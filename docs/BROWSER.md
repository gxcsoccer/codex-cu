# Browser surface

The original exposes a browser provider to the model (`listBrowsers`,
`createBrowserTab`, `getTab`, `listTabs`) backed by Playwright plus a WASM
accessibility layer and a Chrome extension. This repo implements the same
surface over **Chrome DevTools Protocol (CDP)**, which is the closest transport
that is available without shipping a browser extension.

## Enabling

Start a Chrome with a debugging port (a separate profile avoids touching your
main session):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/codex-cu-chrome \
  --no-first-run --no-default-browser-check
```

Then construct `Cua` with a provider:

```js
const cua = new Cua({
  socketPath: '/tmp/codex-cu.sock',
  browserProvider: new CdpBrowserProvider({ endpoint: 'http://127.0.0.1:9222' }),
});
```

## Implemented

| Surface | Status |
|---|---|
| `listBrowsers()` | one `cdp` browser built from `/json/version` |
| `getBrowser({id})` | connects the WebSocket, returns `documentation()` |
| `listTabs()` | `Target.getTargets`, pages only |
| `getTab(id \| {url})` | by target id or url substring, attaches flattened session |
| `createBrowserTab(browserId, url, {visible})` | `Target.createTarget` + attach |
| `goto/back/forward/reload/close` | `Page.*` |
| `getAXState()` | `Accessibility.getFullAXTree`, ignored nodes skipped |
| `getScreenshot()` | `Page.captureScreenshot` (PNG bytes) |
| `click(index)` / `click([x,y])` | AX `backendDOMNodeId` → `DOM.getBoxModel` center, then mouse events |
| `scroll(index \| [x,y], dir, n)` | element center or coordinate + `mouseWheel` |
| `typeText(index?, text)` | optional `DOM.focus` then `Input.insertText` |
| `setValue(index, value)` | `Runtime.callFunctionOn` sets value + input/change events |
| `selectText(index, text, {selectionType})` | `Runtime.callFunctionOn` + `setSelectionRange` |
| `pressKey(index?, key)` | optional focus then key events |
| `drag(from, to)` | mousePressed/moved/released |
| `typeText(text)` | `Input.insertText` (layout independent) |
| `pressKey(key)` | `Input.dispatchKeyEvent` for Enter/Tab/Escape/Backspace/arrows/single chars |
| `markDeliverable()` | local flag |

## Environment note

The Chrome installed on the development machine is a 367 KB stub that starts a
custom `aha-runtime`; its `/json/version` reports `Browser: aha-runtime` and no
`webSocketDebuggerUrl`, so it cannot serve as a CDP browser. Live browser
verification therefore has not been run here; the provider is covered by unit
tests with a fake CDP connection, and the WebSocket transport has its own tests
(`client/test/cdp.test.mjs`).

## Gaps vs the original

- **Element indices come from the latest `getAXState()`**; stale indices raise an
  explicit error instead of clicking the wrong node.
- `performSecondaryAction` is not implemented for tabs (CDP has no direct
  equivalent of an accessibility secondary action).
- `paste` is implemented as focus + `Input.insertText`; it does not write the
  system clipboard.
- The original can also drive `iab` (in-app browser), extension-backed tabs and
  MCP apps; this provider only speaks CDP.
- The browser documentation string is synthesized, not the original's
  per-browser docs.
