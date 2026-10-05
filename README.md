# 赛博街溜子 · Cyber Stray

一只会自己探索互联网、带着发现回家、逐渐长出兴趣的赛博宠物。

核心闭环是 **探索 → 学习 → 反思 → 进化兴趣 → 更懂主人 → 更准推送**。你可以领养宠物、阅读它带回的内容、点赞或表达不感兴趣，让它在后续探索中调整方向。

## 当前使用方式

产品处于免费邀请内测。新用户需要一次性邀请链接；已有受邀账号直接登录。所有受邀用户统一享有原 Pro 权益：每天最多 20 次推送、每天一次兴趣方向引导、自定义推送时段，以及配额内的宠物形象生成。上限不是每天必达的推送数量。

内测不设收费套餐，不要求绑卡。BYOK 是可选的模型密钥配置，不改变内测权益或使用限额。付费模式保留独立接口，支付实现和单独发布之前不会启用，也不会自动把内测用户转为收费订阅。具体契约见 [ADR-0016](docs/adr/0016-invite-beta-entitlements.md)。

通过官网提交邀请申请后，由管理员在管理端生成邀请链接并私下发给申请人。公开申请中不要填写邮箱、密钥等隐私信息。

## 项目结构

| 包 | 职责 |
|---|---|
| `packages/agent` | 宠物运行时：探索、Markdown 记忆、反思、兴趣演化、推送；Node.js / tsx |
| `packages/control-plane` | Casdoor 登录、租户、邀请、额度、调度、API；Bun / Hono / SQLite |
| `packages/web` | Next.js 16 伴侣端，通过 CP API 读取数据和提交明确交互 |
| `packages/site` | Next.js 静态官网，由 nginx 提供服务 |
| `packages/shared` | 跨包契约、权益、事件、出站网络守卫等 |
| `packages/slides` | Slidev 演示文稿 |

云端宠物由 CP 按无聊与精力状态调度为短命 worker：载入记忆，完成探索及到期反思，保存状态后退出。ReAct 工具调用是决策回路。宠物记忆保持可阅读的 Markdown，CP 元数据独立存储于 SQLite。

搜索支持 DuckDuckGo、Tavily、Exa，内容可通过飞书、Telegram 和 Web Push 送达。伴侣端支持来源链接、反馈、兴趣图谱、日记和设置。SaaS worker 禁用外部浏览器 CLI，使用受出站地址校验与响应大小限制保护的搜索和网页阅读；单机浏览器需单独配置。

## 本地开发

需要 Node.js 22+、pnpm 9（版本见根 `package.json`），运行控制面还需要 Bun。先安装依赖：

```bash
pnpm install --frozen-lockfile
```

按根 `.env.example` 配置环境变量。CP 需要 session/master key、Casdoor OIDC 应用信息、Web origin 和独立数据目录；首次启动会创建 CP 数据库并执行已有迁移，应先确认目标路径。模型调用至少需要有效的 DeepSeek key，其余搜索、推送与生图提供方按功能配置。

在分别配置环境变量的终端启动所需应用：

```bash
pnpm dev:cp
pnpm dev:web
pnpm dev:site
```

默认端口分别为 8787、3000、3002。单机宠物与 TUI 使用 `pnpm dev:agent`；云端 worker 由 CP 调度，不需要额外启动常驻 agent。请为开发和测试使用独立数据目录。

管理员由 `CP_ADMIN_SUBS` 指定，登录后在 `/admin` 的邀请管理中生成一次性链接；新用户通过链接完成登录和领养。注册入口与 CP 邀请校验共用同一访问边界。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm lint
NEXT_PUBLIC_APP_URL=https://app.kleinbottle.top pnpm -F @cyber-stray/site build
pnpm -F @cyber-stray/web build
python3 -B -m unittest discover -s deploy -p 'test_*.py'
```

集成测试会创建并清理临时数据库。修改数据库结构或操作现有数据库前，遵循 [AGENTS.md](AGENTS.md) 的审批约定。

## 部署与设计

生产为五个容器：CP、Web、官网、Casdoor、nginx。HTTPS、OIDC 域名和证书必须同步准备；发布脚本先检查配置，再更新容器。详见 [部署说明](deploy/README.md)，实际域名切换还需按 [ADR-0015](docs/adr/0015-unified-nginx-ingress.md) 的条件执行。

- 产品与领域约定：[CONTEXT.md](CONTEXT.md)
- 工程规则：[AGENTS.md](AGENTS.md)
- 视觉规范：[docs/design-v3](docs/design-v3/)
- 架构决策：[docs/adr](docs/adr/)
- 本轮上线前审查：[launch-readiness-2026-10-04.md](docs/reviews/launch-readiness-2026-10-04.md)

## License

MIT
