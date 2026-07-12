/* ============================================================
   数据层：装成 Electron 时走本地文件（通过 preload 暴露的 notesAPI），
   在普通浏览器里预览时自动回退到 localStorage。
   这样同一套界面既能真机运行、也能在浏览器里看效果。
   ============================================================ */
const Storage = (() => {
  const hasElectron = !!(window.notesAPI && window.notesAPI.isElectron);
  const LS_KEY = 'qingji-notes-data';

  function empty() {
    return { version: 1, folders: [], notes: [] };
  }

  async function load() {
    if (hasElectron) {
      try {
        const data = await window.notesAPI.load();
        return data && typeof data === 'object' ? data : empty();
      } catch (e) {
        console.error('加载失败：', e);
        return empty();
      }
    }
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : empty();
    } catch (e) {
      console.error('localStorage 读取失败：', e);
      return empty();
    }
  }

  async function save(data) {
    if (hasElectron) {
      try {
        return await window.notesAPI.save(data);
      } catch (e) {
        console.error('保存失败：', e);
        return { ok: false, error: String(e) };
      }
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      console.error('localStorage 写入失败：', e);
      return { ok: false, error: String(e) };
    }
  }

  // 同步保存：关窗/退出时调用，确保末尾编辑一定落盘（Electron 走 sendSync，浏览器本就是同步的 localStorage）
  function saveSync(data) {
    if (hasElectron && window.notesAPI.saveSync) {
      try { return window.notesAPI.saveSync(data); }
      catch (e) { console.error('同步保存失败：', e); return { ok: false, error: String(e) }; }
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  return {
    load,
    save,
    saveSync,
    hasElectron,
    platform: (window.notesAPI && window.notesAPI.platform) || 'browser'
  };
})();
