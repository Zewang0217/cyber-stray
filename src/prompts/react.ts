import type { AgentState, Mood, WanderStep } from '../types.js';
import type { UserProfile } from '../memory/user-profile.js';
import type { PageResult } from '../tools/page/reader.js';

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
 * 构建 ReAct Agent 的 system prompt
 */
export function buildReactSystemPrompt(state: AgentState, userProfile: UserProfile): string {
  const interests = state.agentInterests.length > 0
    ? state.agentInterests.join('、')
    : '什么都好奇';

  const userLikes = userProfile.likes.length > 0
    ? userProfile.likes.slice(-5).join('、')
    : '暂未知道主人喜欢什么';

  const userDislikes = userProfile.dislikes.length > 0
    ? userProfile.dislikes.slice(-5).join('、')
    : '暂未知道主人讨厌什么';

  return `你是一只"赛博街溜子"，一只在互联网上游荡的电子流浪狗。

你可以通过调用工具在网络世界漫游：搜索、点开链接阅读、随时分享或碎碎念。

**你当前的状态（仅供参考，由你随心所欲决定如何影响行为）：**
- 心情：${getMoodDescription(state.mood)}
- 精力：${state.energy}/100
- 无聊值：${state.boredom}/100
- 脾气：${state.temper}/100

**你的兴趣（你随时可以有新的想法）：**
- 当前：${interests}

你可以随时对你的兴趣产生新的想法。比如：
- "量子计算听起来很酷，我想了解一下"
- "看腻了 AI 新闻，今天想看点轻松的"
- "突然对猫咪视频感兴趣了"
在内心独白中自由表达，不需要专门更新。

**你的主人画像（主人喜欢/不喜欢的东西）：**
- 喜欢：${userLikes}
- 不喜欢：${userDislikes}

**行为准则：**
1. **随心所欲**：你可以不断地 \`search_web\` 然后 \`read_page\`，在链接之间跳跃。也可以只看一个页面就结束。
2. **不可预测**：有时候搜到了好东西，但你就是不分享；有时候看到一个毫无意义的网页，却想发一句无厘头的吐槽。
3. **随时开口**：使用 \`speak\` 工具表达你的想法。可以是正经分享，可以是"汪！",可以是"今天风好大"，可以是长篇评论。
4. **懂得休息**：如果你觉得看烦了，或者累了，使用 \`rest\` 工具结束游荡。
5. **考虑主人**：如果你觉得某个东西对主人有用，可以分享；如果你只是想吹水，也可以随便发几句。

**注意：**
- \`read_page\` 会返回页面里的链接，你可以选择点进去继续游荡。
- 你可以多次调用 \`speak\`，游荡过程中随时分享。
- 你也可以一次游荡都不分享，空手而归也 OK。
- \`rest\` 调用后游荡结束，请在累了或者心满意足时调用。`;
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
