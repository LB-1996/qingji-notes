// 局域网同步 —— 主进程网络层。
// 只负责：设备发现(mDNS) + 连接(带重连) + 同步码校验 + 在"渲染层协议消息"和"对端"之间中继。
// 所有数据合并逻辑放在渲染层，这里是一根带自愈的"网线"。
const { EventEmitter } = require('events');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { Bonjour } = require('bonjour-service');

const SERVICE_TYPE = 'qingjisync';
const MAX_PAYLOAD = 128 * 1024 * 1024; // 128MB，容纳带图片的笔记
const RETRY_MS = 4000;

function hashCode(code) {
  return crypto.createHash('sha256').update('qingji-sync::' + String(code)).digest('hex').slice(0, 16);
}

class SyncService extends EventEmitter {
  constructor() {
    super();
    this._reset();
  }

  _reset() {
    this.enabled = false;
    this.code = '';
    this.codeHash = '';
    this.deviceId = '';
    this.deviceName = '';
    this.port = 0;
    this.wss = null;
    this.bonjour = null;
    this.publisher = null;
    this.browser = null;
    this.retryTimer = null;
    this.peers = new Map();    // peerId(真实 deviceId) -> { ws, name }
    this.targets = new Map();  // 待连接目标 key -> { address, port, manual, dialing, ws, peerId }
  }

  start(cfg) {
    this.stop();
    if (!cfg || !cfg.code) { this.emit('status', this.getStatus()); return; }
    this.enabled = true;
    this.code = String(cfg.code);
    this.codeHash = hashCode(this.code);
    this.deviceId = cfg.deviceId;
    this.deviceName = cfg.deviceName || os.hostname();

    this.wss = new WebSocketServer({ port: cfg.port || 0, maxPayload: MAX_PAYLOAD });
    this.wss.on('error', (e) => this.emit('status', Object.assign(this.getStatus(), { error: '监听失败：' + e.message })));
    this.wss.on('connection', (ws) => this._onServerConnection(ws));
    this.wss.on('listening', () => {
      this.port = this.wss.address().port;
      try { this._advertise(); this._browse(); } catch (e) { this.emit('status', Object.assign(this.getStatus(), { error: '发现服务启动失败：' + e.message })); }
      (Array.isArray(cfg.manualPeers) ? cfg.manualPeers : []).forEach((hp) => this._addManual(hp));
      this._tick();
      this.retryTimer = setInterval(() => this._tick(), RETRY_MS); // 定时重连未连上的目标
      this.emit('status', this.getStatus());
    });
  }

  stop() {
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.peers.forEach((p) => { try { p.ws.close(); } catch (_) {} });
    this.targets.forEach((t) => { if (t.ws) { try { t.ws.close(); } catch (_) {} } });
    try { if (this.browser) this.browser.stop(); } catch (_) {}
    try { if (this.publisher) this.publisher.stop(); } catch (_) {}
    try { if (this.bonjour) this.bonjour.destroy(); } catch (_) {}
    try { if (this.wss) this.wss.close(); } catch (_) {}
    const wasEnabled = this.enabled;
    this._reset();
    if (wasEnabled) this.emit('status', this.getStatus());
  }

  // ---- 广播自己（名字用完整 deviceId 保证唯一，避免"名字已被占用"）----
  _advertise() {
    this.bonjour = new Bonjour();
    this.publisher = this.bonjour.publish({
      name: 'qingji-' + this.deviceId,
      type: SERVICE_TYPE,
      port: this.port,
      txt: { id: this.deviceId, name: encodeURIComponent(this.deviceName), code: this.codeHash }
    });
  }

  // ---- 发现同"同步码"的其它设备 → 记为待连接目标 ----
  _browse() {
    this.browser = this.bonjour.find({ type: SERVICE_TYPE }, (service) => {
      try {
        const txt = service.txt || {};
        if (!txt.id || txt.id === this.deviceId) return; // 跳过自己
        if (txt.code !== this.codeHash) return;          // 不同同步组
        const address = this._pickAddress(service);
        if (!address) return;
        this._addTarget(txt.id, address, service.port, false, txt.id);
        this._tick();
      } catch (_) {}
    });
  }

  _pickAddress(service) {
    const addrs = service.addresses || [];
    const ipv4 = addrs.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
    return ipv4 || addrs[0] || (service.referer && service.referer.address) || null;
  }

  _addManual(hp) {
    const s = String(hp).trim();
    const idx = s.lastIndexOf(':');
    if (idx <= 0) return;
    const address = s.slice(0, idx);
    const port = parseInt(s.slice(idx + 1), 10);
    if (address && port) this._addTarget('manual:' + s, address, port, true, null);
  }

  _addTarget(key, address, port, manual, peerId) {
    const ex = this.targets.get(key);
    if (ex) { ex.address = address; ex.port = port; }
    else this.targets.set(key, { address, port, manual, dialing: false, ws: null, peerId: peerId || null });
  }

  // 尝试连接所有"该连但还没连上"的目标
  _tick() {
    if (!this.enabled) return;
    this.targets.forEach((t, key) => {
      if (t.ws || t.dialing) return;
      if (t.peerId && this.peers.has(t.peerId)) return;         // 已通过其它连接连上
      if (!t.manual && this.deviceId >= key) return;            // mDNS：只让较小 deviceId 主动拨号
      this._dial(key, t);
    });
  }

  _dial(key, t) {
    t.dialing = true;
    let ws;
    try { ws = new WebSocket('ws://' + t.address + ':' + t.port, { maxPayload: MAX_PAYLOAD, handshakeTimeout: 5000 }); }
    catch (_) { t.dialing = false; return; }
    ws._authed = false;
    ws.on('open', () => {
      try { ws.send(JSON.stringify({ type: '__hello', id: this.deviceId, name: encodeURIComponent(this.deviceName), code: this.codeHash })); } catch (_) {}
    });
    ws.on('message', (raw) => {
      if (!ws._authed) {
        let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return ws.close(); }
        if (msg.type !== '__hello_ok' || !msg.id || msg.id === this.deviceId) return ws.close();
        ws._authed = true;
        t.dialing = false;
        if (this._addPeer(msg.id, decodeURIComponent(msg.name || ''), ws)) { t.ws = ws; t.peerId = msg.id; }
      } else if (ws._peerId) {
        this.emit('message', { peerId: ws._peerId, data: raw.toString() });
      }
    });
    ws.on('close', () => { t.dialing = false; t.ws = null; this._removePeerByWs(ws); });
    ws.on('error', () => { t.dialing = false; });
  }

  _onServerConnection(ws) {
    ws._authed = false;
    ws.on('message', (raw) => {
      if (!ws._authed) {
        let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return ws.close(); }
        if (msg.type !== '__hello' || msg.code !== this.codeHash || !msg.id || msg.id === this.deviceId) return ws.close();
        try { ws.send(JSON.stringify({ type: '__hello_ok', id: this.deviceId, name: encodeURIComponent(this.deviceName) })); } catch (_) {}
        ws._authed = true;
        this._addPeer(msg.id, decodeURIComponent(msg.name || ''), ws);
      } else if (ws._peerId) {
        this.emit('message', { peerId: ws._peerId, data: raw.toString() });
      }
    });
    ws.on('close', () => this._removePeerByWs(ws));
    ws.on('error', () => {});
  }

  _addPeer(peerId, name, ws) {
    if (!peerId || peerId === this.deviceId) { try { ws.close(); } catch (_) {} return false; }
    const existing = this.peers.get(peerId);
    if (existing && existing.ws !== ws) { try { ws.close(); } catch (_) {} return false; } // 已有连接，关掉重复的
    ws._peerId = peerId;
    this.peers.set(peerId, { ws, name });
    console.log('[sync] 已连接对端：' + name + ' (' + peerId + ')');
    this.emit('status', this.getStatus());
    this.emit('peer-connected', { peerId, name }); // 通知渲染层：给这个新对端发一份状态
    return true;
  }

  _removePeerByWs(ws) {
    const id = ws._peerId;
    if (id && this.peers.get(id) && this.peers.get(id).ws === ws) {
      this.peers.delete(id);
      this.emit('status', this.getStatus());
      this.emit('peer-disconnected', { peerId: id });
    }
  }

  // ---- 发送（data 是渲染层拼好的 JSON 字符串）----
  sendTo(peerId, data) {
    const p = this.peers.get(peerId);
    if (p && p.ws.readyState === WebSocket.OPEN) { try { p.ws.send(data); } catch (_) {} }
  }
  broadcast(data) {
    this.peers.forEach((p) => { if (p.ws.readyState === WebSocket.OPEN) { try { p.ws.send(data); } catch (_) {} } });
  }

  getStatus() {
    return {
      enabled: this.enabled,
      port: this.port,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      peers: Array.from(this.peers.entries()).map(([id, p]) => ({ id, name: p.name }))
    };
  }
}

module.exports = new SyncService();
module.exports.SyncService = SyncService; // 便于测试时实例化多个
