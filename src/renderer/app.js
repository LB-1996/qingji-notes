/* ============================================================
   轻记 — 主编排逻辑
   ============================================================ */
(() => {
  const SPECIAL = { ALL: 'all', TRASH: 'trash' };
  const TRASH_KEEP_DAYS = 30;
  const TOMBSTONE_KEEP_DAYS = 90; // 删除墓碑保留多久后真正移除

  let data = { version: 1, folders: [], notes: [] };
  const view = { folderId: SPECIAL.ALL, noteId: null, query: '' };
  let saveTimer = null;
  const pendingSync = new Set(); // 待广播到其它设备的笔记 id

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const folderListEl = $('folderList');
  const noteListEl = $('noteList');
  const listTitleEl = $('listTitle');
  const listPaneEl = $('listPane');
  const editorPaneEl = $('editorPane');
  const searchInput = $('searchInput');
  const searchWrap = searchInput.parentElement;
  const searchClear = $('searchClear');
  const toolbar = $('toolbar');
  const formatPopover = $('formatPopover');
  const pinBtn = $('pinBtn');
  const deleteBtn = $('deleteBtn');
  const imageInput = $('imageInput');
  const contextMenu = $('contextMenu');
  const toast = $('toast');
  const themeBtn = $('themeBtn');
  const themeLabel = $('themeLabel');
  const appEl = $('app');
  const sidebarToggle = $('sidebarToggle');
  const listResizer = $('listResizer');
  const syncBtn = $('syncBtn');
  const syncDot = $('syncDot');
  const syncModal = $('syncModal');

  // ---------- 工具函数 ----------
  const now = () => Date.now();
  const genId = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const t = new Date();
    if (d.toDateString() === t.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const y = new Date(t); y.setDate(t.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return '昨天';
    if (d.getFullYear() === t.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  // 把一段 HTML 展开成按「块」分行的纯文本。
  // 不能用游离节点的 innerText —— 未挂载到文档时它不会在块级元素间换行。
  const BLOCK_TAGS = /^(H1|H2|H3|H4|P|DIV|LI|UL|OL|BLOCKQUOTE|PRE)$/;
  function extractText(node) {
    let out = '';
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        out += child.nodeValue;
      } else if (child.nodeType === 1) {
        const tag = child.nodeName;
        if (tag === 'BR') { out += '\n'; return; }
        if (tag === 'IMG') return;
        const inner = extractText(child);
        if (BLOCK_TAGS.test(tag)) {
          if (out && !out.endsWith('\n')) out += '\n';
          out += inner + '\n';
        } else {
          out += inner;
        }
      }
    });
    return out;
  }

  function deriveMeta(note) {
    const tmp = document.createElement('div');
    tmp.innerHTML = note.content || '';
    const text = extractText(tmp).replace(/ /g, ' ');
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const title = lines[0] || '';
    let preview = lines.slice(1).join('  ');
    if (!title && !preview && tmp.querySelector('img')) return { title: '图片', preview: '' };
    if (!preview && tmp.querySelector('img')) preview = '图片';
    return { title, preview };
  }

  function notesInFolder(folderId) {
    if (folderId === SPECIAL.TRASH) return data.notes.filter((n) => n.trashed && !n.deleted);
    if (folderId === SPECIAL.ALL) return data.notes.filter((n) => !n.trashed && !n.deleted);
    return data.notes.filter((n) => !n.trashed && !n.deleted && n.folderId === folderId);
  }

  function findNote(id) { return data.notes.find((n) => n.id === id && !n.deleted); }
  function findNoteRaw(id) { return data.notes.find((n) => n.id === id); }  // 含墓碑，供合并/广播用
  function findFolder(id) { return data.folders.find((f) => f.id === id && !f.deleted); }

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => (toast.hidden = true), 220);
    }, 1600);
  }

  // ---------- 持久化 ----------
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    const res = await Storage.save(data);
    if (res && res.ok === false) showToast('保存失败，请检查磁盘空间');
    // 把本次改动的笔记广播给其它设备
    if (pendingSync.size) {
      pendingSync.forEach((id) => { const n = findNoteRaw(id); if (n) Sync.broadcastNote(n); });
      pendingSync.clear();
    }
  }

  // ---------- 同步：合并来自其它设备的改动（LWW，按 syncTs）----------
  function ver(x) { return (x && (x.syncTs || x.updatedAt)) || 0; }
  function mergeNote(incoming) {
    if (!incoming || !incoming.id) return false;
    const local = findNoteRaw(incoming.id);
    if (!local) { data.notes.push(incoming); return true; }
    if (ver(incoming) > ver(local)) {
      // 不打断正在输入的当前笔记；用户下一次保存(更晚的 syncTs)会自然胜出
      if (incoming.id === view.noteId && document.activeElement === Editor.el) return false;
      // 冲突保护：本地这条有"还没广播出去"的改动、且内容与对端不同 → 把本地版本留成「冲突副本」，避免丢失
      if (pendingSync.has(local.id) && !local.deleted && !incoming.deleted && (local.content || '') !== (incoming.content || '')) {
        const copy = Object.assign({}, local, {
          id: genId('n'), syncTs: now(), updatedAt: now(),
          content: '<div>⚠️ 冲突副本（另一台设备也同时改了这条）</div>' + (local.content || '')
        });
        data.notes.push(copy);
        pendingSync.add(copy.id);
      }
      Object.assign(local, incoming);
      return true;
    }
    return false;
  }
  function mergeFolder(incoming) {
    if (!incoming || !incoming.id) return false;
    const local = data.folders.find((f) => f.id === incoming.id);
    if (!local) { data.folders.push(incoming); return true; }
    if (ver(incoming) > ver(local)) { Object.assign(local, incoming); return true; }
    return false;
  }
  function applyIncoming(payload) {
    let changed = false;
    (payload.folders || []).forEach((f) => { if (mergeFolder(f)) changed = true; });
    (payload.notes || []).forEach((n) => { if (mergeNote(n)) changed = true; });
    if (!changed) return;
    if (view.noteId && !findNote(view.noteId)) view.noteId = null;
    saveNow();
    renderFolders();
    renderNoteList();
    if (document.activeElement !== Editor.el) renderEditor(); // 不在输入时才刷新编辑器
  }

  // ---------- 同步：设置界面 ----------
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function onSyncStatus(st) { renderSyncStatus(st); }
  function renderSyncStatus(st) {
    st = st || { enabled: false, peers: [] };
    const peers = st.peers || [];
    syncDot.classList.toggle('on', !!st.enabled && peers.length > 0);
    syncDot.classList.toggle('idle', !!st.enabled && peers.length === 0);
    const box = $('syncStatusBox');
    const toggle = $('syncToggle');
    if (!Sync.available()) {
      if (box) box.textContent = '此功能仅在桌面应用中可用（当前是浏览器预览）';
      if (toggle) { toggle.textContent = '开启同步'; toggle.disabled = true; }
      return;
    }
    if (toggle) {
      toggle.disabled = false;
      toggle.textContent = st.enabled ? '停止同步' : '开启同步';
      toggle.classList.toggle('stop', !!st.enabled);
    }
    if (box) {
      box.classList.toggle('on', !!st.enabled);
      if (!st.enabled) box.textContent = '未开启';
      else if (!peers.length) box.innerHTML = '已开启 · 正在局域网内查找其它设备……' + portHint(st);
      else box.innerHTML = '已连接 ' + peers.length + ' 台设备：' +
        peers.map((p) => '<span class="sync-peer">🖥 ' + escapeHtml(p.name || '设备') + '</span>').join('') + portHint(st);
    }
  }
  function portHint(st) {
    return st.port ? '<div class="sync-tip" style="margin-top:6px">本机端口 ' + st.port + '（手动配对时对方填「你的IP:' + st.port + '」）</div>' : '';
  }

  function openSyncModal() {
    const cfg = Sync.getConfig();
    $('syncCode').value = cfg.code || '';
    $('syncName').value = cfg.deviceName || '';
    $('syncManual').value = (cfg.manualPeers || []).join('\n');
    renderSyncStatus(Sync.getStatus());
    syncModal.hidden = false;
  }
  function closeSyncModal() { syncModal.hidden = true; }

  function toggleSync() {
    if (!Sync.available()) { showToast('请在桌面应用中使用'); return; }
    const running = Sync.getStatus().enabled;
    if (running) {
      Sync.stop();
    } else {
      const code = $('syncCode').value.trim();
      if (!code) { showToast('请先填写同步码'); return; }
      const deviceName = $('syncName').value.trim();
      const manualPeers = $('syncManual').value.split('\n').map((s) => s.trim()).filter(Boolean);
      Sync.setConfig({ code, deviceName: deviceName || undefined, manualPeers });
      Sync.start();
    }
    renderSyncStatus(Sync.getStatus());
    showToast(Sync.getStatus().enabled ? '同步已开启' : '同步已停止');
  }

  // ---------- 主题 ----------
  function currentTheme() {
    const saved = localStorage.getItem('qingji-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeLabel.textContent = theme === 'dark' ? '浅色模式' : '深色模式';
  }
  function toggleTheme() {
    const next = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
    localStorage.setItem('qingji-theme', next);
    applyTheme(next);
  }

  // ---------- 边栏收起 / 展开 ----------
  function toggleSidebar(force) {
    const collapsed = typeof force === 'boolean' ? force : !appEl.classList.contains('sidebar-collapsed');
    appEl.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggle.classList.toggle('active', collapsed);
    localStorage.setItem('qingji-sidebar', collapsed ? '1' : '0');
  }

  // ---------- 渲染：文件夹 ----------
  const ICON = {
    all: '<svg viewBox="0 0 24 24" width="17" height="17"><rect x="4" y="3.5" width="16" height="17" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 8.5h8M8 12h8M8 15.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l1.6 1.8H19.5A1.5 1.5 0 0 1 21 8.3v9.2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="currentColor" opacity="0.9"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M4 7h16M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7M6 7l1 12.2A1.8 1.8 0 0 0 8.8 21h6.4a1.8 1.8 0 0 0 1.8-1.8L18 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pinSmall: '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M9 3h6l-1 5 3 3v2h-5v6l-1 1-1-1v-6H4v-2l3-3z" fill="currentColor"/></svg>'
  };

  function makeFolderItem({ id, name, icon, count, kind }) {
    const div = document.createElement('div');
    div.className = 'folder-item' + (kind ? ' ' + kind : '') + (view.folderId === id ? ' active' : '');
    div.dataset.id = id;
    div.innerHTML = `<span class="folder-ico">${icon}</span>`;
    const nameEl = document.createElement('span');
    nameEl.className = 'folder-name';
    nameEl.textContent = name;
    div.appendChild(nameEl);
    const countEl = document.createElement('span');
    countEl.className = 'folder-count';
    countEl.textContent = count > 0 ? count : '';
    div.appendChild(countEl);
    return div;
  }

  function renderFolders() {
    folderListEl.innerHTML = '';
    folderListEl.appendChild(makeFolderItem({
      id: SPECIAL.ALL, name: '所有备忘录', icon: ICON.all,
      count: notesInFolder(SPECIAL.ALL).length
    }));

    const userFolders = data.folders.filter((f) => !f.deleted);
    if (userFolders.length) {
      const label = document.createElement('div');
      label.className = 'sidebar-section-label';
      label.textContent = '我的文件夹';
      folderListEl.appendChild(label);
      userFolders.forEach((f) => {
        folderListEl.appendChild(makeFolderItem({
          id: f.id, name: f.name, icon: ICON.folder, kind: 'user',
          count: notesInFolder(f.id).length
        }));
      });
    }

    const sep = document.createElement('div');
    sep.className = 'sidebar-section-label';
    sep.textContent = '';
    folderListEl.appendChild(sep);
    folderListEl.appendChild(makeFolderItem({
      id: SPECIAL.TRASH, name: '最近删除', icon: ICON.trash, kind: 'trash',
      count: notesInFolder(SPECIAL.TRASH).length
    }));
  }

  // ---------- 渲染：笔记列表 ----------
  function currentListNotes() {
    const q = view.query.trim().toLowerCase();
    if (q) {
      // 搜索：限定在当前视图范围内（所有备忘录 / 某个文件夹 / 回收站）
      return notesInFolder(view.folderId).filter((n) => {
        const m = deriveMeta(n);
        return (m.title + ' ' + m.preview).toLowerCase().includes(q);
      });
    }
    return notesInFolder(view.folderId).slice();
  }

  function sortNotes(list, isTrash) {
    if (isTrash) return list.sort((a, b) => (b.trashedAt || b.updatedAt) - (a.trashedAt || a.updatedAt));
    return list.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function makeNoteItem(note) {
    const m = deriveMeta(note);
    const div = document.createElement('div');
    div.className = 'note-item' + (note.id === view.noteId ? ' active' : '') + (note.pinned ? ' pinned' : '');
    div.dataset.id = note.id;

    const title = document.createElement('div');
    title.className = 'ni-title';
    title.innerHTML = `<span class="ni-pin">${ICON.pinSmall}</span>`;
    const tSpan = document.createElement('span');
    tSpan.textContent = m.title || '新建备忘录';
    title.appendChild(tSpan);

    const sub = document.createElement('div');
    sub.className = 'ni-sub';
    const date = document.createElement('span');
    date.className = 'ni-date';
    date.textContent = formatDate(note.trashed ? note.trashedAt : note.updatedAt);
    const snip = document.createElement('span');
    snip.className = 'ni-snippet';
    snip.textContent = m.preview || '无其他文本';
    sub.appendChild(date);
    sub.appendChild(snip);

    div.appendChild(title);
    div.appendChild(sub);
    return div;
  }

  function renderNoteList() {
    const isTrash = view.folderId === SPECIAL.TRASH;
    const list = sortNotes(currentListNotes(), isTrash);
    noteListEl.innerHTML = '';

    // 标题
    if (view.query.trim()) listTitleEl.textContent = '搜索';
    else if (view.folderId === SPECIAL.ALL) listTitleEl.textContent = '所有备忘录';
    else if (view.folderId === SPECIAL.TRASH) listTitleEl.textContent = '最近删除';
    else { const f = findFolder(view.folderId); listTitleEl.textContent = f ? f.name : '备忘录'; }

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = view.query.trim() ? '没有找到匹配的备忘录' : (isTrash ? '最近删除中没有内容' : '还没有备忘录');
      noteListEl.appendChild(empty);
      return;
    }

    const pinned = list.filter((n) => n.pinned && !isTrash);
    const rest = list.filter((n) => !(n.pinned && !isTrash));

    if (pinned.length) {
      noteListEl.appendChild(groupLabel('置顶'));
      pinned.forEach((n) => noteListEl.appendChild(makeNoteItem(n)));
      if (rest.length) noteListEl.appendChild(groupLabel('备忘录'));
    }
    rest.forEach((n) => noteListEl.appendChild(makeNoteItem(n)));
  }

  function groupLabel(text) {
    const el = document.createElement('div');
    el.className = 'note-list-group-label';
    el.textContent = text;
    return el;
  }

  // ---------- 渲染：编辑器 ----------
  function renderEditor() {
    const note = findNote(view.noteId);
    if (!note) {
      editorPaneEl.classList.remove('has-note');
      Editor.setHTML('');
      return;
    }
    editorPaneEl.classList.add('has-note');
    Editor.setHTML(note.content || '');
    Editor.el.setAttribute('data-placeholder', '开始记录…');

    const isTrash = !!note.trashed;
    Editor.el.contentEditable = isTrash ? 'false' : 'true';
    toolbar.querySelectorAll('.tb-btn').forEach((b) => {
      if (b.dataset.cmd === 'delete') b.disabled = false;
      else b.disabled = isTrash;
    });
    pinBtn.classList.toggle('active', !!note.pinned);
    updateToolbarState();
  }

  function updateToolbarState() {
    if (!findNote(view.noteId)) return;
    const s = Editor.queryState();
    setActive('bold', s.bold);
    setActive('italic', s.italic);
    setActive('underline', s.underline);
    setActive('strike', s.strike);
    setActive('bullet', s.listType === 'bullet');
    setActive('checklist', s.listType === 'checklist');
  }
  function setActive(cmd, on) {
    const btn = toolbar.querySelector(`.tb-btn[data-cmd="${cmd}"]`);
    if (btn) btn.classList.toggle('active', !!on);
  }

  // ---------- 选择 ----------
  function selectFolder(id) {
    view.folderId = id;
    view.query = '';
    searchInput.value = '';
    searchWrap.classList.remove('has-text');
    // 选中该文件夹下第一条
    const first = sortNotes(currentListNotes(), id === SPECIAL.TRASH)[0];
    view.noteId = first ? first.id : null;
    renderFolders();
    renderNoteList();
    renderEditor();
  }

  function selectNote(id, focus) {
    saveNow();
    view.noteId = id;
    renderNoteList();
    renderEditor();
    listPaneEl.classList.add('focused');
    if (focus) setTimeout(() => Editor.focus(), 0);
  }

  // ---------- 编辑变更 ----------
  function onEditorChange() {
    const note = findNote(view.noteId);
    if (!note || note.trashed) return;
    note.content = Editor.getHTML();
    note.updatedAt = now();
    note.syncTs = now();
    pendingSync.add(note.id);
    // 就地更新列表项的标题 / 摘要 / 日期，避免打字时列表跳动
    const item = noteListEl.querySelector(`.note-item[data-id="${note.id}"]`);
    if (item) {
      const m = deriveMeta(note);
      item.querySelector('.ni-title span:last-child').textContent = m.title || '新建备忘录';
      item.querySelector('.ni-snippet').textContent = m.preview || '无其他文本';
      item.querySelector('.ni-date').textContent = formatDate(note.updatedAt);
    }
    updateToolbarState();
    scheduleSave();
  }

  // ---------- 增删改 ----------
  function newNote() {
    let folderId = null;
    if (view.folderId !== SPECIAL.ALL && view.folderId !== SPECIAL.TRASH) folderId = view.folderId;
    const note = {
      id: genId('n'), folderId, content: '<div><br></div>',
      pinned: false, trashed: false,
      createdAt: now(), updatedAt: now(), syncTs: now()
    };
    data.notes.unshift(note);
    pendingSync.add(note.id);
    if (view.folderId === SPECIAL.TRASH) view.folderId = SPECIAL.ALL;
    view.query = '';
    searchInput.value = '';
    searchWrap.classList.remove('has-text');
    view.noteId = note.id;
    renderFolders();
    renderNoteList();
    renderEditor();
    listPaneEl.classList.add('focused');
    setTimeout(() => Editor.focus(), 0);
    saveNow();
  }

  function newFolder() {
    const folder = { id: genId('f'), name: '新建文件夹', createdAt: now(), updatedAt: now(), syncTs: now() };
    data.folders.push(folder);
    renderFolders();
    saveNow();
    Sync.broadcastFolder(folder);
    startRenameFolder(folder.id);
  }

  function startRenameFolder(id) {
    const item = folderListEl.querySelector(`.folder-item[data-id="${id}"]`);
    if (!item) return;
    const folder = findFolder(id);
    const nameEl = item.querySelector('.folder-name');
    const input = document.createElement('input');
    input.className = 'folder-name-input';
    input.value = folder.name;
    item.replaceChild(input, nameEl);
    input.focus();
    input.select();
    const commit = () => {
      const v = input.value.trim();
      folder.name = v || '未命名文件夹';
      folder.updatedAt = now();
      folder.syncTs = now();
      renderFolders();
      if (view.folderId === id) renderNoteList();
      saveNow();
      Sync.broadcastFolder(folder);
    };
    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = folder.name; input.blur(); }
    });
  }

  function deleteFolder(id) {
    const folder = findFolder(id);
    if (!folder) return;
    const affected = data.notes.filter((n) => n.folderId === id && !n.trashed && !n.deleted);
    affected.forEach((n) => { n.trashed = true; n.trashedAt = now(); n.syncTs = now(); pendingSync.add(n.id); });
    folder.deleted = true; folder.deletedAt = now(); folder.syncTs = now(); // 用墓碑标记，好同步删除
    if (view.folderId === id) {
      // 删的是当前正在看的文件夹 → 切回「所有备忘录」
      selectFolder(SPECIAL.ALL);
    } else {
      // 删的是别的文件夹 → 保留当前搜索/视图，仅在当前笔记被连带移入回收站时才改选
      if (view.noteId && !currentListNotes().some((n) => n.id === view.noteId)) {
        const list = sortNotes(currentListNotes(), view.folderId === SPECIAL.TRASH);
        view.noteId = list.length ? list[0].id : null;
      }
      renderFolders();
      renderNoteList();
      renderEditor();
    }
    saveNow();
    Sync.broadcastFolder(folder);
    showToast(affected.length ? `文件夹已删除，${affected.length} 条备忘录移到最近删除` : '文件夹已删除');
  }

  function moveNoteToTrash(id) {
    const note = findNote(id);
    if (!note) return;
    note.trashed = true;
    note.trashedAt = now();
    note.syncTs = now();
    pendingSync.add(id);
    afterRemoveFromView(id);
    saveNow();
    showToast('已移到最近删除');
  }

  function restoreNote(id) {
    const note = findNoteRaw(id);
    if (!note) return;
    note.trashed = false;
    note.trashedAt = null;
    note.syncTs = now();
    pendingSync.add(id);
    if (note.folderId && !findFolder(note.folderId)) note.folderId = null;
    afterRemoveFromView(id);
    saveNow();
    showToast('已恢复');
  }

  function deleteForever(id) {
    const note = findNoteRaw(id);
    if (note) { note.deleted = true; note.deletedAt = now(); note.syncTs = now(); note.content = ''; pendingSync.add(id); }
    afterRemoveFromView(id);
    saveNow();
  }

  function afterRemoveFromView(removedId) {
    // 仅当被操作的笔记确实已离开当前列表时才改选，否则保持选中不变。
    // （移动笔记到别的文件夹时，在「所有备忘录」/搜索视图里它其实还在列表中）
    const stillInView = currentListNotes().some((n) => n.id === removedId);
    if (view.noteId === removedId && !stillInView) {
      const list = sortNotes(currentListNotes(), view.folderId === SPECIAL.TRASH);
      view.noteId = list.length ? list[0].id : null;
    }
    renderFolders();
    renderNoteList();
    renderEditor();
  }

  function togglePin(id) {
    const note = findNote(id);
    if (!note) return;
    note.pinned = !note.pinned;
    note.syncTs = now();   // 同步版本 bump（但不动 updatedAt，避免跳到列表顶部/显示错误修改时间）
    pendingSync.add(id);
    renderNoteList();
    if (id === view.noteId) pinBtn.classList.toggle('active', note.pinned);
    saveNow();
    showToast(note.pinned ? '已置顶' : '已取消置顶');
  }

  function moveNote(id, folderId) {
    const note = findNote(id);
    if (!note) return;
    note.folderId = folderId;
    note.syncTs = now();   // 同步版本 bump（保留原 updatedAt）
    pendingSync.add(id);
    afterRemoveFromView(id);
    saveNow();
    const name = folderId ? (findFolder(folderId) || {}).name : '所有备忘录';
    showToast(`已移动到「${name || '备忘录'}」`);
  }

  // ---------- 图片 ----------
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // 插入前对大图降采样：图片以 base64 内联进笔记，若不限制体积，几张照片就能把
  // 单个数据文件撑到几十 MB，拖慢每次保存。小图保持原样，大图缩到最长边 MAX_IMG_DIM。
  const MAX_IMG_DIM = 1600;
  async function processImage(file) {
    const dataUrl = await readFileAsDataURL(file);
    if (typeof dataUrl !== 'string' || dataUrl.length < 1500000) return dataUrl; // 小图直接用
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(dataUrl); // 解码失败就退回原图
      img.onload = () => {
        const scale = Math.min(1, MAX_IMG_DIM / Math.max(img.width, img.height));
        if (scale >= 1) { resolve(dataUrl); return; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const isPng = /^data:image\/png/.test(dataUrl); // PNG 保留透明度，其余转 JPEG 省体积
        try { resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85)); }
        catch (e) { resolve(dataUrl); }
      };
      img.src = dataUrl;
    });
  }

  async function insertImageFiles(files) {
    const note = findNote(view.noteId);
    if (!note || note.trashed) { showToast('请先选择一条可编辑的备忘录'); return; }
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const url = await processImage(file);
        Editor.insertImage(url);
      } catch (e) { console.error(e); }
    }
  }

  // 把笔记里的图片复制到系统剪贴板（可粘贴到微信/Word 等别处）
  async function copyImageToClipboard(img) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (blob && navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('图片已复制，可粘贴到别处');
        return;
      }
      throw new Error('clipboard API 不可用');
    } catch (e) {
      // 兜底：选中图片，让用户自己按 Ctrl/⌘+C
      const range = document.createRange();
      range.selectNode(img);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      showToast('已选中图片，按 Ctrl/⌘+C 复制');
    }
  }

  // ---------- 右键菜单 ----------
  function showContextMenu(x, y, items) {
    contextMenu.innerHTML = '';
    items.forEach((it) => {
      if (it.sep) {
        const s = document.createElement('div');
        s.className = 'cm-sep';
        contextMenu.appendChild(s);
        return;
      }
      const b = document.createElement('button');
      if (it.danger) b.className = 'danger';
      b.textContent = it.label;
      b.addEventListener('click', () => { hideContextMenu(); it.onClick(); });
      contextMenu.appendChild(b);
    });
    contextMenu.hidden = false;
    const w = contextMenu.offsetWidth, h = contextMenu.offsetHeight;
    contextMenu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
  }
  function hideContextMenu() { contextMenu.hidden = true; }

  function noteContextItems(note) {
    if (note.trashed) {
      return [
        { label: '恢复备忘录', onClick: () => restoreNote(note.id) },
        { sep: true },
        { label: '立即永久删除', danger: true, onClick: () => {
          if (confirm('永久删除这条备忘录？此操作不可恢复。')) deleteForever(note.id);
        } }
      ];
    }
    const items = [
      { label: note.pinned ? '取消置顶' : '置顶备忘录', onClick: () => togglePin(note.id) }
    ];
    // 移动到...
    const targets = [];
    if (note.folderId) targets.push({ label: '移出文件夹（所有备忘录）', onClick: () => moveNote(note.id, null) });
    data.folders.filter((f) => f.id !== note.folderId).forEach((f) => {
      targets.push({ label: `移动到「${f.name}」`, onClick: () => moveNote(note.id, f.id) });
    });
    if (targets.length) { items.push({ sep: true }); items.push(...targets); }
    items.push({ sep: true });
    items.push({ label: '删除', danger: true, onClick: () => moveNoteToTrash(note.id) });
    return items;
  }

  function folderContextItems(folder) {
    return [
      { label: '重命名', onClick: () => startRenameFolder(folder.id) },
      { sep: true },
      { label: '删除文件夹', danger: true, onClick: () => {
        if (confirm(`删除文件夹「${folder.name}」？里面的备忘录会移到最近删除。`)) deleteFolder(folder.id);
      } }
    ];
  }

  // ---------- 事件绑定 ----------
  function wireUI() {
    // 文件夹点击
    folderListEl.addEventListener('click', (e) => {
      const item = e.target.closest('.folder-item');
      if (!item) return;
      selectFolder(item.dataset.id);
    });
    folderListEl.addEventListener('dblclick', (e) => {
      const item = e.target.closest('.folder-item.user');
      if (item) startRenameFolder(item.dataset.id);
    });
    folderListEl.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.folder-item.user');
      if (!item) return;
      e.preventDefault();
      const folder = findFolder(item.dataset.id);
      if (folder) showContextMenu(e.clientX, e.clientY, folderContextItems(folder));
    });

    // 笔记列表点击
    noteListEl.addEventListener('click', (e) => {
      const item = e.target.closest('.note-item');
      if (!item) return;
      selectNote(item.dataset.id, false);
    });
    noteListEl.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.note-item');
      if (!item) return;
      e.preventDefault();
      const note = findNote(item.dataset.id);
      if (note) showContextMenu(e.clientX, e.clientY, noteContextItems(note));
    });

    // 新建
    $('newNoteBtn').addEventListener('click', newNote);
    $('newFolderBtn').addEventListener('click', newFolder);

    // 搜索
    searchInput.addEventListener('input', () => {
      view.query = searchInput.value;
      searchWrap.classList.toggle('has-text', !!searchInput.value);
      const list = sortNotes(currentListNotes(), view.folderId === SPECIAL.TRASH);
      view.noteId = list.length ? list[0].id : null;
      renderNoteList();
      renderEditor();
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      view.query = '';
      searchWrap.classList.remove('has-text');
      selectFolder(view.folderId);
      searchInput.focus();
    });

    // 主题
    themeBtn.addEventListener('click', toggleTheme);

    // 边栏收起 / 展开
    sidebarToggle.addEventListener('click', () => toggleSidebar());

    // 局域网同步
    syncBtn.addEventListener('click', openSyncModal);
    $('syncClose').addEventListener('click', closeSyncModal);
    $('syncToggle').addEventListener('click', toggleSync);
    syncModal.addEventListener('click', (e) => { if (e.target === syncModal) closeSyncModal(); });

    // 拖动分隔线调整列表宽度（编辑区自动填充剩余空间）
    const LIST_MIN = 240, LIST_MAX = 640;
    let resizing = false;
    listResizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizing = true;
      appEl.classList.add('resizing');
    });
    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const left = listPaneEl.getBoundingClientRect().left;
      let w = Math.round(e.clientX - left);
      w = Math.max(LIST_MIN, Math.min(LIST_MAX, w));
      appEl.style.setProperty('--list-w', w + 'px');
    });
    window.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      appEl.classList.remove('resizing');
      const w = appEl.style.getPropertyValue('--list-w');
      if (w) localStorage.setItem('qingji-listw', w.trim());
    });
    // 双击分隔线恢复默认宽度
    listResizer.addEventListener('dblclick', () => {
      appEl.style.removeProperty('--list-w');
      localStorage.removeItem('qingji-listw');
    });

    // 工具栏：mousedown 阻止默认，保住编辑器选区
    toolbar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tb-btn') || e.target.closest('.popover')) e.preventDefault();
    });
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.tb-btn');
      if (!btn) return;
      handleToolbarCmd(btn.dataset.cmd, btn);
    });

    // 文字样式弹出面板
    formatPopover.addEventListener('mousedown', (e) => e.preventDefault());
    formatPopover.addEventListener('click', (e) => {
      const it = e.target.closest('.pop-item');
      if (!it) return;
      Editor.setBlock(it.dataset.style);
      hidePopover();
      updateToolbarState();
    });

    // 图片选择
    imageInput.addEventListener('change', async () => {
      await insertImageFiles(Array.from(imageInput.files));
      imageInput.value = '';
    });

    // 编辑器焦点/选区 → 更新工具栏、列表焦点态
    Editor.el.addEventListener('focus', () => listPaneEl.classList.remove('focused'));
    Editor.el.addEventListener('keyup', updateToolbarState);
    Editor.el.addEventListener('mouseup', updateToolbarState);

    // 粘贴：图片 → 插入；富文本 → 清理内联样式后插入（避免把标题字号等带进来）
    Editor.el.addEventListener('paste', async (e) => {
      const cd = e.clipboardData;
      const items = (cd || {}).items || [];
      const imgs = [];
      for (const it of items) if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) imgs.push(f); }
      if (imgs.length) { e.preventDefault(); await insertImageFiles(imgs); return; }
      const html = cd && cd.getData && cd.getData('text/html');
      if (html && html.trim()) {
        e.preventDefault();
        Editor.insertCleanHTML(html);
      }
    });

    // 右键图片 → 复制 / 删除
    Editor.el.addEventListener('contextmenu', (e) => {
      if (e.target.tagName !== 'IMG') return;
      e.preventDefault();
      const img = e.target;
      const items = [{ label: '复制图片', onClick: () => copyImageToClipboard(img) }];
      const note = findNote(view.noteId);
      if (note && !note.trashed) {
        items.push({ sep: true });
        items.push({ label: '删除图片', danger: true, onClick: () => { img.remove(); onEditorChange(); } });
      }
      showContextMenu(e.clientX, e.clientY, items);
    });

    // 拖拽图片到编辑区
    editorPaneEl.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        editorPaneEl.classList.add('drag-over');
      }
    });
    editorPaneEl.addEventListener('dragleave', (e) => {
      if (e.target === editorPaneEl) editorPaneEl.classList.remove('drag-over');
    });
    editorPaneEl.addEventListener('drop', async (e) => {
      editorPaneEl.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files.length) {
        e.preventDefault();
        // 把光标定位到拖放落点，图片就插在鼠标松开的位置，而不是上次的光标处
        const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
        if (r && Editor.el.contains(r.startContainer)) {
          Editor.el.focus();
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          Editor.saveSelection();
        }
        await insertImageFiles(Array.from(e.dataTransfer.files));
      }
    });

    // 全局点击关闭菜单/弹层
    document.addEventListener('click', (e) => {
      if (!contextMenu.hidden && !contextMenu.contains(e.target)) hideContextMenu();
      if (!formatPopover.hidden && !formatPopover.contains(e.target) && !e.target.closest('[data-cmd="format"]')) hidePopover();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { hideContextMenu(); hidePopover(); if (!syncModal.hidden) closeSyncModal(); }
      // Ctrl/Cmd + \ 收起/展开边栏（Electron 与浏览器都可用，无菜单冲突）
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
    });

    // 快捷键：浏览器预览时用 keydown；Electron 里交给原生菜单以免重复触发
    if (!Storage.hasElectron) {
      document.addEventListener('keydown', (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
        else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newFolder(); }
        else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
        else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleTheme(); }
      });
    } else if (window.notesAPI.onMenuAction) {
      window.notesAPI.onMenuAction((ch) => {
        if (ch === 'menu:new-note') newNote();
        else if (ch === 'menu:new-folder') newFolder();
        else if (ch === 'menu:search') { searchInput.focus(); searchInput.select(); }
        else if (ch === 'menu:toggle-theme') toggleTheme();
      });
    }

    // 关闭前同步落盘，确保最后一次编辑不因异步 IPC 竞态丢失
    window.addEventListener('beforeunload', () => {
      clearTimeout(saveTimer);
      Storage.saveSync(data);
    });
  }

  function handleToolbarCmd(cmd, btn) {
    switch (cmd) {
      case 'format': togglePopover(btn); return;
      case 'bold': Editor.exec('bold'); break;
      case 'italic': Editor.exec('italic'); break;
      case 'underline': Editor.exec('underline'); break;
      case 'strike': Editor.exec('strikeThrough'); break;
      case 'bullet': Editor.toggleBullet(); break;
      case 'checklist': Editor.toggleChecklist(); break;
      case 'image': Editor.saveSelection(); imageInput.click(); break;
      case 'pin': if (view.noteId) togglePin(view.noteId); return;
      case 'delete': handleDeleteCurrent(); return;
    }
    updateToolbarState();
  }

  function handleDeleteCurrent() {
    const note = findNote(view.noteId);
    if (!note) return;
    if (note.trashed) {
      if (confirm('永久删除这条备忘录？此操作不可恢复。')) deleteForever(note.id);
    } else {
      moveNoteToTrash(note.id);
    }
  }

  function togglePopover(btn) {
    if (!formatPopover.hidden) { hidePopover(); return; }
    formatPopover.hidden = false;
    formatPopover.style.left = (btn.offsetLeft) + 'px';
    // 标记当前样式
    const s = Editor.queryState();
    formatPopover.querySelectorAll('.pop-item').forEach((it) => {
      it.classList.toggle('active', it.dataset.style === s.block);
    });
  }
  function hidePopover() { formatPopover.hidden = true; }

  // 清理超过保留期的回收站笔记。render=true 时刷新界面（用于常驻运行时的定时清理）。
  function purgeTrash(render) {
    let changed = false;
    const trashCutoff = now() - TRASH_KEEP_DAYS * 86400000;
    const tombCutoff = now() - TOMBSTONE_KEEP_DAYS * 86400000;
    // 回收站里超过保留期的 → 转成删除墓碑（这样删除也能同步到其它设备）
    data.notes.forEach((n) => {
      if (n.trashed && !n.deleted && n.trashedAt && n.trashedAt < trashCutoff) {
        n.deleted = true; n.deletedAt = now(); n.syncTs = now(); n.content = '';
        pendingSync.add(n.id); changed = true;
      }
    });
    // 非常久以前的墓碑 → 真正移除（此时各设备早已同步过这条删除）
    const bn = data.notes.length, bf = data.folders.length;
    data.notes = data.notes.filter((n) => !(n.deleted && n.deletedAt && n.deletedAt < tombCutoff));
    data.folders = data.folders.filter((f) => !(f.deleted && f.deletedAt && f.deletedAt < tombCutoff));
    if (data.notes.length !== bn || data.folders.length !== bf) changed = true;
    if (!changed) return;
    if (view.noteId && !findNote(view.noteId)) view.noteId = null;
    if (render) { renderFolders(); renderNoteList(); renderEditor(); }
    scheduleSave();
  }

  // ---------- 启动 ----------
  async function init() {
    applyTheme(currentTheme());
    // 显示版本号（右下角），便于区分当前用的是哪个版本
    const verEl = document.getElementById('appVersion');
    if (verEl) {
      const v = (window.notesAPI && window.notesAPI.appVersion) || '';
      verEl.textContent = v ? 'v' + v : '';
    }
    // 恢复边栏收起状态（加载时不播放动画，避免闪一下）
    appEl.classList.add('no-anim');
    if (localStorage.getItem('qingji-sidebar') === '1') {
      appEl.classList.add('sidebar-collapsed');
      sidebarToggle.classList.add('active');
    }
    // 恢复上次拖动的列表宽度
    const savedListW = localStorage.getItem('qingji-listw');
    if (savedListW) appEl.style.setProperty('--list-w', savedListW);
    requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.remove('no-anim')));

    data = await Storage.load();
    if (!data.folders) data.folders = [];
    if (!data.notes) data.notes = [];

    // 启动时清理一次过期回收站，并每 6 小时清理一次（应对长时间常驻不重启）
    purgeTrash(false);
    setInterval(() => purgeTrash(true), 6 * 60 * 60 * 1000);

    Editor.setOnChange(onEditorChange);
    wireUI();

    // 首次使用：放一条欢迎笔记
    if (!data.notes.length && !data.folders.length && !localStorage.getItem('qingji-seeded')) {
      localStorage.setItem('qingji-seeded', '1');
      data.notes.push({
        id: genId('n'), folderId: null,
        content: '<h1>欢迎使用轻记 👋</h1><p>这是一个类似苹果备忘录的小工具。</p>' +
          '<ul class="checklist"><li>点这个圆圈可以打勾</li><li class="checked">支持可勾选的清单</li></ul>' +
          '<p>试试上方工具栏：<b>加粗</b>、<i>斜体</i>、标题、清单、插入图片。</p>' +
          '<p>左侧可以新建文件夹分类，右上角放大镜旁能搜索。所有内容都会<b>自动保存</b>。</p>',
        pinned: false, trashed: false, createdAt: now(), updatedAt: now()
      });
      saveNow();
    }

    renderFolders();
    const first = sortNotes(currentListNotes(), false)[0];
    view.noteId = first ? first.id : null;
    renderNoteList();
    renderEditor();

    // 局域网同步：接入（若上次开着会自动开始）
    Sync.init({ getData: () => data, applyIncoming: applyIncoming, onStatusChange: onSyncStatus });
    renderSyncStatus(Sync.getStatus());
  }

  init();
})();
