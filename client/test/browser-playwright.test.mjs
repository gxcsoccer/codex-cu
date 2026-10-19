import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { toPlaywrightChord, PlaywrightBrowserProvider, assertPlaywrightVersion, loadPlaywright } from '../src/browser-playwright.mjs';

test('toPlaywrightChord maps modifiers and keys', () => {
  assert.equal(toPlaywrightChord('cmd+shift+a'), 'Meta+Shift+A');
  assert.equal(toPlaywrightChord('ctrl+enter'), 'Control+Enter');
  assert.equal(toPlaywrightChord('arrowleft'), 'ArrowLeft');
  assert.equal(toPlaywrightChord('f5'), 'F5');
  assert.equal(toPlaywrightChord('escape'), 'Escape');
  assert.throws(() => toPlaywrightChord('hyper+x'), /unknown modifier/);
});

const endpoint = process.env.PLAYWRIGHT_CDP_ENDPOINT;

test('Playwright backend drives a real Chrome over CDP', { skip: !endpoint }, async () => {
  const provider = new PlaywrightBrowserProvider({ endpoint });
  const browser = await provider.getBrowser();
  const tab = await browser.createTab(`data:text/html,<title>Sample</title><button id=b onclick="this.textContent='Clicked'">Hello</button>`);
  try {
    assert.equal(await tab.title(), 'Sample');
    assert.match(await tab.url(), /^data:text\/html/);

    const axes = await tab.getAXState();
    assert.match(axes, /button Hello, ID: b/);
    const line = axes.split('\n').find((candidate) => candidate.includes('button Hello'));
    const index = Number(line.trim().split(' ')[0]);
    await tab.click(index);
    assert.equal(await tab.playwright.locator('#b').textContent(), 'Clicked');

    const shot = await tab.screenshot();
    assert.equal(shot[0], 0x89);
    assert.ok((await tab.domSnapshot()).includes('<button'));

    await tab.playwright.getByRole('button', { name: 'Clicked' }).click();
  } finally {
    await tab.close();
    await provider.close();
  }
});

test('paste uses the clipboard on a secure origin', { skip: !endpoint }, async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<title>Paste</title><input id=i>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const provider = new PlaywrightBrowserProvider({ endpoint });
  const browser = await provider.getBrowser();
  try {
    const tab = await browser.createTab(`${origin}/`);
    const axes = await tab.getAXState();
    const line = axes.split('\n').find((candidate) => candidate.includes('textbox'));
    const index = Number(line.trim().split(' ')[0]);
    await tab.paste(index, 'pasted text');
    assert.equal(await tab.playwright.locator('#i').inputValue(), 'pasted text');
    assert.equal(await tab.page.evaluate(() => navigator.clipboard.readText()), 'pasted text');
    await tab.close();
  } finally {
    await provider.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('iframe content is visible in AX and clickable by index', { skip: !endpoint }, async () => {
  const provider = new PlaywrightBrowserProvider({ endpoint });
  const browser = await provider.getBrowser();
  const tab = await browser.createTab('data:text/html,<title>Frames</title><iframe srcdoc="<button id=in>Inside</button>"></iframe>');
  try {
    const frame = tab.page.frames()[1];
    await frame.evaluate(() => document.getElementById('in').addEventListener('click', (event) => { event.target.textContent = 'Hit'; }));
    const axes = await tab.getAXState();
    assert.match(axes, /button Inside/);
    const line = axes.split('\n').find((candidate) => candidate.includes('button Inside'));
    const index = Number(line.trim().split(' ')[0]);
    await tab.click(index);
    assert.equal(await frame.locator('#in').textContent(), 'Hit');
  } finally {
    await tab.close();
    await provider.close();
  }
});

test('cross-origin iframe (OOPIF) AX merges and clicks', { skip: !endpoint }, async () => {
  const inner = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<title>Inner</title><button id=in>Inner Button</button>');
  });
  const outer = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<title>Outer</title><iframe style="margin:20px" src="http://127.0.0.1:${inner.address().port}/"></iframe>`);
  });
  await new Promise((resolve) => inner.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => outer.listen(0, '0.0.0.0', resolve));
  const provider = new PlaywrightBrowserProvider({ endpoint });
  const browser = await provider.getBrowser();
  try {
    const tab = await browser.createTab(`http://localhost:${outer.address().port}/`);
    await tab.page.waitForTimeout(400);
    const frame = tab.page.frames()[1];
    await frame.evaluate(() => document.getElementById('in').addEventListener('click', (event) => { event.target.textContent = 'Hit'; }));
    const axes = await tab.getAXState();
    assert.match(axes, /button Inner Button/);
    const line = axes.split('\n').find((candidate) => candidate.includes('button Inner Button'));
    const index = Number(line.trim().split(' ')[0]);
    await tab.click(index);
    assert.equal(await frame.locator('#in').textContent(), 'Hit');
    await tab.close();
  } finally {
    await provider.close();
    await new Promise((resolve) => inner.close(resolve));
    await new Promise((resolve) => outer.close(resolve));
  }
});

test('nested cross-site iframes merge recursively', { skip: !endpoint }, async () => {
  const deep = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<title>Deep</title><button id=deep>Deep Button</button>');
  });
  const middle = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<title>Middle</title><iframe src="http://localhost:${deep.address().port}/"></iframe>`);
  });
  const outer = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<title>Outer</title><iframe src="http://127.0.0.1:${middle.address().port}/"></iframe>`);
  });
  await new Promise((resolve) => deep.listen(0, '0.0.0.0', resolve));
  await new Promise((resolve) => middle.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => outer.listen(0, '0.0.0.0', resolve));
  const provider = new PlaywrightBrowserProvider({ endpoint });
  const browser = await provider.getBrowser();
  try {
    const tab = await browser.createTab(`http://localhost:${outer.address().port}/`);
    await tab.page.waitForTimeout(700);
    const deepFrame = tab.page.frames().find((frame) => frame.url().includes(String(deep.address().port)));
    await deepFrame.evaluate(() => document.getElementById('deep').addEventListener('click', (event) => { event.target.textContent = 'Hit'; }));
    const axes = await tab.getAXState();
    assert.match(axes, /button Deep Button/);
    const line = axes.split('\n').find((candidate) => candidate.includes('button Deep Button'));
    const index = Number(line.trim().split(' ')[0]);
    await tab.click(index);
    assert.equal(await deepFrame.locator('#deep').textContent(), 'Hit');
    await tab.close();
  } finally {
    await provider.close();
    await new Promise((resolve) => deep.close(resolve));
    await new Promise((resolve) => middle.close(resolve));
    await new Promise((resolve) => outer.close(resolve));
  }
});

test('Playwright version is pinned and drift fails closed', () => {
  const saved = process.env.CODEX_CU_ALLOW_PLAYWRIGHT_DRIFT;
  try {
    delete process.env.CODEX_CU_ALLOW_PLAYWRIGHT_DRIFT;
    assert.equal(assertPlaywrightVersion('1.57.0', 'test'), '1.57.0');
    assert.throws(() => assertPlaywrightVersion('1.58.0', 'test'), /does not match the pinned/);
    process.env.CODEX_CU_ALLOW_PLAYWRIGHT_DRIFT = '1';
    assert.equal(assertPlaywrightVersion('1.58.0', 'test'), '1.58.0');
  } finally {
    if (saved === undefined) delete process.env.CODEX_CU_ALLOW_PLAYWRIGHT_DRIFT;
    else process.env.CODEX_CU_ALLOW_PLAYWRIGHT_DRIFT = saved;
  }
});

test('three levels of nested cross-site iframes merge and click', { skip: !endpoint }, async () => {
  const level4 = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<title>L4</title><button id=deep>L4 Button</button>');
  });
  const level3 = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<title>L3</title><iframe src="http://127.0.0.1:${level4.address().port}/"></iframe>`);
  });
  const level2 = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<title>L2</title><iframe src="http://localhost:${level3.address().port}/"></iframe>`);
  });
  const level1 = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<title>L1</title><iframe src="http://127.0.0.1:${level2.address().port}/"></iframe>`);
  });
  await new Promise((resolve) => level4.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => level3.listen(0, '0.0.0.0', resolve));
  await new Promise((resolve) => level2.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => level1.listen(0, '0.0.0.0', resolve));
  const provider = new PlaywrightBrowserProvider({ endpoint });
  const browser = await provider.getBrowser();
  try {
    const tab = await browser.createTab(`http://localhost:${level1.address().port}/`);
    await tab.page.waitForTimeout(1200);
    const deepFrame = tab.page.frames().find((frame) => frame.url().includes(String(level4.address().port)));
    assert.ok(deepFrame, 'deep frame loaded');
    await deepFrame.evaluate(() => document.getElementById('deep').addEventListener('click', (event) => { event.target.textContent = 'Hit'; }));

    const first = await tab.getAXState({ disableDiff: true });
    assert.match(first, /button L4 Button/);
    const line = first.split('\n').find((candidate) => candidate.includes('button L4 Button'));
    const index = Number(line.trim().split(' ')[0]);
    const second = await tab.getAXState({ disableDiff: true });
    const secondLine = second.split('\n').find((candidate) => candidate.includes('button L4 Button'));
    assert.equal(Number(secondLine.trim().split(' ')[0]), index, 'frame offset is stable');

    await tab.click(index);
    assert.equal(await deepFrame.locator('#deep').textContent(), 'Hit');
    await tab.close();
  } finally {
    await provider.close();
    await Promise.all([level1, level2, level3, level4].map((server) => new Promise((resolve) => server.close(resolve))));
  }
});
