# 技术设计

## 现状诊断

### 数据目录

| 消费方 | 当前路径表达式 | 运行时解析结果 |
|---|---|---|
| agent（`getDataPath`） | `${DATA_DIR ?? 'data'}/x` | cwd 相对 → `pnpm dev:agent` 时为 `packages/agent/data/x` |
| agent（硬编码处） | `'data/memory/...'`、`'data/logs'`、`'data/history'` 等 | 同上，但完全绕过 `getDataPath`，`DATA_DIR` 对其无效 |
| web（四个 API 路由） | `'../data/x'` | cwd 相对 → `packages/data/x`（不存在） |

agent 侧"碰巧正确"是因为 `pnpm --filter` 把 cwd 设成了包目录。换任何一种启动方式（仓库根 `tsx packages/agent/src/index.ts`、pm2、systemd WorkingDirectory）数据就会散落到别处。这是 R1 要求路径与 cwd 解耦的原因。

`feedback-store.ts:14` 用 `path.join(process.cwd(), 'data/feedback.json')` 在模块加载时求值，是同一问题里最脆的一处。

### 历史记录契约

agent 写入（`tools/push/speak.ts:35-41`）：`{ content, type, pushed, timestamp, messageId? }`
web 期待（`lib/types.ts` 的 `PushContent`）：`{ title, url, summary, message, mood, timestamp }`

两者只有 `timestamp` 重叠。`app/api/history/route.ts:15` 直接 `JSON.parse(line) as PushContent` 强转，类型系统完全没有拦住这个错配。

另外门控拦截分支（`tools/registry/speak.ts:73-80`）在调用 `speak()` 之前就 return 了，所以被拦截的内容根本没有历史留痕——要满足"History 里能看到仅学习未推送的内容"，必须补写入。

## 方案

### A. 数据路径统一

**A1. `getDataPath()` 锚定到 agent 包目录**

```ts
// packages/agent/src/config.ts
const AGENT_DATA_ROOT = fileURLToPath(new URL('../data', import.meta.url));

export function getDataPath(filename: string): string {
  return join(process.env.DATA_DIR ?? AGENT_DATA_ROOT, filename);
}
```

`config.ts` 位于 `packages/agent/src/`，`new URL('../data', import.meta.url)` 解析为 `packages/agent/data`，与 cwd 无关。`DATA_DIR` 仍然优先，测试隔离不受影响。

返回值从相对路径变成绝对路径。所有下游都是直接喂给 `fs` API，绝对路径完全兼容。

**A2. 硬编码路径收编**

| 文件 | 现状 | 改为 |
|---|---|---|
| `config.ts:4` | `const CONFIG_PATH = 'data/agent-config.json'` | `getDataPath('agent-config.json')`（函数声明提升，模块顶层可调用） |
| `memory/user-profile.ts:9` | `const USER_PROFILE_PATH = 'data/memory/user-profile.json'` | 惰性函数 `userProfilePath()` |
| `memory/long-term/types.ts:76` | `basePath: 'data/memory'` | 从默认配置对象移除，改由 `MemoryStore` 构造时 `getDataPath('memory')` 兜底 |
| `memory/long-term/memory-index.ts:294` | `basePath = 'data/memory'` 默认参数 | 默认参数改为惰性求值 |
| `memory/feedback-store.ts:14` | `path.join(process.cwd(), 'data/feedback.json')` | 惰性函数 `feedbackFilePath()` |
| `logger/file-writer.ts:20`、`logger/log-cleaner.ts:19` | `const LOG_DIR = 'data/logs'` | 惰性函数 `logDir()` |
| `tools/push/speak.ts:48-49` | `'data/history'` | `getDataPath('history')` |

**惰性化是硬性要求**：模块级 `const` 在 import 时求值，而测试是在 import 之后才设置 `DATA_DIR`。凡是路径常量，一律改成调用时求值的函数。

**A3. 测试隔离机制的适配**

`useTempDataDir()` 目前做两件事：`DATA_DIR = <tmp>` + `chdir(<tmp>)`。chdir 的存在正是为了让那些硬编码 `data/xxx` 的相对路径落进临时目录。A2 收编之后，两条路径的解析基准会分叉：

- 走 `getDataPath` → `<tmp>/xxx`
- 测试夹具里写死的 `data/xxx`（如 `user-profile.test.ts:51`、`feedback-pipeline.test.ts:243`、`interest-graph.test.ts` 的 20 余处 `new InterestGraph('data/interests.json')`）→ `<tmp>/data/xxx`

把 `DATA_DIR` 改成指向 `<tmp>/data` 并保留 chdir，两条路径就重新合流，现有测试夹具一行都不用改：

```ts
const root = mkdtempSync(...);
process.env.DATA_DIR = join(root, 'data');
process.chdir(root);
```

需要同步更新的只有 `config.test.ts:11`（断言 `getDataPath('state.json') === 'data/state.json'`），改为断言锚定后的绝对路径。

**A4. web 侧路径解析**

新增 `packages/web/lib/data-path.ts`：

```ts
export function dataPath(...segments: string[]): string {
  const root = process.env.DATA_DIR ?? resolve(process.cwd(), '../agent/data');
  return join(root, ...segments);
}
```

Next.js 的 `process.cwd()` 在 dev 与 build 下都稳定等于包根目录 `packages/web`，因此 `../agent/data` 是可靠的。沿用 `DATA_DIR` 同名变量，便于把 agent 与 web 一起指到自定义位置（比如部署时数据盘挂载在别处）。

四个路由改为调用 `dataPath(...)`。

### B. 推送历史记录契约

**B1. 记录结构（v2）**

```ts
interface SpeakRecord {
  // 原有字段，保持不变
  content: string;
  type: SpeakType;
  pushed: boolean;
  timestamp: string;
  messageId?: string;
  // 新增：供 web 卡片渲染
  title: string;
  url?: string;
  summary: string;
  mood: Mood;
  gated?: boolean;
  gateScore?: number;
}
```

向后兼容靠"只增不改"：旧记录反序列化后新字段为 `undefined`，由 web 侧降级处理。不做数据迁移脚本——历史目录是本地运行态产物，且 `.gitignore` 已排除。

**B2. 派生逻辑**

新增 `packages/agent/src/tools/push/history-record.ts`，纯函数，独立单测：

- `title`：取内容第一行，剥掉 markdown 标记与 URL，截断到 40 字；空则回退到类型中文名（"分享" / "碎碎念" / "文章"）
- `url`：复用 `tools/dedup/url-tracker.ts` 已有的 `extractUrl()`
- `summary`：剥掉 URL 后的正文，截断到 120 字
- 截断按字符数而非字节，中文场景下与 UI 显示宽度一致

`mood` 不派生，由调用方传入。

**B3. mood 的传递路径**

`speak()` 当前签名是 `speak(content, type)`，内部没有 `AgentState`。两种取法：

1. 在 `speak()` 里 `await loadState()` —— 多一次文件 IO，且与推送时刻的状态存在竞态
2. 由 registry 工具从 `ctx.state.mood` 传入 —— 零 IO，且就是触发这次游荡时的状态

取第二种。`speak()` 增加第三个可选参数 `meta?: { mood?: Mood; gated?: boolean; gateScore?: number }`。可选而非必填，是为了不破坏 `speak()` 现有的直接调用点与测试。

**B4. 门控拦截也写历史**

`tools/registry/speak.ts` 的门控分支在 return 之前调用一次历史写入。写入职责下沉到 `push/speak.ts` 导出的 `recordGatedSpeak(content, type, meta)`，避免 registry 层直接碰文件系统——保持"registry 只做编排、push 层做 IO"的现有分层。

注意 `ctx.spokeTimes` 不能因此自增：它统计的是真实推送次数，会进入 `state.totalPushes`。门控拦截不是推送。

### C. web 渲染

**C1. 类型与映射**

`PushContent` 增加 `content?` / `pushed?` / `gated?` / `type?`，并把 `title` / `summary` / `message` / `mood` / `url` 放宽为可选。

`app/api/history/route.ts` 增加 `normalizeRecord()`：新格式直通；旧格式（无 `title`）从 `content` 派生 `title` / `summary`。这点重复是有意的——跨包共享工具函数要引入第四个 workspace 包或跨包 import，代价高于两处通用截断，且 web 侧只服务遗留数据，长期自然废弃。

**派生边界（实现时收紧，与初稿不同）**：web 侧只派生 `title` / `summary`，靠的是"取首行 + 截断"这类通用文本处理。`url` 和 `mood` 不派生：

- `url` 的提取规则是 agent 侧 `url-tracker.ts` 的 `URL_PATTERN`，属于契约级正则。在 web 再抄一份就是 `cross-layer-thinking-guide` 里的"每个消费方各自解析同一份载荷"，规则一改必然漏掉一边。旧记录因此没有外链按钮，但原文里的链接仍在卡片正文中可见。
- `mood` 是 agent 的内部状态，初稿写的缺省 `curious` 属于凭空造数据，违反"禁止兜底"。旧记录改为不渲染心情标签。

**C2. FeedCard 状态标记**

三态徽标：`pushed === true` → 无额外标记（现状）；`gated === true` → "仅学习 · 未推送"；`pushed === false && !gated` → "推送失败"。`url` 缺失时不渲染外链按钮。

## 兼容性与回滚

- agent 数据文件格式：只增字段，旧文件可直读，无迁移
- web：纯读取侧，无写入，不影响 agent
- `speak()` 签名：第三参数可选，现有调用点不受影响
- 回滚：三块（A 路径 / B 记录 / C 渲染）相互独立，可单独 revert；A 是其余两块的前提，但 B、C 不依赖彼此

## 风险

| 风险 | 缓解 |
|---|---|
| 惰性化路径常量时漏改某处，测试仍绿但生产写错位置 | 用 `grep -rn "'data/" packages/agent/src` 做验收门禁，排除 `*.test.ts` |
| `DATA_DIR` 语义变化（`<tmp>` → `<tmp>/data`）影响其他测试 | 全量跑 `pnpm test`；`useTempDataDir` 返回值增加 `root` 字段，需要原始临时根的测试可自取 |
| Next.js 某些运行模式下 `process.cwd()` 不是包根 | 提供 `DATA_DIR` 覆盖作为逃生舱；在 `lib/data-path.ts` 注释中写明假设 |
