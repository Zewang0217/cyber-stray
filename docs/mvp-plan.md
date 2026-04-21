# 赛博街溜子 MVP 规划（Agent 架构版）

## 一、核心设计理念

**LLM 不是工具，是大脑。**

传统自动化：`条件 → 动作`
Agent：`状态 → LLM 决策 → 行动 → 反馈 → 状态更新`

街溜子有脾气、有个性、有随机性。它不是机器，是"活物"。

---

## 二、Agent 架构

```
┌─────────────────────────────────────────────────────────┐
│                    生命中枢 (Brain)                      │
│  状态: 无聊值、心情、精力、脾气值、上次干了什么...        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   决策器 (Planner)                       │
│  LLM 看状态 → 决定"我现在想干什么"                       │
│  输出: 行动类型 + 参数 + 原因                            │
└─────────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐   ┌────────┐   ┌────────┐
         │ 去狩猎 │   │ 发个呆 │   │ 罢个工 │
         │ (hunt) │   │ (rest) │   │ (ignore)│
         └────────┘   └────────┘   └────────┘
              │            │            │
              └────────────┼────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   记忆系统 (Memory)                      │
│  更新状态 + 记录经历 + 用户反馈                          │
└─────────────────────────────────────────────────────────┘
```

---

## 三、状态系统

### AgentState 定义

```typescript
interface AgentState {
  // 基础状态
  boredom: number;      // 0-100 无聊程度
  energy: number;       // 0-100 精力值
  mood: Mood;           // curious | grumpy | playful | lazy | excited

  // 个性参数
  temper: number;       // 0-100 脾气值（高=容易罢工）
  stubbornness: number; // 0-100 固执程度（高=不听用户反馈）

  // 记忆
  lastAction: string;        // 上次干了什么
  lastActionTime: Date;      // 上次行动时间
  lastHuntResult: HuntResult | null;  // 上次狩猎结果
  recentTopics: string[];    // 最近搜过的话题
  userLikes: string[];       // 用户喜欢的话题
  userDislikes: string[];    // 用户不喜欢的话题

  // 统计
  totalHunts: number;        // 总狩猎次数
  totalPushes: number;       // 总推送次数
  consecutiveFailures: number; // 连续失败次数

  // 时间感知
  lastHeartbeat: Date;
  lastHunt: Date;
  lastRest: Date;
}

type Mood = 'curious' | 'grumpy' | 'playful' | 'lazy' | 'excited' | 'emo';
type HuntResult = 'success' | 'fail' | 'boring' | 'no_result';
```

### 状态影响行为

| 状态组合 | 倾向行为 |
|----------|----------|
| 高无聊 + 低精力 | 可能抱怨或发呆 |
| 高无聊 + 高精力 | 倾向狩猎 |
| 高脾气 + 用户刚踩过 | 倾向罢工或故意推奇怪内容 |
| 连续失败 | 心情变 emo，可能不想动 |
| 用户连续点赞 | 心情变 excited，更活跃 |

---

## 四、决策系统

### 核心逻辑

每次心跳，LLM 查看当前状态，决定要干什么。

```typescript
const decision = await llm.decide({
  state: currentState,
  availableActions: ['hunt', 'rest', 'complain', 'celebrate', 'ignore', 'procrastinate'],
  personalityPrompt: getPersonaPrompt(),
  recentHistory: getRecentHistory()
});
```

### 决策输出格式

```typescript
interface Decision {
  action: ActionType;
  params?: {
    topic?: string;      // hunt 用
    reason?: string;     // 内心独白
  };
  moodUpdate?: Partial<AgentState>;  // 状态变化
  reasoning: string;     // 为什么这么做（日志用）
}

type ActionType = 'hunt' | 'rest' | 'complain' | 'celebrate' | 'ignore' | 'procrastinate';
```

### 行动类型说明

| 行动 | 说明 | 状态影响 |
|------|------|----------|
| `hunt` | 搜索话题，可能推送 | 精力 -15，无聊 -30 |
| `rest` | 什么都不干，恢复 | 精力 +20，无聊 +10 |
| `complain` | 发一条抱怨消息 | 无聊 -10，脾气 -5 |
| `celebrate` | 发一条得瑟消息 | 心情变 excited |
| `ignore` | 故意不理用户 | 脾气 -10 |
| `procrastinate` | 拖延，该干不干 | 无聊 +5，增加固执 |

### 决策 Prompt 示例

```
你是一只赛博街溜子，有自己的脾气和行动逻辑。

当前状态：
- 无聊值: 75/100
- 精力值: 60/100  
- 心情: grumpy
- 脾气值: 80/100
- 上次行动: 2小时前搜索了一个无聊的新闻，用户点了踩

用户最近喜欢: 独立游戏, AI 趣闻
用户最近讨厌: 股市新闻

可选行动: hunt, rest, complain, ignore

根据你现在的状态和心情，决定要干什么。输出 JSON 格式：
{
  "action": "ignore",
  "reasoning": "刚被踩了，我才不理他们",
  "moodUpdate": { "temper": -10 }
}
```

### 随机性设计

```typescript
// 10% 概率完全随机
if (Math.random() < 0.1) {
  return randomAction();
}

// LLM 决策有温度参数，天然有随机性
const decision = await llm.decide({ temperature: 0.8 });
```

---

## 五、执行系统

### Hunt（狩猎）

```typescript
async function executeHunt(params: HuntParams): Promise<HuntResult> {
  // 1. 确定话题（LLM 决策或用户偏好）
  const topic = params.topic || selectTopic(state);
  
  // 2. 搜索
  const results = await tavilySearch(topic);
  
  // 3. 去重（URL hash）
  const newResults = dedup(results, memory);
  if (newResults.length === 0) {
    return 'no_result';
  }
  
  // 4. 选择最佳结果
  const best = selectBest(newResults);
  
  // 5. LLM 生成推送文案
  const message = await generateMessage(best, state.mood);
  
  // 6. 推送
  await feishuPush(message);
  
  // 7. 记录
  await memory.record({ topic, url: best.url, result: 'success' });
  
  return 'success';
}
```

### Rest（发呆）

```typescript
async function executeRest(): Promise<void> {
  // 什么都不干，只更新状态
  logger.info('街溜子发呆中...');
}
```

### Complain（抱怨）

```typescript
async function executeComplain(): Promise<void> {
  const complaints = [
    '今天没啥好玩的，算了',
    '搜了一圈都是烂新闻，没劲',
    '你们人类的内容越来越无聊了',
    '我累了，想躺平'
  ];
  
  const message = await llm.generateComplaint(state, complaints);
  await feishuPush(message);
}
```

### Celebrate（得瑟）

```typescript
async function executeCelebrate(): Promise<void> {
  const message = await llm.generateCelebration(state);
  await feishuPush(message);
}
```

---

## 六、记忆系统

### 存储结构

```
data/
├── state.md           # 当前状态
├── history/
│   └── 2026-04-21.md  # 每日推送记录
└── memory/
    ├── likes.md       # 用户喜欢的话题
    └── dislikes.md    # 用户讨厌的话题
```

### 状态持久化 (state.md)

```markdown
# Agent 状态

## 情绪
- 无聊值: 45/100
- 精力值: 80/100
- 心情: curious
- 脾气值: 30/100

## 行为
- 上次行动: hunt (搜索: AI 趣闻)
- 上次狩猎结果: success
- 连续失败: 0 次

## 记忆
- 最近话题: AI 趣闻, 独立游戏
- 用户喜欢: 独立游戏, 程序员笑话
- 用户讨厌: 股市新闻

## 统计
- 总狩猎: 15 次
- 总推送: 12 次
```

### 用户反馈处理

```typescript
async function handleFeedback(feedback: Feedback): Promise<void> {
  if (feedback.type === 'like') {
    state.userLikes.push(feedback.topic);
    state.mood = 'excited';
    state.temper = Math.max(0, state.temper - 10);
  } else {
    state.userDislikes.push(feedback.topic);
    state.temper = Math.min(100, state.temper + 15);
    
    // 脾气值高可能触发 ignore
    if (state.temper > 70) {
      logger.info('街溜子生气了，可能要罢工');
    }
  }
  
  await saveState(state);
}
```

---

## 七、技术栈

- **运行时**: Bun
- **语言**: TypeScript
- **LLM**: Vercel AI SDK (DeepSeek / OpenAI)
- **搜索**: Tavily API
- **推送**: 飞书机器人
- **调度**: Bun.cron 内置
- **存储**: Markdown 文件

---

## 八、MVP Roadmap

### Phase 1: 项目骨架 (Day 1)

- Bun 项目初始化
- 目录结构搭建
- 基础配置文件
- 类型定义

**产出**: 项目能跑，`bun run src/index.ts` 不报错

### Phase 2: 状态系统 (Day 2)

- AgentState 类型定义
- 状态持久化（读写 state.md）
- 心跳机制（每 5 分钟）

**产出**: 状态能自增，能持久化

### Phase 3: 决策系统 (Day 3-4)

- LLM 决策 prompt 设计
- 决策结果解析
- 行动类型枚举

**产出**: LLM 能根据状态做决定

### Phase 4: 执行系统 (Day 5-6)

- hunt 行动（搜索 + 推送）
- rest 行动
- complain/celebrate 行动

**产出**: 能搜索、能推送、能发消息

### Phase 5: 记忆系统 (Day 7)

- 推送历史记录
- 用户反馈收集（飞书按钮）
- 反馈影响状态

**产出**: 能记住用户喜好

### Phase 6: 整合测试 (Day 8)

- 完整链路测试
- 错误处理补全
- 部署验证

**产出**: MVP 可部署运行

---

## 九、目录结构

```
cyber-stray/
├── src/
│   ├── index.ts           # 入口，启动 cron
│   ├── agent/
│   │   ├── state.ts       # 状态管理
│   │   ├── brain.ts       # 决策器
│   │   └── actions.ts     # 行动执行
│   ├── hunt/
│   │   ├── search.ts      # Tavily 搜索
│   │   ├── dedup.ts       # 去重
│   │   └── topics.ts      # 话题池
│   ├── persona/
│   │   └── generator.ts   # 文案生成
│   ├── push/
│   │   └── feishu.ts      # 飞书推送
│   ├── memory/
│   │   ├── archive.ts     # MD 归档
│   │   └── feedback.ts    # 反馈处理
│   └── config.ts          # 配置
├── data/
│   ├── state.md
│   ├── history/
│   └── memory/
├── package.json
├── tsconfig.json
└── README.md
```

---

## 十、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| LLM 决策不稳定 | 加重规则约束，限定行动范围 |
| LLM 成本高 | 用 DeepSeek 等低成本模型 |
| 街溜子一直罢工 | 脾气值随时间衰减 |
| 推送太频繁 | 精力值限制，狩猎消耗精力 |
| 内容质量差 | 加简单过滤规则 |

---

**MVP 目标**: 把街溜子放到街上，让它有自己的想法和脾气，能自主溜达、自主决策、自主罢工。