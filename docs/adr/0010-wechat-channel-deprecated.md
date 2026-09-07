# 0010 — 微信通道废弃（取代 0003）

2026-09-04 拍板：微信 iLink 通道作为获客路径**实测源头不可用**——官方硬约束（主动推送 ≈10 条/24h 有效会话、24h 无交互 context_token 失效、需主人先发消息建立会话、仅 DM，issue #202/#142 实测确认，扩额诉求官方受理未落地）与产品主轴「宠物主动推送」不可调和。决定：微信通道功能整体判死，代码待删除；获客起点收敛为纯落地页。取代 ADR-0003。

## Consequences

- 待删面（后续单独执行票，本 ADR 只记决策）：`packages/control-plane/src/ilink/`、`routes/wechat.ts`、`web/app/wechat/`、`agent/src/worker/wechat-reply*`、drizzle `0008_wechat_bindings.sql`；「扫码即用自动领养街溜子」入口随之消失。
- 通道矩阵收缩：飞书 / Telegram / PWA 三通道，微信不再是第四可选通道。
- 认证边界回退：Casdoor 之外的第二账号入口（微信身份锚点）取消，账号合并问题不复存在。
- CONTEXT.md「微信通道」节标记废弃，仅存历史。
