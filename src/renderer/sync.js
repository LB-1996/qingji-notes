/* ============================================================
   局域网同步 —— 渲染层。
   负责：配置管理、连接后交换全量状态、按「最后修改时间」(LWW) 合并、广播本地改动。
   主进程只做网络中继，合并逻辑全在这里。
   ============================================================ */
const Sync = (() => {
  const CFG_KEY = 'qingji-sync-cfg';
  const ID_KEY = 'qingji-device-id';

  let hooks = null;            // { getData, applyIncoming, onStatusChange }
  let deviceId = '';
  let cfg = { enabled: false, code: '', deviceName: '', manualPeers: [] };
  let status = { enabled: false, peers: [] };
  let forcePort = 0; // 测试用固定端口，正式使用为 0（随机）

  const api = () => (window.notesAPI && window.notesAPI.sync) || null;
  const available = () => !!api();

  function defaultDeviceName() {
    const p = (window.notesAPI && window.notesAPI.platform) || '';
    if (p === 'darwin') return 'Mac';
    if (p === 'win32') return 'Windows 电脑';
    return '我的设备';
  }

  function loadConfig() {
    deviceId = localStorage.getItem(ID_KEY);
    if (!deviceId) {
      deviceId = 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(ID_KEY, deviceId);
    }
    try {
      const saved = JSON.parse(localStorage.getItem(CFG_KEY));
      if (saved) cfg = Object.assign(cfg, saved);
    } catch (_) {}
    if (!cfg.deviceName) cfg.deviceName = defaultDeviceName();
    if (!Array.isArray(cfg.manualPeers)) cfg.manualPeers = [];
  }
  function saveConfig() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

  function init(h) {
    hooks = h;
    loadConfig();
    if (!available()) return; // 浏览器预览：无同步能力
    // 测试钩子：环境变量 QINGJI_SYNC 自动配置并开启
    const auto = window.notesAPI.autoSync;
    if (auto && auto.code) {
      cfg.code = auto.code;
      if (auto.deviceName) cfg.deviceName = auto.deviceName;
      if (Array.isArray(auto.peers)) cfg.manualPeers = auto.peers;
      forcePort = auto.port || 0;
      cfg.enabled = true;
      saveConfig();
    }
    const s = api();
    s.onStatus((st) => { status = st || { enabled: false, peers: [] }; if (hooks.onStatusChange) hooks.onStatusChange(status); });
    s.onPeerConnected((p) => sendFullState(p.peerId)); // 新对端连上 → 把本机整份状态发过去
    s.onMessage((m) => handleMessage(m.peerId, m.data));
    if (cfg.enabled && cfg.code) start();
  }

  function start() {
    if (!available() || !cfg.code) return;
    cfg.enabled = true; saveConfig();
    api().start({ code: cfg.code, deviceId, deviceName: cfg.deviceName, manualPeers: cfg.manualPeers, port: forcePort });
  }
  function stop() {
    cfg.enabled = false; saveConfig();
    if (available()) api().stop();
    status = { enabled: false, peers: [] };
    if (hooks && hooks.onStatusChange) hooks.onStatusChange(status);
  }

  function setConfig(patch) {
    cfg = Object.assign(cfg, patch || {});
    if (!Array.isArray(cfg.manualPeers)) cfg.manualPeers = [];
    saveConfig();
    if (cfg.enabled && cfg.code && available()) start(); // 改了配置且开着 → 重启
  }

  // ---- 把整份状态发给某个对端（分批，避免单条消息过大）----
  function sendFullState(peerId) {
    if (!available() || !hooks) { console.log('[sync] sendFullState 跳过 available=' + available()); return; }
    const data = hooks.getData();
    api().sendTo(peerId, JSON.stringify({ type: 'folders', folders: data.folders || [] }));
    let batch = [], size = 0;
    const flush = () => {
      if (!batch.length) return;
      api().sendTo(peerId, JSON.stringify({ type: 'notes', notes: batch }));
      batch = []; size = 0;
    };
    (data.notes || []).forEach((n) => {
      const est = ((n.content || '').length) + 300;
      if (size + est > 4 * 1024 * 1024 && batch.length) flush(); // 每批约 4MB
      batch.push(n); size += est;
    });
    flush();
  }

  function handleMessage(peerId, dataStr) {
    let msg; try { msg = JSON.parse(dataStr); } catch (_) { return; }
    if (!hooks) return;
    if (msg.type === 'notes') hooks.applyIncoming({ notes: msg.notes || [] });
    else if (msg.type === 'folders') hooks.applyIncoming({ folders: msg.folders || [] });
    else if (msg.type === 'note') hooks.applyIncoming({ notes: [msg.note] });
    else if (msg.type === 'folder') hooks.applyIncoming({ folders: [msg.folder] });
  }

  // ---- 广播本地改动 ----
  function broadcastNote(note) { if (available() && status.enabled && note) api().send(JSON.stringify({ type: 'note', note })); }
  function broadcastFolder(folder) { if (available() && status.enabled && folder) api().send(JSON.stringify({ type: 'folder', folder })); }

  return {
    init, start, stop, setConfig,
    broadcastNote, broadcastFolder,
    available,
    getConfig: () => Object.assign({}, cfg),
    getStatus: () => status,
    getDeviceId: () => deviceId
  };
})();
