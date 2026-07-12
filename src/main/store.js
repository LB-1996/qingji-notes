// 本地数据存储：把所有笔记数据保存为 userData 目录下的一个 JSON 文件。
// 采用「整体读 / 整体写」的简单模型，对个人笔记量级（几千条 = 几 MB）完全够用，
// 且避免了原生数据库模块在 Windows 上编译打包的麻烦。
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DATA_DIR = app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'qingji-notes.json');
const BACKUP_FILE = path.join(DATA_DIR, 'qingji-notes.backup.json');

function emptyData() {
  return { version: 1, folders: [], notes: [] };
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return emptyData();
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    if (!raw.trim()) return emptyData();
    return JSON.parse(raw);
  } catch (err) {
    // 主文件损坏时尝试读备份，避免数据全丢
    console.error('读取数据失败，尝试备份：', err);
    try {
      if (fs.existsSync(BACKUP_FILE)) {
        return JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
      }
    } catch (e) {
      console.error('备份也读取失败：', e);
    }
    return emptyData();
  }
}

const fsp = fs.promises;
let lastBackupAt = 0;
const BACKUP_INTERVAL = 60 * 1000; // 备份最多每分钟一次，避免每次保存都全量复制整个文件

function shouldBackup() {
  const t = Date.now();
  if (t - lastBackupAt >= BACKUP_INTERVAL) { lastBackupAt = t; return true; }
  return false;
}

// 常规保存：异步写盘，不阻塞主进程事件循环；备份做节流
async function writeData(data) {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    if (shouldBackup()) {
      try { await fsp.copyFile(DATA_FILE, BACKUP_FILE); } catch (_) {}
    }
    const tmp = DATA_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data), 'utf-8');
    await fsp.rename(tmp, DATA_FILE); // 原子替换
    return { ok: true };
  } catch (err) {
    console.error('写入数据失败：', err);
    return { ok: false, error: String(err) };
  }
}

// 同步保存：仅用于关窗/退出时的最后一次刷盘，确保末尾编辑不因异步 IPC 竞态丢失。
// 用独立的临时文件名，避免与可能在途的异步写冲突。
function writeDataSync(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.synctmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
    return { ok: true };
  } catch (err) {
    console.error('同步写入失败：', err);
    return { ok: false, error: String(err) };
  }
}

module.exports = { readData, writeData, writeDataSync, DATA_FILE };
