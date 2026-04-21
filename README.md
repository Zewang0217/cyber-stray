# 赛博街溜子 (Cyber Stray)

> 一只会在互联网上"游荡"的自动化信息猎犬，有自己的小脾气和行动逻辑。

## 简介

赛博街溜子是一个侧重于**工具调用 (Tool Use)** 和**自主规划**的 Agent 项目。它打破了传统 AI"你不问它就不动"的死板模式——它有自己的"饥饿值"和"无聊值"，会在后台自主运行，从互联网上搜罗各种有趣的内容推送到你的设备。

### 核心玩法

- 郦署一个一直在后台运行的 Agent
- Agent 有初始的"饥饿值"或"无聊值"
- 当感到无聊时，它会自主调用搜索引擎
- 机发现奇奇怪怪的新闻、梗图、或你关注领域的最新动态
- 用特定的语气（海盗腔、脱口秀风格等）把内容推送到你的设备

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│                   Cyber Stray Agent                 │
├─────────────┬─────────────┬─────────────┬──────────┤
│  State Mgr  │   Planner   │   Tools     │ Notifier │
│  (饥饿/无聊) │  (自主规划)  │  (搜索/爬取) │ (消息推送)│
└─────────────┴─────────────┴─────────────┴──────────┘
         │                │                │
    ┌────▼────┐     ┌─────▼─────┐    ┌─────▼─────┐
    │ Bun     │     │ Search    │    │ Telegram  │
    │ Cron    │     │ APIs      │    │ Feishu    │
    └─────────┘     └───────────┘    └───────────┘
```

## 功能模块

### 1. 状态管理 (State Machine)
- **无聊值**: 随时间增长，触发自主搜索行为
- **饥饿值**: 搜索后"进食"内容，降低饥饿感
- **心情**: 影响推送语气和内容选择偏好

### 2. 自主规划 (Planner)
- 基于当前状态决定行动
- 选择搜索领域（新闻、梗图、游戏、技术等）
- 生成搜索关键词和策略

### 3. 工具集 (Tools)
- **搜索工具**: DuckDuckGo / Tavily API
- **爬取工具**: 网页内容提取
- **过滤工具**: 内容去重、相关性评分

### 4. 消息推送 (Notifier)
- Telegram Bot API
- 飞书机器人

## 项目结构

```
cyber-stray/
├── src/
│   ├── agent.ts          # Agent 核心逻辑
│   ├── planner.ts        # 自主规划模块
│   ├── tools/
│   │   ├── search.ts     # 搜索封装
│   │   ├── fetch.ts      # 网页抓取
│   │   └── filter.ts     # 内容过滤
│   ├── state.ts          # 状态管理 (饥饿/无聊值)
│   ├── notifier/
│   │   ├── telegram.ts
│   │   └── feishu.ts
│   ├── prompts.ts        # 语气模板
│   └── index.ts          # 入口文件
├── config/
│   └── config.ts         # 配置
├── tests/
├── package.json
├── tsconfig.json
└── README.md
```

## 快速开始

### 安装依赖

```bash
git clone https://github.com/your-username/cyber-stray.git
cd cyber-stray
bun install
```

### 配置

1. 创建 `config/config.ts`，填写必要的 API Keys:
- 搜索 API (Tavily / DuckDuckGo)
- 推送渠道 (Telegram Bot Token / 飞书 App Credentials)
- LLM API (用于语气转换和内容筛选)

### 运行

```bash
# 单次运行
bun run src/index.ts --once

# 持续运行 (内嵌 cron 调度)
bun run src/index.ts
```

### 设置定时任务（可选）

也可以用外部 cron 定期唤醒：

```bash
# 每小时唤醒一次
0 * * * * cd /path/to/cyber-stray && bun run src/index.ts --once
```

## 推送语气示例

### 海盗模式 🏴‍☠️
```
啊哈！俺在赛博七海发现了个宝贝！
📰 "独立游戏《星露谷物语》开发商宣布新作"
这帮旱鸭子游戏开发者又整活儿了！快去看看吧，陆地人！
```

### 脱口秀模式 🎤
```
各位观众朋友们，你们绝对不会相信我今天挖到了什么...
📰 "科学家发现猫其实能听懂自己的名字，只是假装听不见"
这解释了太多事情了！我家猫听完都笑了，然后继续装聋。
```

## 开发路线图

- [ ] 基础框架搭建
- [ ] 状态管理模块
- [ ] 搜索工具集成
- [ ] Telegram / 飞书推送
- [ ] 语气模板系统
- [ ] Web Dashboard (查看历史推送)
- [ ] 多 Agent 协作 (多只"赛博宠物")
- [ ] 用户兴趣学习

## 技术栈

- **运行时**: Bun
- **语言**: TypeScript
- **LLM**: Vercel AI SDK (OpenAI / DeepSeek / Claude)
- **搜索**: Tavily API / DuckDuckGo
- **推送**: Telegram Bot API / 飞书
- **调度**: Bun 内置 cron 或外部 cron
- **存储**: JSON 文件 / SQLite (better-sqlite3)

## License

MIT

---

*让 AI 也有自己的生活 🐕*