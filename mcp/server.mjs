#!/usr/bin/env node
// Minimal MCP server over stdio exposing the Codex Computer Use surface.
// Protocol: newline-delimited JSON-RPC 2.0 (MCP stdio transport).
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '../client/src/client.mjs';
import { CdpBrowserProvider } from '../client/src/browser.mjs';
import { PlaywrightBrowserProvider } from '../client/src/browser-playwright.mjs';

const SERVER_INFO = { name: 'codex-cu', version: '0.1.0' };
const PROTOCOL_VERSION = '2025-06-18';
const SHOT_DIR = path.join(os.tmpdir(), 'codex-cu-mcp');

function parseArgs(argv) {
  const options = {
    socket: process.env.CODEX_CU_SOCKET ?? '/tmp/codex-cu.sock',
    browser: process.env.CODEX_CU_BROWSER ?? null,
    browserBackend: process.env.CODEX_CU_BROWSER_BACKEND ?? 'cdp',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--socket') options.socket = argv[++index];
    else if (arg === '--browser') options.browser = argv[++index];
    else if (arg === '--browser-backend') options.browserBackend = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: mcp/server.mjs [--socket PATH] [--browser ENDPOINT] [--browser-backend cdp|playwright]\n');
      process.exit(0);
    } else if (arg.startsWith('--socket=')) options.socket = arg.slice('--socket='.length);
    else if (arg.startsWith('--browser=')) options.browser = arg.slice('--browser='.length);
    else if (arg.startsWith('--browser-backend=')) options.browserBackend = arg.slice('--browser-backend='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const client = new Client({ socketPath: options.socket });
let provider = null;
let browserPromise = null;
const tabCache = new Map();
const tabAliases = new Map();

function browserProvider() {
  if (!options.browser) throw new Error('browser endpoint not configured; pass --browser http://127.0.0.1:9222');
  if (!provider) {
    provider = options.browserBackend === 'playwright'
      ? new PlaywrightBrowserProvider({ endpoint: options.browser })
      : new CdpBrowserProvider({ endpoint: options.browser });
  }
  return provider;
}

async function browserOnce() {
  if (!browserPromise) browserPromise = browserProvider().getBrowser();
  return browserPromise;
}

async function resolveTab(reference) {
  if (typeof reference !== 'string' || reference === '') throw new Error('tab reference is required');
  if (tabAliases.has(reference)) return tabAliases.get(reference);
  const browser = await browserOnce();
  const tabs = await browser.listTabs();
  const info = tabs.find((candidate) => candidate.id === reference || candidate.url === reference || candidate.url?.includes(reference));
  if (!info) throw new Error(`tab not found: ${reference}`);
  if (tabCache.has(info.id)) {
    const cached = tabCache.get(info.id);
    tabAliases.set(reference, cached);
    return cached;
  }
  const tab = await browser.getTab(info.id);
  tabCache.set(info.id, tab);
  tabAliases.set(reference, tab);
  tabAliases.set(info.id, tab);
  tabAliases.set(info.url, tab);
  return tab;
}

function jsonText(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

async function screenshotPath(app) {
  const state = await client.getAppState({ app, disableDiff: true });
  const url = state.skyshot?.screenshot?.url;
  if (!url) throw new Error('no screenshot returned (is Screen Recording granted?)');
  return fileURLToPath(url);
}

async function browserScreenshot(tab, { fullPage = false } = {}) {
  const bytes = await tab.screenshot({ fullPage });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `browser-${Date.now()}.png`);
  fs.writeFileSync(file, bytes);
  return { path: file, bytes: bytes.length };
}

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const TOOLS = [
  // Native surface
  { name: 'list_apps', description: 'List running regular applications.', inputSchema: object({}),
    handler: async () => jsonText(await client.listApps()) },
  { name: 'app_policy', description: 'Return the approval decision for an app (allowed + decision).', inputSchema: object({ app: { type: 'string' } }, ['app']),
    handler: async ({ app }) => jsonText(await client.getAppPolicy(app)) },
  { name: 'start_app', description: 'Launch or activate an app by bundle id or name.', inputSchema: object({ app: { type: 'string' } }, ['app']),
    handler: async ({ app }) => jsonText(await client.startApp(app)) },
  { name: 'get_app_state', description: 'Observe an app: accessibility tree text, optional instructions and screenshot URL.', inputSchema: object({ app: { type: 'string' }, disable_diff: { type: 'boolean' } }, ['app']),
    handler: async ({ app, disable_diff: disableDiff = false }) => {
      const state = await client.getAppState({ app, disableDiff });
      return jsonText({
        text: state.text,
        appSpecificInstructions: state.appSpecificInstructions,
        screenshotURL: state.skyshot?.screenshot?.url,
        revision: state.revision,
      });
    } },
  { name: 'get_screenshot', description: 'Capture an app and return the PNG path.', inputSchema: object({ app: { type: 'string' } }, ['app']),
    handler: async ({ app }) => jsonText({ path: await screenshotPath(app) }) },
  { name: 'click', description: 'Click an element index from get_app_state, or coordinates.', inputSchema: object({
      app: { type: 'string' }, element_index: { type: 'integer' },
      x: { type: 'number' }, y: { type: 'number' },
      click_count: { type: 'integer' }, mouse_button: { type: 'string', enum: ['left', 'right', 'middle'] },
    }, ['app']),
    handler: async ({ app, element_index: elementIndex, x, y, click_count: clickCount, mouse_button: mouseButton }) =>
      jsonText(await client.click({ app, elementIndex, x, y, clickCount, mouseButton })) },
  { name: 'type_text', description: 'Type text into the focused element of an app.', inputSchema: object({ app: { type: 'string' }, text: { type: 'string' } }, ['app', 'text']),
    handler: async ({ app, text }) => jsonText(await client.typeText({ app, text })) },
  { name: 'press_key', description: 'Press a key/chord such as cmd+shift+g.', inputSchema: object({ app: { type: 'string' }, key: { type: 'string' }, duration: { type: 'number' } }, ['app', 'key']),
    handler: async ({ app, key, duration }) => jsonText(await client.pressKey({ app, key, duration })) },
  { name: 'scroll', description: 'Scroll an element or coordinates.', inputSchema: object({
      app: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, pages: { type: 'number' },
      element_index: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' },
    }, ['app', 'direction']),
    handler: async ({ app, direction, pages = 1, element_index: elementIndex, x, y }) =>
      jsonText(await client.scroll({ app, direction, pages, elementIndex, x, y })) },
  { name: 'set_value', description: 'Set a text field value by element index.', inputSchema: object({ app: { type: 'string' }, element_index: { type: 'integer' }, value: { type: 'string' } }, ['app', 'element_index', 'value']),
    handler: async ({ app, element_index: elementIndex, value }) => jsonText(await client.setValue({ app, elementIndex, value })) },
  { name: 'select_text', description: 'Select text inside an element, optionally constrained by prefix/suffix.', inputSchema: object({
      app: { type: 'string' }, element_index: { type: 'integer' }, text: { type: 'string' },
      prefix: { type: 'string' }, suffix: { type: 'string' }, selection: { type: 'string', enum: ['text', 'cursor_before', 'cursor_after'] },
    }, ['app', 'element_index', 'text']),
    handler: async ({ app, element_index: elementIndex, text, prefix, suffix, selection = 'text' }) =>
      jsonText(await client.selectText({ app, elementIndex, text, prefix, suffix, selection })) },
  { name: 'secondary_action', description: 'Perform an accessibility secondary action (e.g. AXRaise).', inputSchema: object({ app: { type: 'string' }, element_index: { type: 'integer' }, action: { type: 'string' } }, ['app', 'element_index', 'action']),
    handler: async ({ app, element_index: elementIndex, action }) => jsonText(await client.performSecondaryAction({ app, elementIndex, action })) },
  { name: 'paste', description: 'Paste text into the focused element.', inputSchema: object({ app: { type: 'string' }, text: { type: 'string' } }, ['app', 'text']),
    handler: async ({ app, text }) => jsonText(await client.paste({ app, text })) },
  { name: 'drag', description: 'Drag from one point to another.', inputSchema: object({ app: { type: 'string' }, from_x: { type: 'number' }, from_y: { type: 'number' }, to_x: { type: 'number' }, to_y: { type: 'number' } }, ['app', 'from_x', 'from_y', 'to_x', 'to_y']),
    handler: async ({ app, from_x: fromX, from_y: fromY, to_x: toX, to_y: toY }) => jsonText(await client.drag({ app, fromX, fromY, toX, toY })) },
  { name: 'audio_start', description: 'Start loopback audio recording.', inputSchema: object({ max_duration_ms: { type: 'integer' } }),
    handler: async ({ max_duration_ms: maxDurationMilliseconds }) => jsonText(await client.startAudioRecording({ maxDurationMilliseconds })) },
  { name: 'audio_stop', description: 'Stop recording and return the WAV URL.', inputSchema: object({}),
    handler: async () => jsonText(await client.stopAudioRecording()) },

  // Browser surface
  { name: 'browser_list', description: 'List configured browsers (CDP/Playwright endpoint).', inputSchema: object({}),
    handler: async () => jsonText(await browserProvider().list()) },
  { name: 'browser_tabs', description: 'List tabs.', inputSchema: object({}),
    handler: async () => jsonText(await (await browserOnce()).listTabs()) },
  { name: 'browser_open', description: 'Open a tab at a URL and return its id/url.', inputSchema: object({ url: { type: 'string' } }, ['url']),
    handler: async ({ url }) => {
      const tab = await (await browserOnce()).createTab(url);
      tabCache.set(tab.id, tab);
      tabAliases.set(tab.id, tab);
      tabAliases.set(url, tab);
      // A fresh CDP target may not have an execution context yet; the target URL
      // is what createTab navigated to and is enough to resolve the tab later.
      return jsonText({ id: tab.id, url });
    } },
  { name: 'browser_goto', description: 'Navigate a tab.', inputSchema: object({ tab: { type: 'string' }, url: { type: 'string' } }, ['tab', 'url']),
    handler: async ({ tab, url }) => { const target = await resolveTab(tab); await target.goto(url); return jsonText({ url: await target.url() }); } },
  { name: 'browser_ax', description: 'Return the accessibility tree of a tab.', inputSchema: object({ tab: { type: 'string' }, disable_diff: { type: 'boolean' } }, ['tab']),
    handler: async ({ tab, disable_diff: disableDiff = false }) => jsonText(await (await resolveTab(tab)).getAXState({ disableDiff })) },
  { name: 'browser_click', description: 'Click an element index from browser_ax, or coordinates.', inputSchema: object({
      tab: { type: 'string' }, element_index: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' },
      click_count: { type: 'integer' }, mouse_button: { type: 'string', enum: ['left', 'right', 'middle'] },
    }, ['tab']),
    handler: async ({ tab, element_index: elementIndex, x, y, click_count: clickCount, mouse_button: mouseButton }) => {
      const target = await resolveTab(tab);
      if (elementIndex !== undefined) await target.click(elementIndex, { clickCount, mouseButton });
      else await target.click([x, y], { clickCount, mouseButton });
      return jsonText({ ok: true });
    } },
  { name: 'browser_type', description: 'Type text, optionally focusing an element index.', inputSchema: object({ tab: { type: 'string' }, text: { type: 'string' }, element_index: { type: 'integer' } }, ['tab', 'text']),
    handler: async ({ tab, text, element_index: elementIndex }) => { await (await resolveTab(tab)).typeText(elementIndex, text); return jsonText({ ok: true }); } },
  { name: 'browser_press_key', description: 'Press a key/chord in a tab, optionally focusing an element index.', inputSchema: object({ tab: { type: 'string' }, key: { type: 'string' }, element_index: { type: 'integer' } }, ['tab', 'key']),
    handler: async ({ tab, key, element_index: elementIndex }) => { await (await resolveTab(tab)).pressKey(elementIndex, key); return jsonText({ ok: true }); } },
  { name: 'browser_screenshot', description: 'Screenshot a tab and return the PNG path.', inputSchema: object({ tab: { type: 'string' }, full_page: { type: 'boolean' } }, ['tab']),
    handler: async ({ tab, full_page: fullPage = false }) => jsonText(await browserScreenshot(await resolveTab(tab), { fullPage })) },
  { name: 'browser_locator_fill', description: 'Playwright locator fill by CSS selector.', inputSchema: object({ tab: { type: 'string' }, selector: { type: 'string' }, value: { type: 'string' } }, ['tab', 'selector', 'value']),
    handler: async ({ tab, selector, value }) => { await (await resolveTab(tab)).playwright.locator(selector).fill(value); return jsonText({ ok: true }); } },
  { name: 'browser_locator_click', description: 'Playwright locator click by CSS selector.', inputSchema: object({ tab: { type: 'string' }, selector: { type: 'string' } }, ['tab', 'selector']),
    handler: async ({ tab, selector }) => { await (await resolveTab(tab)).playwright.locator(selector).click(); return jsonText({ ok: true }); } },
  { name: 'browser_evaluate', description: 'Evaluate an expression in a tab and return its JSON value.', inputSchema: object({ tab: { type: 'string' }, expression: { type: 'string' } }, ['tab', 'expression']),
    handler: async ({ tab, expression }) => jsonText(await (await resolveTab(tab)).evaluate(expression)) },
];

const toolMap = new Map(TOOLS.map((tool) => [tool.name, tool]));

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
    });
  }
  if (method === 'tools/call') {
    const tool = toolMap.get(params?.name);
    if (!tool) return error(id, -32602, `unknown tool: ${params?.name}`);
    try {
      return send({ jsonrpc: '2.0', id, result: await tool.handler(params?.arguments ?? {}) });
    } catch (toolError) {
      const code = toolError?.code !== undefined ? `${toolError.code}: ` : '';
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `${code}${toolError?.message ?? String(toolError)}` }], isError: true },
      });
    }
  }
  if (method?.startsWith('notifications/')) return undefined;
  return error(id, -32601, `method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
rl.on('line', (line) => {
  if (!line.trim()) return;
  queue = queue.then(async () => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return error(null, -32700, 'parse error');
    }
    await handle(message);
  });
});

function shutdown() {
  tabCache.clear();
  tabAliases.clear();
  provider?.close();
  client.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
