// CDP-backed browser provider. Mirrors the model-facing browser surface
// (`listBrowsers`, `getTab`, `createBrowserTab`, `listTabs`, Tab actions) using
// Chrome's DevTools Protocol instead of the original's Playwright/WASM stack.
import { CdpConnection } from './cdp.mjs';
import { buildAXEntries, formatEntries, renderAXDiff, formatAXTree } from './ax-format.mjs';

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

export class Locator {
  constructor(tab, selector) {
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw new TypeError('locator requires a selector');
    }
    this.tab = tab;
    this.selector = selector;
  }

  async evaluate(body) {
    return this.tab.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(this.selector)}); ${body} })()`);
  }

  async count() {
    return this.tab.evaluate(`document.querySelectorAll(${JSON.stringify(this.selector)}).length`);
  }

  async click() {
    const clicked = await this.evaluate('if (!el) return false; el.click(); return true;');
    if (!clicked) throw new Error(`locator.click: no element for ${this.selector}`);
  }

  async fill(value) {
    if (value === undefined || value === null) throw new TypeError('locator.fill requires a value');
    const ok = await this.evaluate(`if (!el) return false; el.focus(); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
    if (!ok) throw new Error(`locator.fill: no element for ${this.selector}`);
  }

  async type(value) {
    const focused = await this.evaluate('if (!el) return false; el.focus(); return true;');
    if (!focused) throw new Error(`locator.type: no element for ${this.selector}`);
    await this.tab.connection.send('Input.insertText', { text: String(value) }, this.tab.sessionId);
  }

  async press(key) {
    const focused = await this.evaluate('if (!el) return false; el.focus(); return true;');
    if (!focused) throw new Error(`locator.press: no element for ${this.selector}`);
    await this.tab.pressKey(key);
  }

  async textContent() {
    return this.evaluate('return el ? el.textContent : null;');
  }

  async isVisible() {
    return this.evaluate('return !!el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);');
  }

  async getAttribute(name) {
    if (typeof name !== 'string' || name === '') throw new TypeError('locator.getAttribute requires a name');
    return this.evaluate(`return el ? el.getAttribute(${JSON.stringify(name)}) : null;`);
  }
}

export class PlaywrightAPI {
  constructor(tab) { this.tab = tab; }

  locator(selector) { return new Locator(this.tab, selector); }

  async evaluate(script, arg) {
    const expression = typeof script === 'function'
      ? `(${script.toString()})(${JSON.stringify(arg ?? null)})`
      : String(script);
    return this.tab.evaluate(expression);
  }
}

export { formatAXTree };

export class BrowserTab {
  constructor({ connection, targetId, sessionId, info = {} }) {
    this.connection = connection;
    this.id = targetId;
    this.sessionId = sessionId;
    this.info = info;
    this.status = null; // 'deliverable' | 'handoff'
    this.takeoverRequested = false;
    this.playwright = new PlaywrightAPI(this);
    this.axIndex = new Map(); // AX nodeId -> backendDOMNodeId
  }

  async goto(url) {
    this.domIds = null;
    await this.connection.send('Page.navigate', { url }, this.sessionId);
  }

  async back() { this.domIds = null; await this.connection.send('Page.navigateToHistoryEntry', { entryId: await this.historyEntry(-1) }, this.sessionId); }
  async forward() { this.domIds = null; await this.connection.send('Page.navigateToHistoryEntry', { entryId: await this.historyEntry(1) }, this.sessionId); }
  async reload() { this.domIds = null; await this.connection.send('Page.reload', {}, this.sessionId); }
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

  async getAXState({ disableDiff = false } = {}) {
    await this.connection.send('Accessibility.enable', {}, this.sessionId);
    const { nodes: pageNodes } = await this.connection.send('Accessibility.getFullAXTree', {}, this.sessionId);
    const nodes = await this.mergeFrameNodes(pageNodes);
    this.axIndex = new Map(
      nodes
        .filter((node) => node.backendDOMNodeId !== undefined)
        .map((node) => [String(node.nodeId), node.backendDOMNodeId]),
    );
    const domIds = await this.domIdMap().catch(() => new Map());
    const entries = buildAXEntries(nodes, { domIds });
    this.axIndex = new Map(
      entries
        .filter((entry) => entry.backendDOMNodeId !== undefined)
        .map((entry) => [String(entry.id), {
          backendNodeId: entry.backendDOMNodeId,
          sessionId: entry.actionSessionId,
          send: entry.actionSend,
          space: entry.coordinateSpace,
        }]),
    );
    if (!disableDiff && this.previousAX) {
      const text = renderAXDiff(this.previousAX, entries);
      this.previousAX = entries;
      return text;
    }
    this.previousAX = entries;
    return formatEntries(entries);
  }

  /**
   * Merges per-frame accessibility trees into the page tree, nesting each frame
   * under its owner element. Stable display ids for frame nodes are offset per
   * frame so they never collide with page ids; the backend id remains the action
   * handle (CDP dispatches frame input through the page session).
   */
  async mergeFrameNodes(pageNodes) {
    let frameTree;
    try {
      ({ frameTree } = await this.connection.send('Page.getFrameTree', {}, this.sessionId));
    } catch {
      return pageNodes;
    }
    const frames = [];
    const collect = (node) => {
      for (const child of node.childFrames ?? []) { frames.push(child); collect(child); }
    };
    if (frameTree?.childFrames) collect(frameTree);

    const merged = pageNodes.map((node) => ({ ...node }));
    const byFrame = new Map(); // frameId -> { prefix, nodes }
    let index = 0;
    for (const child of frames) {
      index += 1;
      const frame = child.frame;
      let frameNodes;
      try {
        ({ nodes: frameNodes } = await this.connection.send('Accessibility.getFullAXTree', { frameId: frame.id }, this.sessionId));
      } catch { continue; }
      if (!frameNodes?.length) continue;
      let ownerBackend;
      try {
        ({ backendNodeId: ownerBackend } = await this.connection.send('DOM.getFrameOwner', { frameId: frame.id }, this.sessionId));
      } catch { continue; }

      const parent = frame.parentId ? byFrame.get(frame.parentId) : null;
      const pool = parent ? parent.nodes : merged;
      const owner = pool.find((node) => node.backendDOMNodeId === ownerBackend);
      if (!owner) continue;
      const ownerId = parent ? `${parent.prefix}${owner.nodeId}` : String(owner.nodeId);
      const prefix = `f${index}:`;
      const base = index * 1_000_000;
      const nodes = frameNodes.map((node, position) => ({
        ...node,
        nodeId: `${prefix}${node.nodeId}`,
        parentId: node.parentId ? `${prefix}${node.parentId}` : ownerId,
        displayId: base + (node.backendDOMNodeId ?? 500_000 + position),
      }));
      merged.push(...nodes);
      byFrame.set(frame.id, { prefix, nodes });
    }

    // Playwright exposes per-frame CDP sessions; the page session cannot attach
    // out-of-process targets, so those are merged from frameProviders instead.
    if (this.frameProviders) {
      let providerIndex = 0;
      for (const provider of this.frameProviders) {
        providerIndex += 1;
        let frameNodes;
        try { ({ nodes: frameNodes } = await provider.send('Accessibility.getFullAXTree')); } catch { continue; }
        if (!frameNodes?.length) continue;
        let ownerBackend;
        try { ({ backendNodeId: ownerBackend } = await this.connection.send('DOM.getFrameOwner', { frameId: provider.frameId }, this.sessionId)); } catch { continue; }
        const owner = merged.find((node) => node.backendDOMNodeId === ownerBackend);
        if (!owner) continue;
        const prefix = `p${providerIndex}:`;
        const base = 200_000_000 * providerIndex;
        merged.push(...frameNodes.map((node, position) => ({
          ...node,
          nodeId: `${prefix}${node.nodeId}`,
          parentId: node.parentId ? `${prefix}${node.parentId}` : String(owner.nodeId),
          displayId: base + (node.backendDOMNodeId ?? 500_000 + position),
          actionSend: provider.send,
          coordinateSpace: 'frame',
        })));
      }
      return merged;
    }

    let targetInfos = [];
    try { ({ targetInfos } = await this.connection.send('Target.getTargets')); } catch { /* no target list */ }
    let oopif = 0;
    for (const target of (targetInfos ?? []).filter((info) => info.type === 'iframe')) {
      oopif += 1;
      let sessionId = this.iframeSessions?.get(target.targetId);
      if (!sessionId) {
        try {
          // Attach at the browser level; page-session attach returns the parent
          // frame instead of the out-of-process child.
          ({ sessionId } = await this.connection.send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
        } catch { continue; }
        if (!this.iframeSessions) this.iframeSessions = new Map();
        this.iframeSessions.set(target.targetId, sessionId);
      }
      let childFrameTree;
      try { ({ frameTree: childFrameTree } = await this.connection.send('Page.getFrameTree', {}, sessionId)); } catch { continue; }
      const frameId = childFrameTree?.frame?.id;
      if (!frameId) continue;
      let frameNodes;
      try {
        await this.connection.send('Accessibility.enable', {}, sessionId);
        ({ nodes: frameNodes } = await this.connection.send('Accessibility.getFullAXTree', {}, sessionId));
      } catch { continue; }
      if (!frameNodes?.length) continue;
      let ownerBackend;
      try { ({ backendNodeId: ownerBackend } = await this.connection.send('DOM.getFrameOwner', { frameId }, this.sessionId)); } catch { continue; }
      const owner = merged.find((node) => node.backendDOMNodeId === ownerBackend);
      if (!owner) continue;
      const prefix = `o${oopif}:`;
      const base = 100_000_000 * oopif;
      merged.push(...frameNodes.map((node, position) => ({
        ...node,
        nodeId: `${prefix}${node.nodeId}`,
        parentId: node.parentId ? `${prefix}${node.parentId}` : String(owner.nodeId),
        displayId: base + (node.backendDOMNodeId ?? 500_000 + position),
        actionSessionId: sessionId,
        coordinateSpace: 'frame',
      })));
    }
    return merged;
  }

  descriptorFor(index) {
    const descriptor = this.axIndex.get(String(index));
    if (!descriptor) throw new Error(`unknown element index ${index}; call getAXState() first`);
    return descriptor;
  }

  sendFor(descriptor, method, params = {}) {
    if (descriptor.send) return descriptor.send(method, params);
    return this.connection.send(method, params, descriptor.sessionId ?? this.sessionId);
  }

  /** backendNodeId -> DOM id, used for the `ID:` field. */
  async domIdMap() {
    if (this.domIds) return this.domIds;
    await this.connection.send('DOM.enable', {}, this.sessionId);
    const { root } = await this.connection.send('DOM.getDocument', { depth: -1, pierce: true }, this.sessionId);
    const map = new Map();
    const visit = (node) => {
      if (!node) return;
      const attributes = node.attributes ?? [];
      for (let index = 0; index + 1 < attributes.length; index += 2) {
        if (attributes[index] === 'id') map.set(node.backendNodeId, attributes[index + 1]);
      }
      for (const child of node.children ?? []) visit(child);
      for (const shadow of node.shadowRoots ?? []) visit(shadow);
    };
    visit(root);
    this.domIds = map;
    return map;
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.connection.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, this.sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'Runtime.evaluate failed');
    return result?.value;
  }

  async centerOf(index) {
    const descriptor = this.descriptorFor(index);
    await this.sendFor(descriptor, 'DOM.enable', {});
    const { model } = await this.sendFor(descriptor, 'DOM.getBoxModel', { backendNodeId: descriptor.backendNodeId });
    const quad = model.content;
    return [(quad[0] + quad[2] + quad[4] + quad[6]) / 4, (quad[1] + quad[3] + quad[5] + quad[7]) / 4];
  }

  async focus(index) {
    const descriptor = this.descriptorFor(index);
    await this.sendFor(descriptor, 'DOM.enable', {});
    await this.sendFor(descriptor, 'DOM.focus', { backendNodeId: descriptor.backendNodeId });
    return descriptor;
  }

  async resolveObject(index) {
    const descriptor = this.descriptorFor(index);
    await this.sendFor(descriptor, 'DOM.enable', {});
    const { object } = await this.sendFor(descriptor, 'DOM.resolveNode', { backendNodeId: descriptor.backendNodeId });
    return object.objectId;
  }

  async callOn(index, functionDeclaration, args = []) {
    const objectId = await this.resolveObject(index);
    const descriptor = this.descriptorFor(index);
    const { result, exceptionDetails } = await this.sendFor(descriptor, 'Runtime.callFunctionOn', {
      objectId, functionDeclaration, arguments: args.map((value) => ({ value })), returnByValue: true,
    });
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

  async domSnapshot() {
    return this.evaluate('document.documentElement.outerHTML');
  }

  async elementInfo(x, y) {
    if (![x, y].every((value) => Number.isFinite(value))) {
      throw new TypeError('elementInfo requires finite x and y');
    }
    return this.evaluate(`(() => {
      const el = document.elementFromPoint(${Number(x)}, ${Number(y)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        tagName: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        ariaName: el.getAttribute('aria-label'),
        testId: el.getAttribute('data-testid'),
        text: (el.innerText || el.textContent || '').slice(0, 200),
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    })()`);
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
    const descriptor = Array.isArray(target) ? null : this.descriptorFor(target);
    const [x, y] = Array.isArray(target) ? target : await this.centerOf(target);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await (descriptor ? this.sendFor(descriptor, 'Input.dispatchMouseEvent', {
        type, x, y, button: mouseButton, clickCount,
      }) : this.connection.send('Input.dispatchMouseEvent', {
        type, x, y, button: mouseButton, clickCount,
      }, this.sessionId));
    }
  }

  async scroll(target, direction, distance = 1) {
    const descriptor = Array.isArray(target) ? null : this.descriptorFor(target);
    const [x, y] = Array.isArray(target) ? target : await this.centerOf(target);
    const delta = Math.max(1, Number(distance)) * 120;
    const params = {
      type: 'mouseWheel', x, y,
      deltaX: direction === 'left' ? -delta : direction === 'right' ? delta : 0,
      deltaY: direction === 'up' ? -delta : delta,
    };
    if (descriptor) await this.sendFor(descriptor, 'Input.dispatchMouseEvent', params);
    else await this.connection.send('Input.dispatchMouseEvent', params, this.sessionId);
  }

  async typeText(index, text) {
    if (typeof index !== 'number') { text = index; index = null; }
    if (index !== null) {
      const descriptor = await this.focus(index);
      await this.sendFor(descriptor, 'Input.insertText', { text });
      return;
    }
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
    let descriptor = null;
    if (index !== null) descriptor = await this.focus(index);
    const spec = parseKeyChord(key);
    for (const type of ['keyDown', 'keyUp']) {
      if (descriptor) await this.sendFor(descriptor, 'Input.dispatchKeyEvent', { type, ...spec });
      else await this.connection.send('Input.dispatchKeyEvent', { type, ...spec }, this.sessionId);
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


