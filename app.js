/* ============================================================
   我的日记本 - app.js
   File System Access API 版本 v2
   数据存储在用户指定的本地 .json 文件，跨浏览器可访问
   ============================================================ */

'use strict';

// ============================================================
// 工具函数
// ============================================================

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function formatDateShort(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showLoading(msg = '正在读取数据文件...') {
  const overlay = document.getElementById('loading-overlay');
  const msgEl = document.getElementById('loading-message');
  if (msgEl) msgEl.textContent = msg;
  overlay.classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

let toastTimer = null;
function showToast(msg, duration = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

// ============================================================
// 内存数据仓库（单一数据源）
// ============================================================

let appData = {
  version: 2,
  books: [],
  entries: [],
  images: [],
};

function getBooks() { return appData.books; }
function getEntries() { return appData.entries; }
function getEntriesByBook(bookId) {
  return appData.entries
    .filter(e => e.bookId === bookId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getImageObj(imageId) {
  return appData.images.find(img => img.id === imageId) || null;
}

function getImageDataUrl(imageId) {
  const img = getImageObj(imageId);
  if (!img) return null;
  return `data:${img.mimeType};base64,${img.data}`;
}

function addImageToStore(imageObj) {
  appData.images.push(imageObj);
}

function removeImageFromStore(imageId) {
  appData.images = appData.images.filter(img => img.id !== imageId);
}

function getDataFileSizeBytes() {
  return new Blob([JSON.stringify(appData)]).size;
}

// ============================================================
// FileSystemFileHandle 持久化（用 IndexedDB 存 handle 对象）
// ============================================================

const HANDLE_DB_NAME = 'DiaryHandleDB';
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'lastFileHandle';

let _handleDb = null;

function openHandleDB() {
  if (_handleDb) return Promise.resolve(_handleDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, HANDLE_DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = e => { _handleDb = e.target.result; resolve(_handleDb); };
    req.onerror = () => reject(req.error);
  });
}

async function persistHandle(handle) {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) {
    // 部分浏览器（如 Safari）不支持持久化 handle，静默忽略
  }
}

async function restoreHandle() {
  try {
    const db = await openHandleDB();
    return new Promise((resolve) => {
      const req = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function clearPersistedHandle() {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
  } catch { /* ignore */ }
}

// ============================================================
// File System Access API — 读写文件
// ============================================================

let fileHandle = null;

function isFileSystemSupported() {
  return 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
}

async function ensureWritePermission(handle) {
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return true;
  const req = await handle.requestPermission({ mode: 'readwrite' });
  return req === 'granted';
}

async function loadFromHandle(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.books || !data.entries) throw new Error('文件格式不正确');
  const books = (data.books || []).map((b, idx) => ({
    pinned: false,
    sortOrder: idx,
    ...b,
  }));
  const entries = (data.entries || []).map(e => ({
    mood: '',
    tags: [],
    ...e,
  }));
  appData = {
    version: data.version || 2,
    books,
    entries,
    images: data.images || [],
  };
  fileHandle = handle;
  await persistHandle(handle);
  updateFileInfo(file.name);
}

async function saveToFile() {
  if (!fileHandle) return;
  const granted = await ensureWritePermission(fileHandle);
  if (!granted) { showToast('需要文件写入权限才能保存'); return; }
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(appData, null, 2));
    await writable.close();
    showSaveIndicator();
  } catch (err) {
    showToast('保存失败：' + err.message);
  }
}

function updateFileInfo(name) {
  const el = document.getElementById('current-file-name');
  if (el) el.textContent = name || '未知文件';
}

let _saveIndicatorTimer = null;
function showSaveIndicator(msg = '已保存') {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  if (_saveIndicatorTimer) clearTimeout(_saveIndicatorTimer);
  _saveIndicatorTimer = setTimeout(() => el.classList.remove('visible'), 2000);
}

// ============================================================
// 欢迎页：新建 / 打开 / 记住上次文件
// ============================================================

async function initWelcome() {
  if (!isFileSystemSupported()) {
    showView('unsupported');
    return;
  }

  // 尝试恢复上次的文件 handle
  const savedHandle = await restoreHandle();
  const reopenBtn = document.getElementById('btn-reopen-file');
  const reopenDesc = document.getElementById('reopen-file-desc');

  if (savedHandle) {
    try {
      // 检查文件是否仍然可访问（不需要 requestPermission，只是检查）
      const perm = await savedHandle.queryPermission({ mode: 'readwrite' });
      reopenBtn.classList.remove('hidden');
      const file = await savedHandle.getFile().catch(() => null);
      const fname = file ? file.name : '上次的数据文件';
      reopenDesc.textContent = fname;
      reopenBtn.dataset.handle = 'pending'; // 标记有待恢复的 handle
      // 存到临时变量供点击时使用
      window._savedHandle = savedHandle;
    } catch {
      reopenBtn.classList.add('hidden');
    }
  } else {
    reopenBtn.classList.add('hidden');
  }

  showView('welcome');
}

async function handleReopenFile() {
  const handle = window._savedHandle;
  if (!handle) return;
  try {
    const granted = await handle.requestPermission({ mode: 'readwrite' });
    if (granted !== 'granted') { showToast('需要文件访问权限'); return; }
    showLoading('正在读取数据文件...');
    await loadFromHandle(handle);
    hideLoading();
    await renderHome();
    showView('home');
  } catch (err) {
    hideLoading();
    showToast('无法打开文件：' + err.message);
    await clearPersistedHandle();
    document.getElementById('btn-reopen-file').classList.add('hidden');
  }
}

async function handleNewFile() {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'diary_data.json',
      types: [{ description: '日记数据文件', accept: { 'application/json': ['.json'] } }],
    });
    // 初始化空数据并写入
    appData = { version: 2, books: [], entries: [], images: [] };
    fileHandle = handle;
    await saveToFile();
    await persistHandle(handle);
    const file = await handle.getFile();
    updateFileInfo(file.name);
    await renderHome();
    showView('home');
  } catch (err) {
    if (err.name !== 'AbortError') showToast('创建文件失败：' + err.message);
  }
}

async function handleOpenFile() {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: '日记数据文件', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    const granted = await handle.requestPermission({ mode: 'readwrite' });
    if (granted !== 'granted') { showToast('需要文件读写权限'); return; }
    showLoading('正在读取数据文件...');
    await loadFromHandle(handle);
    hideLoading();
    await renderHome();
    showView('home');
  } catch (err) {
    hideLoading();
    if (err.name !== 'AbortError') showToast('打开文件失败：' + err.message);
  }
}

async function handleSwitchFile() {
  showConfirm(
    '切换数据文件',
    '切换后当前数据文件不会删除，你可以随时重新打开它。确认切换？',
    async () => {
      fileHandle = null;
      window._savedHandle = null;
      await clearPersistedHandle();
      appData = { version: 2, books: [], entries: [], images: [] };
      await initWelcome();
    }
  );
}

// ============================================================
// 图片压缩
// ============================================================

function compressImage(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height / width) * maxWidth);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, quality);
        const base64 = dataUrl.split(',')[1];
        const byteSize = Math.round(base64.length * 0.75);
        resolve({ dataUrl, base64, mimeType, size: byteSize });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveImageFile(file) {
  const { dataUrl, base64, mimeType, size } = await compressImage(file);
  const id = 'img_' + genId();
  addImageToStore({ id, data: base64, mimeType, size });
  return { id, dataUrl };
}

// ============================================================
// 视图路由
// ============================================================

let currentView = 'welcome';
let currentBookId = null;
let currentEntryId = null;
let _entrySearchQuery = '';
let _bookSortOrder = 'custom';
let _isDirty = false;

function markDirty() { _isDirty = true; }
function markClean() { _isDirty = false; }

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function showView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + viewName);
  if (target) target.classList.add('active');
  currentView = viewName;

  const backBtn = document.getElementById('btn-back');
  const navTitle = document.getElementById('navbar-title');
  const dataMgmtBtn = document.getElementById('btn-data-mgmt');

  const isWelcome = viewName === 'welcome' || viewName === 'unsupported';
  dataMgmtBtn.classList.toggle('hidden', isWelcome);

  if (viewName === 'welcome' || viewName === 'unsupported') {
    backBtn.classList.add('hidden');
    navTitle.textContent = '我的日记本';
  } else if (viewName === 'home') {
    backBtn.classList.add('hidden');
    navTitle.textContent = '我的日记本';
  } else if (viewName === 'book') {
    backBtn.classList.remove('hidden');
    const book = getBooks().find(b => b.id === currentBookId);
    navTitle.textContent = book ? book.name : '日记本';
  } else if (viewName === 'entry') {
    backBtn.classList.remove('hidden');
    navTitle.textContent = '记录日记';
  } else if (viewName === 'data') {
    backBtn.classList.remove('hidden');
    navTitle.textContent = '数据管理';
    refreshDataStats();
  }
}

// ============================================================
// 确认弹窗
// ============================================================

function showConfirm(title, message, onConfirm, confirmLabel = '确认', isDanger = true) {
  const overlay = document.getElementById('modal-confirm');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  const okBtn = document.getElementById('confirm-ok');
  okBtn.textContent = confirmLabel;
  okBtn.className = isDanger ? 'btn-danger' : 'btn-primary';
  overlay.classList.remove('hidden');

  const close = () => overlay.classList.add('hidden');
  const handleOk = () => { close(); onConfirm(); };

  okBtn.onclick = handleOk;
  document.getElementById('confirm-cancel').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
}

// ============================================================
// 日记本弹窗
// ============================================================

let _bookModalMode = 'create';
let _editingBookId = null;
let _pendingCoverImageId = null;
let _pendingCoverDataUrl = null;
let _existingCoverImageId = null;

function openBookModal(mode, bookId = null) {
  _bookModalMode = mode;
  _editingBookId = bookId;
  _pendingCoverImageId = null;
  _pendingCoverDataUrl = null;
  _existingCoverImageId = null;

  const modal = document.getElementById('modal-book');
  const titleEl = document.getElementById('modal-book-title');
  const nameInput = document.getElementById('modal-book-name');
  const preview = document.getElementById('cover-preview');
  const placeholder = document.getElementById('cover-upload-placeholder');
  const removeBtn = document.getElementById('btn-remove-cover');

  preview.src = '';
  preview.classList.add('hidden');
  placeholder.classList.remove('hidden');
  removeBtn.classList.add('hidden');
  nameInput.value = '';

  if (mode === 'edit' && bookId) {
    titleEl.textContent = '编辑日记本';
    const book = getBooks().find(b => b.id === bookId);
    if (book) {
      nameInput.value = book.name;
      _existingCoverImageId = book.coverImageId || null;
      if (book.coverImageId) {
        const url = getImageDataUrl(book.coverImageId);
        if (url) {
          preview.src = url;
          preview.classList.remove('hidden');
          placeholder.classList.add('hidden');
          removeBtn.classList.remove('hidden');
        }
      }
    }
  } else {
    titleEl.textContent = '新建日记本';
  }

  modal.classList.remove('hidden');
  nameInput.focus();
}

function closeBookModal() {
  document.getElementById('modal-book').classList.add('hidden');
  // 如果有临时上传的封面但弹窗被取消，清理掉这个图片
  if (_pendingCoverImageId) {
    removeImageFromStore(_pendingCoverImageId);
  }
  _pendingCoverImageId = null;
  _pendingCoverDataUrl = null;
}

async function confirmBookModal() {
  const name = document.getElementById('modal-book-name').value.trim();
  if (!name) { showToast('请输入日记本名称'); return; }

  const books = getBooks();
  const now = new Date().toISOString();

  let coverImageId = _existingCoverImageId;

  if (_pendingCoverDataUrl && _pendingCoverImageId) {
    // 新上传了封面（已在 cover file input change 时加入 store）
    coverImageId = _pendingCoverImageId;
    // 如果之前有旧封面，移除
    if (_existingCoverImageId && _existingCoverImageId !== _pendingCoverImageId) {
      removeImageFromStore(_existingCoverImageId);
    }
  } else if (_pendingCoverImageId === null && !_pendingCoverDataUrl && _existingCoverImageId !== undefined) {
    // 封面被移除（_existingCoverImageId 已被设为 null）
    coverImageId = _existingCoverImageId; // 此时为 null
  }

  if (_bookModalMode === 'create') {
    const book = { id: genId(), name, coverImageId: coverImageId || null, createdAt: now, updatedAt: now, pinned: false, sortOrder: appData.books.length };
    appData.books.push(book);
    showToast('日记本已创建');
  } else {
    const idx = books.findIndex(b => b.id === _editingBookId);
    if (idx > -1) {
      appData.books[idx].name = name;
      appData.books[idx].coverImageId = coverImageId || null;
      appData.books[idx].updatedAt = now;
      showToast('已保存');
    }
  }

  _pendingCoverImageId = null;
  _pendingCoverDataUrl = null;
  document.getElementById('modal-book').classList.add('hidden');

  await saveToFile();
  if (currentView === 'home') await renderHome();
  else if (currentView === 'book') await renderBookView(currentBookId);
}

// ============================================================
// 首页渲染
// ============================================================

function getSortedBooks() {
  const books = [...getBooks()];
  const pinned = books.filter(b => b.pinned);
  const unpinned = books.filter(b => !b.pinned);

  const sortFn = (a, b) => {
    switch (_bookSortOrder) {
      case 'updated': return new Date(b.updatedAt) - new Date(a.updatedAt);
      case 'created': return new Date(b.createdAt) - new Date(a.createdAt);
      case 'entries': return getEntriesByBook(b.id).length - getEntriesByBook(a.id).length;
      case 'name': return a.name.localeCompare(b.name, 'zh');
      default: return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    }
  };

  return [...pinned.sort(sortFn), ...unpinned.sort(sortFn)];
}

async function togglePinBook(bookId, event) {
  event.stopPropagation();
  const idx = appData.books.findIndex(b => b.id === bookId);
  if (idx === -1) return;
  appData.books[idx].pinned = !appData.books[idx].pinned;
  await saveToFile();
  await renderHome();
}

async function renderHome() {
  const books = getBooks();
  const grid = document.getElementById('books-grid');
  const empty = document.getElementById('books-empty');
  document.getElementById('books-count').textContent = books.length;

  const sortSelect = document.getElementById('books-sort');
  if (sortSelect) sortSelect.value = _bookSortOrder;

  grid.innerHTML = '';

  if (books.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const book of getSortedBooks()) {
    const card = document.createElement('div');
    card.className = 'book-card' + (book.pinned ? ' pinned' : '');
    card.dataset.bookId = book.id;

    let coverHtml = `<div class="book-card-cover-placeholder">📔</div>`;
    if (book.coverImageId) {
      const url = getImageDataUrl(book.coverImageId);
      if (url) coverHtml = `<img class="book-card-cover" src="${url}" alt="${escapeHtml(book.name)}" />`;
    }

    const entries = getEntriesByBook(book.id);
    const pinIcon = book.pinned ? '📌' : '📍';
    card.innerHTML = `
      <button class="book-pin-btn ${book.pinned ? 'is-pinned' : ''}" title="${book.pinned ? '取消置顶' : '置顶'}">${pinIcon}</button>
      ${coverHtml}
      <div class="book-card-body">
        <div class="book-card-name">${escapeHtml(book.name)}</div>
        <div class="book-card-meta">${entries.length} 篇 · ${formatDateShort(book.updatedAt)}</div>
      </div>
    `;
    card.querySelector('.book-pin-btn').addEventListener('click', e => togglePinBook(book.id, e));
    card.addEventListener('click', () => navigateToBook(book.id));
    grid.appendChild(card);
  }
}

// ============================================================
// 日记本详情
// ============================================================

async function navigateToBook(bookId) {
  currentBookId = bookId;
  _entrySearchQuery = '';
  const searchInput = document.getElementById('entries-search');
  if (searchInput) searchInput.value = '';
  await renderBookView(bookId);
  showView('book');
}

async function renderBookView(bookId) {
  const book = getBooks().find(b => b.id === bookId);
  if (!book) { await renderHome(); showView('home'); return; }

  document.getElementById('book-title-display').textContent = book.name;

  const allEntries = getEntriesByBook(bookId);
  document.getElementById('entries-count').textContent = allEntries.length;
  document.getElementById('book-meta-display').textContent =
    `创建于 ${formatDate(book.createdAt)}`;

  const q = _entrySearchQuery.trim().toLowerCase();
  const entries = q
    ? allEntries.filter(e =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.content || '').toLowerCase().includes(q)
      )
    : allEntries;

  const coverDisplay = document.getElementById('book-cover-display');
  coverDisplay.innerHTML = '';
  if (book.coverImageId) {
    const url = getImageDataUrl(book.coverImageId);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = book.name;
      coverDisplay.appendChild(img);
    } else {
      coverDisplay.innerHTML = '<span class="book-cover-placeholder">📖</span>';
    }
  } else {
    coverDisplay.innerHTML = '<span class="book-cover-placeholder">📖</span>';
  }

  const list = document.getElementById('entries-list');
  const empty = document.getElementById('entries-empty');
  list.innerHTML = '';

  if (entries.length === 0) {
    empty.classList.remove('hidden');
    empty.innerHTML = q
      ? `<div class="empty-icon">🔍</div><p>未找到匹配的日记</p><p class="empty-sub">试试其他关键词</p>`
      : `<div class="empty-icon">✏️</div><p>这本日记还没有内容</p><p class="empty-sub">点击"新建日记"开始书写</p>`;
    return;
  }
  empty.classList.add('hidden');

  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.entryId = entry.id;

    let thumbHtml = `<div class="entry-card-thumb-placeholder">✏️</div>`;
    if (entry.imageIds && entry.imageIds.length > 0) {
      const url = getImageDataUrl(entry.imageIds[0]);
      if (url) thumbHtml = `<img class="entry-card-thumb" src="${url}" alt="" />`;
    }

    const title = entry.title || '（无标题）';
    const excerpt = (entry.content || '').slice(0, 80).replace(/\n/g, ' ');
    const updated = entry.updatedAt !== entry.createdAt
      ? `编辑于 ${formatDate(entry.updatedAt)}`
      : '';

    const moodHtml = entry.mood ? `<span class="entry-card-mood">${entry.mood}</span>` : '';
    const tagsHtml = (entry.tags && entry.tags.length > 0)
      ? `<div class="entry-card-tags">${entry.tags.map(t => `<span class="entry-card-tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    card.innerHTML = `
      ${thumbHtml}
      <div class="entry-card-body">
        <div class="entry-card-title">${moodHtml}${escapeHtml(title)}</div>
        <div class="entry-card-excerpt">${escapeHtml(excerpt) || '<span style="opacity:0.5">（空白日记）</span>'}</div>
        ${tagsHtml}
        <div class="entry-card-dates">
          创建于 ${formatDate(entry.createdAt)}
          ${updated ? ' · ' + updated : ''}
        </div>
      </div>
    `;
    card.addEventListener('click', () => navigateToEntry(entry.id));
    list.appendChild(card);
  }
}

// ============================================================
// 条目编辑
// ============================================================

let _currentEntryImageIds = [];
let _removedImageIds = [];
let _currentMood = '';
let _currentTags = [];

async function navigateToEntry(entryId) {
  currentEntryId = entryId;
  _currentEntryImageIds = [];
  _removedImageIds = [];
  _currentMood = '';
  _currentTags = [];
  markClean();

  const entry = getEntries().find(e => e.id === entryId);

  if (entry) {
    document.getElementById('entry-title-input').value = entry.title || '';
    document.getElementById('entry-content-input').value = entry.content || '';
    document.getElementById('entry-created-display').textContent =
      '创建于 ' + formatDate(entry.createdAt);
    document.getElementById('entry-updated-display').textContent =
      entry.updatedAt !== entry.createdAt ? '编辑于 ' + formatDate(entry.updatedAt) : '';
    _currentEntryImageIds = [...(entry.imageIds || [])];
    _currentMood = entry.mood || '';
    _currentTags = [...(entry.tags || [])];
  } else {
    document.getElementById('entry-title-input').value = '';
    document.getElementById('entry-content-input').value = '';
    document.getElementById('entry-created-display').textContent = '';
    document.getElementById('entry-updated-display').textContent = '';
  }

  renderMoodSelector();
  renderTagChips();
  renderEntryImages();
  showView('entry');
}

async function createNewEntry() {
  const now = new Date().toISOString();
  const entry = {
    id: genId(),
    bookId: currentBookId,
    title: '',
    content: '',
    imageIds: [],
    mood: '',
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  appData.entries.push(entry);
  await saveToFile();
  await navigateToEntry(entry.id);
}

function renderMoodSelector() {
  document.querySelectorAll('.mood-btn[data-mood]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.mood === _currentMood);
  });
  const clearBtn = document.getElementById('btn-clear-mood');
  if (clearBtn) clearBtn.classList.toggle('hidden', !_currentMood);
}

function renderTagChips() {
  const container = document.getElementById('entry-tag-chips');
  if (!container) return;
  container.innerHTML = '';
  _currentTags.forEach((tag, idx) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(tag)}<button data-idx="${idx}" title="移除标签">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      _currentTags.splice(idx, 1);
      markDirty();
      renderTagChips();
    });
    container.appendChild(chip);
  });
}

function renderEntryImages() {
  const preview = document.getElementById('entry-images-preview');
  preview.innerHTML = '';
  for (const imgId of _currentEntryImageIds) {
    const url = getImageDataUrl(imgId);
    if (!url) continue;
    const item = document.createElement('div');
    item.className = 'entry-image-item';
    item.innerHTML = `
      <img src="${url}" alt="" />
      <button class="entry-image-remove" data-img-id="${imgId}" title="移除图片">✕</button>
    `;
    item.querySelector('.entry-image-remove').addEventListener('click', () => {
      _removedImageIds.push(imgId);
      _currentEntryImageIds = _currentEntryImageIds.filter(id => id !== imgId);
      markDirty();
      renderEntryImages();
    });
    preview.appendChild(item);
  }
}

async function saveEntry() {
  const title = document.getElementById('entry-title-input').value.trim();
  const content = document.getElementById('entry-content-input').value;
  const idx = appData.entries.findIndex(e => e.id === currentEntryId);

  if (idx === -1) return;

  const now = new Date().toISOString();
  appData.entries[idx].title = title;
  appData.entries[idx].content = content;
  appData.entries[idx].imageIds = [..._currentEntryImageIds];
  appData.entries[idx].mood = _currentMood;
  appData.entries[idx].tags = [..._currentTags];
  appData.entries[idx].updatedAt = now;

  // 清理被移除的图片
  for (const imgId of _removedImageIds) {
    removeImageFromStore(imgId);
  }
  _removedImageIds = [];

  await saveToFile();
  markClean();

  document.getElementById('entry-updated-display').textContent =
    '编辑于 ' + formatDate(now);

  showToast('已保存');
}

async function deleteEntry(entryId) {
  const entry = appData.entries.find(e => e.id === entryId);
  if (!entry) return;

  for (const imgId of (entry.imageIds || [])) {
    removeImageFromStore(imgId);
  }

  appData.entries = appData.entries.filter(e => e.id !== entryId);
  await saveToFile();
  showToast('日记已删除');
  await renderBookView(currentBookId);
  showView('book');
}

function openMoveEntryModal() {
  const otherBooks = getBooks().filter(b => b.id !== currentBookId);
  const list = document.getElementById('move-entry-book-list');
  list.innerHTML = '';

  if (otherBooks.length === 0) {
    list.innerHTML = '<p style="color:var(--text-secondary);font-size:0.88rem;text-align:center;padding:16px 0">只有一本日记本，无法移动</p>';
  } else {
    for (const book of otherBooks) {
      const item = document.createElement('div');
      item.className = 'move-book-item';
      const cnt = getEntriesByBook(book.id).length;
      item.innerHTML = `
        <div>
          <div class="move-book-item-name">${escapeHtml(book.name)}</div>
          <div class="move-book-item-meta">${cnt} 篇日记</div>
        </div>
      `;
      item.addEventListener('click', () => confirmMoveEntry(book.id));
      list.appendChild(item);
    }
  }

  document.getElementById('modal-move-entry').classList.remove('hidden');
}

async function confirmMoveEntry(targetBookId) {
  document.getElementById('modal-move-entry').classList.add('hidden');
  const idx = appData.entries.findIndex(e => e.id === currentEntryId);
  if (idx === -1) return;

  if (_isDirty) {
    await saveEntry();
  }

  const fromBookId = currentBookId;
  appData.entries[idx].bookId = targetBookId;
  await saveToFile();

  showToast('已移动到「' + (getBooks().find(b => b.id === targetBookId)?.name || '') + '」');
  currentBookId = fromBookId;
  markClean();
  await renderBookView(fromBookId);
  showView('book');
}

async function deleteBook(bookId) {
  const book = appData.books.find(b => b.id === bookId);
  if (!book) return;

  if (book.coverImageId) removeImageFromStore(book.coverImageId);

  const bookEntries = appData.entries.filter(e => e.bookId === bookId);
  for (const entry of bookEntries) {
    for (const imgId of (entry.imageIds || [])) {
      removeImageFromStore(imgId);
    }
  }

  appData.books = appData.books.filter(b => b.id !== bookId);
  appData.entries = appData.entries.filter(e => e.bookId !== bookId);
  await saveToFile();
  showToast('日记本已删除');
  await renderHome();
  showView('home');
}

// ============================================================
// 导出单本日记为 Markdown
// ============================================================

function exportBookAsMarkdown(bookId) {
  const book = getBooks().find(b => b.id === bookId);
  if (!book) return;

  const entries = getEntriesByBook(bookId);
  const exportDate = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });

  let md = `# ${book.name}\n\n`;
  md += `> 导出时间：${exportDate}　共 ${entries.length} 篇日记\n\n`;
  md += `---\n\n`;

  if (entries.length === 0) {
    md += '*这本日记还没有任何内容。*\n';
  } else {
    for (const entry of entries) {
      const title = entry.title || '（无标题）';
      md += `## ${title}\n\n`;

      const moodLine = entry.mood ? `心情：${entry.mood}　` : '';
      const tagsLine = (entry.tags && entry.tags.length > 0) ? `标签：${entry.tags.join('、')}　` : '';
      const dateLine = `创建于 ${formatDate(entry.createdAt)}`;
      md += `*${moodLine}${tagsLine}${dateLine}*\n\n`;

      if (entry.imageIds && entry.imageIds.length > 0) {
        md += `${entry.imageIds.map(() => '[图片]').join(' ')}\n\n`;
      }

      if (entry.content) {
        md += `${entry.content}\n\n`;
      }

      md += `---\n\n`;
    }
  }

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = formatDateShort(new Date().toISOString()).replace(/-/g, '');
  const safeName = book.name.replace(/[\\/:*?"<>|]/g, '_');
  a.href = url;
  a.download = `${safeName}_export_${dateStr}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出为 Markdown 文件');
}

// ============================================================
// 数据管理页
// ============================================================

async function refreshDataStats() {
  const books = getBooks();
  const entries = getEntries();
  const images = appData.images;

  document.getElementById('stat-books').textContent = books.length;
  document.getElementById('stat-entries').textContent = entries.length;
  document.getElementById('stat-images').textContent = images.length;

  const fileBytes = getDataFileSizeBytes();
  document.getElementById('file-size-display').textContent = formatBytes(fileBytes);

  const imgBytes = images.reduce((s, img) => s + (img.size || 0), 0);
  document.getElementById('img-size-display').textContent = formatBytes(imgBytes);

  if (fileHandle) {
    try {
      const file = await fileHandle.getFile();
      document.getElementById('current-file-name').textContent = file.name;
    } catch { /* ignore */ }
  }
}

// ============================================================
// 下载备份副本
// ============================================================

async function downloadBackup() {
  const exportBtn = document.getElementById('btn-export');
  const progress = document.getElementById('export-progress');
  exportBtn.disabled = true;
  progress.classList.remove('hidden');
  progress.textContent = '正在打包数据，请稍候...';

  try {
    const json = JSON.stringify(appData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = formatDateShort(new Date().toISOString()).replace(/-/g, '');
    a.href = url;
    a.download = `diary_backup_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
    progress.textContent = `备份下载成功！文件大小：${sizeMB} MB`;
    showToast('备份下载成功');
  } catch (err) {
    progress.textContent = '下载失败：' + err.message;
    showToast('下载失败');
  } finally {
    exportBtn.disabled = false;
  }
}

// ============================================================
// 从旧版备份文件导入（v1 格式兼容）
// ============================================================

async function importFromBackup(file) {
  const progress = document.getElementById('import-progress');
  progress.classList.remove('hidden');
  progress.textContent = '正在读取备份文件...';

  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (!backup.books || !backup.entries) {
      throw new Error('文件格式不正确，请选择由本应用导出的备份文件。');
    }

    showConfirm(
      '确认导入',
      `此操作将用备份文件中的数据（${backup.books.length} 本日记，${backup.entries.length} 篇条目）覆盖当前数据文件。确认吗？`,
      async () => {
        progress.textContent = '正在导入数据...';
        try {
          appData = {
            version: backup.version || 2,
            books: backup.books || [],
            entries: backup.entries || [],
            images: backup.images || [],
          };
          await saveToFile();
          progress.textContent = `导入成功！恢复了 ${backup.books.length} 本日记，${backup.entries.length} 篇条目，${(backup.images || []).length} 张图片。`;
          showToast('数据导入成功');
          await renderHome();
          showView('home');
          refreshDataStats();
        } catch (err) {
          progress.textContent = '导入过程中出错：' + err.message;
          showToast('导入失败');
        }
      }
    );
  } catch (err) {
    progress.textContent = '读取失败：' + err.message;
    showToast('导入失败');
  }
}

// ============================================================
// 清空当前数据文件
// ============================================================

async function clearAllData() {
  showConfirm(
    '清空全部数据',
    '此操作将清空当前数据文件中的所有日记本、日记条目和图片，且无法撤销！',
    async () => {
      appData = { version: 2, books: [], entries: [], images: [] };
      await saveToFile();
      showToast('全部数据已清空');
      await renderHome();
      showView('home');
    }
  );
}

// ============================================================
// 主题切换（主题偏好仍存 localStorage，与数据无关）
// ============================================================

function initTheme() {
  const saved = localStorage.getItem('diary_theme') || 'light';
  document.documentElement.dataset.theme = saved;
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('diary_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  document.getElementById('btn-theme').textContent = theme === 'dark' ? '☀' : '☽';
}

// ============================================================
// 事件绑定
// ============================================================

function bindEvents() {
  // 导航
  document.getElementById('btn-back').addEventListener('click', () => {
    if (currentView === 'book') { renderHome(); showView('home'); }
    else if (currentView === 'entry') {
      if (_isDirty) {
        showConfirm('有未保存的内容', '当前日记还有未保存的修改，返回后会丢失。确定不保存吗？', () => {
          markClean();
          renderBookView(currentBookId);
          showView('book');
        }, '不保存，直接返回', true);
      } else {
        renderBookView(currentBookId);
        showView('book');
      }
    }
    else if (currentView === 'data') showView('home');
  });

  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-data-mgmt').addEventListener('click', () => showView('data'));

  // 欢迎页
  document.getElementById('btn-reopen-file').addEventListener('click', handleReopenFile);
  document.getElementById('btn-new-file').addEventListener('click', handleNewFile);
  document.getElementById('btn-open-file').addEventListener('click', handleOpenFile);

  // 首页
  document.getElementById('books-sort').addEventListener('change', e => {
    _bookSortOrder = e.target.value;
    renderHome();
  });
  document.getElementById('btn-new-book').addEventListener('click', () => openBookModal('create'));

  // 日记本弹窗
  document.getElementById('modal-book-cancel').addEventListener('click', closeBookModal);
  document.getElementById('modal-book-confirm').addEventListener('click', confirmBookModal);
  document.getElementById('modal-book').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-book')) closeBookModal();
  });

  // 封面上传
  document.getElementById('cover-upload-area').addEventListener('click', () => {
    document.getElementById('cover-file-input').click();
  });
  document.getElementById('cover-file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const { dataUrl, base64, mimeType, size } = await compressImage(file);
    const id = 'img_' + genId();
    _pendingCoverImageId = id;
    _pendingCoverDataUrl = dataUrl;
    // 先存入 store（确认时保留，取消时在 closeBookModal 清理）
    addImageToStore({ id, data: base64, mimeType, size });

    const preview = document.getElementById('cover-preview');
    preview.src = dataUrl;
    preview.classList.remove('hidden');
    document.getElementById('cover-upload-placeholder').classList.add('hidden');
    document.getElementById('btn-remove-cover').classList.remove('hidden');
    e.target.value = '';
  });

  document.getElementById('btn-remove-cover').addEventListener('click', () => {
    // 清理新上传的封面（如果有）
    if (_pendingCoverImageId) {
      removeImageFromStore(_pendingCoverImageId);
      _pendingCoverImageId = null;
      _pendingCoverDataUrl = null;
    }
    _existingCoverImageId = null;
    document.getElementById('cover-preview').src = '';
    document.getElementById('cover-preview').classList.add('hidden');
    document.getElementById('cover-upload-placeholder').classList.remove('hidden');
    document.getElementById('btn-remove-cover').classList.add('hidden');
  });

  // 日记本详情页
  document.getElementById('btn-edit-book').addEventListener('click', () => {
    openBookModal('edit', currentBookId);
  });
  document.getElementById('btn-export-book').addEventListener('click', () => {
    exportBookAsMarkdown(currentBookId);
  });
  document.getElementById('btn-delete-book').addEventListener('click', () => {
    const book = getBooks().find(b => b.id === currentBookId);
    if (!book) return;
    const cnt = getEntriesByBook(currentBookId).length;
    showConfirm(
      '删除日记本',
      `确定要删除《${book.name}》吗？其中 ${cnt} 篇日记将一并删除，且无法恢复。`,
      () => deleteBook(currentBookId)
    );
  });

  document.getElementById('btn-new-entry').addEventListener('click', createNewEntry);

  document.getElementById('entries-search').addEventListener('input', e => {
    _entrySearchQuery = e.target.value;
    renderBookView(currentBookId);
  });

  // 条目编辑页 — 标记未保存 + 防抖自动保存
  const autoSave = debounce(async () => {
    if (_isDirty && currentView === 'entry' && currentEntryId) {
      showSaveIndicator('自动保存中...');
      await saveEntry();
    }
  }, 2000);

  document.getElementById('entry-title-input').addEventListener('input', () => { markDirty(); autoSave(); });
  document.getElementById('entry-content-input').addEventListener('input', () => { markDirty(); autoSave(); });

  // 条目编辑页
  document.getElementById('btn-save-entry').addEventListener('click', saveEntry);
  document.getElementById('btn-delete-entry').addEventListener('click', () => {
    showConfirm('删除日记', '确定要删除这篇日记吗？此操作无法撤销。', () => deleteEntry(currentEntryId));
  });

  // 情绪选择器
  document.getElementById('mood-options').addEventListener('click', e => {
    const btn = e.target.closest('.mood-btn[data-mood]');
    if (!btn) return;
    const mood = btn.dataset.mood;
    _currentMood = (_currentMood === mood) ? '' : mood;
    markDirty();
    renderMoodSelector();
    autoSave();
  });
  document.getElementById('btn-clear-mood').addEventListener('click', () => {
    _currentMood = '';
    markDirty();
    renderMoodSelector();
    autoSave();
  });

  // 标签输入
  document.getElementById('entry-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = e.target.value.trim().replace(/,/g, '');
      if (val && !_currentTags.includes(val) && _currentTags.length < 10) {
        _currentTags.push(val);
        markDirty();
        renderTagChips();
        autoSave();
      }
      e.target.value = '';
    }
  });

  document.getElementById('btn-move-entry').addEventListener('click', openMoveEntryModal);
  document.getElementById('modal-move-cancel').addEventListener('click', () => {
    document.getElementById('modal-move-entry').classList.add('hidden');
  });
  document.getElementById('modal-move-entry').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-move-entry')) {
      document.getElementById('modal-move-entry').classList.add('hidden');
    }
  });

  document.getElementById('btn-entry-image').addEventListener('click', () => {
    document.getElementById('entry-image-file').click();
  });
  document.getElementById('entry-image-file').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const { id } = await saveImageFile(file);
      _currentEntryImageIds.push(id);
    }
    markDirty();
    renderEntryImages();
    e.target.value = '';
  });

  // 数据管理页
  document.getElementById('btn-refresh-stats').addEventListener('click', refreshDataStats);
  document.getElementById('btn-export').addEventListener('click', downloadBackup);
  document.getElementById('import-file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    await importFromBackup(file);
    e.target.value = '';
  });
  document.getElementById('btn-switch-file').addEventListener('click', handleSwitchFile);
  document.getElementById('btn-clear-all').addEventListener('click', clearAllData);

  // 键盘快捷键：Ctrl/Cmd+S 保存
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentView === 'entry') {
      e.preventDefault();
      saveEntry();
    }
  });

  // 关闭/刷新标签页时保护未保存内容
  window.addEventListener('beforeunload', e => {
    if (_isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ============================================================
// 初始化
// ============================================================

async function init() {
  initTheme();
  bindEvents();
  await openHandleDB();
  await initWelcome();
}

document.addEventListener('DOMContentLoaded', init);
