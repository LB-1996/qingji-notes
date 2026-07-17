const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
// 允许用环境变量指定数据目录（必须在 require ./store 之前——store 在加载时就会读取 userData 路径）
if (process.env.QINGJI_USERDATA) { try { app.setPath('userData', process.env.QINGJI_USERDATA); } catch (_) {} }
const path = require('path');
const fs = require('fs');
const { readData, writeData, writeDataSync } = require('./store');
const sync = require('./sync');

const isDev = process.argv.includes('--dev');
let mainWindow = null;

// 运行时窗口/任务栏图标：优先根目录 logo.ico / logo.png，否则用自带默认图标
function resolveIcon() {
  const root = path.join(__dirname, '../..');
  for (const name of ['logo.ico', 'logo.png', 'assets/icon.png']) {
    const p = path.join(root, name);
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: '轻记',
    icon: resolveIcon(),
    backgroundColor: '#f6f6f6',
    // macOS 上用隐藏标题栏获得更贴近原生的观感；Windows 保留系统边框以获得标准最小化/关闭按钮
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 只允许在系统浏览器打开 http/https/mailto 链接，其它协议一律忽略（防止 file:、
  // 自定义协议处理器等被链接触发）
  const openExternalSafely = (url) => {
    try {
      const proto = new URL(url).protocol;
      if (proto === 'http:' || proto === 'https:' || proto === 'mailto:') {
        shell.openExternal(url);
      }
    } catch (_) { /* 非法 URL，忽略 */ }
  };

  // 处理 window.open / target=_blank 之类的新窗口请求
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  // 阻止应用窗口本身被导航到任何远端页面——点击笔记里的普通链接不应劫持窗口、
  // 也不应让远端页面继承 preload 暴露的 notesAPI。只放行应用自身的本地页面。
  const blockNavigation = (event, url) => {
    let proto = '';
    try { proto = new URL(url).protocol; } catch (_) {}
    if (proto !== 'file:') {
      event.preventDefault();
      openExternalSafely(url);
    }
  };
  mainWindow.webContents.on('will-navigate', blockNavigation);
  mainWindow.webContents.on('will-redirect', blockNavigation);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===== IPC：数据读写 =====
ipcMain.handle('data:load', () => {
  return readData();
});

ipcMain.handle('data:save', (_event, data) => {
  return writeData(data);
});

// 同步保存通道：仅供渲染进程在 beforeunload 里调用，保证关窗时最后一次编辑落盘
ipcMain.on('data:save-sync', (event, data) => {
  event.returnValue = writeDataSync(data);
});

// 应用版本号（界面上显示，便于区分版本）
ipcMain.on('app:version-sync', (event) => {
  event.returnValue = app.getVersion();
});

// ===== 局域网同步 =====
function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send(channel, payload); } catch (_) {}
  }
}
sync.on('message', (m) => sendToRenderer('sync:message', m));
sync.on('peer-connected', (p) => sendToRenderer('sync:peer-connected', p));
sync.on('peer-disconnected', (p) => sendToRenderer('sync:peer-disconnected', p));
sync.on('status', (s) => sendToRenderer('sync:status', s));

ipcMain.handle('sync:start', (_e, cfg) => { sync.start(cfg); return sync.getStatus(); });
ipcMain.handle('sync:stop', () => { sync.stop(); return sync.getStatus(); });
ipcMain.handle('sync:status', () => sync.getStatus());
ipcMain.on('sync:send', (_e, data) => sync.broadcast(data));
ipcMain.on('sync:send-to', (_e, payload) => sync.sendTo(payload.peerId, payload.data));

// ===== 应用生命周期 =====
app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { try { sync.stop(); } catch (_) {} });

// ===== 菜单（带常用快捷键）=====
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (channel) => {
    if (mainWindow) mainWindow.webContents.send(channel);
  };

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新建备忘录',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:new-note')
        },
        {
          label: '新建文件夹',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => send('menu:new-folder')
        },
        { type: 'separator' },
        {
          label: '查找',
          accelerator: 'CmdOrCtrl+F',
          click: () => send('menu:search')
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '切换深色模式',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => send('menu:toggle-theme')
        },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(isDev ? [{ role: 'toggleDevTools', label: '开发者工具' }] : [])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
