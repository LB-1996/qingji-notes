// 预加载脚本：在渲染进程和主进程之间架一座安全的桥。
// 渲染进程通过 window.notesAPI 访问本地存储，而不直接接触 Node/文件系统。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesAPI', {
  // 读取全部数据
  load: () => ipcRenderer.invoke('data:load'),
  // 保存全部数据（异步）
  save: (data) => ipcRenderer.invoke('data:save', data),
  // 同步保存（仅关窗时用，保证落盘）
  saveSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  // 平台信息（用于界面上的细节适配）
  platform: process.platform,
  isElectron: true,
  // 应用版本号（界面右下角显示）
  appVersion: (() => { try { return ipcRenderer.sendSync('app:version-sync'); } catch (_) { return ''; } })(),
  // 图片：复制到系统剪贴板 / 拖拽到其它应用（原生，能被微信/访达等接收）
  image: {
    copy: (dataUrl) => ipcRenderer.invoke('image:copy', dataUrl),
    startDrag: (dataUrl) => ipcRenderer.send('image:start-drag', dataUrl)
  },
  // 菜单栏动作（新建、搜索、切换主题等）转发给界面
  onMenuAction: (callback) => {
    const channels = ['menu:new-note', 'menu:new-folder', 'menu:search', 'menu:toggle-theme'];
    channels.forEach((ch) => ipcRenderer.on(ch, () => callback(ch)));
  },
  // 测试用：通过环境变量自动开启同步（QINGJI_SYNC=JSON）
  autoSync: (() => { try { return JSON.parse(process.env.QINGJI_SYNC || 'null'); } catch (_) { return null; } })(),
  // 局域网同步
  sync: {
    start: (cfg) => ipcRenderer.invoke('sync:start', cfg),
    stop: () => ipcRenderer.invoke('sync:stop'),
    status: () => ipcRenderer.invoke('sync:status'),
    send: (data) => ipcRenderer.send('sync:send', data),
    sendTo: (peerId, data) => ipcRenderer.send('sync:send-to', { peerId, data }),
    onMessage: (cb) => ipcRenderer.on('sync:message', (_e, m) => cb(m)),
    onPeerConnected: (cb) => ipcRenderer.on('sync:peer-connected', (_e, p) => cb(p)),
    onPeerDisconnected: (cb) => ipcRenderer.on('sync:peer-disconnected', (_e, p) => cb(p)),
    onStatus: (cb) => ipcRenderer.on('sync:status', (_e, s) => cb(s))
  }
});
