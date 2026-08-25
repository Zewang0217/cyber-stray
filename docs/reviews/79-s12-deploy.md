# Review · #79 · S12 部署：2C4G systemd 拓扑 + 备份纪律

> 两轴审查 · `review` skill
> 基线 `32073c8` (review 修复批) → `41cafbb` (S12) · 单提交 · 8 文件 +486 / −44
> 日期 2026-08-16

## 基线

| | |
|---|---|
| Fixed point | `32073c8` |
| Target | `41cafbb` |
| Commit | `feat: S12 部署——2C4G systemd 拓扑 + 备份纪律（#79)` |
| Scope | 8 文件 +486 / −44（deploy/ 5 脚本 + 2 units + CI workflow + next.config） |
| Spec | [issue #79](https://github.com/Zewang0217/cyber-stray/issues/79) |

## Standards

**3 硬违规（双轴共 9 findings，全部修复） / 1 判断题。**

通过项：

- **崩溃自恢复**（spec AC2）：三 unit `Restart=always` + `RestartSec=5`；
  control-plane `KillMode=control-group`——worker 是 CP `child_process.spawn`
  子进程（无 detached），同 cgroup，CP 退出时整个进程组收口（无孤儿写租户
  state.json），CP 重启后 lease + DB 冷却兜底自愈（S5 既有机制）✓
- **构建在 CI 不在产机**：ci.yml 全量验证 + web standalone build + artifact；
  产机 pnpm install --frozen-lockfile（只装依赖）+ bun 直跑 TS（无编译步骤）；
  web 解包 CI 产物零编译 ✓
- **备份真实可恢复**（spec AC3）：backup.sh SQLite 事务快照（sqlite3 .backup）
  + 租户 markdown + master.key + Casdoor conf，保留 N 份 + trap 清理；
  restore.sh 动态路径探测 + 旧数据让位/新数据迁入（防跨文件系统 mv 失败丢副本）✓
- **部署安全**：env 模板 chmod 600；`--web-tar` 参数校验；restore Casdoor
  可选组件启动防护 ✓

硬违规（review 发现并已修复）：

1. **web artifact 打包不完整——`next` 软链悬空 MODULE_NOT_FOUND**（P1，
   ci.yml）：`packages/web/node_modules/next` 是相对软链指向 standalone 根
   `.pnpm`（pnpm 虚拟存储），只 `cp -r .next/standalone/packages/web` 会让
   解包后 `node server.js` 直接 `Cannot find module 'next'`（实证复现）。
   **已修**：打包整个 standalone 树（`cp -r .next/standalone dist/app`）+ 
   static 落 `app/packages/web/.next/static` + public/（PWA sw.js）；
   web.service ExecStart 指向 `app/packages/web/server.js`；完整树验证
   （next 解析 + /settings 307 + /_next/static 200 + /sw.js 200）。
2. **static 落位错误 + public/ 未打包**（P1，ci.yml）：Next 16.2.4 从
   `join(dir, '.next', 'static')` 读 chunk（filesystem.js:148），产物
   static/ 内容不可达 → 生产仪表盘 JS/CSS 全 404；public/（sw.js）未拷 →
   PWA 失效。**已修**：见 #1 布局。
3. **deploy.sh 文档化 `--web-tar` 但 install() 不消费 + case 丢参**（P1，
   deploy.sh）：函数位置参数为空，`install --web-tar x.tgz` 永远走"未提供"
   分支，web 组件从未安装，AC1 对 web 不成立。**已修**：`install "$2" "$3"`
   传参 + 实现解包到 /opt/cyber-stray-web。

判断题：

1. backup.sh 对运行中 SQLite 热快照（未 sqlite3 时降级热拷贝 + 显式警告）——
   `sqlite3 .backup` 在线安全路径已验证；降级路径有警告不静默，可接受。

**最严重（已修）**：web artifact 软链悬空——按文档部署 CP 起来但 web 起不来，
AC1/AC2 同时落空。

## Spec

**0 硬缺失 / 0 实现有误 / 1 设计判断。** 三条验收准则全部达成。

验收对照：
- ✅ **一键部署脚本/文档覆盖全栈组件**——deploy.sh install（依赖检查
  bun/node/openssl → pnpm install --frozen-lockfile → env 模板 600 → web
  产物解包 --web-tar → 三 units 安装启用/status/uninstall）+ README 拓扑/
  部署/备份/演练全文档。
- ✅ **控制面/Casdoor/worker 崩溃自恢复**——三 unit Restart=always +
  RestartSec=5；worker 随 CP `KillMode=control-group` 收口（进程组语义，
  worker spawn 无 detached）；CP 重启后 lease+DB 冷却自愈。
- ✅ **真实可恢复备份（恢复演练一次）**——backup.sh（SQLite .backup 事务
  快照 + 保留 N 份）+ restore.sh（动态路径探测 + 防丢副本迁入）；演练用
  真实 SQLite（pets/users 行）备份→破坏→恢复→行级校验全通过，记录在
  README §恢复演练记录。

设计判断：

- 备份覆盖 = 控制面 data/ + Casdoor 账号库；web 无本地状态不备份
  （standalone 产物可再生）——spec「目录 tar / 快照 / 离线 rsync」中取
  tar + SQLite 在线快照组合，2C4G 单机规模下合理；离线 rsync 留给异机
  备份扩展。

## 跨切片状态

- S1-S11 遗留项在 `32073c8` 全修；S12 未引入新违规。
- review 文档归档：本 slice 的 `docs/reviews/79-s12-deploy.md` 为 S1-S12
  最后一份；S1-S10 归档（`68-s1` ~ `77-s10`）此前未提交，随本 slice 一并
  入库（见提交记录）。

## 汇总

| 轴 | 硬违规 | 判断题 | 最严重 |
|---|---|---|---|
| Standards | 3（全修） | 1 | web artifact `next` 软链悬空（MODULE_NOT_FOUND） |
| Spec | 0 硬缺失 | 0 实现有误 + 1 设计判断 | 无 |

S12 三条验收准则全部命中，双轴 9 findings（P1×3、P2×4、P3×2）全部修复并
实证验证：web 完整树产物冒烟（settings 307 / static 200 / sw.js 200）、
真实 SQLite 恢复演练行级校验、保留策略 KEEP=2、bash -n 三脚本。至此
epic #67 的 S1-S12 全部交付。
