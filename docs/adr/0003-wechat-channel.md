# 0003 — 微信通道：官方 iLink 自研适配器 + 扫码即用 + 每租户一 bot

给赛博宠物接入微信,定位为**获客通道 + 双向互动主体验**(飞书/TG/PWA 保持主力,微信为第四可选通道)。三个决策锁定:

**1. 通道技术 = 腾讯官方 iLink Bot API,自研薄适配器(400-600 行 TS)**。不选逆向方案(wechaty+padlocal / wechatferry / itchat——2026 全线衰退 + 封号风险,wechatferry 社区版明示禁止商用),不引入 hermes-agent 整体(自研 agent 架构下网关层套完整框架是污染)。参考实现:官方 Tencent/openclaw-weixin(TS 全模块 + 单测)为主,hermes weixin.py 的错误处理为辅,@wechatbot/wechatbot 作兜底脚手架。iLink 官方硬约束(issue #202 官方受理确认):主动推送 ≈10 条/24h 有效会话、24h 无交互 token 失效、需主人先发消息激活、仅 DM。

**2. onboarding = 扫码即用(微信即账号)**。主人扫码绑定 → 自动建租户 + 领养默认宠物 + 免费档起步 → 微信聊天框直接用;web 登录是可选的升级路径(绑定后并入 Casdoor 账号体系)。微信身份是租户锚点——这是 Casdoor 之外的第二个认证入口,但计费/配额/数据目录完全复用现有租户模型,不建平行体系。获客定位要求零摩擦,先注册再绑定不可接受。

**3. 每租户一个 bot(BYO)**。用户自己扫码操作,平台做指引(web 绑定页:扫码 → 轮询确认 → 配对)。扫码绑定 API 无需预注册(`get_bot_qrcode` → `get_qrcode_status` → `bot_token`/`ilink_bot_id`/`ilink_user_id`);`ilink_user_id`(扫码主人微信 ID)做 pairing 白名单,防他人扫码抢绑。多租户 = 每账号一条独立长轮询 + 按账号持久化游标/context_token,hermes 实测 60 bot 并发无压力。

## Considered Options
- **逆向协议(wechaty/wechatferry/itchat)**:封号风险高、2026 维护全线衰退、wechatferry 禁商用 → 否。
- **hermes-agent 作网关**:引入完整框架只为一个通道,架构污染 → 否;只做行为参考。
- **平台级单 bot + 按发送者路由**:一个 bot 服务所有租户,运维轻,但消息路由依赖 iLink 会话模型(未验证多用户加同一 bot)、品牌身份模糊 → 否,用户拍板每租户 bot。
- **先注册 web 再绑定微信**:获客摩擦大 → 否,扫码即用。

## Consequences
- 微信租户在 24h 无交互后通道失效,需主人重新打招呼激活(web 提示"发条消息重新激活");微信通道推送上限 `min(套餐, 8 条/天)`,超限自动降级其他已绑通道。
- 认证边界扩展:Casdoor 之外的微信身份入口(租户锚点 = iLink 身份),账号合并(微信租户 ↔ Casdoor 账号)需在设计时留绑定表。
- 新能力:真正的双向 DM(现有飞书只是 reaction)——CP 收 iLink 消息 → spawn 短命 agent 进程处理(复用 feedback-cli 模式)→ 回复;微信聊天上下文存租户目录。
- 首版只做文本推送;表情包图片等 CDN 媒体验证(服务器在国内,出口 OK)后接入 #96。
