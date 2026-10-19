# Open questions

Everything below is still uncertain. Each item records the evidence, the current
behaviour, and what would settle it. Nothing here is a claim of correctness.

## Protocol and native service

### 1. Diff presentation variants

**Evidence**: `SkyComputerUseService` contains three templates:
`The following is a diff from the previous accessibility tree with ~, +, and -
representing changed, added, and removed elements...`, a cumulative variant
(`from the initial accessibility tree`), and
`There has been no change in the accessibility tree for `.
**Current**: always the summarized form (`Removed element IDs: …`, `~`/`+`).
**Settle it**: observe an entitled service with removals and with an unchanged
tree; the trigger is server-side and no shipped client option selects it.

### 2. AX invalidation monitor

**Evidence**: `RefetchableSkyshotAXTree`, `RefetchableUIElement`, and
`The skyshot is unexpectedly missing an invalidation monitor`.
**Current**: refetch on demand by role/identifier/title/description; no
`AXObserver` notification stream.
**Settle it**: drive the original service while an external process changes the
UI and compare when it returns stale-vs-refetched results.

### 3. App-instruction bundle mapping

**Evidence**: seven `AppInstructions/*.md` files extracted from
`Package_ComputerUse.bundle`.
**Current**: `com.spotify.client`, `com.tinyspeck.slackmacgap` and
`com.apple.iWork.Numbers` are confirmed (adjacent strings / explicit client
exclusion); `com.apple.Music`, `com.apple.clock`, `notion.id` and
`com.apple.ScreenContinuity` are inferred, with a display-name fallback.
**Settle it**: call the original `getAppState` for each running app and compare
`appSpecificInstructions`.

### 4. Response schemas beyond consumed fields

**Evidence**: the mac client reads only `text`, `skyshot.screenshot.url` and
`appSpecificInstructions` from `AppGetSkyshot`; actions read `ok`.
**Current**: responses emit those fields; any additional original fields are
unknown.
**Settle it**: capture a real response envelope from the original service.

### 5. Refetch failure code

**Evidence**: exact error strings observed in the binary; no code attached.
**Current**: `-10008 accessibilityError` for zero/multiple matches (inferred).
**Settle it**: trigger the same condition against the original service.

### 6. Native element-id algorithm

**Evidence**: captured trees have gaps (0, 4, 26), so ids are not per-walk
counters.
**Current**: `CFHash(AXUIElement)` registry, monotonic allocation.
**Settle it**: compare id sequences across two snapshots of the same app from
the original service; hash collisions are theoretically possible in our scheme.

### 7. Instruction delivery scope

**Evidence**: `window_result.js` uses a module-level `Set` to deliver each app's
instruction block once per process, and excludes `com.apple.iWork.Numbers`.
**Current**: same process-wide dedupe.
**Settle it**: multiple CUA sessions in one process; unknown whether the original
resets per session.

## Browser

### 8. Role labels and `Secondary Actions:`

**Evidence**: CDP `AXNode` has no localized role description; the browser WASM
has `Secondary Actions` but no AX action names (`AXPress`, `AXRaise` absent).
**Current**: CDP role names as labels; no secondary actions.
**Settle it**: capture the original browser AX text for a page with a context
menu / secondary action.

### 9. `Selected:` semantics

**Evidence**: the native tree uses the `selected` state; the browser WASM has the
same `Selected:` block and note.
**Current**: nodes whose AX `selected` property is true.
**Settle it**: compare against text selection / focused element in the original.

### 10. Frame display-id stability

**Status: addressed (our side).** Bases are allocated per frame id in a per-tab
registry, independent of enumeration order, and reset on navigation; a unit test
swaps frame order and asserts identical ids, and a live three-level OOPIF test
asserts id stability across observations. The original's exact scheme remains
unknown.

### 11. iab / extension / MCP-app backends

**Evidence**: the shipped browser stack includes a Chrome extension and a WASM
AX layer; our backend is CDP/Playwright.
**Current**: not implemented.
**Settle it**: requires the extension and its native-messaging host, which are
not reproduced here.

## Audio

### 12. Late stop after auto-stop

**Evidence**: the original auto-stops after `max_duration_ms`; the client then
calls stop.
**Current**: the finished URL is retained and returned by a late stop (verified
live).
**Settle it**: observe the original after its timer fires.

## Process and environment

### 13. `codexTurnMetadata`

**Evidence**: the client sends an `x-codex-turn-metadata` header.
**Current**: ignored.
**Settle it**: determine whether the service stores or uses it.

### 14. Approvals fail-open

**Evidence**: `AppApprovalStore` keys are known; the first-use approval UI is a
host feature.
**Current**: missing/malformed stores and absent entries allow the app.
**Settle it**: observe the original without an approvals file.

### 15. `AppStart` readiness

**Evidence**: no direct observation of the original wait.
**Current**: waits up to 5 s for the first AX window, then returns anyway.
**Settle it**: time the original `startApp` for slow apps.

### 16. Window-scoped bindings

**Evidence**: absent from the mac client and from `cua-repl`; only the Linux
types expose `list_windows`/`get_window`.
**Current**: `getApp({windowId})` rejected explicitly.
**Settle it**: a newer mac client that exposes windows.

### 17. Playwright version drift

**Status: resolved.** `playwright-core@1.57.0` is an optional dependency and the
loader fails closed on a different version (`CODEX_CU_ALLOW_PLAYWRIGHT_DRIFT=1`
overrides). The macOS bundle fallback is checked the same way.

### 18. Live verification prerequisites

**Evidence**: Accessibility and Screen Recording are machine-level grants; the
system Chrome is an `aha-runtime` stub.
**Current**: live checks use a real Chrome for Testing on a separate port and
require TCC grants for the service.
**Settle it**: run `docs/LIVE-VERIFICATION.md` on a desktop session.
