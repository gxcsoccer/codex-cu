# Codex Computer Use IPC — protocol specification

Status: derived from the shipped client and service binaries plus recorded frames.
Fields marked **[observed]** were seen on the wire or in the client's serialization
code; fields marked **[inferred]** are required by the client but not yet observed
on a response.

## Transport

- Unix domain stream socket.
- Default path (original service):
  `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`
  [observed]
- This implementation takes `--socket <path>` so tests can use a temp directory.

## Framing

```
+--------------------+----------------------------+
| uint32 little-endian | UTF-8 JSON (that many bytes) |
+--------------------+----------------------------+
```

- Maximum frame size: 8 MiB (original client constant) [observed]. Frames larger
  than the limit are a protocol error; the connection is closed. The same applies
  to malformed JSON bodies.
- One JSON document per frame. No newline terminator.

## JSON-RPC subset

The original client and service use JSON-RPC 2.0 with two methods:

### `ping`

```json
{"jsonrpc":"2.0","id":1,"method":"ping","params":{"clientApiVersion":"CodexComputerUseIPC-5"}}
```

Response:

```json
{"jsonrpc":"2.0","id":1,"result":{"serverApiVersion":"CodexComputerUseIPC-5"}}
```

The client rejects a mismatch between `serverApiVersion` and its own version
[observed]. `CodexComputerUseIPC-5` is the current version.

### `request`

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "request",
  "params": {
    "clientApiVersion": "CodexComputerUseIPC-5",
    "codexTurnMetadata": { "...": "opaque" },
    "deadlineUnixMilliseconds": 1760000000000,
    "requestType": "ComputerUseIPCAppPerformActionRequest",
    "request": { "...": "type-specific" }
  }
}
```

- `codexTurnMetadata` is optional; when present it is forwarded to the service
  (the original client fills it from `nodeRepl.requestMeta["x-codex-turn-metadata"]`).
- `deadlineUnixMilliseconds` is `Date.now() + timeoutSeconds * 1000`.
- `requestType` selects the payload schema.
- An expired deadline is rejected by this implementation with
  `-10001 couldNotGetRequestData` / `"deadline exceeded"`. Whether the original
  enforces it server-side is **[inferred]**; the field is always sent by the
  client, so ignoring it would diverge on slow requests.

### Response validation

The original client rejects a response unless:

- `id` is a number,
- `jsonrpc` is `"2.0"`,
- exactly one of `result` / `error` is present,
- `error` has a numeric `code` and string `message`.

## Request types

| `requestType` | `request` fields |
|---|---|
| `ComputerUseIPCListAppsRequest` | `{}` |
| `ComputerUseIPCAppStartRequest` | `{app}` |
| `ComputerUseIPCAppGetSkyshotRequest` | `{app, disableDiff?}` |
| `ComputerUseIPCAppPolicyRequest` | `{app}` |
| `ComputerUseIPCAppPerformActionRequest` | `{app, action}` |
| `ComputerUseIPCStartAudioRecordingRequest` | `{}` (this repo returns `-10004`, not implemented) |
| `ComputerUseIPCStopAudioRecordingRequest` | `{}` (same) |

`app` is a bundle identifier or application name string.

## Action payloads

All actions are single-key objects; the inner value shape identifies the action.

```jsonc
{"click": {"at": {"elementID": {"_0": "42"}}, "clickCount": 1, "mouseButton": 0}}
{"click": {"at": {"coordinate": {"_0": [640, 480]}}, "clickCount": 1, "mouseButton": 1}}
{"drag": {"from": {"_0": [1, 2]}, "to": {"_0": [3, 4]}}}
{"paste": {"text": "hello", "format": "md"}}
{"pressKey": {"_0": "cmd+shift+g", "duration": 0.05}}
{"scroll": {"at": {"elementID": {"_0": "42"}}, "direction": "down", "pages": 1}}
{"selectText": {"elementID": "42", "text": "x", "prefix": "a", "suffix": "b", "selection": "text"}}
{"setValue": {"elementID": "42", "value": "hello"}}
{"type": {"_0": "hello"}}
{"performSecondaryAction": {"elementID": "42", "action": "Expand"}}
```

Notes [observed in the client's serializer]:

- element IDs are strings, not numbers (`String(elementIndex)`);
- `mouseButton` is `0=left, 1=right, 2=middle`;
- `direction` is one of `up`, `down`, `left`, `right`;
- the `_0` key wraps single-value variants (tuple/oneof encoding).

## Responses (inferred)

The client reads these fields; the exact JSON names below are consistent with the
client and the bundled API docs, but not all were observed on a live response.

| Request | Response fields |
|---|---|
| `ListApps` | `apps: [{bundleIdentifier, name, pid?}]` |
| `AppStart` | `{app, pid?}` |
| `AppGetSkyshot` | `{app, text, skyshot: {screenshot: {url, mimeType?}}, axTree?, appSpecificInstructions?}` |
| `PerformAction` | `{}` (success) or `error` |
| `AppPolicy` | `{allowed}` |

`skyshot.screenshot.url` is a `file://` URL to a temporary PNG; the original
client reads it with `fileURLToPath` + `readFile`, and cleans it up via the
service's `TemporaryFile` deinit [observed in symbols].

## Error codes

| Code | Name |
|---:|---|
| -10000 | senderProcessNotAuthenticated |
| -10001 | couldNotGetRequestData |
| -10002 | couldNotGetRequestTypeName |
| -10003 | couldNotResolveRequestType |
| -10004 | unhandledEvent |
| -10005 | unknownError |
| -10006 | appNotAllowed |
| -10007 | runningApplicationNotFound |
| -10008 | accessibilityError |
| -10009 | permissionsNotGranted |
| -10010 | invalidApp |
| -10011 | noActiveSession |
| -10012 | userStoppedSession |
| -10013 | incompatibleClientVersion |
| -10014 | permissionsPending |
| -10015 | blockedURL |
| -10016 | userIntervened |
| -10017 | couldNotGetSenderPID |
| -10018 | ambiguousApp |
| -10019 | couldNotGetBootstrapPort |
| -10020 | screenLocked |
