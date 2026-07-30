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
const MDNS_RETRY_MS = 10000;  // mDNS 出错后隔多久重建发现服务（按次数递增退避）
const MDNS_MAX_RETRIES = 3;   // 最多重建几次，避免反复拆建反而发现不了对端
const PASSIVE_WAIT_MS = 12000; // 让对方先拨的礼让时间；超过就自己上（见 _tick）

function safeDecode(s) { try { return decodeURIComponent(s || ''); } catch (_) { return String(s || ''); } }

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
    this.mdnsRetryTimer = null;
    this.mdnsRetries = 0;
    this.peers = new Map();    // peerId(真实 deviceId) -> { ws, name }
    this.targets = new Map();  // 待连接目标 key -> { address, port, manual, dialing, ws, peerId }
    this.mismatched = new Map(); // 同步码对不上的设备 deviceId -> name（用来给用户明确提示，别让人干等）
  }

  start(cfg) {
    this.stop();
    if (!cfg || !cfg.code) { this.emit('status', this.getStatus()); return; }
    this.enabled = true;
    this.code = String(cfg.code);
    this.codeHash = hashCode(this.code);
    this.deviceId = cfg.deviceId;
    this.deviceName = cfg.deviceName || os.hostname();
    this._listen(cfg.port || 0, cfg);
  }

  // 监听端口；固定端口被占用时自动退回随机端口，保证同步始终能开起来
  _listen(port, cfg) {
    this.wss = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD });
    this.wss.on('error', (e) => {
      if (e && e.code === 'EADDRINUSE' && port !== 0) {
        try { this.wss.close(); } catch (_) {}
        this._listen(0, cfg);
      } else {
        this.emit('status', Object.assign(this.getStatus(), { error: '监听失败：' + e.message }));
      }
    });
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
    if (this.mdnsRetryTimer) clearTimeout(this.mdnsRetryTimer);
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

  // mDNS 只是"自动发现"的便利手段，它出问题绝不能拖垮整个应用：
  //  1) bonjour-service 一个 error 监听都不注册，而 multicast-dns 在 bind 失败 / EACCES /
  //     EADDRINUSE 时会 emit('error') —— 没人接就是主进程未捕获异常，
  //     用户会看到"A JavaScript error occurred in the main process"弹窗。
  //  2) 多网卡（Wi-Fi + 有线 / VPN）的机器上，某块网卡发不出组播会 EHOSTUNREACH，同理。
  // 出错后隔一会儿把发现服务整个重建：切网络、睡眠唤醒、网卡上下线之后能自动恢复广播，
  // 而不是像以前那样悄悄死掉、这台设备从此在局域网里"消失"。
  _guardMdns() {
    const mdns = this.bonjour && this.bonjour.server && this.bonjour.server.mdns;
    if (!mdns || typeof mdns.on !== 'function') return;
    // 'warning' 只是"这个组播包看不懂"之类的噪音 —— 局域网里打印机/投屏设备天天在发，
    // 只吞掉、绝不能拿它当故障去重建发现服务（否则会 10 秒拆一次，永远撑不到发现对端）。
    mdns.on('warning', () => {});
    // 'error' 才是真出事了（bind 失败 / EACCES / EADDRINUSE），这时候重建才有意义
    mdns.on('error', (err) => this._onMdnsIssue(err));
  }

  _onMdnsIssue(err) {
    const code = (err && err.code) || '';
    console.log('[sync] mDNS 出错：' + code + ' ' + ((err && err.message) || ''));
    if (this.mdnsRetryTimer || !this.enabled) return;
    if (this.mdnsRetries >= MDNS_MAX_RETRIES) {
      console.log('[sync] mDNS 已重建 ' + this.mdnsRetries + ' 次仍失败，放弃自动发现；' +
        '已连上的设备和「手动添加设备」不受影响');
      return;
    }
    this.mdnsRetries += 1;
    this.mdnsRetryTimer = setTimeout(() => {
      this.mdnsRetryTimer = null;
      if (this.enabled) this._restartDiscovery();
    }, MDNS_RETRY_MS * this.mdnsRetries);   // 退避，别死循环
  }

  _restartDiscovery() {
    console.log('[sync] 正在重建局域网发现服务……');
    try { if (this.browser) this.browser.stop(); } catch (_) {}
    try { if (this.publisher) this.publisher.stop(); } catch (_) {}
    try { if (this.bonjour) this.bonjour.destroy(); } catch (_) {}
    this.bonjour = null; this.publisher = null; this.browser = null;
    try { this._advertise(); this._browse(); }
    catch (e) { console.log('[sync] 重建发现服务失败：' + e.message); }
  }

  // ---- 广播自己（名字用完整 deviceId 保证唯一，避免"名字已被占用"）----
  _advertise() {
    this.bonjour = new Bonjour();
    this._guardMdns();
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
        // 同步码不一致 —— 以前直接静默跳过，界面永远停在"正在查找其它设备……"，
        // 用户根本不知道是码填错了。现在记下来，让界面明确提示。
        if (txt.code !== this.codeHash) {
          const name = safeDecode(txt.name);
          if (this.mismatched.get(txt.id) !== name) {
            this.mismatched.set(txt.id, name);
            this.emit('status', this.getStatus());
          }
          return;
        }
        if (this.mismatched.delete(txt.id)) this.emit('status', this.getStatus()); // 码改对了
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
    else this.targets.set(key, { address, port, manual, dialing: false, ws: null, peerId: peerId || null, politeSince: 0 });
  }

  // 尝试连接所有"该连但还没连上"的目标
  _tick() {
    if (!this.enabled) return;
    this.targets.forEach((t, key) => {
      if (t.ws || t.dialing) return;
      if (t.peerId && this.peers.has(t.peerId)) return;         // 已通过其它连接连上
      // mDNS 发现的目标：正常只让较小 deviceId 主动拨号，避免两边同时拨出一堆重复连接。
      // 但这会留下一个单点 —— 万一"该拨号的那一方"连不出去（防火墙、macOS 的
      // 「本地网络」权限没给、VPN 抢路由……），另一方就算完全正常也只会干等，
      // 整对设备永远连不上。所以礼让一段时间后，本机也主动拨。
      // 两边同时拨也没关系：_addPeer 会把重复的那条关掉，最终只留一条。
      if (!t.manual && this.deviceId >= key) {
        if (!t.politeSince) t.politeSince = Date.now();
        if (Date.now() - t.politeSince < PASSIVE_WAIT_MS) return;
      }
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
        if (this._addPeer(msg.id, safeDecode(msg.name), ws)) { t.ws = ws; t.peerId = msg.id; }
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
        this._addPeer(msg.id, safeDecode(msg.name), ws);
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
    this.mismatched.delete(peerId);
    this.peers.set(peerId, { ws, name });
    console.log('[sync] 已连接对端：' + name + ' (' + peerId + ')');
    this.emit('status', this.getStatus());
    this.emit('peer-connected', { peerId, name }); // 通知渲染层：给这个新对端发一份状态
    return true;
  }

  _removePeerByWs(ws) {
    const id = ws._peerId;
    // 断开后重新开始礼让计时：正常情况下仍然只有较小 deviceId 那方主动重连
    const t = id && this.targets.get(id);
    if (t) t.politeSince = 0;
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
      peers: Array.from(this.peers.entries()).map(([id, p]) => ({ id, name: p.name })),
      // 局域网里有这些设备，但同步码和本机不一样，连不上
      codeMismatch: Array.from(this.mismatched.entries()).map(([id, name]) => ({ id, name }))
    };
  }
}

module.exports = new SyncService();
module.exports.SyncService = SyncService; // 便于测试时实例化多个
