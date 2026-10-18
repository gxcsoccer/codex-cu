// CDP-backed browser provider. Mirrors the model-facing browser surface
// (`listBrowsers`, `getTab`, `createBrowserTab`, `listTabs`, Tab actions) using
// Chrome's DevTools Protocol instead of the original's Playwright/WASM stack.
import { CdpConnection } from './cdp.mjs';

const KEY_CODES = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
};

export class BrowserTab {
  constructor({ connection, targetId, sessionId, info = {} }) {
    this.connection = connection;
    this.id = targetId;
    this.sessionId = sessionId;
    this.info = info;
    this.deliverable = false;
  }

  async goto(url) {
    await this.connection.send('Page.navigate', { url }, this.sessionId);
  }

  async back() { await this.connection.send('Page.navigateToHistoryEntry', { entryId: await this.historyEntry(-1) }, this.sessionId); }
  async forward() { await this.connection.send('Page.navigateToHistoryEntry', { entryId: await this.historyEntry(1) }, this.sessionId); }
  async reload() { await this.connection.send('Page.reload', {}, this.sessionId); }
  async close() { await this.connection.send('Target.closeTarget', { targetId: this.id }); }
  markDeliverable() { this.deliverable = true; }

  async historyEntry(delta) {
    const { currentIndex, entries } = await this.connection.send('Page.getNavigationHistory', {}, this.sessionId);
    const entry = entries[currentIndex + delta];
    if (!entry) throw new Error('no history entry in that direction');
    return entry.id;
  }

  async getAXState() {
    await this.connection.send('Accessibility.enable', {}, this.sessionId);
    const { nodes } = await this.connection.send('Accessibility.getFullAXTree', {}, this.sessionId);
    return formatAXTree(nodes);
  }

  async getScreenshot() {
    const { data } = await this.connection.send('Page.captureScreenshot', { format: 'png' }, this.sessionId);
    return new Uint8Array(Buffer.from(data, 'base64'));
  }

  async getAXStateAndScreenshot() {
    return { state: await this.getAXState(), screenshot: await this.getScreenshot() };
  }

  async click(target) {
    if (!Array.isArray(target)) throw new Error('element-index clicks are not implemented for browser tabs; pass [x, y]');
    const [x, y] = target;
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.connection.send('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', clickCount: 1,
      }, this.sessionId);
    }
  }

  async scroll(target, direction, distance = 1) {
    if (!Array.isArray(target)) throw new Error('element-index scroll is not implemented for browser tabs; pass [x, y]');
    const delta = Math.max(1, Number(distance)) * 120;
    await this.connection.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: target[0], y: target[1],
      deltaX: direction === 'left' ? -delta : direction === 'right' ? delta : 0,
      deltaY: direction === 'up' ? -delta : delta,
    }, this.sessionId);
  }

  async typeText(text) {
    await this.connection.send('Input.insertText', { text }, this.sessionId);
  }

  async pressKey(key) {
    const spec = KEY_CODES[key] ?? (/^[a-zA-Z0-9]$/.test(key)
      ? { key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }
      : null);
    if (!spec) throw new Error(`unsupported browser key: ${key}`);
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
