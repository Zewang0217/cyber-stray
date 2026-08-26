# 容器化部署与产机退役 self-hosted runner

生产环境从「产机自建自部署裸进程」切换为「GitHub-hosted CI 构建镜像 → 推 GHCR → 产机只拉镜像跑容器」。控制面 + agent 一个镜像（worker 是控制面子进程，必须同镜像）、web 一个、casdoor 用官方镜像，全栈一个 compose；数据 bind mount 回原路径，零迁移。产机不再当 self-hosted runner，也不再跑构建——部署动作只剩「拉镜像、起容器」。

## Considered Options

- **维持裸进程 + 修脚本**：解决不了「产机自己构建、自己部署自己」的角色混淆，也没有不可变版本；重启语义（SIGTERM 超时被 SIGKILL、`KillMode=control-group` 杀在飞 worker）只能靠手工纪律维持。
- **版本化发布目录**（源码树 + `current` 符号链接）：比容器轻，但依赖安装、运行时版本、重启语义仍靠产机自维护，「构建在 CI」纪律继续名存实亡。
- **蓝绿/双实例**：control.db 是 SQLite 单写者，双实例调度器抢锁，工程量与收益不成比例。

## Consequences

- 部署单元 = 镜像 = 版本（tag = commit sha）。坏版本 = 改 compose 里的 tag 重发，天然留档——**因此不建显式回滚机制**。
- 数据路径不变（`/opt/cyber-stray/data`、`/opt/casdoor/` bind mount），现有 backup.sh 零迁移；casdoor 零数据库依赖（SQLite 单文件），容器化只需挂两个文件。
- 磁盘：根分区已用 79%，镜像按「保留在用 tag + 定期 prune」管理，部署脚本附带清理。
- 产机直连 GHCR 不通，`docker pull` 必须走本机代理（为 `docker.service` 配 systemd proxy drop-in，一次性）。
- 本 ADR 取代根 CONTEXT.md 两条旧锁定决策：「不是 Docker 起步」与「Casdoor 跑 systemd unit（非容器）」——当初的论证（容量瓶颈触发才上编排）针对的是横向扩展，不适用于不可变交付与产机角色分离的诉求。
- 优雅停机是容器化的前提而非赠品：控制面收到 SIGTERM 后停调度器、等在飞 worker 干净退出再退（预算 60–90s，compose `stop_grace_period` 放宽）；超时孤儿由既有 lease 机制自愈。
