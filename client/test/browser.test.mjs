import test from 'node:test';
import assert from 'node:assert/strict';
import { CdpBrowserProvider, BrowserTab, formatAXTree } from '../src/browser.mjs';
import { Cua } from '../src/cua.mjs';
import { startMockServer } from './helpers/mock-server.mjs';

class FakeConnection {
  constructor(responses = {}) { this.responses = responses; this.calls = []; }
  async send(method, params = {}, sessionId) {
    this.calls.push({ method, params, sessionId });
    const value = this.responses[method];
    return typeof value === 'function' ? value(params) : (value ?? {});
  }
  on() { return () => {}; }
  close() {}
}

const version = { Browser: 'Chrome/155', webSocketDebuggerUrl: 'ws://fake' };
const fetchImpl = async (url) => ({
  ok: true,
  json: async () => (url.endsWith('/json/version') ? version : []),
});

test('lists a single CDP browser', async () => {
  const provider = new CdpBrowserProvider({ fetchImpl });
  const browsers = await provider.list();
  assert.equal(browsers.length, 1);
  assert.equal(browsers[0].type, 'cdp');
  assert.match(browsers[0].name, /Chrome/);
});

test('lists page targets and attaches by url', async () => {
  const connection = new FakeConnection({
    'Target.getTargets': { targetInfos: [
      { targetId: 'T1', type: 'page', title: 'One', url: 'https://one.test/' },
      { targetId: 'T2', type: 'worker', title: '', url: 'https://one.test/w.js' },
      { targetId: 'T3', type: 'page', title: 'Two', url: 'https://two.test/' },
    ] },
    'Target.attachToTarget': { sessionId: 'S1' },
  });
  const provider = new CdpBrowserProvider({ fetchImpl, connect: async () => connection });
  const browser = await provider.getBrowser();
  const tabs = await browser.listTabs();
  assert.deepEqual(tabs.map((tab) => tab.id), ['T1', 'T3']);

  const tab = await browser.getTab('https://two.test/');
  assert.equal(tab.id, 'T3');
  assert.equal(tab.sessionId, 'S1');
  await tab.goto('https://three.test/');
  assert.deepEqual(connection.calls.at(-1), { method: 'Page.navigate', params: { url: 'https://three.test/' }, sessionId: 'S1' });
});

test('creates a tab and drives it', async () => {
  const connection = new FakeConnection({
    'Target.createTarget': { targetId: 'NEW' },
    'Target.attachToTarget': { sessionId: 'S2' },
    'Accessibility.getFullAXTree': { nodes: [
      { nodeId: '1', backendDOMNodeId: 101, ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Example' } },
      { nodeId: '2', backendDOMNodeId: 102, ignored: true, role: { value: 'generic' }, name: { value: '' } },
      { nodeId: '3', backendDOMNodeId: 103, ignored: false, role: { value: 'button' }, name: { value: 'Go' } },
    ] },
    'DOM.getBoxModel': { model: { content: [0, 0, 100, 0, 100, 50, 0, 50] } },
    'DOM.resolveNode': { object: { objectId: 'O1' } },
    'Runtime.callFunctionOn': { result: { value: true } },
    'Page.captureScreenshot': { data: Buffer.from([0x89, 0x50]).toString('base64') },
  });
  const provider = new CdpBrowserProvider({ fetchImpl, connect: async () => connection });
  const browser = await provider.getBrowser();
  const tab = await browser.createTab('https://new.test/');
  assert.equal(tab.id, 'NEW');

  assert.equal(await tab.getAXState(), '\t1 RootWebArea Example\n\t3 button Go');
  assert.deepEqual([...(await tab.getScreenshot())], [0x89, 0x50]);

  await tab.click([10, 20]);
  let clicks = connection.calls.filter((call) => call.method === 'Input.dispatchMouseEvent');
  assert.equal(clicks.length, 2);
  assert.equal(clicks[0].params.type, 'mousePressed');

  await tab.click(3, { clickCount: 2 });
  clicks = connection.calls.filter((call) => call.method === 'Input.dispatchMouseEvent');
  assert.deepEqual([clicks[2].params.x, clicks[2].params.y], [50, 25]);
  assert.equal(clicks[2].params.clickCount, 2);
  assert.equal(connection.calls.find((call) => call.method === 'DOM.getBoxModel').params.backendNodeId, 103);

  await tab.typeText('hello');
  assert.equal(connection.calls.at(-1).method, 'Input.insertText');
  await tab.typeText(3, 'world');
  const insert = connection.calls.filter((call) => call.method === 'Input.insertText');
  assert.equal(insert.at(-1).params.text, 'world');
  assert.equal(connection.calls.filter((call) => call.method === 'DOM.focus').at(-1).params.backendNodeId, 103);

  await tab.setValue(3, 'value');
  const call = connection.calls.filter((c) => c.method === 'Runtime.callFunctionOn').at(-1);
  assert.equal(call.params.objectId, 'O1');
  assert.deepEqual(call.params.arguments, [{ value: 'value' }]);

  await tab.selectText(3, 'val');
  assert.equal(connection.calls.filter((c) => c.method === 'Runtime.callFunctionOn').length, 2);

  await tab.pressKey(3, 'Enter');
  assert.equal(connection.calls.filter((call) => call.method === 'Input.dispatchKeyEvent').length, 2);
  await assert.rejects(() => tab.pressKey('Hyper+Space'), /unsupported browser key/);
});

test('element-index input requires a fresh AX state', async () => {
  const tab = new BrowserTab({ connection: new FakeConnection(), targetId: 'T', sessionId: 'S' });
  await assert.rejects(() => tab.click(42), /unknown element index/);
  await assert.rejects(() => tab.scroll(42, 'down'), /unknown element index/);
});

test('cua exposes the browser surface through a provider', async () => {
  const provider = {
    list: async () => [{ id: 'cdp', name: 'Chrome', type: 'cdp' }],
    getBrowser: async () => ({
      browserId: 'cdp',
      documentation: async () => 'docs',
      listTabs: async () => [{ id: 'T1', browserId: 'cdp', url: 'https://one.test/' }],
      getTab: async () => ({ id: 'T1' }),
      createTab: async () => ({ id: 'T2' }),
    }),
  };
  const mock = await startMockServer(() => ({ result: {} }));
  const cua = new Cua({ socketPath: mock.socketPath, browserProvider: provider });
  try {
    assert.deepEqual(await cua.listBrowsers(), [{ id: 'cdp', name: 'Chrome', type: 'cdp' }]);
    assert.equal((await cua.listTabs())[0].id, 'T1');
    assert.equal((await cua.getTab('https://one.test/')).id, 'T1');
    assert.equal((await cua.createBrowserTab('cdp', 'https://two.test/')).id, 'T2');
  } finally {
    cua.close();
    await mock.close();
  }
});

test('cua reports a missing browser provider', async () => {
  const mock = await startMockServer(() => ({ result: {} }));
  const cua = new Cua({ socketPath: mock.socketPath });
  try {
    await assert.rejects(() => cua.listBrowsers(), /no browser provider/);
  } finally {
    cua.close();
    await mock.close();
  }
});

test('reports non-browser CDP endpoints clearly', async () => {
  const provider = new CdpBrowserProvider({
    fetchImpl: async () => ({ ok: true, json: async () => ({ Browser: 'aha-runtime' }) }),
  });
  await assert.rejects(() => provider.getBrowser(), /not a browser CDP/);
});

test('formatAXTree skips ignored nodes', () => {
  assert.equal(formatAXTree([{ nodeId: 9, ignored: false, role: { value: 'button' }, name: { value: 'OK' } }]), '\t9 button OK');
});
