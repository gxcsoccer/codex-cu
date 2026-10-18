# Evidence trail

Everything here was obtained from artifacts shipped to this machine and from
black-box experiments. No OpenAI source code was read or copied.

## Artifacts

| Artifact | What it gave us |
|---|---|
| `SkyComputerUseService` (Mach-O, `com.openai.sky.CUAService`) | method names, JSON keys, error codes, screenshot file handling |
| `@oai/sky` client JS (`client.js`, `native-pipe.js`) | exact request envelopes, framing, version handshake, response validation |
| Bundled browser API docs (`api.json`, `accessibility.md`) | public action/observation surface and batching guidance |
| `cua_repl` tool schema (`tools/list`) | model-facing API and constraints |
| Recorded frames (this repo, `fixtures/frames/`) | golden request payloads |

## Key observations

1. **Framing** — 4-byte little-endian length + UTF-8 JSON. The client's
   `native-pipe.js` encodes/decodes exactly that; the 8 MiB limit comes from the
   same file.
2. **Methods** — only `ping` and `request`. `requestType` selects the payload:
   seven `ComputerUseIPC*Request` names recovered from the Swift binary and the
   client's string constants.
3. **Handshake** — `ping` carries `clientApiVersion`; the client refuses a
   mismatch with `serverApiVersion`. Current value: `CodexComputerUseIPC-5`.
4. **Action encoding** — element IDs are serialized as strings; `mouseButton` is
   numeric; single-value variants use `_0`; `at` is a oneof of
   `elementID {_0}` / `coordinate {_0: [x, y]}`.
5. **Error taxonomy** — 20 codes (-10000 … -10020) recovered from
   `errors.js`; `senderProcessNotAuthenticated` explains why unentitled peers get
   no response at all.
6. **Screenshots** — mandatory for the original desktop observation
   (`window_result.js` requires a non-null skyshot). The service writes a PNG to a
   temporary file, returns `file://`, and deletes it when the attachment is
   released (`SlimCore.TemporaryFile.deinit`).
7. **Permissions** — the original requires Screen Recording for desktop
   observation; without it, `SCStream` fails with `-3811`. Application approvals
   are stored in `ComputerUseAppApprovals.json` keyed by bundle identifier.

## What we could not observe

- The exact response JSON for `AppGetSkyshot` and `PerformAction` (the service
  ignores peers without the app-group entitlement, so we could not drive it
  directly).
- Whether `codexTurnMetadata` affects service behavior.
- The audio-recording request/response bodies.

## Consequence for this implementation

Response field names are specified from the client's reads (`skyshot.screenshot.url`,
`text`, `apps`, ...) and pinned by tests in `client/test/`. If a field name turns
out to be wrong, only the compatibility table and the corresponding fixture need
to change.
