# 日志系统规范

## 四级日志

| 级别 | 用途 | 示例 |
|------|------|------|
| `debug` | 开发调试，生产可关 | 工具参数、hook 执行顺序、prompt 片段 |
| `info` | 正常业务流关键节点 | 游荡开始/结束、工具调用、推送成功、状态更新 |
| `warn` | 异常但可自愈/降级 | 门控拦截、网页 403、画像文件缺失用默认值 |
| `error` | 需要关注的失败 | LLM 调用异常、推送失败、数据写入失败 |

## 规则

1. **落盘日志 ≠ TUI 输出**。文件日志（`data/logs/YYYY-MM-DD.log`）记录全量四级；TUI 只显示 info 及以上，且格式面向人类可读。两者独立配置。
2. **error 必须可定位**。包含：错误名称、statusCode（如有）、responseBody 前 500 字（如有）、traceId、上下文参数。禁止只记 `{"error":{}}` 空对象。
3. **序列化 error 对象时用 `String(error)` 或提取字段**，不要直接 `JSON.stringify(error)`（Error 对象序列化为 `{}`）。
4. **每个工具调用必须有 start + end 日志**，end 包含 success/durationMs/error。
5. **LLM 调用必须记录**：模型名、token 用量、finishReason、输出文本前 500 字、toolCalls 列表。
6. **不在日志中记录完整 API key / token / cookie**。

## 文件位置

- 落盘：`${DATA_DIR}/logs/YYYY-MM-DD.log`，**调用时**读取 DATA_DIR（logger 为低层模块，不引 config.js，内联懒解析；其余业务模块走 `getDataPath()`）。禁止在 import 期冻结路径。
- TUI：Ink 组件订阅 `logCallbacks`，独立渲染
