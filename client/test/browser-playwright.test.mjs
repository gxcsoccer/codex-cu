import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { toPlaywrightChord, PlaywrightBrowserProvider } from '../src/browser-playwright.mjs';

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
