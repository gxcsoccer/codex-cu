// CDP-backed browser provider. Mirrors the model-facing browser surface
// (`listBrowsers`, `getTab`, `createBrowserTab`, `listTabs`, Tab actions) using
// Chrome's DevTools Protocol instead of the original's Playwright/WASM stack.
import { CdpConnection } from './cdp.mjs';

const NAMED_KEYS = {
  enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
  up: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  end: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
};

const MODIFIERS = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

export function parseKeyChord(spec) {
  const tokens = String(spec).split('+').map((token) => token.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) throw new Error('key is required');
  const keyName = tokens.at(-1);
  let modifiers = 0;
  for (const token of tokens.slice(0, -1)) {
    if (!(token in MODIFIERS)) throw new Error(`unknown modifier: ${token}`);
    modifiers |= MODIFIERS[token];
  }
  if (NAMED_KEYS[keyName]) return { ...NAMED_KEYS[keyName], modifiers };
  if (/^[a-z]$/.test(keyName)) {
    return { key: keyName, code: `Key${keyName.toUpperCase()}`, windowsVirtualKeyCode: keyName.toUpperCase().charCodeAt(0), modifiers };
  }
  if (/^[0-9]$/.test(keyName)) {
    return { key: keyName, code: `Digit${keyName}`, windowsVirtualKeyCode: keyName.charCodeAt(0), modifiers };
  }
  if (/^f([1-9]|1[0-2])$/.test(keyName)) {
    return { key: keyName.toUpperCase(), code: keyName.toUpperCase(), windowsVirtualKeyCode: 111 + Number(keyName.slice(1)), modifiers };
  }
  throw new Error(`unsupported browser key: ${spec}`);
}

export class BrowserTab {
  constructor({ connection, targetId, sessionId, info = {} }) {
    this.connection = connection;
    this.id = targetId;
    this.sessionId = sessionId;
    this.info = info;
    this.status = null; // 'deliverable' | 'handoff'
    this.takeoverRequested = false;
    this.axIndex = new Map(); // AX nodeId -> backendDOMNodeId
  }

  async goto(url) {
    await this.connection.send('Page.navigate', { url }, this.sessionId);
  }

  async back() { await this.connection.send('Page.navigateToHistoryEntry', { entryId: await this.historyEntry(-1) }, this.sessionId); }
  async forward() { await this.connection.send('Page.navigateToHistoryEntry', { entryId: await this.historyEntry(1) }, this.sessionId); }
  async reload() { await this.connection.send('Page.reload', {}, this.sessionId); }
  async close() { await this.connection.send('Target.closeTarget', { targetId: this.id }); }
  async markDeliverable() { this.status = 'deliverable'; }
  async markHandoff() { this.status = 'handoff'; }
  async requestUserTakeover() { this.takeoverRequested = true; }

  async historyEntry(delta) {
    const { currentIndex, entries } = await this.connection.send('Page.getNavigationHistory', {}, this.sessionId);
    const entry = entries[currentIndex + delta];
    if (!entry) throw new Error('no history entry in that direction');
    return entry.id;
  }

  async getAXState() {
    await this.connection.send('Accessibility.enable', {}, this.sessionId);
    const { nodes } = await this.connection.send('Accessibility.getFullAXTree', {}, this.sessionId);
    this.axIndex = new Map(
      nodes
        .filter((node) => node.backendDOMNodeId !== undefined)
        .map((node) => [String(node.nodeId), node.backendDOMNodeId]),
    );
    return formatAXTree(nodes);
  }

  backendFor(index) {
    const backend = this.axIndex.get(String(index));
    if (backend === undefined) {
      throw new Error(`unknown element index ${index}; call getAXState() first`);
    }
    return backend;
  }

  async centerOf(index) {
    await this.connection.send('DOM.enable', {}, this.sessionId);
    const { model } = await this.connection.send('DOM.getBoxModel', { backendNodeId: this.backendFor(index) }, this.sessionId);
    const quad = model.content;
    return [(quad[0] + quad[2] + quad[4] + quad[6]) / 4, (quad[1] + quad[3] + quad[5] + quad[7]) / 4];
  }

  async focus(index) {
    await this.connection.send('DOM.enable', {}, this.sessionId);
    await this.connection.send('DOM.focus', { backendNodeId: this.backendFor(index) }, this.sessionId);
  }

  async resolveObject(index) {
    await this.connection.send('DOM.enable', {}, this.sessionId);
    const { object } = await this.connection.send('DOM.resolveNode', { backendNodeId: this.backendFor(index) }, this.sessionId);
    return object.objectId;
  }

  async callOn(index, functionDeclaration, args = []) {
    const objectId = await this.resolveObject(index);
    const { result, exceptionDetails } = await this.connection.send('Runtime.callFunctionOn', {
      objectId, functionDeclaration, arguments: args.map((value) => ({ value })), returnByValue: true,
    }, this.sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'Runtime.callFunctionOn failed');
    return result?.value;
  }

  async getScreenshot() {
    return this.screenshot();
  }

  async screenshot({ fullPage = false, clip } = {}) {
    const params = { format: 'png' };
    if (fullPage) params.captureBeyondViewport = true;
    if (clip) {
      if (![clip.x, clip.y, clip.width, clip.height].every((value) => Number.isFinite(value))) {
        throw new TypeError('screenshot clip requires finite x, y, width, height');
      }
      params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
    }
    const { data } = await this.connection.send('Page.captureScreenshot', params, this.sessionId);
    return new Uint8Array(Buffer.from(data, 'base64'));
  }

  async title() {
    const { result } = await this.connection.send('Runtime.evaluate', {
      expression: 'document.title', returnByValue: true,
    }, this.sessionId);
    return result?.value ?? '';
  }

  async url() {
    const { result } = await this.connection.send('Runtime.evaluate', {
      expression: 'location.href', returnByValue: true,
    }, this.sessionId);
    return result?.value ?? '';
  }

  async performSecondaryAction() {
    throw new Error('performSecondaryAction is not supported for browser tabs (no CDP equivalent)');
  }

  async getAXStateAndScreenshot() {
    return { state: await this.getAXState(), screenshot: await this.getScreenshot() };
  }

  async click(target, { mouseButton = 'left', clickCount = 1 } = {}) {
    const [x, y] = Array.isArray(target) ? target : await this.centerOf(target);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.connection.send('Input.dispatchMouseEvent', {
        type, x, y, button: mouseButton, clickCount,
      }, this.sessionId);
    }
  }

  async scroll(target, direction, distance = 1) {
    const [x, y] = Array.isArray(target) ? target : await this.centerOf(target);
    const delta = Math.max(1, Number(distance)) * 120;
    await this.connection.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y,
      deltaX: direction === 'left' ? -delta : direction === 'right' ? delta : 0,
      deltaY: direction === 'up' ? -delta : delta,
    }, this.sessionId);
  }

  async typeText(index, text) {
    if (typeof index !== 'number') { text = index; index = null; }
    if (index !== null) await this.focus(index);
    await this.connection.send('Input.insertText', { text }, this.sessionId);
  }

  async paste(index, text) {
    return this.typeText(index, text);
  }

  async setValue(index, value) {
    const changed = await this.callOn(index, 'function(value){ this.value = value; this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true })); return true; }', [value]);
    if (!changed) throw new Error(`could not set value on element ${index}`);
  }

  async selectText(index, text, { selectionType = 'text', prefix, suffix } = {}) {
    const ok = await this.callOn(index, 'function(text, type, prefix, suffix){ const value = String(this.value ?? this.textContent ?? ""); let from = 0; for (;;) { const start = value.indexOf(text, from); if (start < 0) return false; const end = start + text.length; const before = start - (prefix ? prefix.length : 0); const after = end + (suffix ? suffix.length : 0); const prefixOK = !prefix || (before >= 0 && value.slice(before, start) === prefix); const suffixOK = !suffix || (after <= value.length && value.slice(end, after) === suffix); if (prefixOK && suffixOK) { const cursor = type === "cursor_before" ? start : end; this.focus(); this.setSelectionRange(type === "text" ? start : cursor, type === "text" ? end : cursor); return true; } from = start + Math.max(1, text.length); } }', [text, selectionType, prefix ?? null, suffix ?? null]);
    if (!ok) throw new Error(`text not found in element ${index}${prefix ? ` after prefix` : ''}${suffix ? ` before suffix` : ''}`);
  }

  async drag(from, to) {
    await this.connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', clickCount: 1 }, this.sessionId);
    await this.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to[0], y: to[1], button: 'left' }, this.sessionId);
    await this.connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button: 'left' }, this.sessionId);
  }

  async pressKey(index, key) {
    if (typeof index !== 'number') { key = index; index = null; }
    if (index !== null) await this.focus(index);
    const spec = parseKeyChord(key);
    for (const type of ['keyDown', 'keyUp']) {
      await this.connection.send('Input.dispatchKeyEvent', { type, ...spec }, this.sessionId);
    }
  }
}

export class CdpBrowser {
  constructor({ connection, id, name, info = {} }) {
    this.connection = connection;
    this.browserId = id;
    this.name = name;
    this.info = info;
  }

  async documentation() {
    return 'CDP browser provider: goto/back/forward/reload/close, getAXState, getScreenshot, click([x,y]), scroll([x,y]), typeText, pressKey.';
  }

  async listTabs() {
    const { targetInfos } = await this.connection.send('Target.getTargets');
    return targetInfos
      .filter((target) => target.type === 'page')
      .map((target) => ({ id: target.targetId, browserId: this.browserId, title: target.title, url: target.url }));
  }

  async attach(targetId) {
    const { sessionId } = await this.connection.send('Target.attachToTarget', { targetId, flatten: true });
    return new BrowserTab({ connection: this.connection, targetId, sessionId });
  }

  async getTab(reference) {
    const tabs = await this.listTabs();
    const tab = typeof reference === 'string'
      ? tabs.find((candidate) => candidate.id === reference || candidate.url === reference)
      : tabs.find((candidate) => reference.url && candidate.url?.includes(reference.url));
    if (!tab) throw new Error(`browser tab not found: ${JSON.stringify(reference)}`);
    return this.attach(tab.id);
  }

  async createTab(url, { visible = true } = {}) {
    const { targetId } = await this.connection.send('Target.createTarget', { url: url ?? 'about:blank', background: !visible });
    return this.attach(targetId);
  }
}

export class CdpBrowserProvider {
  constructor({ endpoint = 'http://127.0.0.1:9222', fetchImpl = globalThis.fetch, connect = CdpConnection.connect } = {}) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.connect = connect;
    this.connections = new Map();
  }

  async list() {
    const version = await this.getJson('/json/version');
    return [{
      id: 'cdp',
      name: version.Browser ?? 'Chrome',
      type: 'cdp',
      metadata: { endpoint: this.endpoint },
    }];
  }

  async getBrowser(options = {}) {
    const browsers = await this.list();
    const info = browsers.find((browser) => !options.id || browser.id === options.id);
    if (!info) throw new Error(`browser not found: ${options.id}`);
    const connection = await this.connection();
    return new CdpBrowser({ connection, id: info.id, name: info.name, info });
  }

  async connection() {
    if (this.connections.has('cdp')) return this.connections.get('cdp');
    const version = await this.getJson('/json/version');
    if (!version.webSocketDebuggerUrl) {
      throw new Error(`endpoint is not a browser CDP (no webSocketDebuggerUrl; Browser=${version.Browser ?? 'unknown'})`);
    }
    const connection = await this.connect(version.webSocketDebuggerUrl);
    this.connections.set('cdp', connection);
    return connection;
  }

  async getJson(path) {
    const response = await this.fetch(`${this.endpoint}${path}`);
    if (!response.ok) throw new Error(`CDP HTTP ${response.status}: ${path}`);
    return response.json();
  }

  close() {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
  }
}

export function formatAXTree(nodes) {
  const lines = [];
  for (const node of nodes) {
    if (node.ignored) continue;
    const role = node.role?.value ?? 'unknown';
    const name = node.name?.value ?? '';
    const id = node.nodeId;
    lines.push(`\t${id} ${role}${name ? ` ${name}` : ''}`);
  }
  return lines.join('\n');
}
