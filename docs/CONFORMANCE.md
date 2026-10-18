# Conformance report

What "1:1" means here, what is implemented, and what the evidence is. Every row
points at code and at a test; rows marked **inferred** were not observed on a live
response and are documented as such.

## Transport and framing

| Item | Original | This repo | Evidence |
|---|---|---|---|
| Unix stream socket | yes | yes | `service/Sources/CodexCUCore/Server.swift` |
| 4-byte LE length + JSON | yes | yes | `Framing.swift`, `client/src/framing.mjs` |
| 8 MiB cap, malformed frames close | client constant | enforced | `readerRejectsOversizedFrames`, integration test |
| JSON-RPC `ping` / `request` | yes | yes | `RPC.swift`, `client/test/client.test.mjs` |
| Version handshake `CodexComputerUseIPC-5` | yes | yes | `pingRejectsVersionMismatch` |
| Exactly one of result/error | yes | yes | `client/test/client.test.mjs` |
| Deadline (`deadlineUnixMilliseconds`) | sent by client | enforced, `-10001` | **inferred code**; `expiredDeadlinesAreRejected` |
| Concurrent clients | unknown | supported | `serves concurrent clients` |

## Native (desktop) surface

| Request | Original | This repo | Evidence |
|---|---|---|---|
| `ListApps` | yes | yes | integration test |
| `AppStart` | yes | yes (NSWorkspace + wait for the first AX window) | `StartAppTests` |
| `AppGetSkyshot` | AX text + screenshot | yes; focused-window root, localized roles; `appSpecificInstructions` from `--instructions` | `FormatParityTests`, `ObservationTests`, `PolicyTests` |
| Screenshot | SCK → temp PNG → `file://` | same shape; old file removed | `ObservationTests` |
| Diff | `~`/`+`, removed ranges, Selected block | same shape | `AXDiffTests`, `FormatParityTests` |
| `AppPolicy` | approvals store | JSON allowlist (`--approvals`); explicit false -> `-10006`; missing/malformed/absent entry -> allow (**fail-open deviation**) | `PolicyTests`, integration test |
| `PerformAction` | 9 action kinds | all 9 | `ActionTests` |
| Audio recording | Start/Stop, 100…300000 ms, WAV URL | protocol + lifecycle + ScreenCaptureKit recorder (`--audio`); denial -> `-10009` | `AudioTests`, `AudioFormatTests`, wire test |
| Screen lock | `-10020` | observation/actions fail with `-10020` | `ScreenLockTests` |
| `AppStart` errors | not found | `-10007` | integration test |
| Ambiguous app match | `-10018` | `-10018` via `selectRunning` | `PolicyTests` |
| `AppGetSkyshot` without TCC | `-10009` | `-10009` | integration test |

Action semantics:

| Action | Original | This repo | Evidence |
|---|---|---|---|
| click element | AX-first | `AXPress` when advertised (no modifiers/hold), else CGEvent center | `ActionTests`, `SystemActionExecutor` |
| click payload | `key`, `durationMs` | modifiers held on the mouse events; hold duration | `clickModifiersAndDurationAreForwarded` |
| click coordinate | yes | yes | `coordinateClicksSkipElementResolution` |
| drag / scroll | yes | yes | `ActionTests` |
| type | layout independent | unicode CGEvents | `ActionTests` |
| pressKey | `cmd+shift+g` | parser covers modifiers/names/F1–F12; `duration` holds the key | `KeyCodesTests`, `ActionTests` |
| paste | clipboard + cmd+v | same | `ActionTests` |
| setValue / selectText | AX attributes | same | `ActionTests` |
| secondaryAction | AX action | same | `ActionTests` |
| stale element IDs | rejected | `-10008` | `staleElementIDsAreRejectedAfterAnAction` |

## Browser surface

| Item | Original | This repo | Evidence |
|---|---|---|---|
| `listBrowsers` | Playwright + WASM AX | CDP `/json/version`, or Playwright over CDP | `browser.test.mjs`, `browser-playwright.test.mjs` |
| `getBrowser` / `documentation` | yes | yes | same |
| `listTabs` / `getTab` | yes | `Target.getTargets` / attach | `browser.test.mjs`, `cdp-live.test.mjs` |
| `createBrowserTab` | yes | `Target.createTarget` | same |
| `goto/back/forward/reload/close` | yes | `Page.*` | `cdp-live.test.mjs` |
| AX state | WASM AX | `Accessibility.getFullAXTree` | same |
| element-index click | via AX indices | `backendDOMNodeId` + `DOM.getBoxModel` | same |
| typeText/pressKey/setValue/selectText | yes | focus + input / `Runtime.callFunctionOn` | same |
| screenshot | yes | `Page.captureScreenshot` | same |
| `title()` / `url()` / `screenshot({fullPage, clip})` | yes | `Runtime.evaluate` / `Page.captureScreenshot` | `browser.test.mjs` |
| `domSnapshot()` / `elementInfo(x, y)` | yes | `outerHTML` / `elementFromPoint` | `browser.test.mjs` |
| `tab.playwright` | Playwright | **real Playwright Page** on the Playwright backend (getByRole/text/testid/label, auto-wait), CSS subset on the CDP backend | `browser-playwright.test.mjs` |
| `markDeliverable` / `markHandoff` / `requestUserTakeover` | host status | local flags (no host channel) | `browser.test.mjs` |
| `performSecondaryAction` | yes | **unsupported**, explicit error | `browser.test.mjs` |
| `iab` / extension / MCP apps | yes | **not implemented** | — |

## Model-facing API

`client/src/cua.mjs` mirrors the captured `cua` surface: `getApp`, `getAXState`,
`getScreenshot`, `getAXStateAndScreenshot`, `click`, `drag`, `scroll`,
`selectText`, `setValue`, `performSecondaryAction`, `paste`, `pressKey`,
`typeText`, plus `listBrowsers`, `getBrowser`, `listTabs`, `getTab`,
`createBrowserTab`.

Deviations: `getApp({windowId})` is rejected explicitly. Note that the macOS
client we inspected exposes no window-scoped bindings either: `windowId` does not
appear in `cua-repl` or `@oai/sky`'s mac target, and only the Windows client has
`list_windows`/`get_window`. The TypeScript surface is broader than the macOS
implementation. `performSecondaryAction` on browser tabs throws; browser `paste`
does not touch the system clipboard.

## Verification tooling

`scripts/live-check.mjs` exercises ping, app inventory, AX text, screenshot,
audio and browser against a real socket; skips are explicit and never counted as
passes. `scripts/verify.sh` builds debug+release and runs every suite.

## Packaging

`scripts/install.sh` installs a LaunchAgent with the service binary, prints TCC
instructions, and supports `--print-plist` / `--uninstall`; the plist is linted
in tests.

## Evidence provenance

- Protocol shapes: shipped client (`@oai/sky`), service symbols, bundled API docs.
- AX text format: verbatim captures in `fixtures/ax/` (Finder, zh locale).
- Error codes: recovered from `errors.js`.
- Everything else is marked **inferred** in `docs/PROTOCOL.md` / here.

## Known unknowns

- Exact `AppGetSkyshot` / `PerformAction` response JSON beyond the fields the
  client reads.
- Whether the original enforces deadlines server-side.
- Audio recording request/response.
- App-specific instruction texts.
- `codexTurnMetadata` semantics.
