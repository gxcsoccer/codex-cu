// High-level surface mirroring the API the original exposes to the model
// (captured from a live session): `cua.getApp(...)`, `app.getAXState()`,
// `app.click(42)`, `app.scroll([x, y], "down", 1)`, ...
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from './client.mjs';

const DIRECTIONS = new Set(['up', 'down', 'left', 'right', 'u', 'd', 'l', 'r']);

// The original mac client wraps the first app-specific instruction block per app
// and excludes Numbers (window_result.js). The delivered set is process-wide.
const INSTRUCTION_EXCLUSIONS = new Set(['com.apple.iWork.Numbers']);
const DELIVERED_INSTRUCTIONS = new Set();

function appKey(app) {
  if (app && typeof app === 'object') return app.bundleIdentifier ?? app.app ?? '';
  return String(app ?? '');
}

function withInstructions(app, text, instructions) {
  if (typeof instructions !== 'string' || instructions.length === 0) return text;
  const key = appKey(app);
  if (INSTRUCTION_EXCLUSIONS.has(key) || DELIVERED_INSTRUCTIONS.has(key)) return text;
  DELIVERED_INSTRUCTIONS.add(key);
  return `<app_specific_instructions>\n${instructions}\n</app_specific_instructions>\n${text}`;
}

function normalizeDirection(direction) {
  const map = { u: 'up', d: 'down', l: 'left', r: 'right' };
  const value = map[direction] ?? direction;
  if (!DIRECTIONS.has(direction)) throw new TypeError(`invalid direction: ${direction}`);
  return value;
}

function targetOf(target) {
  if (typeof target === 'number') return { elementIndex: target };
  if (Array.isArray(target) && target.length === 2) return { x: target[0], y: target[1] };
  throw new TypeError('target must be an element index or [x, y]');
}

export class App {
  constructor({ client, app }) {
    this.client = client;
    this.app = app;
    this.lastState = null;
  }

  async getAXState({ disableDiffing = false } = {}) {
    const result = await this.client.getAppState(this.app, { disableDiff: disableDiffing });
    this.lastState = result;
    return withInstructions(this.app, result.text, result.appSpecificInstructions);
  }

  async getScreenshot() {
    const result = await this.client.getAppState(this.app, { disableDiff: true });
    this.lastState = result;
    return readScreenshot(result);
  }

  async getAXStateAndScreenshot(options = {}) {
    const state = await this.getAXState(options);
    return { state, screenshot: this.lastState ? await readScreenshot(this.lastState) : undefined };
  }

  async click(target, options = {}) {
    return this.client.click({
      app: this.app,
      ...targetOf(target),
      mouseButton: options.mouseButton,
      clickCount: options.clickCount,
    });
  }

  async drag(from, to) {
    return this.client.drag({ app: this.app, fromX: from[0], fromY: from[1], toX: to[0], toY: to[1] });
  }

  async scroll(target, direction, distance = 1) {
    const pages = typeof distance === 'object' && distance !== null && 'pixels' in distance
      ? Math.max(1, Math.ceil(distance.pixels / 400))
      : distance;
    return this.client.scroll({ app: this.app, ...targetOf(target), direction: normalizeDirection(direction), pages });
  }

  async selectText(elementIndex, text, options = {}) {
    return this.client.selectText({
      app: this.app,
      elementIndex,
      text,
      prefix: options.prefix,
      suffix: options.suffix,
      selection: options.selectionType,
    });
  }

  async setValue(elementIndex, value) {
    return this.client.setValue({ app: this.app, elementIndex, value });
  }

  async performSecondaryAction(elementIndex, action) {
    return this.client.performSecondaryAction({ app: this.app, elementIndex, action });
  }

  async paste(text, options = {}) {
    return this.client.paste({ app: this.app, text, format: options.format });
  }

  async pressKey(key, options = {}) {
    return this.client.pressKey({ app: this.app, key, duration: options.durationMs });
  }

  async typeText(text) {
    return this.client.typeText({ app: this.app, text });
  }
}

export class Cua {
  constructor({ socketPath, client, browserProvider } = {}) {
    this.client = client ?? new Client({ socketPath });
    this.browserProvider = browserProvider ?? null;
  }

  async connect() { await this.client.connect(); return this; }

  async getState() {
    const apps = await this.client.listApps();
    return { apps: apps.apps ?? [], browsers: [] };
  }

  async listApps() {
    const result = await this.client.listApps();
    return result.apps ?? [];
  }

  async getApp(target) {
    if (typeof target === 'object' && target !== null) {
      throw new Error('window-scoped bindings are not implemented; pass an app name or bundle id');
    }
    await this.client.connect();
    return new App({ client: this.client, app: target });
  }

  browserProviderOrThrow() {
    if (!this.browserProvider) throw new Error('no browser provider configured; pass browserProvider to Cua');
    return this.browserProvider;
  }

  async startAudioRecording(options = {}) {
    return this.client.startAudioRecording(options);
  }

  async stopAudioRecording() {
    const { url } = await this.client.stopAudioRecording();
    if (typeof url !== 'string' || !url.startsWith('file:')) {
      throw new Error('computer-use service did not return a local computer audio URL');
    }
    const filepath = fileURLToPath(url);
    const bytes = new Uint8Array(await readFile(filepath));
    return {
      filepath,
      bytes,
      data_url: `data:audio/wav;base64,${Buffer.from(bytes).toString('base64')}`,
    };
  }

  async listBrowsers() {
    return this.browserProviderOrThrow().list();
  }

  async getBrowser(options = {}) {
    return this.browserProviderOrThrow().getBrowser(options);
  }

  async listTabs(options = {}) {
    const browser = await this.getBrowser(options);
    return browser.listTabs();
  }

  async getTab(reference, options = {}) {
    const browser = await this.getBrowser(options);
    return browser.getTab(reference);
  }

  async createBrowserTab(browserId, url, options = {}) {
    const browser = await this.getBrowser({ id: browserId });
    return browser.createTab(url, options);
  }

  close() {
    this.client.close();
    this.browserProvider?.close?.();
  }
}

async function readScreenshot(result) {
  const url = result?.skyshot?.screenshot?.url;
  if (!url) return undefined;
  return new Uint8Array(await readFile(fileURLToPath(url)));
}
