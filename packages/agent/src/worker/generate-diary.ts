/**
 * runDiaryWorker — 睡前任务：租户化短命 worker 入口（#92 日记系统 / #93 梦境）
 *
 * 非游荡 worker（睡眠开始时由控制面调度器拉起）：读当天足迹/新兴趣/主人
 * 反馈 → 按性格 diaryStyle（+ 用户可配风格覆盖）生成性格化日记 markdown →
 * 落盘租户目录 diary/YYYY-MM-DD.md；**同刻**（同一次任务、同一份素材）生成
 * 当晚梦境叙事 → 独立文件 diary/dreams/YYYY-MM-DD.md（ADR-0002：梦境与日记
 * 分离，夜间访问零延迟读取）。内容源全部是现有数据，零新采集。
 *
 * 与 runOneWander 同构：设置租户上下文 → 管道 → 清除上下文 → 返回结果。
 * 由日记 worker CLI（diary-cli.ts）调用；调度器经 diary-runner spawn。
 * 触发复用 #92 判定（睡眠开始 / 固定 23 点）——梦境不引入新调度逻辑。
 */

import { createDeepSeek } from '@ai-sdk/deepseek';
import { getPersonality, type PersonalityId } from '@cyber-stray/shared';
import { DIARY_STYLE_NAMES, isDiaryStyleChoice, resolveDiaryStylePrompt, type DiaryStyleChoice } from '@cyber-stray/shared/diary';
import { loadConfig, setTenantContext } from '../config.js';
import type { AgentSecrets, PlanExecutionArgs } from '../types.js';
import {
  buildDiaryPrompt,
  collectDiaryData,
  generateDiaryNarrative,
  hasDiaryContent,
  recordDiaryForPush,
  renderDiaryMarkdown,
  writeDiaryMarkdown,
} from '../memory/diary/diary-generator.js';
import {
  buildDreamPrompt,
  generateDreamNarrative,
  hasDreamContent,
  renderDreamMarkdown,
  writeDreamMarkdown,
} from '../memory/diary/dream-generator.js';

/** runDiaryWorker 入参 */
export interface DiaryWorkerOptions {
  /** 租户键（仅标识与日志） */
  tenantId: string;
  /** 该租户隔离的数据目录（DATA_DIR） */
  dataDir: string;
  /** 日记日期（YYYY-MM-DD；缺省 = 本地当天） */
  date?: string;
  /** 性格（#90：diaryStyle 模板来源） */
  personality?: PersonalityId;
  /** 日记风格选择（用户可配；'personality' = 跟随性格，默认） */
  diaryStyle?: DiaryStyleChoice;
  /** 宠物名（日记头展示） */
  petName: string;
  /** 是否推送日记（开启则写 notifiable speak 记录，Web Push 送达） */
  pushEnabled?: boolean;
  /** per-tenant 敏感信息（控制面解密后注入；缺省回退进程 env） */
  secrets?: AgentSecrets;
  /** 套餐执行参数（门控；缺省 = 单用户模式） */
  planArgs?: PlanExecutionArgs;
  /** LLM 温度（缺省 0.8） */
  temperature?: number;
}

/** runDiaryWorker 结果 */
export interface DiaryWorkerResult {
  date: string;
  /** 今天无事可记（三段全空）→ 跳过生成 */
  skipped: boolean;
  /** 落盘路径（未跳过时有值） */
  file?: string;
  /** 当晚梦境落盘路径（#93：与日记同刻生成；素材 = 兴趣+足迹非空时有值） */
  dreamFile?: string;
  /** 是否推送（开启且有内容时 true） */
  pushed?: boolean;
  /** 使用的最终风格 prompt（可观测：不同性格/风格可感知差异） */
  stylePrompt?: string;
  personality: string;
}

/** 本地当天日期（YYYY-MM-DD） */
export function todayDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 执行一次睡前日记任务（设置租户上下文 → 收集/生成/落盘/推送 → 清除）。
 * 失败抛错（不兜底），CLI 层转退出码。默认性格好奇（与存量一致）。
 */
export async function runDiaryWorker(options: DiaryWorkerOptions): Promise<DiaryWorkerResult> {
  const personality = getPersonality(options.personality ?? 'curious');
  const styleChoice = options.diaryStyle ?? 'personality';
  if (!isDiaryStyleChoice(styleChoice)) {
    throw new Error(`非法日记风格: ${String(styleChoice)}`);
  }
  const date = options.date ?? todayDate();

  const config = loadConfig(options.dataDir, options.secrets, options.planArgs, options.personality);
  setTenantContext({ tenantId: options.tenantId, dataDir: options.dataDir, config });
  try {
    const data = await collectDiaryData(date, options.petName);
    if (!hasDiaryContent(data)) {
      return {
        date,
        skipped: true,
        personality: personality.name,
      };
    }

    const provider = createDeepSeek({
      apiKey:
        config.plan?.plan === 'byok'
          ? config.secrets?.deepseekApiKey
          : (config.secrets?.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY),
    });
    const model = provider.chat(config.llmModel);
    const narrative = await generateDiaryNarrative(
      buildDiaryPrompt(data, personality, styleChoice),
      model,
      options.temperature ?? 0.8,
    );

    const styleLabel =
      styleChoice === 'personality'
        ? `随性格（${personality.name}）`
        : DIARY_STYLE_NAMES[styleChoice];
    const markdown = renderDiaryMarkdown(narrative, {
      date,
      petName: options.petName,
      personalityName: personality.name,
      styleLabel,
    });
    const file = await writeDiaryMarkdown(date, markdown);

    // #93 梦境：与日记同刻、同素材生成，落盘独立文件 diary/dreams/YYYY-MM-DD.md。
    // 素材 = 当天兴趣 + 足迹（反馈不进梦境）；两者皆空 = 当晚无梦（不生成文件，
    // 不视为失败——日记仍可能因反馈生成）。失败抛错（禁兜底），任务整体重试。
    let dreamFile: string | undefined;
    if (hasDreamContent(data)) {
      const dreamNarrative = await generateDreamNarrative(
        buildDreamPrompt(data, personality),
        model,
        options.temperature ?? 0.8,
      );
      const dreamMarkdown = renderDreamMarkdown(dreamNarrative, {
        date,
        petName: options.petName,
        personalityName: personality.name,
      });
      dreamFile = await writeDreamMarkdown(date, dreamMarkdown);
    }

    // 推送：开启则写 notifiable speak 记录（Web Push 经 diary_generated 事件送达）
    let pushed = false;
    if (options.pushEnabled) {
      await recordDiaryForPush(markdown);
      pushed = true;
    }

    return {
      date,
      skipped: false,
      file,
      dreamFile,
      pushed,
      stylePrompt: resolveDiaryStylePrompt(styleChoice, personality.diaryStyle),
      personality: personality.name,
    };
  } finally {
    setTenantContext(null);
  }
}
