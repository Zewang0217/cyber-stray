# agent-browser Persistence & Caching Research

> **Date:** 2026-08-02
> **Version investigated:** 0.33.2 (cli/Cargo.toml, GitHub HEAD)
> **Sources:** Source code at github.com/vercel-labs/agent-browser, official docs at agent-browser.dev
> **Purpose:** Inform Issue #54 design for cyber-stray persistent login across daemon restarts

---

## 1. Session Persistence (`--restore`)

### What data is saved

`--restore` saves **cookies + localStorage + sessionStorage** only. It does NOT save IndexedDB, service workers, cache, or browser extensions state.

The state format is a JSON structure (`StorageState`):

```rust
// cli/src/native/state.rs
pub struct StorageState {
    pub cookies: Vec<Cookie>,
    pub origins: Vec<OriginStorage>,
}
pub struct OriginStorage {
    pub origin: String,
    pub local_storage: Vec<StorageEntry>,
    pub session_storage: Vec<StorageEntry>,
}
pub struct StorageEntry {
    pub name: String,
    pub value: String,
}
```

### Where on disk

State files are stored in `~/.agent-browser/sessions/` (or `~/.agent-browser/namespaces/{ns}/state/sessions/` when `AGENT_BROWSER_NAMESPACE` is set).

File naming: `{restoreKey}-{sessionId}.json` (plaintext) or `{restoreKey}-{sessionId}.json.enc` (encrypted).

### When is it saved

1. **Explicit `close` command** — `handle_close()` calls `auto_save_restore_state()` before closing.
2. **Idle timeout** (default 1 hour) — daemon saves state then shuts down.
3. **Daemon shutdown** (SIGINT/SIGTERM/SIGHUP) — `shutdown_signal()` handler calls `auto_save_restore_state()`.
4. **Periodic autosave** — every `AGENT_BROWSER_AUTOSAVE_INTERVAL_MS` (default 30000ms = 30s), waits for 2-second quiet period after last command.

Set `AGENT_BROWSER_AUTOSAVE_INTERVAL_MS=0` to disable periodic autosave (save-on-close still runs).

### Transactional save mechanism

1. Write candidate to `sessions/.tmp/{key}-{session}-candidate-{pid}.json`
2. Validate the candidate (parse as valid StorageState JSON)
3. Rotate existing final file to `{final}.previous`
4. Rename candidate to final path
5. Delete `.previous`

### How is it restored

On browser launch, if a `restoreKey` is configured:

1. `find_auto_state_file(session_name)` scans for files matching `{restoreKey}-*`, picks most recently modified.
2. `load_state()` reads and parses (decrypting if `.enc`), sets cookies via CDP `Network.setCookies`, then sets localStorage/sessionStorage via `Runtime.evaluate`.
3. Optional validation via `--restore-check-url/text/fn`.

### Restore save policies

| Policy | Behavior |
|--------|----------|
| `auto` (default) | Skip save if restore failed or validation failed |
| `always` | Always save regardless |
| `never` | Never auto-save |

---

## 2. `--profile` vs `--restore` vs `--state`

| Mechanism | What persists | Storage | Lifetime | Use case |
|-----------|--------------|---------|----------|----------|
| `--profile <path>` | Full Chrome user-data-dir | Chrome's LevelDB/SQLite | Permanent | Full browser state |
| `--profile <name>` | Read-only snapshot of existing Chrome profile | Temp dir copy | Session only | Reuse existing login |
| `--restore [key]` | Cookies + localStorage + sessionStorage | JSON in `~/.agent-browser/sessions/` | Across restarts | Lightweight login persistence |
| `--state <path>` | Cookies + localStorage + sessionStorage (one-time) | User-managed JSON | One-time load | Import auth from external source |

### Recommendation for cyber-stray

**`--restore` is the appropriate choice**: lightweight, automatic, encryptable, crash-resilient (30s autosave), no Chrome profile directory management.

---

## 3. Auth Vault / Encryption

### State file encryption (`AGENT_BROWSER_ENCRYPTION_KEY`)

- **Algorithm:** AES-256-GCM
- **Key derivation:** SHA-256 hash of the hex key string → 32 bytes
- **Format:** `[12-byte nonce][ciphertext+tag]` (raw binary, `.json.enc` extension)
- **Key format:** 64-character hex string (256 bits)

### Auth profile encryption (credential vault)

- **Algorithm:** AES-256-GCM
- **Key:** Raw 32 bytes parsed from 64-char hex (NOT hashed — different from state encryption)
- **Key sources (priority):**
  1. `AGENT_BROWSER_ENCRYPTION_KEY` env var
  2. `~/.agent-browser/.encryption-key` file (auto-generated if missing)

### Auth vault CLI commands

| Command | Description |
|---------|-------------|
| `auth save <name> --url <url> --username <u> --password <p>` | Save credentials (encrypted) |
| `auth login <name>` | Auto-login using saved credentials |
| `auth list / show / delete` | Manage profiles |

---

## 4. Data Directory

Default: `~/.agent-browser/`

```
~/.agent-browser/
├── .encryption-key          # Auto-generated AES key
├── auth/                    # Credential vault profiles
├── sessions/                # Restore state files
│   ├── {key}-{session}.json[.enc]
│   └── .tmp/                # Candidate files during save
├── {session}.sock           # Unix socket (macOS/Linux)
├── {session}.pid            # Daemon PID file
├── {session}.port           # TCP port (Windows)
└── namespaces/              # Namespaced isolation
```

Overrides: `AGENT_BROWSER_SOCKET_DIR`, `AGENT_BROWSER_NAMESPACE`, `XDG_RUNTIME_DIR`.

---

## 5. Chrome User Data Dir

- **Without `--profile`:** EPHEMERAL — temp dir at `$TMPDIR/agent-browser-chrome-{uuid4}`, deleted on close.
- **With `--profile <path>`:** PERSISTENT — full Chrome state, not deleted.
- **`--restore` is independent** of Chrome user-data-dir — saves/loads via CDP protocol calls.

---

## 6. Daemon Lifecycle & Crash Recovery

### Graceful shutdown (all trigger `auto_save_restore_state()`)

`close` command, SIGINT, SIGTERM, SIGHUP, idle timeout, Ctrl+C (Windows).

### SIGKILL: What is lost

- State changes since last autosave (up to 30s)
- Browser process may be orphaned
- Socket/PID files become stale (auto-cleaned on next start)

### Crash resilience

30s periodic autosave is the primary mechanism. Transactional writes prevent corruption. No WAL/journal.

---

## 7. Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_BROWSER_ENCRYPTION_KEY` | (none) | 64-char hex, AES-256-GCM encryption |
| `AGENT_BROWSER_AUTOSAVE_INTERVAL_MS` | 30000 | Periodic autosave interval |
| `AGENT_BROWSER_IDLE_TIMEOUT_MS` | 3600000 | Auto-shutdown after idle (1h) |
| `AGENT_BROWSER_RESTORE_SAVE` | auto | Save policy: auto/always/never |
| `AGENT_BROWSER_STATE_EXPIRE_DAYS` | 30 | Auto-cleanup old state files |
| `AGENT_BROWSER_NAMESPACE` | (none) | Isolate sockets + state |

---

## 8. Caveats

- `--restore` does NOT save IndexedDB, service workers, or cache.
- SIGKILL loses up to 30s of state changes.
- State encryption uses SHA-256(key) as AES key; auth vault uses raw hex bytes. Two different derivations for the same env var.
- Periodic autosave requires 2-second quiet period — rapid-fire commands can delay it.
- Without `--restore`, `--session` alone does NOT enable persistence.
- Chrome's temp user-data-dir may accumulate in `$TMPDIR` if daemon is SIGKILLed.
- On Windows, daemon uses TCP (port from session name hash, range 49152-65535).
- Auto-generated `.encryption-key` has 0o600 on Unix but no special protection on Windows.
