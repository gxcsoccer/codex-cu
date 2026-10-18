# Scope: what "1:1" means here

The original is closed source. A literal source-identical copy is not possible;
this repo aims at **protocol- and behavior-compatible replication**, with every
deviation written down and tested where the environment allows.

## Replicated (with evidence)

| Area | Fidelity |
|---|---|
| Unix-socket transport, 4-byte LE framing, 8 MiB cap | 1:1 |
| JSON-RPC `ping`/`request`, version handshake | 1:1 |
| Seven request types, envelopes, `requestType` dispatch | 1:1 |
| Action payload encoding (`_0`, string element IDs, mouse buttons) | 1:1 |
| 21 error codes | identical taxonomy (cross-language test) |
| AX text format (roles, states, fields, diff, Selected block) | matched to captured output |
| Nine native actions, AX-first with CGEvent fallback | implemented, faked-executor tested |
| Screenshot shape (`file://` PNG, temp lifecycle) | matched; live needs TCC |
| `cua` surface (native + browser + audio) | matched to captured TypeScript types |
| Audio protocol/limits/WAV URL | matched from `@oai/sky` and tested |
| LaunchAgent packaging, approvals, instructions | implemented |

## Deliberate deviations

| Deviation | Why |
|---|---|
| Browser backend can use **CDP** or **Playwright** (`PlaywrightBrowserProvider`) | the Playwright backend uses the app's own 1.57 engine for locators, auto-waiting and actionability; the CDP backend is the dependency-free default |
| No Playwright WASM AX layer or Chrome extension host | accessibility text stays on CDP `Accessibility.getFullAXTree`, rendered in the same tree/diff layout; the extension/iab transports are not reproduced |
| `performSecondaryAction` on browser tabs throws | CDP has no accessibility secondary-action equivalent |
| Browser `paste` uses the page clipboard on the Playwright backend, `Input.insertText` on CDP | clipboard writes need a trusted gesture and permissions; the Playwright path is verified live, the CDP path is the deterministic fallback |
| Approvals default to allow; malformed files fail open | the original's first-use prompt UI is not reproduced |
| Diff header/wording | copied from captured output, but not proven byte-identical for every app |
| `appSpecificInstructions` shipped empty by default | original texts are not recoverable; `--instructions` supplies them |

## Verified live on this machine

| Item | Result |
|---|---|
| Native inventory + AX text | PASS (11 apps, `Window:` header) |
| Screenshot | PASS (175,490-byte PNG) |
| Audio capture | PASS (24 kHz stereo WAV, 26,924 bytes) |
| Browser (CDP) | PASS (Chrome for Testing 149, real CDP WebSocket) |
| Browser (Playwright) | PASS (live test: getByRole click, AX text, screenshot) |

The system Chrome is an `aha-runtime` stub, so browser verification uses the
Playwright-cached **Chrome for Testing**; the service itself is unchanged.

`scripts/live-check.mjs` reruns the same checks on any desktop session.

## Not attempted

| Item | Reason |
|---|---|
| `iab` / extension / MCP-app browser backends | require the original extension and native-messaging host |
| iframe content in browser AX | main-frame tree only; `frameLocator` covers interaction on the Playwright backend |
| Audio live capture verification | now PASS on this machine (`live-check --audio`) |
| Windows-specific `list_windows`/`get_window` | macOS client exposes no window-scoped bindings either |
| Exact response schemas for `AppGetSkyshot`/`PerformAction` beyond consumed fields | not observable without an entitled peer |

## How to judge completion

1. `scripts/verify.sh` passes (build + 65 Swift tests + 70 Node tests).
2. `docs/CONFORMANCE.md` rows have implementation + tests.
3. Docs state each deviation and each blocked item.
4. On a TCC-enabled machine, `scripts/live-check.mjs` reports PASS for native,
   screenshot, audio and browser checks.
