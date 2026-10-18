// High-level surface mirroring the API the original exposes to the model
// (captured from a live session): `cua.getApp(...)`, `app.getAXState()`,
// `app.click(42)`, `app.scroll([x, y], "down", 1)`, ...
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from './client.mjs';

const DIRECTIONS = new Set(['up', 'down', 'left', 'right', 'u', 'd', 'l', 'r']);

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
    return result.text;
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
  constructor({ socketPath, client } = {}) {
    this.client = client ?? new Client({ socketPath });
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

  close() { this.client.close(); }
}

async function readScreenshot(result) {
  const url = result?.skyshot?.screenshot?.url;
  if (!url) return undefined;
  return new Uint8Array(await readFile(fileURLToPath(url)));
}
