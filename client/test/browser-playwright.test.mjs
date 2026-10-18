import test from 'node:test';
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
  const tab = await browser.createTab('data:text/html,<title>Sample</title><button id=b>Hello</button>');
  try {
    assert.equal(await tab.title(), 'Sample');
    assert.match(await tab.url(), /^data:text\/html/);

    await tab.playwright.getByRole('button', { name: 'Hello' }).click();
    const axes = await tab.getAXState();
    assert.match(axes, /button/i);

    const shot = await tab.screenshot();
    assert.equal(shot[0], 0x89);
    assert.ok((await tab.domSnapshot()).includes('<button'));

    await tab.playwright.locator('#b').click();
    assert.equal(await tab.playwright.locator('#b').textContent(), 'Hello');
  } finally {
    await tab.close();
    await provider.close();
  }
});
