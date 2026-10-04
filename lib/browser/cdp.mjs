export class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.listeners = {
      message: (event) => {
        let message;
        try { message = JSON.parse(event.data); }
        catch { return this.close(new Error("浏览器调试连接返回了无效 JSON")); }
        if (!message?.id) return;
        this.settle(message.id, message.error ? new Error(message.error.message) : null, message.result);
      },
      close: () => this.close(new Error("浏览器调试连接已断开")),
      error: () => this.close(new Error("浏览器调试连接发生错误")),
    };
    for (const [type, listener] of Object.entries(this.listeners)) socket.addEventListener(type, listener);
  }

  static async connect(url, { WebSocketImpl = WebSocket, timeout = 5000 } = {}) {
    const socket = new WebSocketImpl(url);
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        socket.removeEventListener("open", opened);
        socket.removeEventListener("error", failed);
        socket.removeEventListener("close", failed);
        if (!error) return resolve();
        try { socket.close(); } catch { /* A failed socket may already be closed. */ }
        reject(error);
      };
      const opened = () => finish();
      const failed = () => finish(new Error("无法连接 Edge 调试端口"));
      const timer = setTimeout(() => finish(new Error("连接 Edge 调试端口超时")), timeout);
      socket.addEventListener("open", opened);
      socket.addEventListener("error", failed);
      socket.addEventListener("close", failed);
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}, timeout = 20000) {
    if (this.closed) return Promise.reject(new Error("浏览器调试连接已关闭"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(id, new Error(`${method} 执行超时`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { this.close(error); }
    });
  }

  settle(id, error, result) {
    const request = this.pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(id);
    if (error) request.reject(error);
    else request.resolve(result);
  }

  close(error = new Error("浏览器调试连接已关闭")) {
    if (this.closed) return;
    this.closed = true;
    for (const [type, listener] of Object.entries(this.listeners)) this.socket.removeEventListener(type, listener);
    for (const id of this.pending.keys()) this.settle(id, error);
    try { this.socket.close(); } catch { /* All requests have already been settled. */ }
  }
}
