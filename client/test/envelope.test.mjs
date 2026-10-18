import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client } from '../src/client.mjs';
import { elementTarget, mouseButton } from '../src/client.mjs';
import { startMockServer } from './helpers/mock-server.mjs';

async function capture(build, { now = () => 1000 } = {}) {
  const mock = await startMockServer(() => ({ result: {} }));
  const client = new Client({ socketPath: mock.socketPath, now });
  try {
    await build(client);
    await new Promise((resolve) => setImmediate(resolve));
    return mock.requests[0];
  } finally {
    client.close();
    await mock.close();
  }
}

test('click-by-element matches the golden frame', async () => {
  const sent = await capture((client) => client.click({ app: 'com.apple.finder', elementIndex: 42 }));
  const golden = JSON.parse(fs.readFileSync(new URL('../../fixtures/frames/perform-action-click-element.json', import.meta.url)));
  assert.deepEqual(sent, golden);
});

test('coordinate click and right button encoding', async () => {
  const sent = await capture((client) => client.click({ app: 'a', x: 640, y: 480, mouseButton: 'right' }));
  assert.deepEqual(sent.params.request.action.click.at, { coordinate: { _0: [640, 480] } });
  assert.equal(sent.params.request.action.click.mouseButton, 1);
});

test('action encodings match the original client serializer', async () => {
  const press = await capture((client) => client.pressKey({ app: 'a', key: 'cmd+shift+g' }));
  assert.deepEqual(press.params.request.action, { pressKey: { _0: 'cmd+shift+g' } });

  const type = await capture((client) => client.typeText({ app: 'a', text: '你好' }));
  assert.deepEqual(type.params.request.action, { type: { _0: '你好' } });

  const scroll = await capture((client) => client.scroll({ app: 'a', elementIndex: 7, direction: 'down', pages: 2 }));
  assert.deepEqual(scroll.params.request.action, {
    scroll: { at: { elementID: { _0: '7' } }, direction: 'down', pages: 2 },
  });

  const select = await capture((client) => client.selectText({ app: 'a', elementIndex: 9, text: 'x' }));
  assert.deepEqual(select.params.request.action, {
    selectText: { elementID: '9', text: 'x', selection: 'text' },
  });

  const secondary = await capture((client) => client.performSecondaryAction({ app: 'a', elementIndex: 3, action: 'Raise' }));
  assert.deepEqual(secondary.params.request.action, {
    performSecondaryAction: { action: 'Raise', elementID: '3' },
  });

  const drag = await capture((client) => client.drag({ app: 'a', fromX: 1, fromY: 2, toX: 3, toY: 4 }));
  assert.deepEqual(drag.params.request.action, { drag: { from: { _0: [1, 2] }, to: { _0: [3, 4] } } });
});

test('element IDs are serialized as strings and mouse buttons as numbers', () => {
  assert.deepEqual(elementTarget({ elementIndex: 5 }), { elementID: { _0: '5' } });
  assert.equal(mouseButton('left'), 0);
  assert.equal(mouseButton('r'), 1);
  assert.equal(mouseButton(2), 2);
  assert.throws(() => mouseButton('side'), /mouseButton/);
  assert.throws(() => elementTarget({ elementIndex: 1.5 }), /elementIndex/);
});

test('codexTurnMetadata is only included when provided', async () => {
  const without = await capture((client) => client.listApps());
  assert.equal('codexTurnMetadata' in without.params, false);

  const withMeta = await capture((client) => client.request('ComputerUseIPCListAppsRequest', {}, { metadata: { turn: 't1' } }));
  assert.deepEqual(withMeta.params.codexTurnMetadata, { turn: 't1' });
});
