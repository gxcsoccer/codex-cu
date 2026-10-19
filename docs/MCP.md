# Agent integration: MCP + skill + app

Three layers make the service directly usable from an agent:

```
agent
  └─ MCP (stdio, JSON-RPC)  mcp/server.mjs
        └─ Unix socket ── Codex CU service (native apps, audio)
        └─ CDP/Playwright ── browser tabs
```

## 1. MCP server

```bash
node mcp/server.mjs --socket /tmp/codex-cu.sock \
  [--browser http://127.0.0.1:9222] [--browser-backend cdp|playwright]
```

It speaks newline-delimited JSON-RPC 2.0 (MCP stdio transport) and exposes 28
tools. Environment fallbacks: `CODEX_CU_SOCKET`, `CODEX_CU_BROWSER`,
`CODEX_CU_BROWSER_BACKEND`.

Client configuration (Claude Desktop / any `mcpServers` host):

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

Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`.
`notifications/*` are accepted silently; unknown methods return `-32601` and an
unknown tool returns `-32602`.

### Tool surface

Native: `list_apps`, `app_policy`, `start_app`, `get_app_state`,
`get_screenshot`, `click`, `type_text`, `press_key`, `scroll`, `set_value`,
`select_text`, `secondary_action`, `paste`, `drag`, `audio_start`, `audio_stop`.

Browser: `browser_list`, `browser_tabs`, `browser_open`, `browser_goto`,
`browser_ax`, `browser_click`, `browser_type`, `browser_press_key`,
`browser_screenshot`, `browser_locator_fill`, `browser_locator_click`,
`browser_evaluate`.

Browser tab sessions and their accessibility indexes are cached per tab id, so a
`browser_ax` index can be used by a later `browser_click` on the same tab.
Native element indexes come from `get_app_state`; stale indexes are refetched by
criteria on the service side.

## 2. Skill

`skill/codex-cu/SKILL.md` is a self-contained skill manifest (YAML frontmatter +
tool table + workflow + safety rules). Copy the directory into your agent's
skills folder, e.g.:

```bash
cp -R skill/codex-cu ~/.claude/skills/
```

The skill assumes the MCP server above is configured; it contains no code.

## 3. `.app` bundle

The service is a plain executable. To grant TCC permissions to a bundle (and to
launch it from Finder/`open`), build an app wrapper:

```bash
scripts/build-app.sh                       # -> dist/Codex CU.app
scripts/build-app.sh --print-plist         # inspect Info.plist
open "dist/Codex CU.app" --args --socket /tmp/codex-cu.sock --audio
```

Bundle id `com.codex-cu.agent`, `LSUIElement` (no Dock icon), and the
accessibility/screen-capture usage strings. Grant **Accessibility** and **Screen
Recording** to `dist/Codex CU.app`, then the MCP server can drive it.

## 4. End-to-end verification

Offline (mock service, used by CI):

```bash
node --test mcp/test/mcp.test.mjs
```

Live, with the service and a Chrome CDP endpoint running:

```bash
node scripts/live-check.mjs --socket /tmp/codex-cu.sock --audio \
  --browser http://127.0.0.1:9555

node mcp/server.mjs --socket /tmp/codex-cu.sock --browser http://127.0.0.1:9555
# then initialize -> tools/call get_app_state / browser_open / browser_ax / ...
```

The live MCP flow was verified manually: `get_app_state` on Finder, `browser_open`
a data URL, `browser_ax` showing the button, `browser_click` firing its handler,
and `audio_start`/`audio_stop` returning a 24 kHz WAV.
