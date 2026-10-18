# Codex Computer Use — reverse-engineering report

This report describes what Codex Computer Use is, how it was reconstructed, how
faithful the reimplementation is, and what remains unknown. It is the narrative
companion to `PROTOCOL.md` (wire format), `CONFORMANCE.md` (feature matrix) and
`PARITY.md` (comparison harness).

## 1. What the original is

Codex Computer Use is a local macOS desktop-automation stack shipped with the
Codex/ChatGPT app. It has four parts:

1. **`SkyComputerUseService`** — a Swift service, bundled as
   `Codex Computer Use.app` (bundle `com.openai.sky.CUAService`), listening on a
   Unix socket inside a group container.
2. **`@oai/sky` client** — JavaScript in the Electron app that speaks
   length-prefixed JSON-RPC to the service.
3. **`@oai/browser-desktop`** — Playwright plus a WASM accessibility layer and a
   Chrome extension for browser tabs.
4. **`cua_repl`** — a Node REPL exposed to the model, wrapping 1 and 3 into the
   `cua` API (`getApp`, `getAXState`, `click`, `createBrowserTab`, ...).

The model never touches AX or CGEvent directly; it writes JavaScript against
`cua`, and the stack executes it locally. That design is what this repo
reproduces.

## 2. Architecture reconstructed

```
 model ──> cua (JS REPL)
             ├── native:  cua.getApp / getAXState / click ...
             │      └── Unix socket, 4-byte LE length + JSON-RPC
             │             └── SkyComputerUseService
             │                    ├── AXUIElement observation (ID-indexed text)
             │                    ├── AXPress / CGEvent actions
             │                    ├── ScreenCaptureKit skyshot
             │                    └── approvals + TCC checks
             └── browser: cua.getTab / createBrowserTab ...
                    └── browser provider (Playwright + extension + WASM AX)
```

The reimplementation mirrors the split: `service/` (Swift) owns native
observation/actions; `client/` (Node) owns the protocol, the `cua` surface and a
CDP-backed browser provider.

## 3. Protocol

- AF_UNIX stream socket; 4-byte little-endian length + UTF-8 JSON.
- JSON-RPC 2.0 with `ping` and `request`.
- `requestType` selects one of seven payloads; `request` is type-specific.
- Version handshake: `CodexComputerUseIPC-5`.
- Twenty error codes (-10000 … -10020), including
  `senderProcessNotAuthenticated` and `screenLocked`.
- Actions are single-key objects (`click`, `drag`, `paste`, `pressKey`, `scroll`,
  `selectText`, `setValue`, `type`, `performSecondaryAction`) with element IDs
  serialized as strings and `_0` wrappers for single-value variants.

Full spec: `PROTOCOL.md`.

## 4. Native observation

Captured from a real Finder session (`fixtures/ax/`):

```
Window: "下载", App: 访达.
0 标准窗口 下载, ID: FinderWindow, Secondary Actions: Raise
	4 row (selectable) Description: 时钟, Value: 最近使用
		26 滚动条 (settable, float) 0
```

Key properties, all implemented and pinned by `FormatParityTests`:

- tree rooted at the **focused window**, not the application;
- **localized role descriptions** (`kAXRoleDescription`), not `AXRole`;
- states: `disabled`, `selected`/`selectable`, `expanded`/`collapsed`, `settable`,
  `float`;
- optional `Description/ID/URL/Value` fields; numeric values are bare;
- `Secondary Actions` excluding press;
- diffs: removed-ID ranges, `+`/`~` + tab, `Selected:` block and the explanatory
  note.

Element IDs are scoped to one observation. Actions invalidate the snapshot;
reusing an ID returns `-10008`, matching the client's "fresh refs" contract.

## 5. Native actions

All nine action kinds are implemented. The executor is AX-first: element clicks
use `AXPress` when the element advertises it, otherwise a synthetic click at the
element's frame center. `type` posts Unicode keyboard events (layout
independent); `pressKey` parses `cmd+shift+g`-style chords into flags plus a
virtual keycode.

`AppStart` waits briefly (default 5 s) for the first accessibility window after
launch, since acting on a windowless app is the most common first-action failure;
without Accessibility there is nothing to inspect and it returns immediately.

## 6. Browser stack

The original uses Playwright, a WASM accessibility layer and a Chrome extension.
The reimplementation exposes the **same model-facing API** over CDP:

- `listBrowsers` / `getBrowser` / `listTabs` / `getTab` / `createBrowserTab`;
- Tab navigation, AX text (`Accessibility.getFullAXTree`), screenshots, and input;
- element indices resolve through `backendDOMNodeId` + `DOM.getBoxModel`;
- `setValue`/`selectText` use `Runtime.callFunctionOn` with input/change events.

This is API-compatible but not transport-identical: there is no Playwright or
extension, and `iab`/MCP-app backends are absent.

## 7. Permissions and safety

The original gates on:

- **Accessibility** for AX reads and synthetic input → `-10009`;
- **Screen Recording** for skyshot (SCK fails with `-3811` without it) → `-10009`;
- per-app approvals (`ComputerUseAppApprovals.json`);
- screen-lock detection (`-10020`).

The reimplementation keeps the first two gates, reads a configurable approval
JSON (default allow — a documented deviation), and fails observation and actions
while the screen is locked (`-10020`). The socket is user-owned with no TCP listener.

## 8. Fidelity assessment

| Layer | Fidelity |
|---|---|
| Framing / JSON-RPC / error codes | **1:1** (observed) |
| Request envelopes / action encoding | **1:1** (client serializer) |
| AX text format | **matched to captured output** |
| Native action semantics | implemented; **not live-verified** (TCC) |
| Screenshot shape (temp PNG → `file://`) | matched; live capture requires TCC |
| Browser API surface | compatible; backend differs (CDP vs Playwright) |
| Browser extras | locators (CSS subset), DOM snapshot, element info, key chords |
| cua surface | matched to the captured TypeScript definitions |
| Audio recording | protocol, lifecycle and SCK loopback recorder implemented; live capture needs TCC |
| Window-scoped bindings | **not implemented** (the macOS client exposes none either; only the Windows client has window APIs) |

Inferred items (documented in `PROTOCOL.md`): exact response schemas for
`AppGetSkyshot`/`PerformAction`, server-side deadline enforcement, the diff header
wording (we match the captured text), and app-specific instruction texts.

## 9. Verification

```
Swift unit tests        65   (framing, RPC, actions, observation, format parity,
                             policy, screen lock, startApp, instructions, audio)
Node protocol/client    63   (framing, envelopes, errors, cua, browser, CDP,
                             locators, DOM, audio, fuzzing, CLI)
Integration (real socket) 7   (interop, concurrency, oversized frame, semantics,
                             approvals, malformed instructions, audio denial)
CI                      macos-15, green
```

CI cannot exercise Accessibility, Screen Recording or a real browser. On the
development machine, `live-check` reports PASS for ping, app inventory, AX text
(`Window:` header), a 175 KB screenshot, a 24 kHz stereo WAV and a real Chrome 149
CDP session.

## 10. Reproduce

```bash
scripts/verify.sh          # build + all suites
swift build --package-path service
./service/.build/debug/CodexCU --socket /tmp/codex-cu.sock
node tools/scenario.mjs fixtures/scenarios/finder.json --socket /tmp/codex-cu.sock
```

Live native verification requires granting Accessibility and Screen Recording to
the service binary (`docs/INSTALL.md`); live browser verification requires a real
Chrome started with `--remote-debugging-port` (`docs/BROWSER.md`).
