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
  // 菜单栏动作（新建、搜索、切换主题等）转发给界面
  onMenuAction: (callback) => {
    const channels = ['menu:new-note', 'menu:new-folder', 'menu:search', 'menu:toggle-theme'];
    channels.forEach((ch) => ipcRenderer.on(ch, () => callback(ch)));
  }
});
