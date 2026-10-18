import net from 'node:net';
import { encodeFrame, FrameDecoder } from './framing.mjs';
import { CodexCuError, ProtocolError } from './errors.mjs';

export const API_VERSION = 'CodexComputerUseIPC-5';

export const REQUEST_TYPES = {
  listApps: 'ComputerUseIPCListAppsRequest',
  appStart: 'ComputerUseIPCAppStartRequest',
  appGetSkyshot: 'ComputerUseIPCAppGetSkyshotRequest',
  appPolicy: 'ComputerUseIPCAppPolicyRequest',
  performAction: 'ComputerUseIPCAppPerformActionRequest',
  startAudio: 'ComputerUseIPCStartAudioRecordingRequest',
  stopAudio: 'ComputerUseIPCStopAudioRecordingRequest',
};

const MOUSE_BUTTONS = { left: 0, l: 0, right: 1, r: 1, middle: 2, m: 2 };

export function elementTarget({ elementIndex, x, y }) {
  if (elementIndex !== undefined && elementIndex !== null) {
    if (!Number.isInteger(elementIndex)) throw new TypeError('elementIndex must be an integer');
    return { elementID: { _0: String(elementIndex) } };
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('coordinate target needs finite x/y');
  return { coordinate: { _0: [Number(x), Number(y)] } };
}

export function mouseButton(value = 'left') {
  if (typeof value === 'number') {
    if ([0, 1, 2].includes(value)) return value;
    throw new TypeError('mouseButton number must be 0, 1, or 2');
  }
  const normalized = String(value).trim().toLowerCase();
  if (!(normalized in MOUSE_BUTTONS)) throw new TypeError('mouseButton must be left/right/middle');
  return MOUSE_BUTTONS[normalized];
}

export class Client {
  constructor({ socketPath, apiVersion = API_VERSION, timeoutMs = 120_000, connectTimeoutMs = 5_000, now = Date.now } = {}) {
    this.socketPath = socketPath;
    this.apiVersion = apiVersion;
    this.timeoutMs = timeoutMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.now = now;
    this.nextId = 1;
    this.pending = new Map();
    this.decoder = new FrameDecoder();
    this.socket = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected) return this;
    const socket = net.createConnection({ path: this.socketPath });
    this.socket = socket;
    socket.on('data', (chunk) => {
      let messages;
      try {
        messages = this.decoder.push(chunk);
      } catch (error) {
        this.failAll(error);
        socket.destroy();
        return;
      }
      for (const message of messages) this.dispatch(message);
    });
    socket.on('error', (error) => this.failAll(error));
    socket.on('close', () => { this.connected = false; this.failAll(new Error('socket closed')); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('connect timeout')); }, this.connectTimeoutMs);
      socket.once('connect', () => { clearTimeout(timer); this.connected = true; resolve(); });
      socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    return this;
  }

  dispatch(message) {
    if (typeof message?.id !== 'number') return; // notifications are ignored, like the original client
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    const hasResult = Object.prototype.hasOwnProperty.call(message, 'result');
    const hasError = Object.prototype.hasOwnProperty.call(message, 'error');
    if (hasResult === hasError) {
      pending.reject(new ProtocolError('invalid JSON-RPC response: exactly one of result/error required'));
      return;
    }
    if (hasError) {
      pending.reject(new CodexCuError({
        code: message.error?.code,
        message: message.error?.message,
        requestType: pending.requestType,
        request: pending.request,
      }));
      return;
    }
    pending.resolve(message.result);
  }

  failAll(error) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params, { timeoutMs = this.timeoutMs } = {}) {
    if (!this.socket) throw new Error('not connected');
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs) : null;
      this.pending.set(id, { resolve, reject, timer, requestType: params?.requestType, request: params?.request });
      this.socket.write(encodeFrame(payload));
    });
  }

  async ping() {
    await this.connect();
    const result = await this.send('ping', { clientApiVersion: this.apiVersion });
    if (result?.serverApiVersion !== this.apiVersion) {
      throw new ProtocolError(`API version mismatch: client=${this.apiVersion} server=${result?.serverApiVersion}`);
    }
    return result;
  }

  async request(requestType, request, { timeoutSeconds = 120, metadata } = {}) {
    await this.connect();
    const params = {
      clientApiVersion: this.apiVersion,
      codexTurnMetadata: metadata,
      deadlineUnixMilliseconds: this.now() + timeoutSeconds * 1000,
      request,
      requestType,
    };
    if (metadata === undefined) delete params.codexTurnMetadata;
    return this.send('request', params);
  }

  listApps() { return this.request(REQUEST_TYPES.listApps, {}); }
  startApp(app) { return this.request(REQUEST_TYPES.appStart, { app }); }
  getAppState(app, { disableDiff } = {}) {
    const request = typeof app === 'string' ? { app } : { app: app.app };
    if (disableDiff !== undefined) request.disableDiff = disableDiff;
    return this.request(REQUEST_TYPES.appGetSkyshot, request);
  }
  getAppPolicy(app) { return this.request(REQUEST_TYPES.appPolicy, { app }); }
  performAction(app, action) { return this.request(REQUEST_TYPES.performAction, { app, action }); }

  click({ app, elementIndex, x, y, clickCount = 1, mouseButton: button = 'left', key, duration }) {
    return this.performAction(app, {
      click: { at: elementTarget({ elementIndex, x, y }), clickCount, mouseButton: mouseButton(button), key, duration },
    });
  }

  drag({ app, fromX, fromY, toX, toY }) {
    return this.performAction(app, {
      drag: { from: { _0: [Number(fromX), Number(fromY)] }, to: { _0: [Number(toX), Number(toY)] } },
    });
  }

  paste({ app, text, format }) { return this.performAction(app, { paste: { text, format } }); }

  pressKey({ app, key, duration }) {
    if (!String(key).trim()) throw new TypeError('key is required');
    return this.performAction(app, { pressKey: { _0: key, duration } });
  }

  scroll({ app, elementIndex, x, y, direction = 'down', pages = 1 }) {
    return this.performAction(app, {
      scroll: { at: elementTarget({ elementIndex, x, y }), direction, pages },
    });
  }

  selectText({ app, elementIndex, text, prefix, suffix, selection = 'text' }) {
    return this.performAction(app, {
      selectText: { elementID: String(elementIndex), text, prefix, suffix, selection },
    });
  }

  setValue({ app, elementIndex, value }) {
    return this.performAction(app, { setValue: { elementID: String(elementIndex), value } });
  }

  typeText({ app, text }) { return this.performAction(app, { type: { _0: text } }); }

  performSecondaryAction({ app, elementIndex, action }) {
    return this.performAction(app, { performSecondaryAction: { action, elementID: String(elementIndex) } });
  }

  close() {
    if (this.socket) this.socket.destroy();
    this.connected = false;
  }
}
