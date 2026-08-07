# agent-browser CLI API Research

> Researched: 2026-07-26 | Version tested: **0.33.0** | Source: npm + live CLI testing + GitHub (vercel-labs/agent-browser)

## 1. Package Info

| Field | Value |
|-------|-------|
| npm package | `agent-browser` (NOT `@anthropic/agent-browser`) |
| Latest version | 0.33.0 (116 versions published) |
| License | Apache-2.0 |
| Repo | https://github.com/vercel-labs/agent-browser |
| Website | https://agent-browser.dev |
| Maintainers | Vercel team (matheuss, matt.straka, vercel-release-bot) |
| Binary | Native Rust CLI + Node.js daemon |
| Unpacked size | 90.6 MB (includes platform binaries) |
| Dependencies | none (zero npm deps) |

### Installation

```bash
npm install -g agent-browser        # npm global
brew install agent-browser          # Homebrew (macOS)
cargo install agent-browser         # Cargo
npx agent-browser <cmd>             # without installing

# First-time Chrome download (from Chrome for Testing):
agent-browser install
agent-browser install --with-deps   # also system deps (Linux only)
```

Existing Chrome, Brave, Playwright, and Puppeteer installations are auto-detected.

### Local status (this machine)

- NOT in PATH globally (use `npx agent-browser`)
- Chrome detected at `C:\Program Files\Google\Chrome\Application\chrome.exe`
- State dir: `C:\Users\luobo\.agent-browser`
- Doctor: all checks pass, headless launch in 0.54s

---

## 2. Architecture: Client-Daemon Model

```
┌─────────────┐     IPC (JSON+\n)     ┌──────────────────┐     CDP     ┌───────────┐
│  Rust CLI   │ ◄──────────────────► │  Node.js Daemon   │ ◄────────► │ Chromium  │
│  (< 1ms)    │   Unix socket / TCP   │  (persistent bg)  │  Playwright│ (headless │
│  arg parse  │                       │  browser mgmt     │            │  / headed)│
└─────────────┘                       └──────────────────┘            └───────────┘
```

### IPC Transport
- **macOS/Linux**: Unix Domain Socket at `~/.agent-browser/{session}.sock`
- **Windows**: TCP localhost, port derived from session name (range 49152-65535)
- Messages: JSON objects terminated by `\n`

### Daemon Lifecycle

| Event | Behavior |
|-------|----------|
| **Auto-start** | Daemon starts automatically on first command. CLI checks PID file at `~/.agent-browser/{session}.pid` |
| **Persistence** | Daemon persists between commands — browser stays alive. Avoids 2-3s startup per command |
| **Graceful shutdown** | `agent-browser close` / `close --all`, or SIGINT/SIGTERM/SIGHUP |
| **Shutdown cleanup** | Closes browser → removes socket/PID files → auto-saves state if configured |
| **Stale detection** | CLI checks if PID is alive; stale sockets/PIDs auto-cleaned |
| **Idle timeout** | `AGENT_BROWSER_IDLE_TIMEOUT_MS` env — auto-shutdown after N ms of inactivity (disabled by default) |
| **Command serialization** | Daemon processes commands serially (one at a time) to prevent race conditions |

### Performance

| Metric | Value |
|--------|-------|
| Native binary parse | < 1ms |
| npx fallback startup | 100-500ms (Node.js overhead) |
| Daemon IPC round-trip | ~1-2ms (Unix socket) / ~2-5ms (TCP localhost) |
| First browser launch | 2-3 seconds |
| Subsequent commands | 0ms browser overhead (already running) |
| Rust CLI memory | ~1-2 MB |
| Node.js daemon memory | ~50-100 MB |
| Chromium memory | ~200-500 MB |

---

## 3. JSON Output Envelope

Every command with `--json` returns this envelope:

```typescript
interface AgentBrowserResponse {
  success: boolean;
  data: CommandData | null;    // null on error
  error: string | null;        // null on success
}
```

### Error example (exit code 1):
```json
{"success": false, "data": null, "error": "Unknown ref: e99"}
```

### Lifecycle metadata (embedded in most `data` objects):
```typescript
interface LifecycleInfo {
  lifecycle: {
    effectiveLaunch: {
      browserLaunched: boolean;
      engine: "chrome";
      launchHash: number | null;
    };
    launched: boolean;           // true = browser was just launched
    relaunchedBrowser: boolean;
    restartedBackground: boolean;
    restoreStatus: "not_configured" | string;
    reused: boolean;             // true = existing browser reused
    saveStatus: "not_attempted" | "not_configured" | string;
  };
}
```

---

## 4. Command Signatures & JSON Output Schemas

### 4.1 Navigation

#### `open <url>`
```bash
agent-browser open https://example.com --json
```
```json
{
  "success": true,
  "data": {
    "lifecycle": { "..." : "..." },
    "title": "Example Domain",
    "url": "https://example.com/"
  },
  "error": null
}
```
- Aliases: `goto`, `navigate`
- Auto-prepends `https://` if no protocol
- Supports: `https://`, `http://`, `file://`, `about:`, `data://`
- `open` with no URL = launch browser on `about:blank`

#### `read [url]`
```bash
agent-browser read --json
```
```json
{
  "success": true,
  "data": {
    "content": "# Example Domain\n\nThis domain is for use...",
    "contentType": "text/html",
    "finalUrl": "https://example.com/",
    "source": "active-tab-html",
    "truncated": false,
    "url": "https://example.com/",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```
- Without URL: reads rendered DOM of active tab
- With URL: fetches markdown/text without launching Chrome
- Options: `--raw`, `--require-md`, `--outline`, `--llms <index|full>`, `--filter <text>`, `--timeout <ms>`

#### `back` / `forward` / `reload`
```bash
agent-browser back --json
```
```json
{
  "success": true,
  "data": {
    "url": "https://example.com/",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```

#### `close [--all]`
```bash
agent-browser close --json
```
```json
{
  "success": true,
  "data": {
    "closed": true,
    "restoreStatus": "not_configured",
    "saveStatus": "not_configured",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```

`close --all --json`:
```json
{
  "data": {
    "closed": 1,
    "failed": [],
    "sessions": ["default"]
  },
  "success": true
}
```

### 4.2 Snapshot (Accessibility Tree)

```bash
agent-browser snapshot -i --json
```
```json
{
  "success": true,
  "data": {
    "origin": "https://example.com/",
    "refs": {
      "e1": { "name": "Example Domain", "role": "heading" },
      "e2": { "name": "Learn more", "role": "link" }
    },
    "snapshot": "- heading \"Example Domain\" [level=1, ref=e1]\n- link \"Learn more\" [ref=e2]",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```

**Key fields:**
- `refs`: Map of ref ID → `{name, role}` for programmatic access
- `snapshot`: Human/LLM-readable accessibility tree text with `[ref=eN]` markers
- `origin`: Current page URL

**Options:**
- `-i` / `--interactive`: Only interactive elements (recommended for AI agents)
- `-c` / `--compact`: Remove empty structural elements
- `-d <n>` / `--depth <n>`: Limit tree depth
- `-s <sel>` / `--selector <sel>`: Scope to CSS selector
- `-u`: Include href URLs on links

**Non-JSON output** (default, for LLM consumption):
```
Page: Example - Log in
URL: https://example.com/login

@e1 [heading] "Log in"
@e2 [form]
  @e3 [input type="email"] placeholder="Email"
  @e4 [input type="password"] placeholder="Password"
  @e5 [button type="submit"] "Continue"
```

**Refs are ephemeral**: Assigned fresh on every snapshot. Stale after any page change.

### 4.3 Interactions

#### `click <sel>`
```bash
agent-browser click @e2 --json
```
```json
{
  "success": true,
  "data": {
    "clicked": "@e2",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```
- Accepts: `@eN` refs, CSS selectors, semantic locators
- `--new-tab`: Open link in new tab
- Fails with covering element error: `"covered by <div#consent-banner>"`

#### `fill <sel> <text>`
```bash
agent-browser fill @e145 "test query" --json
```
```json
{
  "success": true,
  "data": {
    "filled": "@e145",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```
- Clears existing content first, then types

#### `type <sel> <text>`
- Same schema as `fill`, returns `"typed": "@eN"`
- Types WITHOUT clearing existing content

#### `press <key>`
```bash
agent-browser press Enter --json
```
```json
{
  "success": true,
  "data": {
    "pressed": "Enter",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```
- Supports: `Enter`, `Tab`, `Escape`, `Control+a`, `Shift+Tab`, etc.
- Alias: `key`

#### `scroll <dir> [px]`
```bash
agent-browser scroll down 300 --json
```
```json
{
  "success": true,
  "data": {
    "scrolled": true,
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```
- Directions: `up`, `down`, `left`, `right`
- Default: `down 300px`

#### `hover`, `focus`, `check`, `uncheck`, `select`, `drag`, `upload`, `dblclick`
- All follow same envelope pattern
- Return the action performed (e.g., `"hovered": "@e1"`, `"checked": "@e1"`)

### 4.4 Get Information

#### `get text <sel>`
```bash
agent-browser get text @e1 --json
```
```json
{
  "success": true,
  "data": {
    "text": "Example Domain",
    "origin": "https://example.com/",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```

#### `get url`
```json
{ "success": true, "data": { "url": "https://example.com/", "lifecycle": {} }, "error": null }
```

#### `get title`
```json
{ "success": true, "data": { "title": "Example Domain", "lifecycle": {} }, "error": null }
```

#### Other `get` subcommands
- `get html <sel>` → `"html": "<div>...</div>"`
- `get value <sel>` → `"value": "input text"`
- `get attr <sel> <name>` → attribute value
- `get count <sel>` → element count
- `get box <sel>` → bounding box `{x, y, width, height}`
- `get styles <sel>` → computed styles
- `get cdp-url` → CDP WebSocket URL

### 4.5 Check State

```bash
agent-browser is visible @e1 --json
agent-browser is enabled @e1 --json
agent-browser is checked @e1 --json
```

### 4.6 Screenshot

```bash
agent-browser screenshot --json
```
```json
{
  "success": true,
  "data": {
    "path": "C:\\Users\\luobo\\.agent-browser\\tmp\\screenshots\\screenshot-1785074962162.png",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```
- Without path: saves to temp dir, returns path
- With path: `agent-browser screenshot page.png`
- `--full`: Full page scroll height
- `--annotate`: Numbered labels + legend (maps `[N]` → `@eN`)
- `--screenshot-format <png|jpeg>`, `--screenshot-quality <0-100>`

### 4.7 Wait

```bash
agent-browser wait 100 --json
```
```json
{
  "success": true,
  "data": {
    "ms": 100,
    "waited": "timeout",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```

Wait variants:
- `wait @e1` — until element appears
- `wait 2000` — milliseconds (dumb wait)
- `wait --text "Success"` — until text on page
- `wait --url "**/dashboard"` — until URL matches glob
- `wait --load networkidle` — until network idle
- `wait --load domcontentloaded` — until DOMContentLoaded
- `wait --fn "window.ready"` — until JS condition true
- Default timeout: 25 seconds (`AGENT_BROWSER_DEFAULT_TIMEOUT`)

### 4.8 Find (Semantic Locators)

```bash
agent-browser find text "Privacy" click --json
```
```json
{
  "success": true,
  "data": {
    "clicked": "[data-agent-browser-located='true']",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```

Locator types:
- `find role button click --name "Submit"`
- `find text "Sign In" click [--exact]`
- `find label "Email" fill "user@test.com"`
- `find placeholder "Search" fill "query"`
- `find alt "Logo" click`
- `find title "Close" click`
- `find testid "submit-btn" click`
- `find first ".card" click`
- `find last ".card" click`
- `find nth 2 "a" hover`

### 4.9 Eval (JavaScript)

```bash
agent-browser eval "document.title" --json
```
```json
{
  "success": true,
  "data": {
    "result": "Example Domains",
    "origin": "https://www.iana.org/help/example-domains",
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```
- `eval -b <base64>` for complex scripts
- `eval --stdin` for heredoc input (recommended for multiline)

### 4.10 Tabs

```bash
agent-browser tab --json
```
```json
{
  "success": true,
  "data": {
    "tabs": [
      {
        "active": true,
        "label": null,
        "tabId": "t1",
        "title": "iana.org/help/example-domains",
        "type": "page",
        "url": "https://www.iana.org/help/example-domains"
      }
    ],
    "lifecycle": { "..." : "..." }
  },
  "error": null
}
```
- Tab IDs: stable `t1`, `t2`, `t3` — never reused within session
- Labels: user-assigned via `tab new --label docs [url]`
- Commands: `tab`, `tab new [url]`, `tab t2`, `tab close [t2]`, `tab close docs`

### 4.11 Sessions

```bash
agent-browser session --json
```
```json
{ "data": { "session": "default" }, "success": true }
```

```bash
agent-browser session list --json
```
```json
{ "success": true, "data": { "sessions": ["default"] } }
```

```bash
agent-browser session info --json
```
```json
{
  "data": {
    "active": true,
    "namespace": null,
    "pid": 22928,
    "runtime": {
      "backgroundPid": 22928,
      "browserLaunched": true,
      "compatibilityStatus": "current",
      "engine": "chrome",
      "pageCount": 1,
      "restoreKey": null,
      "restoreSave": "auto",
      "restoreStatus": "not_configured",
      "session": "default",
      "socketDir": "C:\\Users\\luobo\\.agent-browser",
      "version": "0.33.0"
    },
    "session": "default",
    "socketDir": "C:\\Users\\luobo\\.agent-browser",
    "version": "0.33.0"
  },
  "success": true
}
```

### 4.12 Doctor

```bash
agent-browser doctor --json
```
```json
{
  "checks": [
    { "category": "Environment", "id": "env.version", "message": "CLI version 0.33.0 (windows x86_64)", "status": "pass" },
    { "category": "Chrome", "id": "chrome.installed", "message": "...", "status": "pass" },
    { "category": "Daemons", "id": "daemon.active", "message": "No active daemons", "status": "pass" },
    { "category": "Launch test", "id": "launch.elapsed", "message": "Headless launch + about:blank in 0.54s", "status": "pass" }
  ],
  "fixed": [],
  "success": true,
  "summary": { "fail": 0, "pass": 7, "warn": 0 }
}
```
- `--fix`: Run destructive repairs
- `--offline --quick`: Fast local-only check
- Exit code: 0 if all pass, 1 if any fail

---

## 5. Session & Daemon Management

### Session Isolation (`--session <name>`)

Each session gets its own:
- Daemon process (separate PID)
- Browser instance (separate cookies, tabs, refs)
- Socket file / TCP port
- PID file

```bash
agent-browser --session a open https://example.com
agent-browser --session b open https://example.com
# Two fully isolated browsers running concurrently
```

Env: `AGENT_BROWSER_SESSION=myapp` sets default session.

### Session Persistence (`--restore`)

```bash
# Derive stable session ID
SESSION="$(agent-browser session id --scope worktree --prefix myapp)"

# Auto-save/restore cookies + localStorage
agent-browser --session "$SESSION" --restore open https://app.example.com
```

- `--restore` without value uses `--session` as persistence key
- `--restore-save auto|always|never` (default: auto)
- State saved on close + periodically (default every 30s via `AGENT_BROWSER_AUTOSAVE_INTERVAL_MS`)
- Validation: `--restore-check-url`, `--restore-check-text`, `--restore-check-fn`

### Namespace Isolation (`--namespace <name>`)

Isolates daemon sockets and restore-state directories. For multi-project setups.

### Daemon Control

| Action | Command |
|--------|---------|
| Auto-start | Any command (e.g., `open`) |
| Stop one session | `agent-browser close` |
| Stop all sessions | `agent-browser close --all` |
| Check status | `agent-browser session info --json` |
| List sessions | `agent-browser session list --json` |
| Diagnose | `agent-browser doctor --json` |
| Idle auto-shutdown | `AGENT_BROWSER_IDLE_TIMEOUT_MS=60000` |

---

## 6. Key Global Flags for Wrapping

| Flag | Env Var | Purpose |
|------|---------|---------|
| `--session <name>` | `AGENT_BROWSER_SESSION` | Isolated browser session |
| `--json` | `AGENT_BROWSER_JSON` | Machine-readable JSON output |
| `--headed` | `AGENT_BROWSER_HEADED` | Show browser window |
| `--cdp <port>` | `AGENT_BROWSER_CDP` | Connect via CDP |
| `--auto-connect` | `AGENT_BROWSER_AUTO_CONNECT` | Auto-discover running Chrome |
| `--profile <name\|path>` | `AGENT_BROWSER_PROFILE` | Chrome profile for login state |
| `--restore [name]` | `AGENT_BROWSER_RESTORE` | Auto-save/restore session state |
| `--namespace <name>` | `AGENT_BROWSER_NAMESPACE` | Isolate sockets + state dirs |
| `--executable-path <p>` | `AGENT_BROWSER_EXECUTABLE_PATH` | Custom browser binary |
| `--proxy <url>` | `AGENT_BROWSER_PROXY` | Proxy server |
| `--headers <json>` | — | HTTP headers for origin |
| `--state <path>` | `AGENT_BROWSER_STATE` | Load auth state JSON |
| `--ignore-https-errors` | `AGENT_BROWSER_IGNORE_HTTPS_ERRORS` | Skip SSL errors |
| `--max-output <chars>` | `AGENT_BROWSER_MAX_OUTPUT` | Truncate output |
| `--content-boundaries` | `AGENT_BROWSER_CONTENT_BOUNDARIES` | Wrap output in markers |
| `--allowed-domains <list>` | `AGENT_BROWSER_ALLOWED_DOMAINS` | Restrict network domains |
| `--debug` | `AGENT_BROWSER_DEBUG` | Debug output |
| `--config <path>` | `AGENT_BROWSER_CONFIG` | Custom config file |

### Config file resolution (lowest → highest priority):
1. `~/.agent-browser/config.json` (user-level)
2. `./agent-browser.json` (project-level)
3. Environment variables
4. CLI flags

---

## 7. Additional Commands (Not Core but Available)

| Category | Commands |
|----------|----------|
| **Network** | `network route`, `network unroute`, `network requests`, `network request <id>`, `network har start/stop` |
| **Cookies/Storage** | `cookies get/set/clear`, `cookies set --curl <file>`, `storage local/session` |
| **State** | `state save <path>`, `state load <path>` |
| **Auth Vault** | `auth save/login/list/show/delete` |
| **Mouse** | `mouse move/down/up/wheel` |
| **Keyboard** | `keyboard type <text>`, `keyboard inserttext <text>`, `keydown`, `keyup` |
| **Frames** | `frame <sel>`, `frame main` |
| **Dialogs** | `dialog accept/dismiss/status` |
| **Debug** | `console`, `errors`, `highlight`, `inspect`, `trace start/stop`, `profiler start/stop` |
| **Recording** | `record start <path>`, `record stop`, `record restart` |
| **Diff** | `diff snapshot`, `diff screenshot`, `diff url` |
| **A11y** | `a11y [url] [--tags] [--selector] [--json]` |
| **React** | `react tree/inspect/renders/suspense` (requires `--enable react-devtools`) |
| **Vitals** | `vitals [url] [--json]` |
| **SPA** | `pushstate <url>` |
| **Batch** | `batch [--bail] ["cmd" ...]` |
| **MCP** | `mcp [--tools <profiles>]` |
| **Chat** | `chat <message>` (AI-powered, requires `AI_GATEWAY_API_KEY`) |
| **Dashboard** | `dashboard start/stop` |
| **Plugins** | `plugin add/list/show/run` |
| **Streaming** | `stream enable/disable/status` |
| **Init scripts** | `addinitscript <js>`, `removeinitscript <id>` |
| **Skills** | `skills list`, `skills get <name>`, `skills path` |

---

## 8. Wrapping Considerations

### For our MCP tool wrapper:

1. **Always use `--json`** for machine parsing. The envelope is consistent: `{success, data, error}`.
2. **Session management**: Use `--session <name>` per user/conversation. The daemon auto-starts/stops.
3. **Refs are ephemeral**: Always re-snapshot after any page-changing action before using refs.
4. **The `lifecycle` field** in every response can be stripped for cleaner tool output.
5. **Exit codes**: 0 = success, 1 = error. Error message in `error` field.
6. **Command chaining**: `&&` works because daemon persists between CLI invocations.
7. **Timeout**: Default 25s per action. Configurable via `AGENT_BROWSER_DEFAULT_TIMEOUT`.
8. **Windows IPC**: Uses TCP localhost (not Unix sockets), port derived from session name.
9. **`npx` overhead**: 100-500ms per invocation. For production, install globally or as project dep.
10. **`close --all`** returns different schema than `close` (count-based vs boolean).

### Non-JSON output (default) is LLM-optimized:
- Snapshot uses compact `@eN [role] "name"` format (~200-400 tokens per page)
- Designed for AI context efficiency — fewer tokens than JSON
- For our wrapper: use `--json` for programmatic access, non-JSON for LLM-facing content

### MCP server mode:
```bash
agent-browser mcp                    # stdio MCP server (core tools)
agent-browser mcp --tools all        # full tool surface
agent-browser mcp --tools core,network,react  # custom profiles
```
This is an alternative to CLI wrapping — exposes tools via MCP protocol directly.
