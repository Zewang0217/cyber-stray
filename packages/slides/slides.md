---
theme: seriph
themeConfig:
  primary: '#5d8392'
  secondary: '#8bb4c4'
  accent: '#f0a500'
  background: '#0f172a'
  neutrals: '#e2e8f0'
title: Cyber-Stray
subtitle: 赛博共生体
author: Cyber-Stray Team
date: 2026/05/09
colorSchema: dark
transition: slide-left
---

# Cyber-Stray
## 你的赛博共生体

<div class="absolute bottom-12 left-1/2 -translate-x-1/2 text-center">
  <p class="text-lg opacity-70">全天候信息猎手 · 数字世界的游侠</p>
</div>

<style>
h1 {
  background: linear-gradient(135deg, #5d8392, #8bb4c4, #f0a500);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: 5rem !important;
}
</style>

---
layout: section
---

# 01

## 痛点

### 数字时代的孤独

---

# 信息大爆炸

<div class="grid grid-cols-2 gap-8 mt-8">
  <div v-click class="text-center p-8 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900">
    <div class="text-7xl font-bold text-cyan-400 mb-4" v-motion :initial="{ scale: 0 }" :enter="{ scale: 1, transition: { duration: 800 } }">
      4.9B
    </div>
    <p class="text-xl text-slate-300">全球互联网用户</p>
    <p class="text-sm text-slate-500 mt-2">每天产生 3.3 亿 TB 数据</p>
  </div>

  <div v-click="+1" class="text-center p-8 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900">
    <div class="text-7xl font-bold text-amber-400 mb-4" v-motion :initial="{ scale: 0 }" :enter="{ scale: 1, delay: 200, transition: { duration: 800 } }">
      73%
    </div>
    <p class="text-xl text-slate-300">患 FOMO 症状</p>
    <p class="text-sm text-slate-500 mt-2">错失恐惧症</p>
  </div>
</div>

<div v-click="+2" class="mt-8 text-center">
  <p class="text-2xl text-slate-400">
    <span class="text-cyan-400 font-bold">我们</span> 每天被海量碎片化信息淹没
  </p>
</div>

---

# 传统 AI 的局限

<div class="grid grid-cols-3 gap-6 mt-12">
  <div v-click class="p-6 rounded-xl bg-slate-800/50 border border-slate-700 text-center">
    <div class="text-4xl mb-4">🤖</div>
    <h3 class="text-lg font-bold text-slate-200 mb-2">被动响应</h3>
    <p class="text-sm text-slate-400">你问，它才答</p>
  </div>

  <div v-click="+1" class="p-6 rounded-xl bg-slate-800/50 border border-slate-700 text-center">
    <div class="text-4xl mb-4">⏰</div>
    <h3 class="text-lg font-bold text-slate-200 mb-2">时间受限</h3>
    <p class="text-sm text-slate-400">闭眼即停止</p>
  </div>

  <div v-click="+2" class="p-6 rounded-xl bg-slate-800/50 border border-slate-700 text-center">
    <div class="text-4xl mb-4">❄️</div>
    <h3 class="text-lg font-bold text-slate-200 mb-2">冰冷工具</h3>
    <p class="text-sm text-slate-400">无记忆、无情感</p>
  </div>
</div>

<div v-click="+3" class="mt-8 text-center">
  <p class="text-xl text-amber-400 font-medium">
    我们需要的不只是工具，而是一个<span class="text-cyan-400">全天候在线的数字分身</span>
  </p>
</div>

---
layout: section
---

# 02

## 概念

### Cyber-Stray 的前世今生

---

# 赛博流浪者

<div class="grid grid-cols-2 gap-12 items-center">
<div v-click>

在浩瀚的<span class="text-cyan-400 font-bold">赛博荒原</span>上，有无数游离的数据碎片。

我们的项目最初就像一个**赛博流浪者 (Cyber-Stray)**：

- 🏃 没有实体
- 🌐 在网络世界漫游
- 🔍 漫无目的地游荡

</div>

<div v-click="+1" class="text-center">

```mermaid
graph LR
    A[🏝️ 赛博荒原] -->|漫游| B[🔮 流浪者]
    B -->|遇到宿主| C[🎯 数字猎手]
    C -->|进化| D[🤝 赛博共生体]

    style A fill:#1e293b,stroke:#64748b
    style B fill:#1e3a5f,stroke:#5d8392
    style C fill:#1e3a5f,stroke:#8bb4c4
    style D fill:#1e3a5f,stroke:#f0a500
```

<div class="mt-4 text-slate-400 text-sm">
  流浪者 → 宿主 → 觉醒 → 共生
</div>

</div>
</div>

<div v-click="+2" class="mt-8 p-4 rounded-lg bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border border-cyan-800/50 text-center">
  <p class="text-lg text-slate-200">
    直到它遇到了它的<span class="text-amber-400 font-bold">"宿主"</span>——<span class="text-cyan-400">流浪者找到了归宿，故事由此开始</span>
  </p>
</div>

---
layout: section
---

# 03

## 机制

### 狩猎与自我进化

---

# 三大核心能力

<div class="grid grid-cols-3 gap-8 mt-12">

<div v-click class="group">
  <div class="p-8 rounded-2xl bg-gradient-to-br from-cyan-900/30 to-blue-900/30 border border-cyan-700/50 h-full transition-all duration-300 group-hover:border-cyan-500 group-hover:shadow-lg group-hover:shadow-cyan-500/20">
    <div class="mb-6">
      <svg class="w-16 h-16 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        <path d="M2 12h20"/>
      </svg>
    </div>
    <h3 class="text-2xl font-bold text-cyan-400 mb-3">24/7 全天候巡航</h3>
    <p class="text-slate-300">当你在现实世界沉睡，它在赛博空间苏醒，游走于各大信息源之间</p>
    <div class="mt-4 text-sm text-cyan-500">不眠不休 · 持续守护</div>
  </div>
</div>

<div v-click="+1" class="group">
  <div class="p-8 rounded-2xl bg-gradient-to-br from-amber-900/30 to-orange-900/30 border border-amber-700/50 h-full transition-all duration-300 group-hover:border-amber-500 group-hover:shadow-lg group-hover:shadow-amber-500/20">
    <div class="mb-6">
      <svg class="w-16 h-16 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
        <path d="M11 8v6"/>
        <path d="M8 11h6"/>
      </svg>
    </div>
    <h3 class="text-2xl font-bold text-amber-400 mb-3">精准狩猎</h3>
    <p class="text-slate-300">前沿论文、行业新闻、小众资讯——像猎犬一样精准嗅探并捕获</p>
    <div class="mt-4 text-sm text-amber-500">精准定位 · 智能过滤</div>
  </div>
</div>

<div v-click="+2" class="group">
  <div class="p-8 rounded-2xl bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-purple-700/50 h-full transition-all duration-300 group-hover:border-purple-500 group-hover:shadow-lg group-hover:shadow-purple-500/20">
    <div class="mb-6">
      <svg class="w-16 h-16 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 2v4"/>
        <path d="M12 18v4"/>
        <path d="M4.93 4.93l2.83 2.83"/>
        <path d="M16.24 16.24l2.83 2.83"/>
        <path d="M2 12h4"/>
        <path d="M18 12h4"/>
        <path d="M4.93 19.07l2.83-2.83"/>
        <path d="M16.24 7.76l2.83-2.83"/>
        <circle cx="12" cy="12" r="4"/>
      </svg>
    </div>
    <h3 class="text-2xl font-bold text-purple-400 mb-3">自我进化</h3>
    <p class="text-slate-300">通过每次交互、每次反馈，相处越久，越懂你的心智模型</p>
    <div class="mt-4 text-sm text-purple-500">持续学习 · 越用越懂你</div>
  </div>
</div>

</div>

---

# 系统架构

```mermaid {scale: 0.7}
graph TB
    subgraph User["🎯 用户"]
        U[终端设备]
    end

    subgraph Core["⚙️ Cyber-Stray 核心"]
        AGENT[🤖 AI Agent<br/>ReAct Loop]
        MEM[🧠 三层记忆系统<br/>用户画像 · 长期记忆 · 上下文]
        STATE[📊 状态管理<br/>心情 · 精力 · Temper]
    end

    subgraph Actions["🔧 行动模块"]
        SEARCH[🔍 信息搜索<br/>多源聚合]
        READ[📖 内容解析<br/>提炼精华]
        PUSH[📨 智能推送<br/>飞书/微信]
        REST[😴 自主休息<br/>能量管理]
    end

    subgraph Sources["📡 信息源"]
        NEWS[📰 新闻]
        PAPER[📚 论文]
        SOCIAL[💬 社交媒体]
    end

    U <-->|交互| AGENT
    AGENT <--> MEM
    AGENT <--> STATE
    AGENT --> SEARCH
    SEARCH --> Sources
    Sources -->|反馈| READ
    READ -->|提炼| PUSH
    PUSH --> U
    AGENT <-->|消耗/恢复| STATE
    AGENT -->|累了| REST

    style User fill:#1e293b,stroke:#5d8392
    style Core fill:#1e3a5f,stroke:#8bb4c4
    style Actions fill:#1e293b,stroke:#f0a500
    style Sources fill:#0f172a,stroke:#64748b
```

---

# 自我进化机制

<div class="grid grid-cols-2 gap-12 mt-8">

<div>

```mermaid
graph LR
    A[👤 用户交互] -->|点赞| B[👍 正反馈]
    A -->|忽略| C[👎 负反馈]
    A -->|追问| D[🔍 深度理解]

    B --> E[(记忆强化)]
    C --> E
    D --> E

    E --> F[🎯 偏好更新]
    F --> G[💡 更精准的推送]
    G --> A

    style A fill:#1e293b,stroke:#5d8392
    style E fill:#1e3a5f,stroke:#8bb4c4
    style G fill:#1e3a5f,stroke:#f0a500
```

</div>

<div v-click class="space-y-4">

<div class="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
  <div class="flex items-center gap-3">
    <span class="text-2xl">🎯</span>
    <div>
      <h4 class="font-bold text-slate-200">用户画像学习</h4>
      <p class="text-sm text-slate-400">追踪兴趣领域、阅读偏好、互动模式</p>
    </div>
  </div>
</div>

<div v-click="+1" class="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
  <div class="flex items-center gap-3">
    <span class="text-2xl">🧬</span>
    <div>
      <h4 class="font-bold text-slate-200">长期记忆积累</h4>
      <p class="text-sm text-slate-400">重要信息持久化，跨会话上下文延续</p>
    </div>
  </div>
</div>

<div v-click="+2" class="p-4 rounded-lg bg-slate-800/50 border border-amber-700/50 bg-gradient-to-r from-amber-900/20">
  <div class="flex items-center gap-3">
    <span class="text-2xl">✨</span>
    <div>
      <h4 class="font-bold text-amber-400">100% 定制化</h4>
      <p class="text-sm text-slate-300">最终成为世界上唯一契合你的灵魂伴侣</p>
    </div>
  </div>
</div>

</div>

</div>

---
layout: section
---

# 04

## 自进化

### 从"会聊天"，到"会成长"

---

# 双图谱：它开始有了自己的品味

<div class="grid grid-cols-2 gap-8 mt-8">

<div v-click class="group">
  <div class="p-8 rounded-2xl bg-gradient-to-br from-cyan-900/30 to-blue-900/30 border border-cyan-700/50 h-full transition-all duration-300 group-hover:border-cyan-500">
    <div class="text-4xl mb-4">👤</div>
    <h3 class="text-2xl font-bold text-cyan-400 mb-3">用户兴趣图谱</h3>
    <p class="text-xs text-slate-500 font-mono mb-4">user-interests.json</p>
    <div class="space-y-2 text-slate-300">
      <p>主人想看什么 → 驱动<span class="text-cyan-400 font-bold">相关性</span></p>
      <p class="text-sm text-slate-400">领养仪式种子 + 反馈信号 + 反思洞察，按强 / 中 / 弱分级注入决策</p>
    </div>
  </div>
</div>

<div v-click="+1" class="group">
  <div class="p-8 rounded-2xl bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-purple-700/50 h-full transition-all duration-300 group-hover:border-purple-500">
    <div class="text-4xl mb-4">🐈</div>
    <h3 class="text-2xl font-bold text-purple-400 mb-3">宠物好奇图谱</h3>
    <p class="text-xs text-slate-500 font-mono mb-4">curiosity-interests.json</p>
    <div class="space-y-2 text-slate-300">
      <p>它自己想探索什么 → 驱动<span class="text-purple-400 font-bold">新奇</span></p>
      <p class="text-sm text-slate-400">exploreCount 记录游荡足迹；selfInterest 是它反思时自己的判断："我对这个感兴趣吗"</p>
    </div>
  </div>
</div>

</div>

<div v-click="+2" class="mt-8 p-4 rounded-lg bg-gradient-to-r from-amber-900/20 to-cyan-900/20 border border-amber-700/50 text-center">
  <p class="text-lg text-slate-200">
    同一套话题树，两种视角——<span class="text-cyan-400">你想看的</span>与<span class="text-purple-400">它想聊的</span>，共同决定每一次分享
  </p>
</div>

---

# 权重更新：像免疫系统一样校准

<div v-click class="mt-6 p-6 rounded-xl bg-slate-900/80 border border-cyan-800/50 text-center">
  <p class="text-xl font-mono text-cyan-300">
    新权重 = 旧权重 ± 强度 × <span class="text-amber-400">阻尼</span>(1/(1+0.2n)) × <span class="text-amber-400">(1 − 旧权重)</span>
  </p>
  <p class="text-sm text-slate-500 mt-2">like +1.0 · boost +2.0 · dislike −1.5，钳制在 [0, 0.8]</p>
</div>

<div class="grid grid-cols-2 gap-6 mt-6">
  <div v-click="+1" class="p-5 rounded-xl bg-slate-800/50 border border-slate-700">
    <h4 class="font-bold text-slate-200 mb-2">🧬 边际递减 · 饱和增长</h4>
    <p class="text-sm text-slate-400">信号越多单次影响越小，防止单话题被刷屏霸权；权重越高增益越窄，自然收敛</p>
  </div>
  <div v-click="+2" class="p-5 rounded-xl bg-slate-800/50 border border-slate-700">
    <h4 class="font-bold text-slate-200 mb-2">🌙 60 天半衰期</h4>
    <p class="text-sm text-slate-400">不互动的兴趣自然降温而非永久锁死——兴趣会漂移，就像人会成长</p>
  </div>
  <div v-click="+3" class="p-5 rounded-xl bg-slate-800/50 border border-slate-700">
    <h4 class="font-bold text-slate-200 mb-2">🍃 点踩只落叶子</h4>
    <p class="text-sm text-slate-400">踩一次"黑洞"，不会封杀整个"天文"——强兴趣单次点踩仅小幅回撤（0.8 → 0.5）</p>
  </div>
  <div v-click="+4" class="p-5 rounded-xl bg-slate-800/50 border border-slate-700">
    <h4 class="font-bold text-slate-200 mb-2">🛡️ 单写者纪律</h4>
    <p class="text-sm text-slate-400">user-profile 目录化：identity / settings / 图谱 / 派生摘要，杜绝双份数据互相漂移</p>
  </div>
</div>

---

# 门控重构：从评分防火墙，到反馈抽样器

<div class="grid grid-cols-2 gap-8 mt-8 items-stretch">

<div v-click class="p-6 rounded-2xl bg-slate-800/40 border border-red-800/40">
  <h3 class="text-lg font-bold text-red-400 mb-4">❌ 旧方案：评分公式硬拦</h3>
  <div class="space-y-3 text-sm text-slate-300">
    <p class="font-mono text-xs bg-slate-900/80 p-3 rounded">matchedWeight / totalWeight &lt; 0.5 → 拦截</p>
    <p>公式倒挂：<span class="text-red-400">命中头号兴趣的内容只得 0.29 分</span>，数学上永远过不了 0.5 阈值</p>
    <p class="text-slate-400">生产实证（2 天 37 条）：30 条被拦（85%），其中 21 条是主人最感兴趣的内容</p>
  </div>
</div>

<div v-click="+1" class="p-6 rounded-2xl bg-gradient-to-br from-cyan-900/30 to-blue-900/30 border border-cyan-700/50">
  <h3 class="text-lg font-bold text-cyan-400 mb-4">✅ 新方案：LLM 自判断 + 确定性护栏</h3>
  <div class="space-y-3 text-sm text-slate-300">
    <p>是否开口由 LLM 权衡：<span class="text-cyan-400">相关性优先 · 探索许可 · 预算感知</span>，可以保持沉默</p>
    <p>防骚扰交给代码：日预算（会员等级决定）· 每游荡上限 · URL 去重冷却</p>
    <p class="text-amber-400">每条推送都带"为什么推"的理由落盘——宠物自己解释自己的判断</p>
  </div>
</div>

</div>

<div v-click="+2" class="mt-8 text-center">
  <p class="text-lg text-slate-400">
    评分删掉后，误拦的 21 条"头号兴趣"内容<span class="text-cyan-400 font-bold">全部恢复可推送</span>
  </p>
</div>

---

# 一只猫 → 一群猫：平台化

<div class="grid grid-cols-3 gap-6 mt-12">

<div v-click class="group">
  <div class="p-6 rounded-2xl bg-gradient-to-br from-cyan-900/30 to-blue-900/30 border border-cyan-700/50 h-full transition-all duration-300 group-hover:border-cyan-500">
    <div class="text-4xl mb-4">🏠</div>
    <h3 class="text-lg font-bold text-cyan-400 mb-2">多租户 SaaS</h3>
    <p class="text-sm text-slate-400">控制面统一管理，每只宠物独立数据目录与进化状态；会员等级决定推送预算</p>
  </div>
</div>

<div v-click="+1" class="group">
  <div class="p-6 rounded-2xl bg-gradient-to-br from-amber-900/30 to-orange-900/30 border border-amber-700/50 h-full transition-all duration-300 group-hover:border-amber-500">
    <div class="text-4xl mb-4">📡</div>
    <h3 class="text-lg font-bold text-amber-400 mb-2">四通道触达</h3>
    <p class="text-sm text-slate-400">飞书 · Telegram · PWA 仪表盘 · 微信（iLink）——主人在哪，宠物就在哪</p>
  </div>
</div>

<div v-click="+2" class="group">
  <div class="p-6 rounded-2xl bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-purple-700/50 h-full transition-all duration-300 group-hover:border-purple-500">
    <div class="text-4xl mb-4">🎨</div>
    <h3 class="text-lg font-bold text-purple-400 mb-2">表情包图鉴</h3>
    <p class="text-sm text-slate-400">宠物自主生成专属表情包，自动收录与语义检索——行业空白的差异化能力</p>
  </div>
</div>

</div>

<div v-click="+3" class="mt-10 text-center">
  <p class="text-xl text-slate-300">
    自进化系统已全链路落地：<span class="text-cyan-400">双图谱</span> · <span class="text-amber-400">反馈抽样器</span> · <span class="text-purple-400">平台化</span>
  </p>
</div>

---
layout: section
---

# 05

## 愿景

### 数字世界的游侠

---

# 传统 AI vs Cyber-Stray

<div class="grid grid-cols-2 gap-12 mt-12">

<div v-click class="p-8 rounded-2xl bg-slate-800/50 border border-slate-700">
  <h3 class="text-xl font-bold text-slate-400 mb-6 flex items-center gap-2">
    <span class="text-slate-500">传统 AI</span>
  </h3>
  <div class="space-y-4">
    <div class="flex items-center gap-3 text-slate-400">
      <span class="text-red-400">✗</span>
      <span>被动问答模式</span>
    </div>
    <div class="flex items-center gap-3 text-slate-400">
      <span class="text-red-400">✗</span>
      <span>每次会话从零开始</span>
    </div>
    <div class="flex items-center gap-3 text-slate-400">
      <span class="text-red-400">✗</span>
      <span>冷冰冰的工具属性</span>
    </div>
    <div class="flex items-center gap-3 text-slate-400">
      <span class="text-red-400">✗</span>
      <span>工作时间受限</span>
    </div>
    <div class="flex items-center gap-3 text-slate-400">
      <span class="text-red-400">✗</span>
      <span>单点信息检索</span>
    </div>
  </div>
</div>

<div v-click="+1" class="p-8 rounded-2xl bg-gradient-to-br from-cyan-900/30 to-purple-900/30 border border-cyan-700/50">
  <h3 class="text-xl font-bold text-cyan-400 mb-6 flex items-center gap-2">
    <span>Cyber-Stray</span>
  </h3>
  <div class="space-y-4">
    <div class="flex items-center gap-3 text-slate-200">
      <span class="text-cyan-400">✓</span>
      <span>主动巡航模式</span>
    </div>
    <div class="flex items-center gap-3 text-slate-200">
      <span class="text-cyan-400">✓</span>
      <span>持续记忆进化</span>
    </div>
    <div class="flex items-center gap-3 text-slate-200">
      <span class="text-cyan-400">✓</span>
      <span>有灵魂的数字伴侣</span>
    </div>
    <div class="flex items-center gap-3 text-slate-200">
      <span class="text-cyan-400">✓</span>
      <span>7×24 小时在线</span>
    </div>
    <div class="flex items-center gap-3 text-slate-200">
      <span class="text-cyan-400">✓</span>
      <span>多源智能聚合</span>
    </div>
  </div>
</div>

</div>

---
layout: statement
clicks: 0
---

# 跨越时间限制的

## 赛博共生体

<div class="mt-8 text-lg opacity-80">
  它不仅是一个 24 小时为你打工的信息聚合器<br/>
  更是一个在数字世界替你感受、替你探索的<span class="text-amber-400">游侠</span>
</div>

---
layout: end
---

# 谢谢观看

<div class="mt-12 text-slate-400">

### Cyber-Stray

<span class="text-sm opacity-60">赛博共生体 · 你的数字分身</span>

<div class="mt-8 flex justify-center gap-6 opacity-60">
  <span>🔗 开源地址</span>
  <span>📮 联系我们</span>
  <span>📖 文档</span>
</div>

</div>

<style>
.slidev-layout.end {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
}
</style>
