/* ============================================================
   编辑器：封装 contentEditable 上的富文本操作。
   基于 Chromium 的 execCommand —— 虽然标准上标注为废弃，但在 Electron
   内置的 Chromium 里完全可用且稳定，是零依赖实现富文本最省心的方案。
   ============================================================ */
const Editor = (() => {
  const el = document.getElementById('editor');
  let savedRange = null;
  let onChange = () => {};

  function setOnChange(fn) { onChange = fn; }

  function focus() { el.focus(); }

  function getHTML() { return el.innerHTML; }
  function getText() { return el.innerText || ''; }

  function setHTML(html) {
    el.innerHTML = html || '';
    savedRange = null;        // 切换笔记后清空旧选区，避免 restoreSelection 用到跨笔记的过期节点
    normalizeLists();         // 顺手修正历史遗留的非法列表嵌套
    wrapLeadingText();        // 把开头的游离文本包进块，让首行标题样式生效
  }

  // ---- 选区保存 / 恢复（点击工具栏、打开文件选择器时会丢失选区）----
  function saveSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount && el.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  }
  function restoreSelection() {
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  function exec(cmd, value = null) {
    el.focus();
    restoreSelection();
    document.execCommand(cmd, false, value);
    saveSelection();
    onChange();
  }

  // ---- 当前选区所在的列表节点 ----
  function currentNode() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    return n.nodeType === 3 ? n.parentNode : n;
  }
  function closestList() {
    let n = currentNode();
    while (n && n !== el) {
      if (n.nodeName === 'UL' || n.nodeName === 'OL') return n;
      n = n.parentNode;
    }
    return null;
  }

  // 把整条列表就地展开成普通段落。确定性实现，不用 execCommand ——
  // execCommand 对折叠光标只作用于当前 <li>，会把多项列表撕成几段。
  function unwrapList(list) {
    const parent = list.parentNode;
    if (!parent) return;
    const paras = [];
    Array.from(list.children).forEach((li) => {
      const p = document.createElement('p');
      while (li.firstChild) p.appendChild(li.firstChild);
      if (!p.firstChild) p.appendChild(document.createElement('br'));
      parent.insertBefore(p, list);
      paras.push(p);
    });
    parent.removeChild(list);
    if (paras.length) {
      const range = document.createRange();
      range.selectNodeContents(paras[0]);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    saveSelection();
    onChange();
  }

  // 修正非法嵌套：execCommand 会产生 <p><ul>…</ul></p> / <h2><ul>…</ul></h2>，
  // 保存-重载后会漂移（多出空行、清单被套进标题字号）。把列表移出这类块级包裹。
  function normalizeLists() {
    Array.from(el.querySelectorAll('ul, ol')).forEach((list) => {
      let p = list.parentNode;
      while (p && p !== el && /^(P|H1|H2|H3|H4)$/.test(p.nodeName)) {
        p.parentNode.insertBefore(list, p.nextSibling);
        if (!p.textContent.trim() && !p.querySelector('img')) p.parentNode.removeChild(p);
        p = list.parentNode;
      }
    });
  }

  // 若内容开头是游离文本 / 内联节点，包进一个 <div>，好让「第一行=标题」的样式生效
  const BLOCK_RE = /^(DIV|P|H1|H2|H3|H4|UL|OL|LI|BLOCKQUOTE|PRE)$/;
  function wrapLeadingText() {
    if (!el.firstChild) return;
    if (el.firstChild.nodeType === 1 && BLOCK_RE.test(el.firstChild.nodeName)) return; // 已是块级
    const wrap = document.createElement('div');
    while (el.firstChild && !(el.firstChild.nodeType === 1 && BLOCK_RE.test(el.firstChild.nodeName))) {
      wrap.appendChild(el.firstChild);
    }
    if (wrap.childNodes.length) el.insertBefore(wrap, el.firstChild);
  }

  // ---- 文字块样式：标题 / 大标题 / 小标题 / 正文 ----
  function setBlock(style) {
    const map = { title: 'H1', heading: 'H2', subheading: 'H3', body: 'P' };
    if (style === 'numbered') { toggleNumbered(); return; }
    const tag = map[style] || 'P';
    exec('formatBlock', tag);
  }

  // ---- 项目符号列表 ----
  function toggleBullet() {
    const list = closestList();
    if (list && list.nodeName === 'UL' && list.classList.contains('checklist')) {
      // 清单 → 普通符号列表：去掉 checklist 类，并清除残留的勾选状态
      list.classList.remove('checklist');
      list.querySelectorAll('li.checked').forEach((li) => li.classList.remove('checked'));
      onChange();
      return;
    }
    if (list && list.nodeName === 'UL') {
      // 已是普通符号列表 → 取消，整条变回段落
      unwrapList(list);
      return;
    }
    exec('insertUnorderedList');
    const nl = closestList();          // 先抓到刚建的列表（此时选区还在其中）
    if (nl) nl.classList.remove('checklist');
    normalizeLists();                  // 再修正嵌套（nl 节点被移动但引用不变）
    onChange();
  }

  // ---- 编号列表 ----
  function toggleNumbered() {
    const list = closestList();
    if (list && list.nodeName === 'OL') { unwrapList(list); return; }
    exec('insertOrderedList');
    normalizeLists();
    onChange();
  }

  // ---- 可勾选清单 ----
  function toggleChecklist() {
    const list = closestList();
    if (list && list.nodeName === 'UL' && list.classList.contains('checklist')) {
      // 已是清单 → 取消，整条列表变回段落（确定性实现，不会撕散列表）
      unwrapList(list);
      return;
    }
    if (list && list.nodeName === 'UL') {
      // 普通符号列表 → 变成清单
      list.classList.add('checklist');
      onChange();
      return;
    }
    // 普通文字 → 新建清单
    exec('insertUnorderedList');
    const nl = closestList();          // 先抓到刚建的列表（此时选区还在其中）
    if (nl) nl.classList.add('checklist');
    normalizeLists();                  // 再修正嵌套（nl 节点被移动但引用不变）
    onChange();
  }

  // ---- 插入图片（dataURL）----
  function insertImage(dataUrl) {
    el.focus();
    restoreSelection();
    document.execCommand('insertHTML', false,
      `<img src="${dataUrl}" alt="图片" /><p><br/></p>`);
    saveSelection();
    onChange();
  }

  // ---- 当前格式状态（用于点亮工具栏按钮）----
  function queryState() {
    const list = closestList();
    let block = 'body';
    let n = currentNode();
    while (n && n !== el) {
      if (n.nodeName === 'H1') { block = 'title'; break; }
      if (n.nodeName === 'H2') { block = 'heading'; break; }
      if (n.nodeName === 'H3') { block = 'subheading'; break; }
      n = n.parentNode;
    }
    let listType = 'none';
    if (list && list.nodeName === 'UL') listType = list.classList.contains('checklist') ? 'checklist' : 'bullet';
    else if (list && list.nodeName === 'OL') listType = 'numbered';
    return {
      bold: safeState('bold'),
      italic: safeState('italic'),
      underline: safeState('underline'),
      strike: safeState('strikeThrough'),
      block,
      listType
    };
  }
  function safeState(cmd) {
    try { return document.queryCommandState(cmd); } catch (e) { return false; }
  }

  el.addEventListener('click', (e) => {
    // 点击图片 → 选中整张图，方便复制（回收站只读态也允许，好把图复制走）
    if (e.target.tagName === 'IMG') {
      const range = document.createRange();
      range.selectNode(e.target);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    // ---- 点击圆圈勾选 ----
    if (!el.isContentEditable) return;   // 回收站等只读状态下不响应勾选
    const li = e.target.closest('li');
    if (li && li.parentElement && li.parentElement.classList.contains('checklist')) {
      const rect = li.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x <= 28 && y <= 26) {
        li.classList.toggle('checked');
        e.preventDefault();
        onChange();
      }
    }
  });

  // 记录选区变化
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === el) saveSelection();
  });
  el.addEventListener('keyup', saveSelection);
  el.addEventListener('mouseup', saveSelection);

  // 输入即触发保存
  el.addEventListener('input', () => onChange());

  return {
    el,
    setOnChange,
    focus,
    getHTML,
    getText,
    setHTML,
    saveSelection,
    restoreSelection,
    exec,
    setBlock,
    toggleBullet,
    toggleNumbered,
    toggleChecklist,
    insertImage,
    queryState
  };
})();
