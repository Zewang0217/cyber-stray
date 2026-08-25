# 微信 iLink 通道网络故障诊断与修复（2026-08-25）

## 背景

生产环境（京东云 VPS 117.72.100.212）微信通道不可用：web 绑定页发起绑定即失败，
CP 日志报 `IlinkNetworkError`（socket closed / 15s 超时），错误点
`ilink/client.ts:481` → `getBotQrcode`（`routes/wechat.ts` → `binding-service.ts`）。

## 诊断结论（全部实测）

| 测试 | 结果 |
|---|---|
| 产机直连 `ilinkai.weixin.qq.com`（DNS 默认解析的 4 个 IP） | **TLS 握手超时**（TCP 通、Client hello 发出后无响应） |
| 产机走 mihomo 香港节点（规则 DOMAIN-SUFFIX 强制） | CONNECT 隧道 200 后 `SSL_ERROR_SYSCALL` |
| 本机（家宽，mihomo 国内直连） | TLS 正常 |
| 产机访问百度/飞书/DeepSeek | 全部正常（非整体断网） |

**根因**：`ilinkai.weixin.qq.com`（CNAME `aewebpodproxy.weixin.qq.com`）按 DNS 解析分池：

- 产机 DNS 解析到**腾讯云池**（43.137.x / 43.171.x，AS45090，含新加坡）→ **京东云到该池的 BGP 路径不通** → TLS 超时
- 家宽解析到**电信池**（180.101.x / 101.227.x / 61.151.x / 117.89.x，ChinaNet）→ 正常

从家宽强制 `--resolve` 连腾讯云池 4 个 IP 全部 TLS 正常（0.14s）→ **不是服务端封锁**，
是京东云→腾讯云池的路径问题。社区佐证：openclaw-weixin #206 维护者确认同类问题为
"DNS 拿到不适配 IP 池"，hosts 固定电信池 IP 可稳定。

## 修复（已实施，零成本）

产机 `/etc/hosts` 追加（原文件备份 `/etc/hosts.bak.20260825`）：

```
180.101.242.203 ilinkai.weixin.qq.com
```

重启 control-plane 后验证：

- `GET ilink/bot/get_bot_qrcode?bot_type=3` → 返回真实二维码（`ret:0`）
- 绑定流程恢复

**注意**：电信池 IP 可能随腾讯调整而变化；失效时按下方兜底链处理，并重新确认
当前电信池 IP（`dig` 从家宽线路解析或社区反馈）。

## 兜底方案（调研结论，按优先级）

1. **hosts pin 电信池 IP**（当前方案，已生效）
2. **SSH 反向隧道**：本机（家宽，可通）autossh + systemd 反向隧道/SOCKS，产机经隧道访问 iLink；Bun fetch 原生支持 proxy 选项（HTTP CONNECT），socks5 不支持；undici `setGlobalDispatcher` 对 Bun fetch 无效
3. **mihomo 改 DIRECT + hosts pin**：放弃境外节点（香港节点实测不通）
4. **mtr 取证后向京东云报障** BGP 路径（京东云 → AS45090）
5. **企业微信应用消息**作长期兜底通道

## 微信接入方式调研摘要（2026-08，与团队讨论用）

| 方案 | 主动推送 | 双向对话 | 多租户 | 风险 | 国内可达 | 替换成本 |
|---|---|---|---|---|---|---|
| iLink（现状） | ✅ ~10条/24h | ✅ | ✅ 每用户扫码 | ⚠️ 实验性、无 SLA | ⚠️ 已用 hosts 修复 | 0 |
| 认证服务号 | 群发 4条/月 + 48h 客服窗口 | ✅ 窗口内 | 一号多用户 | 官方合规 | 高（有容灾域名） | 中（轮询→webhook） |
| 订阅号（个人） | ❌ | ❌ 仅被动 5s | — | 合规 | 高 | —（不适用） |
| 企业微信 | ⚠️ 群发需人工确认 | ⚠️ 无官方单聊 API | 一企业一号 | 合规 | 高 | 中 |
| wechaty+padlocal | ✅ | ✅ | ✅ 每用户 token | ❌ 封号风险+付费 | 中 | 低（与 iLink 最像） |
| 微信客服 | ❌ 仅 48h 窗口 | ✅ | 一企业 | 合规 | 高 | 中（入口不适配） |

**推荐**：iLink（已修复，先用）→ 认证服务号（官方+双向+可达的长期方案，需企业主体
300 元/年认证）→ 企业微信/wechaty 作对照。

## 相关

- 调研执行：会话 subagent（IlinkAccessResearch / WechatChannelResearch，2026-08-25）
- 代码位置：`packages/control-plane/src/ilink/`（client / binding-service / poller）
- 关联 ADR：`docs/adr/0003-wechat-channel.md`
