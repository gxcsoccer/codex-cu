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
| `getScreenshot()` / `screenshot({fullPage, clip})` | `Page.captureScreenshot`, optional `captureBeyondViewport` / `clip` |
| `title()` / `url()` | `Runtime.evaluate` on `document.title` / `location.href` |
| `domSnapshot()` | `document.documentElement.outerHTML` |
| `elementInfo(x, y)` | `elementFromPoint` → tag/role/aria/testid/text/box |
| `click(index)` / `click([x,y])` | AX `backendDOMNodeId` → `DOM.getBoxModel` center, then mouse events |
| `scroll(index \| [x,y], dir, n)` | element center or coordinate + `mouseWheel` |
| `typeText(index?, text)` | optional `DOM.focus` then `Input.insertText` |
| `setValue(index, value)` | `Runtime.callFunctionOn` sets value + input/change events |
| `selectText(index, text, {selectionType, prefix, suffix})` | page-side search with prefix/suffix, then `setSelectionRange` |
| `selectText(index, text, {selectionType})` | `Runtime.callFunctionOn` + `setSelectionRange` |
| `pressKey(index?, key)` | optional focus then key events |
| `drag(from, to)` | mousePressed/moved/released |
| `typeText(text)` | `Input.insertText` (layout independent) |
| `pressKey(index?, key)` | `Input.dispatchKeyEvent`; supports chords (`cmd+shift+a`), named keys, arrows and F1–F12, with the CDP modifier bitmask |
| `markDeliverable()` / `markHandoff()` | local `status` flag (`deliverable` / `handoff`) |
| `requestUserTakeover()` | local `takeoverRequested` flag |

## Environment note

The Chrome installed on the development machine is a 367 KB stub that starts a
custom `aha-runtime`; its `/json/version` reports `Browser: aha-runtime` and no
`webSocketDebuggerUrl`, so it cannot serve as a CDP browser. Live browser
verification therefore has not been run here; the provider is covered by unit
tests with a fake CDP connection, and `client/test/cdp-live.test.mjs` runs the
whole browser surface against a real WebSocket CDP server implementation
(handshake, framed JSON-RPC, sessions).

## Accessibility text

`getAXState()` emits the same layout as the native service (the browser WASM
contains the same format strings): indented tree lines with role, name, states,
`Description:`/`URL:`/`Value:`, and on subsequent observations a diff with the
browser-specific header, `Removed element IDs:` ranges, `~\t`/`+\t` lines and the
`Selected:` block plus note.

Differences from native:

- the diff header has no `for Window: "..."` part (there is no window);
- display roles are CDP role names (`button`, `textbox`, `StaticText`) rather
  than localized macOS role descriptions;
- `ID:` is the DOM `id` attribute, resolved with one `DOM.getDocument` call;
  `Secondary Actions:` are not available from CDP and are omitted;
- element IDs are the stable DOM backend node id (`backendDOMNodeId`) so diffs can
  report real removals across observations; `InlineTextBox` layout nodes are
  filtered out.

## Frames

`getAXState()` reads the **main frame** only. The original merges per-frame trees
and its own docs warn that frame ownership is omitted; use the Playwright
backend's `tab.playwright.frameLocator(...)` for iframe content and interaction.

## Playwright backend (closest to the original)

The original stack is Playwright + WASM AX. `PlaywrightBrowserProvider` uses the
real Playwright engine (the app bundles 1.57) over CDP, so locators, auto-waiting
and actionability are Playwright's own:

```js
import { Cua } from './client/src/cua.mjs';
import { PlaywrightBrowserProvider } from './client/src/browser-playwright.mjs';

const cua = new Cua({
  socketPath: '/tmp/codex-cu.sock',
  browserProvider: new PlaywrightBrowserProvider({ endpoint: 'http://127.0.0.1:9555' }),
});
const browser = await cua.getBrowser();
const tab = await browser.createTab('https://example.com');
await tab.playwright.getByRole('button', { name: 'Sign in' }).click();
await tab.playwright.getByLabel('Email').fill('a@b.c');
```

- `playwright-core` is imported dynamically; if it is not installed, the macOS
  ChatGPT bundle copy is used as a fallback. For a standalone install run
  `npm install playwright-core`.
- Accessibility text and element-index input still use the CDP session, so
  `getAXState()`/`click(index)` keep the same shapes as the CDP backend.
- `provider.close()` disconnects without terminating Chrome (verified live).
- `PLAYWRIGHT_CDP_ENDPOINT` enables the live test; CI skips it.

## Playwright-style locators (CDP backend)

`tab.playwright.locator(selector)` supports a deterministic CSS subset:

```js
const button = tab.playwright.locator('#submit');
await button.click();
await tab.playwright.locator('input[name=q]').fill('codex');
await button.textContent();
await button.isVisible();
await button.getAttribute('data-testid');
await button.count();
```

Each method runs inside `Runtime.evaluate` (focus/value/events), with
`Input.insertText` for typing and the chord parser for `press`.

Limitations: **CSS selectors only**. Playwright-specific syntax (`>>`,
`internal:*`, `getByRole`/`getByText`) is not parsed, and there is no auto-waiting
or actionability check — `click()` fires `el.click()` immediately.

## Gaps vs the original

- **Element indices come from the latest `getAXState()`**; stale indices raise an
  explicit error instead of clicking the wrong node.
- `performSecondaryAction` is not implemented for tabs (CDP has no direct
  equivalent of an accessibility secondary action) and throws explicitly.
- On the **Playwright backend**, `paste` writes the page clipboard
  (`navigator.clipboard.writeText` with clipboard permissions) and sends the
  platform paste shortcut; verified live against a local HTTP origin. On the CDP
  backend it falls back to focus + `Input.insertText`. Rich-text formats are not
  preserved.
- `markDeliverable`/`markHandoff`/`requestUserTakeover` do not reach a host in the
  CDP backend: there is no tab-status channel. They set local state so callers and
  tests can observe intent; a host integration would need an event sink.
- Clipboard-backed paste was evaluated: it needs `Browser.grantPermissions`
  plus a trusted user gesture for the page to accept `navigator.clipboard`
  writes; synthetic `Cmd+V` is not reliable. `insertText` is the deterministic
  subset, and the limitation is documented rather than faked.
- The original can also drive `iab` (in-app browser), extension-backed tabs and
  MCP apps; this provider only speaks CDP.
- The browser documentation string is synthesized, not the original's
  per-browser docs.
