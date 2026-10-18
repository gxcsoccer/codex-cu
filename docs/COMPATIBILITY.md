# Compatibility matrix

Goal: be wire- and behavior-compatible with the original Codex Computer Use for
the operations below. "1:1" here means: same framing, same envelopes, same action
encoding, same error codes, and the same observable semantics; it does not mean
binary-identical internals.

| Capability | Original | This repo | Evidence / test |
|---|---|---|---|
| Length-prefixed JSON framing | yes | yes | `client/test/framing.test.mjs`, `service/Tests/.../FramingTests.swift` |
| ping/version handshake | yes | yes | `client/test/client.test.mjs` |
| request envelope (`clientApiVersion`, deadline, type) | yes | yes | `client/test/envelope.test.mjs` |
| `ListApps` | yes | yes | `client/test/integration.test.mjs` (real socket + NSWorkspace) |
| `AppStart` (launch/activate) | yes | planned | — |
| `AppGetSkyshot` (AX text + screenshot) | yes | partial (AX text; screenshot gated) | needs Accessibility/Screen Recording |
| `PerformAction` (click/drag/type/...) | yes | planned | action encoding tested client-side |
| App policy / approvals | yes | planned | — |
| Error codes -10000…-10020 | yes | yes | `client/src/errors.mjs`, tests |
| Diffing of AX trees | yes | planned | — |
| Audio recording | yes | out of scope (round 1) | — |

## Inferred response fields

| Field | Source of inference | Pinned by |
|---|---|---|
| `result.apps[].bundleIdentifier` | client `listApps` consumer | client integration test |
| `result.text` | client `getAppState` return | pending live AX test |
| `result.skyshot.screenshot.url` | `screenshot_bytes` reads it | pending |
| `result.app` | client logs | pending |

## Permission requirements (same as original)

| Feature | Permission | Behavior without it |
|---|---|---|
| AX tree / actions | Accessibility (TCC) | `-10009 permissionsNotGranted` |
| Screenshot (skyshot) | Screen Recording (TCC) | `-10008 accessibilityError` / no skyshot |
| Input synthesis | Accessibility | `-10009` |

Tests that need these permissions are skipped with an explicit message; the
protocol and client tests run everywhere.

## Fixture provenance

`fixtures/frames/*.json` are **derived from the original client's serializer**
(reconstructed from the shipped `client.js`), not captured from a live service.
The original service ignores peers without its app-group entitlement, so a live
capture is not possible from an unentitled process. The fixtures pin our client's
output; the protocol document pins the semantics.

## Known gaps

- Response schemas for `AppGetSkyshot` / `PerformAction` are inferred.
- The original enforces a peer entitlement (`senderProcessNotAuthenticated`);
  this implementation authenticates by socket ownership instead (documented in
  `service/Sources/CodexCU/Server.swift`).
- Audio recording (`Start/StopAudioRecording`) is not implemented.
