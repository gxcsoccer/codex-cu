# Project overview

A one-page map of this repository: what it is, which document answers which
question, how it is verified, and which problems were found along the way.

## What this is

A clean-room, protocol- and behaviour-compatible reimplementation of **Codex
Computer Use**: a Swift service that observes and drives macOS apps, a Node
client that exposes the `cua` API, a Playwright/CDP browser backend, and audio
recording. "1:1" means wire/shape/behaviour compatibility with the shipped
artifacts we could observe; literal source equality is not possible.

## Documentation map

| Document | Answers |
|---|---|
| [REPORT.md](REPORT.md) | What the original is, how it was reconstructed, fidelity assessment |
| [PROTOCOL.md](PROTOCOL.md) | Socket framing, JSON-RPC, request types, error codes, action payloads |
| [CONFORMANCE.md](CONFORMANCE.md) | Per-feature implementation and test evidence |
| [SCOPE.md](SCOPE.md) | Replicated / deliberate deviations / blocked / not attempted |
| [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) | Unresolved questions with evidence and how to settle them |
| [BROWSER.md](BROWSER.md) | CDP and Playwright backends, AX text, frames, locators, paste |
| [AUDIO.md](AUDIO.md) | Loopback recording protocol, SCK backend, WAV details |
| [INSTALL.md](INSTALL.md) | Install, LaunchAgent, approvals, instructions |
| [LIVE-VERIFICATION.md](LIVE-VERIFICATION.md) | TCC steps and the six live checks |
| [PARITY.md](PARITY.md) | Scenario harness comparing against a recorded reference |
| [REVERSE-ENGINEERING.md](REVERSE-ENGINEERING.md) | How the artifacts were inspected |
| [COMPATIBILITY.md](COMPATIBILITY.md) | Short compatibility matrix and deviations |
| [ROADMAP.md](ROADMAP.md) | Historical plan and future work |

## What is implemented

- **Native service**: framing, JSON-RPC, seven request types, stable AX element
  IDs, focused-window-rooted trees, localized roles, diffs, nine actions,
  screenshots, approvals (`persistentApprovals` / `allowAllChats`), screen-lock
  guard, app-instruction texts, refetch-by-criteria, audio session lifecycle.
- **Client**: `cua` surface (native + browser + audio), instruction wrapping and
  dedupe, protocol errors, fuzzing-safe frame decoder.
- **Browser**: CDP backend and Playwright backend (real 1.57 engine), AX text in
  the native layout, per-frame merge including nested OOPIFs, locators, DOM
  snapshot/element info, clipboard paste, key chords.
- **Audio**: ScreenCaptureKit loopback, 24 kHz stereo WAV, auto-stop, late-stop
  returns the finished file.
- **Packaging**: LaunchAgent with `CODEX_CU_ARGS`, install script, plists.

## Verification snapshot

```
Swift tests:            73
Node tests:             83 (5 live tests skipped by default)
Integration (socket):    7
Live check (this Mac):  ping, listApps, getAppState, screenshot (247 KB),
                        audio (24 kHz stereo WAV), browser (Chrome 149)
CI:                     GitHub Actions macos-15, green
```

Commands: `scripts/verify.sh`, `npm test`, `node scripts/live-check.mjs`.

## Problems found and fixed

Real bugs uncovered by live verification and fuzzing:

| Problem | Fix |
|---|---|
| `FileHandle.read(upToCount:)` hung on sockets | raw `Darwin.read` in `FrameReader` |
| `SCContentFilter(desktopIndependentWindow:)` aborted with `CGS_REQUIRE_INIT` | initialize `NSApplication` at startup |
| Audio auto-stop desynchronised from the handler; a later stop failed | handler owns the timer, retains the finished URL |
| Sequential AX ids shifted on every walk, breaking diffs | stable `AXIDRegistry` |
| `getAppState({app, disableDiff})` ignored the object form | read options from either argument |
| Page-session attach returned the parent frame for OOPIF | attach at browser level / per-frame Playwright sessions |
| CI ran an explicit file list and silently skipped new tests | run `npm test` |
| Refetch tests asserted before the snapshot was invalidated | invalidate with a first action, then refetch |

## Where to start

1. `docs/SCOPE.md` for what is and is not replicated.
2. `docs/LIVE-VERIFICATION.md` to verify on a TCC-enabled machine.
3. `docs/OPEN-QUESTIONS.md` if you want to continue the reverse engineering.
