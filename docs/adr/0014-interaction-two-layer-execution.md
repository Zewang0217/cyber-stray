# 交互规则两层执行：web 即时回放 + agent 异步消化

宠物交互的反应（动画/台词/音效）要求毫秒级即时，异步 agent 消化给不了这个延迟；但「轻交互影响 mood/语气」的锁语义又要求 agent 在场。决策：交互规则引擎作为 web 播放器纯函数运行（读租户 rules JSON + 本地计数，即时回放动画/台词/原声），交互事件另经 REST 异步上报 agent 消化 mood/语气——两层各持一半语义，rules JSON 本身不跨 agent 边界。此决策同时裁决历史漂移：CONTEXT 曾锁「轻交互走 Web POST → CP → agent」，而实现是纯前端（拍拍反应、记仇存 localStorage）。
