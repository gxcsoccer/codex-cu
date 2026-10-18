# Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M1 protocol + inventory | framing, JSON-RPC, ping, `ListApps`, AX tree text, client lib, CI | **done** |
| M2 input actions | click/drag/scroll/type/pressKey/setValue/selectText, AX-first with CGEvent fallback, element-ID resolution, policy approvals | **done** |
| M3 observation | skyshot (ScreenCaptureKit → temp PNG → `file://`), AX diffing, app-specific instructions | **done** |
| M4 parity harness | scripted scenarios; semantic comparison against recorded Codex traces (same app, same steps) | **harness done**; live run blocked on TCC |
| M5 packaging | launchd agent / `install.sh`, socket bootstrap auth, docs | **done** |
| M6 audio | Start/StopAudioRecording parity | out of scope for now |
| M7 cua surface | `cua.getApp/getAXState/click/scroll/...` wrapper matching the model-facing API | **done** |
| M8 browser surface | CDP provider: listBrowsers/getBrowser/listTabs/getTab/createBrowserTab, Tab AX/screenshot/input | **partial** (element-index and Playwright-style locators missing) |

## M2 design notes

- The original resolves `elementID` against the **last observation** and rejects stale IDs.
  We will keep a per-app snapshot registry with monotonic IDs + revision numbers, and
  return `accessibilityError` for stale or unknown IDs.
- Clicks: resolve the AX element frame, synthesize a click at its center; if the
  element is not clickable, fall back to `CGEvent` at the frame center.
- Keyboard: `pressKey` parses `cmd+shift+g` into flags + keycode; `type` posts
  unicode strings (layout-independent).
- Every action bumps the revision so a follow-up `getAXState` can emit a diff.

## M4 design notes

- Record the same scenario against our service and against Codex (via `dbtrace`),
  then compare normalized steps (verb, target description, observed text hash)
  rather than raw text, to avoid false negatives from incidental UI differences.
- Keep the comparison fixtures under `fixtures/scenarios/`.
