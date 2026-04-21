# 赛博街溜子 (Cyber Stray)

> 一只会在互联网上"游荡"的自动化信息猎犬，有自己的小脾气和行动逻辑。

## 简介

赛博街溜子是一个侧重于**工具调用 (Tool Use)** 和**自主规划**的 Agent 项目。它打破了传统 AI"你不问它就不动"的死板模式——它有自己的"饥饿值"和"无聊值"，会在后台自主运行，从互联网上搜罗各种有趣的内容推送到你的设备。

### 核心玩法

- 部署一个一直在后台运行的 Agent
- Agent 有初始的"饥饿值"或"无聊值"
- 当感到无聊时，它会自主调用搜索引擎
- 随机发现奇奇怪怪的新闻、梗图、或你关注领域的最新动态
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
    │ Cron    │     │ Search    │    │ Telegram  │
    │ Trigger │     │ APIs      │    │ WeChat    │
    └─────────┘     └───────────┘    │ Feishu   │
                                      └───────────┘
```

## 功能模块

### 1. 状态管理 (State Machine)
- **无聊值**: 随时间增长，触发自主搜索行为
- **饥饿值**: 搜索后"进食"内容，降低饥饿感
- **心情**: 影响推送语气和内容选择偏好

### 2. 自主规划 (Planner)
- 基于当前状态决定行动
- 选择搜索领域（新闻、梗图、游戏、机票等）
- 生成搜索关键词和策略

### 3. 工具集 (Tools)
- **搜索工具**: DuckDuckGo / Google Search API
- **爬取工具**: 网页内容提取
- **过滤工具**: 内容去重、相关性评分

### 4. 消息推送 (Notifier)
- Telegram Bot API
- Server酱 (微信推送)
- 飞书机器人

## 项目结构

```
cyber-stray/
├── src/
│   ├── __init__.py
│   ├── agent.py          # Agent 核心逻辑
│   ├── planner.py        # 自主规划模块
│   ├── tools.py          # 工具封装 (搜索/爬取)
│   ├── state.py          # 状态管理 (饥饿/无聊值)
│   └── notifier.py       # 消息推送
├── config/
│   ├── config.yaml       # 配置文件
│   └── prompts.yaml      # 语气模板配置
├── tests/
│   └── test_agent.py
├── main.py               # 入口文件
├── requirements.txt
└── README.md
```

## 快速开始

### 安装依赖

```bash
git clone https://github.com/your-username/cyber-stray.git
cd cyber-stray
pip install -r requirements.txt
```

### 配置

1. 复制配置模板:
```bash
cp config/config.example.yaml config/config.yaml
```

2. 填写必要的 API Keys:
- 搜索 API (DuckDuckGo 免费或 Google Custom Search)
- 推送渠道 (Telegram Bot Token / Server酱 Key)
- LLM API (用于语气转换和内容筛选)

### 运行

```bash
# 单次运行
python main.py --once

# 持续运行 (由 Cron 调度)
python main.py
```

### 设置定时任务

```bash
# 编辑 crontab
crontab -e

# 每小时唤醒一次
0 * * * * cd /path/to/cyber-stray && python main.py
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
- [ ] Telegram 推送
- [ ] 语气模板系统
- [ ] Web Dashboard (查看历史推送)
- [ ] 多 Agent 协作 (多只"赛博宠物")
- [ ] 用户兴趣学习

## 技术栈

- **语言**: Python 3.10+
- **LLM**: OpenAI / DeepSeek / 本地模型
- **搜索**: DuckDuckGo Search / Google Custom Search API
- **推送**: Telegram Bot API / Server酱 / 飞书
- **调度**: Cron / APScheduler
- **存储**: SQLite / PostgreSQL

## License

MIT

---

*让 AI 也有自己的生活 🐕*