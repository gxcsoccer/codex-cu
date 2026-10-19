---
name: codex-cu
description: Control local macOS applications and browser tabs through the codex-cu MCP server (Codex Computer Use). Use when a task needs observing an app's accessibility tree, clicking/typing/pressing keys in native apps, driving a CDP/Playwright browser tab, taking screenshots, or recording loopback audio.
---

# codex-cu

Local desktop automation over the codex-cu MCP server. The server speaks MCP
over stdio and forwards to a Computer Use service on a Unix socket; browsers go
through CDP or the Playwright backend.

## Prerequisites

- The service is running: `codex-cu --socket /tmp/codex-cu.sock` (or the
  LaunchAgent from `scripts/install.sh`).
- The service binary (or its `.app`) has **Accessibility** and **Screen
  Recording** in System Settings → Privacy & Security.
- The MCP server is configured in the agent, for example:

```json
{
  "mcpServers": {
    "codex-cu": {
      "command": "node",
      "args": ["/absolute/path/to/codex-cu/mcp/server.mjs",
               "--socket", "/tmp/codex-cu.sock",
               "--browser", "http://127.0.0.1:9222"]
    }
  }
}
```

`--browser` is optional; add `--browser-backend playwright` to use the real
Playwright engine instead of the dependency-free CDP backend.

## Native tools

| Tool | Arguments |
|---|---|
| `list_apps` | – |
| `app_policy` | `app` |
| `start_app` | `app` |
| `get_app_state` | `app`, `disable_diff?` → `{text, appSpecificInstructions?, screenshotURL?, revision}` |
| `get_screenshot` | `app` → PNG path |
| `click` | `app`, `element_index?` or `x`/`y`, `click_count?`, `mouse_button?` |
| `type_text` | `app`, `text` |
| `press_key` | `app`, `key` (e.g. `cmd+shift+g`), `duration?` |
| `scroll` | `app`, `direction`, `pages?`, `element_index?` or `x`/`y` |
| `set_value` | `app`, `element_index`, `value` |
| `select_text` | `app`, `element_index`, `text`, `prefix?`, `suffix?`, `selection?` |
| `secondary_action` | `app`, `element_index`, `action` (e.g. `AXRaise`) |
| `paste` | `app`, `text` |
| `drag` | `app`, `from_x`, `from_y`, `to_x`, `to_y` |
| `audio_start` / `audio_stop` | `max_duration_ms?` / – → WAV URL |

## Browser tools

| Tool | Arguments |
|---|---|
| `browser_list` | – |
| `browser_tabs` | – |
| `browser_open` | `url` → `{id, url}` |
| `browser_goto` | `tab`, `url` |
| `browser_ax` | `tab`, `disable_diff?` |
| `browser_click` | `tab`, `element_index?` or `x`/`y` |
| `browser_type` | `tab`, `text`, `element_index?` |
| `browser_press_key` | `tab`, `key`, `element_index?` |
| `browser_screenshot` | `tab`, `full_page?` → PNG path |
| `browser_locator_fill` / `browser_locator_click` | `tab`, `selector`, `value?` |
| `browser_evaluate` | `tab`, `expression` |

`tab` may be the id returned by `browser_open`, its URL, or a URL substring.
Tab sessions are cached, so element indexes from `browser_ax` stay valid for
later `browser_click`/`browser_type` calls.

## Workflow

Native apps:

1. `list_apps` → pick the bundle id/name.
2. `get_app_state {app, disable_diff:true}` → read the tree; note the leading
   number on the target line.
3. `click {app, element_index:N}` (or `type_text`, `press_key`, ...).
4. Observe again. A stale index is refetched by criteria; if it cannot be
   resolved uniquely the tool returns an error asking for a fresh observation.

Browsers:

1. `browser_open {url}` → keep `id`.
2. `browser_ax {tab:id}` → note the element index.
3. `browser_click {tab:id, element_index:N}`; re-read with
   `disable_diff:true` for the full tree.

## Rules

- These tools perform **real UI actions**. Ask before destructive or
  irreversible operations (sending messages, purchases, deleting data).
- Prefer element indexes from a fresh observation over raw coordinates.
- Screenshots may contain private content; do not echo them unnecessarily.
- If a tool fails with `-10009`, permissions are missing; `-10007` means the app
  is not running; `-10008` means the element could not be resolved.
