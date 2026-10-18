// Minimal Chrome DevTools Protocol client: JSON-RPC over WebSocket, with
// flattened sessions so one socket can drive several targets.
export class CdpConnection {
  constructor(webSocket, { timeoutMs = 15_000 } = {}) {
    this.ws = webSocket;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    this.ws.addEventListener('message', (event) => this.onMessage(event));
    this.ws.addEventListener('close', () => this.close());
  }

  static async connect(url, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 15_000 } = {}) {
    if (!WebSocketImpl) throw new Error('WebSocket is not available in this runtime');
    const socket = new WebSocketImpl(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timeout: ${url}`)), timeoutMs);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`CDP connect failed: ${url}`)); }, { once: true });
    });
    return new CdpConnection(socket, { timeoutMs });
  }

  onMessage(event) {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else resolve(message.result);
      return;
    }
    if (message.method) {
      for (const handler of this.listeners.get(message.method) ?? []) handler(message.params, message.sessionId);
    }
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(handler);
    return () => this.listeners.get(method)?.delete(handler);
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('CDP connection closed'));
    }
    this.pending.clear();
    try { this.ws.close(); } catch { /* ignore */ }
  }
}
