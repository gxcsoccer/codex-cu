// Playwright-backed browser provider. The original browser stack is Playwright
// plus a WASM accessibility layer; this backend uses the real Playwright engine
// (same version the app ships, 1.57) over CDP, while accessibility text and
// element-index actions keep using the CDP session.
import { BrowserTab, formatAXTree } from './browser.mjs';

const BUNDLED_PLAYWRIGHT = '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright-core/index.mjs';

export async function loadPlaywright(moduleName = 'playwright-core') {
  try {
    return await import(moduleName);
  } catch (error) {
    try {
      return await import(BUNDLED_PLAYWRIGHT);
    } catch {
      throw new Error(`playwright-core is required for the Playwright backend (${error.message})`);
    }
  }
}

const MODIFIERS = {
  cmd: 'Meta', command: 'Meta', meta: 'Meta',
  ctrl: 'Control', control: 'Control',
  alt: 'Alt', option: 'Alt', opt: 'Alt',
  shift: 'Shift',
};

const NAMED = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape',
  backspace: 'Backspace', delete: 'Delete', space: 'Space',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

/** "cmd+shift+a" -> "Meta+Shift+A"; Playwright's keyboard syntax. */
export function toPlaywrightChord(spec) {
  const tokens = String(spec).split('+').map((token) => token.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) throw new Error('key is required');
  const key = tokens.pop();
  const modifiers = tokens.map((token) => {
    if (!MODIFIERS[token]) throw new Error(`unknown modifier: ${token}`);
    return MODIFIERS[token];
  });
  let keyName;
  if (NAMED[key]) keyName = NAMED[key];
  else if (/^[a-z]$/.test(key)) keyName = key.toUpperCase();
  else if (/^[0-9]$/.test(key) || /^f([1-9]|1[0-2])$/.test(key)) keyName = key.toUpperCase();
  else throw new Error(`unsupported key: ${key}`);
  return [...modifiers, keyName].join('+');
}

class SessionAdapter {
  constructor(session) { this.session = session; }
  send(method, params) { return this.session.send(method, params); }
}

export class PlaywrightTab {
  constructor({ page, cdp, id, info = {} }) {
    this.page = page;
    this.cdp = cdp;
    this.id = id;
    this.info = info;
    this.status = null;
    this.takeoverRequested = false;
    // Reuse the CDP element-index/AX implementation through the page session.
    this.cdpTab = new BrowserTab({
      connection: new SessionAdapter(cdp),
      targetId: id,
      sessionId: undefined,
      info,
    });
    // The full Playwright API: locators, getByRole/text/testid/label, evaluate.
    this.playwright = page;
    this.axIndex = this.cdpTab.axIndex;
  }

  async goto(url) { await this.page.goto(url, { waitUntil: 'domcontentloaded' }); }
  async back() { await this.page.goBack(); }
  async forward() { await this.page.goForward(); }
  async reload() { await this.page.reload(); }
  async close() { await this.page.close(); }
  async title() { return this.page.title(); }
  async url() { return this.page.url(); }
  async markDeliverable() { this.status = 'deliverable'; }
  async markHandoff() { this.status = 'handoff'; }
  async requestUserTakeover() { this.takeoverRequested = true; }

  async screenshot({ fullPage = false, clip } = {}) {
    return new Uint8Array(await this.page.screenshot({ fullPage, ...(clip ? { clip } : {}) }));
  }

  async getScreenshot() { return this.screenshot(); }

  async getAXState() {
    const text = await this.cdpTab.getAXState();
    this.axIndex = this.cdpTab.axIndex;
    return text;
  }

  async evaluate(script, arg) {
    return arg === undefined ? this.page.evaluate(script) : this.page.evaluate(script, arg);
  }

  async domSnapshot() { return this.page.evaluate('document.documentElement.outerHTML'); }

  async elementInfo(x, y) {
    return this.page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
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
    }, { x, y });
  }

  async click(index, options) { return this.cdpTab.click(index, options); }
  async scroll(index, direction, pages) { return this.cdpTab.scroll(index, direction, pages); }
  async setValue(index, value) { return this.cdpTab.setValue(index, value); }
  async selectText(index, text, options) { return this.cdpTab.selectText(index, text, options); }

  async typeText(index, text) {
    if (typeof index !== 'number') { await this.page.keyboard.insertText(index); return; }
    return this.cdpTab.typeText(index, text);
  }

  async pressKey(index, key) {
    if (typeof index !== 'number') { await this.page.keyboard.press(toPlaywrightChord(index)); return; }
    return this.cdpTab.pressKey(index, key);
  }

  async paste(index, text) {
    if (typeof index === 'number') await this.cdpTab.typeText(index, text);
    else await this.page.keyboard.insertText(text);
  }

  async performSecondaryAction() {
    throw new Error('performSecondaryAction is not supported for browser tabs (no CDP equivalent)');
  }
}

export class PlaywrightBrowser {
  constructor({ browser, context, id = 'playwright', name = 'Chromium' }) {
    this.browser = browser;
    this.context = context;
    this.browserId = id;
    this.name = name;
    this.ids = new WeakMap();
    this.nextId = 1;
  }

  idFor(page) {
    if (!this.ids.has(page)) this.ids.set(page, `pw-${this.nextId++}`);
    return this.ids.get(page);
  }

  async documentation() {
    return 'Playwright browser provider: real Playwright locators (getByRole/text/testid/label), auto-waiting, goto/back/forward/reload, CDP accessibility text and element-index input.';
  }

  async listTabs() {
    return Promise.all(this.context.pages().map(async (page) => ({
      id: this.idFor(page),
      browserId: this.browserId,
      title: await page.title().catch(() => ''),
      url: page.url(),
    })));
  }

  async getTab(reference) {
    const pages = this.context.pages();
    const match = pages.find((page) => {
      if (typeof reference === 'string') return this.idFor(page) === reference || page.url() === reference;
      return reference?.url ? page.url().includes(reference.url) : false;
    });
    if (!match) throw new Error(`browser tab not found: ${JSON.stringify(reference)}`);
    return this.tab(match);
  }

  async createTab(url, { visible = true } = {}) {
    const page = await this.context.newPage();
    if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
    return this.tab(page);
  }

  async tab(page) {
    const cdp = await this.context.newCDPSession(page);
    return new PlaywrightTab({ page, cdp, id: this.idFor(page), info: { url: page.url() } });
  }
}

export class PlaywrightBrowserProvider {
  constructor({ endpoint = 'http://127.0.0.1:9222', fetchImpl = globalThis.fetch, playwright } = {}) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.playwrightModule = playwright;
    this.browser = null;
  }

  async validate() {
    const response = await this.fetch(`${this.endpoint}/json/version`);
    if (!response.ok) throw new Error(`CDP endpoint returned ${response.status}`);
    const version = await response.json();
    if (!version.webSocketDebuggerUrl) {
      throw new Error(`endpoint is not a browser CDP (no webSocketDebuggerUrl; Browser=${version.Browser ?? 'unknown'})`);
    }
    return version;
  }

  async list() {
    const version = await this.validate();
    return [{ id: 'playwright', name: version.Browser ?? 'Chromium', type: 'playwright', metadata: { endpoint: this.endpoint } }];
  }

  async getBrowser() {
    const info = (await this.list())[0];
    if (!this.browser) {
      const playwright = this.playwrightModule ?? await loadPlaywright();
      this.browser = await playwright.chromium.connectOverCDP(this.endpoint);
    }
    const context = this.browser.contexts()[0] ?? await this.browser.newContext();
    return new PlaywrightBrowser({ browser: this.browser, context, id: info.id, name: info.name });
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.browser = null;
  }
}
