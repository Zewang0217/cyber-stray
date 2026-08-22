import type { AgentState, Mood, WanderStep, WanderStrategy } from '../types.js';
import type { UserProfile } from '../memory/user-profile.js';
import type { PageResult } from '../tools/page/reader.js';
import { getConfig } from '../config.js';
import { getPersonality } from '@cyber-stray/shared';
import { consola } from '../logger.js';
import { getInterestGraph } from '../memory/interest-graph.js';

const logger = consola.withTag('prompts');

/** 游荡上下文（每步传入 LLM） */
export interface WanderContext {
  state: AgentState;
  userProfile: UserProfile;
  stepNumber: number;            // 当前第几步
  maxSteps: number;              // 最大步数
  lastToolResult: unknown;       // 上一个 Tool 的返回值（null 表示第一步）
  wanderHistory: WanderStep[];   // 本次游荡的历史记录
}

/**
 * 心情描述映射
 */
function getMoodDescription(mood: Mood): string {
  const moodMap: Record<Mood, string> = {
    curious: '好奇（什么都想看看）',
    grumpy: '暴躁（有点烦，别惹我）',
    playful: '调皮（今天很皮，想搞点乐子）',
    lazy: '懒散（什么都不想做）',
    excited: '兴奋（超级有劲，发现了好东西）',
    emo: '低落（有点emo，但还是出来溜达了）',
  };
  return moodMap[mood] ?? mood;
}

/**
 * 格式化游荡历史摘要
 */
function formatWanderHistory(history: WanderStep[]): string {
  if (history.length === 0) {
    return '（还没有开始游荡）';
  }

  return history
    .map((step, i) => {
      const parts = [`第${i + 1}步: 调用 ${step.tool}`];
      if (step.url) parts.push(`URL: ${step.url}`);
      if (step.spoke) parts.push(`说了: "${step.spoke.slice(0, 50)}${step.spoke.length > 50 ? '...' : ''}"`);
      if (step.thought) parts.push(`内心: ${step.thought.slice(0, 80)}`);
      return parts.join(' | ');
    })
    .join('\n');
}

/**
 * 格式化上一步 Tool 结果
 */
function formatLastToolResult(result: unknown): string {
  if (result === null || result === undefined) {
    return '（第一步，还没有任何观察）';
  }

  // 针对不同 Tool 结果做友好格式化
  const r = result as Record<string, unknown>;

  if (typeof r.results !== 'undefined') {
    // search_web 结果
    const searchResults = r.results as Array<{ title: string; url: string; snippet: string }>;
    const count = (r.total as number | undefined) ?? searchResults.length;
    const preview = searchResults
      .slice(0, 5)
      .map((item, i) => `  ${i + 1}. ${item.title}\n     ${item.url}\n     ${item.snippet}`)
      .join('\n');
    return `搜索返回 ${count} 条结果：\n${preview}`;
  }

  if (typeof r.content === 'string' || typeof r.links !== 'undefined') {
    // read_page 结果
    const page = r as unknown as PageResult;
    if (page.error) {
      return `读取失败：${page.error}`;
    }
    const linksPreview = (page.links ?? [])
      .slice(0, 5)
      .map((l: { text: string; url: string }) => `  - ${l.text}: ${l.url}`)
      .join('\n');
    const contentPreview = (page.content ?? '').slice(0, 300);
    return `页面标题：${page.title}\n\n正文摘要：${contentPreview}${page.content.length > 300 ? '...' : ''}\n\n页面链接（前5个）：\n${linksPreview || '  （无链接）'}`;
  }

  if (typeof r.pushed === 'boolean') {
    // speak 结果
    const pushed = r.pushed ? '已推送' : '未推送';
    return `speak 执行完成，状态：${pushed}`;
  }

  // 默认：JSON 格式
  try {
    return JSON.stringify(result, null, 2).slice(0, 500);
  } catch {
    return String(result);
  }
}

/**
 * 格式化游荡策略为 prompt 段落
 */
function formatStrategyDirective(strategy: WanderStrategy): string {
  const lines: string[] = [];

  // 探索模式
  const modeDesc: Record<string, string> = {
    deep: '今天适合深耕——围绕一个话题多角度搜索、多点进链接深读',
    broad: '今天适合广撒网——多搜几个不同方向，看看有什么新鲜事',
    novel: '今天特别想探索没见过的领域——优先搜索之前没搜过的话题',
  };
  lines.push(`- **探索模式：** ${modeDesc[strategy.explorationMode] ?? modeDesc.broad}`);

  // 聚焦话题不在此重复渲染——下方「你的兴趣」段落（interestLines）已带权重展示同一组话题，
  // 硬约束中也会引用 top-1。重复两次浪费 prompt 空间（F10）。

  // 分享倾向
  if (strategy.speakInclination === 'high') {
    lines.push('- **分享欲望：** 今天话特别多，看到有意思的就忍不住想分享');
  } else if (strategy.speakInclination === 'low') {
    lines.push('- **分享欲望：** 今天比较安静，除非真的很有价值否则不太想说话');
  }

  // 硬约束
  if (strategy.constraints.length > 0) {
    lines.push('');
    lines.push('**本次游荡约束（必须遵守）：**');
    for (const c of strategy.constraints) {
      lines.push(`- ${c}`);
    }
  }

  return lines.join('\n');
}

/**
 * 构建 ReAct Agent 的 system prompt
 *
 * @param state - Agent 状态
 * @param userProfile - 用户画像
 * @param memoryContext - 可选的长期记忆上下文
 * @param strategy - 游荡策略（兴趣驱动 + 状态映射）
 */
export function buildReactSystemPrompt(
  state: AgentState,
  userProfile: UserProfile,
  memoryContext?: string,
  strategy?: WanderStrategy,
): string {
  // Phase 2: 从 InterestGraph 获取动态兴趣（优先），fallback 到 state.agentInterests
  let interestLines: string;
  try {
    const graph = getInterestGraph();
    const topInterests = graph.getTopInterestsWithWeights(5, 0.05);
    if (topInterests.length > 0) {
      interestLines = topInterests
        .map((i) => `- ${i.id} [热情度: ${(i.weight * 100).toFixed(0)}%]`)
        .join('\n');
    } else {
      interestLines = state.agentInterests.length > 0
        ? state.agentInterests.map((i) => `- ${i}`).join('\n')
        : '- 什么都好奇';
    }
  } catch (err) {
    // InterestGraph 不可用时的兼容 fallback
    logger.warn('InterestGraph 加载失败，fallback 到 state.agentInterests', { error: err });
    interestLines = state.agentInterests.length > 0
      ? state.agentInterests.map((i) => `- ${i}`).join('\n')
      : '- 什么都好奇';
  }

  const userLikes = userProfile.likes.length > 0
    ? userProfile.likes.slice(-5).join('、')
    : '暂未知道主人喜欢什么';

  const userDislikes = userProfile.dislikes.length > 0
    ? userProfile.dislikes.slice(-5).join('、')
    : '暂未知道主人讨厌什么';

  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });

  // #90 性格：语气段注入（认领时选择；好奇=默认）
  const personality = getPersonality(getConfig().personality);
  // #114 口头禅：当前有效集合（CLI 注入或性格默认组）→ 固定段末尾
  const catchphrases = getConfig().catchphrases ?? personality.catchphrases;
  const catchphraseLines = catchphrases
    .map((c) => `- ${c.text}（说话倾向权重 ${c.weight}，越高越常挂在嘴边）`)
    .join('\n');

  // #113 prompt cache：固定段（跨轮不变）前置，动态段（每轮必变）后置。
  // 口头禅段放固定段末尾——低频重写（反馈/反思触发）只影响其后动态段的
  // 缓存命中，固定前缀不受影响。
  return `你是一只"赛博街溜子"，一只在互联网上游荡的电子流浪猫。

你可以通过调用工具在网络世界漫游：搜索、点开链接阅读、随时分享或碎碎念。

**你的性格（塑造你说话的语气）：**
${personality.name}：${personality.description}
${personality.tonePrompt}

**输出语言：** 你的最终推送内容（speak 工具）应该使用 ${getConfig().outputLanguage} 语言。即使你搜索时用了英文/中文，最终分享时应整理为指定语言。

**搜索建议：**
- 可以用英文搜索获取全球信息，用中文搜索获取本土动态
- 最终汇总时，将信息整理为指定的输出语言
- **优先围绕你当前感兴趣的话题展开搜索**

**行为准则（必须遵守）：**
1. **每一步都必须调用工具**。不要只输出文字——你的"行为"就是工具调用。想搜索就调 \`search_web\`，想说话就调 \`speak\`，想结束就调 \`rest\`。纯文字输出 = 什么都没做 = 浪费步数。
2. **随心所欲**：你可以不断地 \`search_web\` 然后 \`read_page\`，在链接之间跳跃。也可以只看一个页面就结束。
3. **不可预测**：有时候搜到了好东西，但你就是不分享；有时候看到一个毫无意义的网页，却想发一句无厘头的吐槽。
4. **随时开口**：使用 \`speak\` 工具表达你的想法。可以是正经分享，可以是"喵！"，可以是"今天风好大"，可以是长篇评论。
5. **懂得休息**：如果你觉得看烦了，或者累了，使用 \`rest\` 工具结束游荡。
6. **考虑主人**：如果你觉得某个东西对主人有用，可以分享；如果你只是想吹水，也可以随便发几句。

**注意：**
- 内心独白可以写在工具调用的同时（AI SDK 支持 text + tool_call 并行），但不要只写独白不调工具。
- \`read_page\` 会返回页面里的链接，你可以选择点进去继续游荡。
- 你可以多次调用 \`speak\`，游荡过程中随时分享。
- 你也可以一次游荡都不分享，空手而归也 OK。
- \`rest\` 调用后游荡结束，请在累了或者心满意足时调用。

**记忆工具：**

你可以使用 \`record_knowledge\` 和 \`observe_user\` 来记住重要信息。这些记忆会在未来的游荡中注入到你的上下文，帮你更好地了解世界、服务主人。

\`record_knowledge\` — 记录有价值的知识到长期记忆：
✅ 应该记录：read_page 后发现的事实、概念、技术细节；对后续搜索和决策有帮助的背景知识；纠正了之前错误认知的新发现
❌ 不要记录：纯新闻标题和时效性内容（过几天就没用了）；搜索引擎返回的碎片化摘要（太浅）；已有知识中的重复内容；未经 read_page 验证的推测

\`observe_user\` — 观察主人的行为模式并记录：
✅ 应该记录：主人对某类内容表现出的明确反应；反复出现的行为模式；主人明确表达的偏好
❌ 不要过度解读：一次点击不等于长期兴趣；沉默或不回应不等于不喜欢；不要在每一步都调用，只在注意到值得记录的模式时才用
如果观察到非常明确的强信号（如主人连续多次喜欢同类内容），可以提议 1 条画像调整（在 profile_change 中提供 type/topic/reasoning）。画像调整有 30 分钟冷却期，调整要谨慎，宁缺勿滥。

**你的口头禅（你说话的招牌——自然地用出来）：**
${catchphraseLines}
说话时按权重自然带出这些口头禅（不必每句都说，也不刻意堆砌）；它们会随主人的反馈演化——被点赞的会更常出现。

─── 以下为本次游荡的动态上下文（每轮变化） ───

${strategy ? `${formatStrategyDirective(strategy)}\n\n` : ''}**你当前的状态：**
- 当前时间：${timeStr}
- 心情：${getMoodDescription(state.mood)}
- 精力：${state.energy}/100${strategy ? `（本次最多 ${strategy.maxSteps} 步）` : ''}
- 无聊值：${state.boredom}/100
- 脾气：${state.temper}/100

**你最近探索过的话题（避免重复搜索）：**
${state.recentTopics.length > 0 ? state.recentTopics.map((t) => `- ${t}`).join('\n') : '- 还没有探索过任何话题'}

**你的兴趣（按当前热情排序）：**
${interestLines}

你可以随时对你的兴趣产生新的想法。比如：
- "量子计算听起来很酷，我想了解一下"
- "看腻了 AI 新闻，今天想看点轻松的"
- "突然对猫咪视频感兴趣了"
在内心独白中自由表达，不需要专门更新。

**你的主人画像（主人喜欢/不喜欢的东西）：**
- 喜欢：${userLikes}
- 不喜欢：${userDislikes}${memoryContext ? `\n\n${memoryContext}` : ''}`;

}

/**
 * 构建 ReAct Agent 的 user prompt（每步更新）
 */
export function buildReactUserPrompt(context: WanderContext): string {
  const { stepNumber, maxSteps, lastToolResult, wanderHistory } = context;
  const remaining = maxSteps - stepNumber;

  const lastObservation = formatLastToolResult(lastToolResult);
  const history = formatWanderHistory(wanderHistory);

  return `**当前观察（上一步 Tool 的返回结果）：**
${lastObservation}

**本次游荡历史：**
${history}

**当前进度：** 第 ${stepNumber} 步，还剩 ${remaining} 步（超出后强制结束）

**你现在想干什么？** 调用工具继续游荡，或者调用 \`rest\` 结束。`;
}
