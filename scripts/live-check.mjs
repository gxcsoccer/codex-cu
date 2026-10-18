#!/usr/bin/env node
// Runs the live verification checklist against a real service socket.
// Permission-bound checks are reported as SKIP with the exact error, never as
// false passes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '../client/src/client.mjs';
import { CdpBrowserProvider } from '../client/src/browser.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runLiveChecks({
  socketPath,
  app = 'com.apple.finder',
  audio = false,
  browserEndpoint,
  log = () => {},
}) {
  const results = [];
  const add = (name, status, detail = '') => { results.push({ name, status, detail }); };
  const client = new Client({ socketPath, timeoutMs: 8000 });

  try {
    try {
      await client.ping();
      add('ping', 'pass', 'CodexComputerUseIPC-5');
    } catch (error) {
      add('ping', 'fail', error.message);
      return results;
    }

    try {
      const { apps } = await client.listApps();
      add('listApps', apps.length > 0 ? 'pass' : 'skip', `${apps.length} apps`);
    } catch (error) {
      add('listApps', 'fail', error.message);
    }

    let state = null;
    try {
      state = await client.getAppState(app);
      add('getAppState', 'pass', state.text?.includes('Window:') ? 'Window header present' : 'no Window header');
    } catch (error) {
      add('getAppState', [-10007, -10009].includes(error.code) ? 'skip' : 'fail', error.message);
    }

    const shotURL = state?.skyshot?.screenshot?.url;
    if (!shotURL) {
      add('screenshot', 'skip', 'no skyshot (Screen Recording not granted?)');
    } else {
      try {
        const bytes = readFileSync(fileURLToPath(shotURL));
        add('screenshot', bytes[0] === 0x89 && bytes[1] === 0x50 ? 'pass' : 'fail', `${bytes.length} bytes`);
      } catch (error) {
        add('screenshot', 'fail', error.message);
      }
    }

    if (!audio) {
      add('audio', 'skip', 'not requested (pass --audio)');
    } else {
      try {
        await client.startAudioRecording({ maxDurationMilliseconds: 300 });
        await sleep(600);
        const { url } = await client.stopAudioRecording();
        const bytes = readFileSync(fileURLToPath(url));
        const riff = bytes.subarray(0, 4).toString('ascii') === 'RIFF';
        const wave = bytes.subarray(8, 12).toString('ascii') === 'WAVE';
        const rate = bytes.readUInt32LE(24);
        const channels = bytes.readUInt16LE(22);
        add('audio', riff && wave && rate === 24000 && channels === 2 ? 'pass' : 'fail',
          `${bytes.length} bytes, ${rate} Hz, ${channels} ch`);
      } catch (error) {
        add('audio', error.code === -10009 ? 'skip' : 'fail', error.message);
      }
    }

    if (!browserEndpoint) {
      add('browser', 'skip', 'no --browser endpoint');
    } else {
      const provider = new CdpBrowserProvider({ endpoint: browserEndpoint });
      try {
        const browser = await provider.getBrowser({ id: 'cdp' });
        const tab = await browser.createTab('data:text/html,<h1>codex-cu live check</h1>');
        const text = await tab.getAXState();
        add('browser', text.includes('codex-cu live check') ? 'pass' : 'fail', `${text.split('\n').length} AX lines`);
        await tab.close();
      } catch (error) {
        add('browser', 'fail', error.message);
      } finally {
        provider.close();
      }
    }
  } finally {
    client.close();
  }
  for (const result of results) log(`${result.status.toUpperCase().padEnd(4)} ${result.name}: ${result.detail}`);
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const results = await runLiveChecks({
    socketPath: flag('--socket', process.env.CODEX_CU_SOCKET ?? '/tmp/codex-cu.sock'),
    app: flag('--app', 'com.apple.finder'),
    audio: args.includes('--audio'),
    browserEndpoint: flag('--browser'),
    log: console.log,
  });
  process.exit(results.some((result) => result.status === 'fail') ? 1 : 0);
}
