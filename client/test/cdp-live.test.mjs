import test from 'node:test';
import assert from 'node:assert/strict';
import { startCdpServer } from './helpers/cdp-server.mjs';
import { CdpBrowserProvider } from '../src/browser.mjs';

const responses = (message) => {
  const map = {
    'Target.getTargets': { targetInfos: [
      { targetId: 'T1', type: 'page', title: 'Mock', url: 'https://mock.test/' },
      { targetId: 'W1', type: 'worker', title: '', url: 'https://mock.test/w.js' },
    ] },
    'Target.attachToTarget': { sessionId: 'S1' },
    'Target.createTarget': { targetId: 'T2' },
    'Page.navigate': { frameId: 'F1' },
    'Page.reload': {},
    'Target.closeTarget': {},
    'Page.captureScreenshot': { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') },
    'Accessibility.enable': {},
    'Accessibility.getFullAXTree': { nodes: [
      { nodeId: '1', backendDOMNodeId: 101, ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Mock' } },
      { nodeId: '2', backendDOMNodeId: 102, ignored: false, role: { value: 'button' }, name: { value: 'Go' } },
    ] },
    'DOM.enable': {},
    'DOM.getBoxModel': { model: { content: [0, 0, 100, 0, 100, 40, 0, 40] } },
    'DOM.focus': {},
    'DOM.resolveNode': { object: { objectId: 'O1' } },
    'Runtime.callFunctionOn': { result: { value: true } },
    'Input.insertText': {},
    'Input.dispatchMouseEvent': {},
    'Input.dispatchKeyEvent': {},
  };
  const result = map[message.method];
  return result === undefined ? { error: { code: -32601, message: `unknown: ${message.method}` } } : { result };
};

test('drives a browser through a real WebSocket CDP server', async () => {
  const server = await startCdpServer({ handler: responses });
  const provider = new CdpBrowserProvider({ endpoint: server.endpoint });
  try {
    const browsers = await provider.list();
    assert.equal(browsers[0].name, 'MockChrome/1.0');

    const browser = await provider.getBrowser({ id: 'cdp' });
    const tabs = await browser.listTabs();
    assert.deepEqual(tabs.map((tab) => tab.id), ['T1']);

    const tab = await browser.getTab('https://mock.test/');
    await tab.goto('https://mock.test/next');
    const ax = await tab.getAXState();
    assert.match(ax, /button Go/);

    await tab.click(102);
    const boxCalls = server.calls.filter((call) => call.method === 'DOM.getBoxModel');
    assert.equal(boxCalls.length, 1);
    assert.equal(boxCalls[0].params.backendNodeId, 102);

    await tab.typeText(102, 'hello');
    assert.equal(server.calls.filter((call) => call.method === 'DOM.focus').length, 1);

    await tab.setValue(102, 'v');
    assert.equal(server.calls.filter((call) => call.method === 'Runtime.callFunctionOn').length, 1);

    const shot = await tab.getScreenshot();
    assert.deepEqual([...shot], [0x89, 0x50, 0x4e, 0x47]);

    const created = await browser.createTab('https://mock.test/new');
    assert.equal(created.id, 'T2');
    await tab.close();
    assert.ok(server.calls.some((call) => call.method === 'Target.closeTarget'));
  } finally {
    provider.close();
    await server.close();
  }
});
