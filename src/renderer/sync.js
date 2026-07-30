/* ============================================================
   局域网同步 —— 渲染层。
   负责：配置管理、增量拉取、按「最后修改时间」(LWW) 合并、广播本地改动。
   主进程只做网络中继，合并逻辑全在这里。

   协议消息：
     note / folder            单条改动的即时推送（编辑时自动发）
     notes / folders          整份内容（分批）；force=true 时对端无视时间戳直接采用
     sync-req  { manifest }   「拉取」：把本机的 id→版本清单发给对端
     sync-res  { notes,... }  对端只回「本机没有 / 比本机新」的部分（增量，省流量）

   为什么要有 sync-req/sync-res：
   以前只有推送，对端漏收一次就只能等下一次改动或手动「强制同步」。
   现在任何一台都能主动把别人的最新内容拉回来，并且只传差异，
   所以可以放心地在「窗口获得焦点 / 每 15 秒 / 刚连上」时自动拉一次。
   ============================================================ */
const Sync = (() => {
  const CFG_KEY = 'qingji-sync-cfg';
  const ID_KEY = 'qingji-device-id';
  const BATCH_BYTES = 4 * 1024 * 1024;  // 单条消息约 4MB 上限（图片是内联 base64，一次塞不下全部）
  const AUTO_PULL_MS = 15000;           // 自动增量拉取间隔
  const LEGACY_WAIT_MS = 6000;          // 等对端回应 sync-req 的时间；超时视为旧版本，退回整份推送
  const REPORT_WAIT_MS = 8000;          // 手动拉取最多等多久就汇报结果

  let hooks = null;            // { getData, applyIncoming, onStatusChange, onPullDone }
  let deviceId = '';
  let cfg = { enabled: false, code: '', deviceName: '', manualPeers: [] };
  let status = { enabled: false, peers: [] };
  let forcePort = 0; // 测试用固定端口，正式使用为 0（随机）
  let autoTimer = null;
  let pullReport = null;       // 手动拉取的汇总：{ pending, changed, timer }
  const reqs = new Map();      // peerId -> { token, manual, changed, got }
  let reqSeq = 0;
  const legacyPeers = new Set(); // 不认识 sync-req 的旧版本对端

  const api = () => (window.notesAPI && window.notesAPI.sync) || null;
  const available = () => !!api();
  const ver = (x) => (x && (x.syncTs || x.updatedAt)) || 0;

  function defaultDeviceName() {
    const p = (window.notesAPI && window.notesAPI.platform) || '';
    if (p === 'darwin') return 'Mac';
    if (p === 'win32') return 'Windows 电脑';
    return '我的设备';
  }

  function loadConfig() {
    // 优先用主进程持久化(文件)的设备 ID —— 闪退/强杀也不变，保证固定端口与身份稳定
    deviceId = (window.notesAPI && window.notesAPI.deviceId) || '';
    if (!deviceId) {
      deviceId = localStorage.getItem(ID_KEY);
      if (!deviceId) {
        deviceId = 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        localStorage.setItem(ID_KEY, deviceId);
      }
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
    s.onPeerConnected((p) => { legacyPeers.delete(p.peerId); requestFrom(p.peerId, { legacyFallback: true }); });
    s.onPeerDisconnected((p) => { reqs.delete(p.peerId); legacyPeers.delete(p.peerId); });
    s.onMessage((m) => handleMessage(m.peerId, m.data));
    // 回到这台电脑（窗口获得焦点）时自动拉一次 —— 这样"另一台改完，我这台看不到"基本不会再发生
    window.addEventListener('focus', () => pullAll());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pullAll(); });
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(() => pullAll(), AUTO_PULL_MS);
    if (cfg.enabled && cfg.code) start();
  }

  // 按设备 ID 生成一个固定端口（重启后不变），这样对端不必重新发现也能连回同一端口
  function stablePort() {
    let h = 5381;
    for (let i = 0; i < deviceId.length; i++) h = ((h * 33) ^ deviceId.charCodeAt(i)) >>> 0;
    return 20000 + (h % 40000); // 20000–59999
  }
  function start() {
    if (!available() || !cfg.code) return;
    cfg.enabled = true; saveConfig();
    api().start({ code: cfg.code, deviceId, deviceName: cfg.deviceName, manualPeers: cfg.manualPeers, port: forcePort || stablePort() });
  }
  function stop() {
    cfg.enabled = false; saveConfig();
    if (available()) api().stop();
    status = { enabled: false, peers: [] };
    reqs.clear(); legacyPeers.clear(); pullReport = null;
    if (hooks && hooks.onStatusChange) hooks.onStatusChange(status);
  }

  function setConfig(patch) {
    cfg = Object.assign(cfg, patch || {});
    if (!Array.isArray(cfg.manualPeers)) cfg.manualPeers = [];
    saveConfig();
    if (cfg.enabled && cfg.code && available()) start(); // 改了配置且开着 → 重启
  }

  const peerName = (peerId) => {
    const p = (status.peers || []).find((x) => x.id === peerId);
    return (p && p.name) || '其它设备';
  };

  // ---- 按体积分批发笔记；send(msg) 由调用方决定是广播还是发给某台 ----
  function sendNotesBatched(send, notes, base) {
    const groups = [];
    let batch = [], size = 0;
    (notes || []).forEach((n) => {
      const est = ((n.content || '').length) + 300;
      if (size + est > BATCH_BYTES && batch.length) { groups.push(batch); batch = []; size = 0; }
      batch.push(n); size += est;
    });
    groups.push(batch); // 最后一批可能为空，用来带 last 标记
    groups.forEach((b, i) => send(Object.assign({}, base, { notes: b, last: i === groups.length - 1 })));
  }

  // ---- 把整份状态推给某个对端（只在对端是旧版本时才需要）----
  function sendFullState(peerId, force) {
    if (!available() || !hooks) return;
    const data = hooks.getData();
    const send = (msg) => api().sendTo(peerId, JSON.stringify(msg));
    send({ type: 'folders', folders: data.folders || [], force: !!force });
    sendNotesBatched(send, data.notes || [], { type: 'notes', force: !!force });
  }

  // ---- 以本机为准，强制同步给所有已连接设备（对端无视时间戳直接采用本机版本）----
  function forceSyncAll() {
    if (!available() || !status.enabled || !hooks) return 0;
    const peers = (status.peers || []).length;
    if (!peers) return 0;
    const data = hooks.getData();
    const send = (msg) => api().send(JSON.stringify(msg));
    send({ type: 'folders', folders: data.folders || [], force: true });
    sendNotesBatched(send, data.notes || [], { type: 'notes', force: true });
    return peers;
  }

  // ---- 拉取：把「本机有哪些、各是什么版本」告诉对端，对端只回更新的部分 ----
  function manifest() {
    const data = hooks.getData();
    const m = { notes: {}, folders: {} };
    (data.notes || []).forEach((n) => { if (n && n.id) m.notes[n.id] = ver(n); });
    (data.folders || []).forEach((f) => { if (f && f.id) m.folders[f.id] = ver(f); });
    return m;
  }

  function requestFrom(peerId, opts) {
    if (!available() || !hooks) return;
    const o = opts || {};
    if (legacyPeers.has(peerId)) {
      // 旧版本对端不会回应拉取请求；只能把本机内容推给它（它连上时也会把自己的推给我们）
      if (o.legacyFallback || o.manual) sendFullState(peerId, false);
      if (o.manual) notePullDone(peerId, 0);
      return;
    }
    const token = ++reqSeq;   // 超时判定要认准自己这一次请求，别把后来那次的记录当成"没回应"
    reqs.set(peerId, { token, manual: !!o.manual, changed: 0, got: false });
    api().sendTo(peerId, JSON.stringify({ type: 'sync-req', manifest: manifest() }));
    setTimeout(() => {
      const r = reqs.get(peerId);
      if (!r || r.token !== token || r.got) return;
      reqs.delete(peerId);
      // 只在「刚连上那一次」没回应时才判定成旧版本；平时超时更可能只是内容大/网络慢，
      // 误判成旧版本会让后续拉取全部停摆。
      if (o.legacyFallback) { legacyPeers.add(peerId); sendFullState(peerId, false); }
      if (o.manual) notePullDone(peerId, 0);
    }, LEGACY_WAIT_MS);
  }

  // 向所有已连接设备拉取最新内容。manual=true 时最后汇报一次结果（供界面提示）
  function pullAll(opts) {
    if (!available() || !status.enabled || !hooks) return 0;
    const ids = (status.peers || []).map((p) => p.id);
    if (!ids.length) return 0;
    const manual = !!(opts && opts.manual);
    if (manual) {
      if (pullReport && pullReport.timer) clearTimeout(pullReport.timer);
      pullReport = { pending: ids.length, changed: 0, timer: null };
      pullReport.timer = setTimeout(() => finishReport(), REPORT_WAIT_MS);
    }
    ids.forEach((id) => requestFrom(id, { manual }));
    return ids.length;
  }

  function notePullDone(peerId, changed) {
    if (!pullReport) return;
    pullReport.changed += changed || 0;
    pullReport.pending -= 1;
    if (pullReport.pending <= 0) finishReport();
  }
  function finishReport() {
    if (!pullReport) return;
    const changed = pullReport.changed;
    if (pullReport.timer) clearTimeout(pullReport.timer);
    pullReport = null;
    if (hooks && hooks.onPullDone) hooks.onPullDone({ changed, peers: (status.peers || []).length });
  }

  // 对端来要差异：只回它没有或比它旧的部分
  function respondTo(peerId, mani) {
    if (!available() || !hooks) return;
    const data = hooks.getData();
    const mn = (mani && mani.notes) || {};
    const mf = (mani && mani.folders) || {};
    const folders = (data.folders || []).filter((f) => f && f.id && ver(f) > (mf[f.id] || 0));
    const notes = (data.notes || []).filter((n) => n && n.id && ver(n) > (mn[n.id] || 0));
    const send = (msg) => api().sendTo(peerId, JSON.stringify(msg));
    let first = true;
    sendNotesBatched((msg) => {
      send(Object.assign({ type: 'sync-res', folders: first ? folders : [] }, msg));
      first = false;
    }, notes, {});
  }

  function handleMessage(peerId, dataStr) {
    let msg; try { msg = JSON.parse(dataStr); } catch (_) { return; }
    if (!hooks) return;
    const force = !!msg.force;
    if (msg.type === 'sync-req') { legacyPeers.delete(peerId); respondTo(peerId, msg.manifest); return; }
    if (msg.type === 'sync-res') {
      legacyPeers.delete(peerId);   // 回得慢被误判成旧版本时，收到回应就改回来
      const r = reqs.get(peerId);
      if (r) r.got = true;
      const changed = hooks.applyIncoming({ notes: msg.notes || [], folders: msg.folders || [], from: peerName(peerId) }) || 0;
      if (r) r.changed += changed;
      if (msg.last) {
        reqs.delete(peerId);
        if (r && r.manual) notePullDone(peerId, r.changed);
      }
      return;
    }
    if (msg.type === 'notes') hooks.applyIncoming({ notes: msg.notes || [], force, from: peerName(peerId) });
    else if (msg.type === 'folders') hooks.applyIncoming({ folders: msg.folders || [], force, from: peerName(peerId) });
    else if (msg.type === 'note') hooks.applyIncoming({ notes: [msg.note], force, from: peerName(peerId) });
    else if (msg.type === 'folder') hooks.applyIncoming({ folders: [msg.folder], force, from: peerName(peerId) });
  }

  // ---- 广播本地改动 ----
  function broadcastNote(note) { if (available() && status.enabled && note) api().send(JSON.stringify({ type: 'note', note })); }
  function broadcastFolder(folder) { if (available() && status.enabled && folder) api().send(JSON.stringify({ type: 'folder', folder })); }

  return {
    init, start, stop, setConfig,
    broadcastNote, broadcastFolder, forceSyncAll, pullAll,
    available,
    getConfig: () => Object.assign({}, cfg),
    getStatus: () => status,
    getDeviceId: () => deviceId
  };
})();
