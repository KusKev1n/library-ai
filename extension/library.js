import { initI18n } from './lib/i18n.js';
// library.js — Логика библиотеки Novel AI v4.0 (локальная папка книг + переведённые книги + 3 действия: Читать / Перевод / Удалить)

import { parseEpub } from './lib/epub.js';
import { parsePdf } from './lib/pdf-reader.js';
import {
  listSavedTranslations,
  saveBookTranslation,
  deleteBookTranslation,
  clearAllTranslations,
  getLibraryFolderInfo,
  pickLibraryFolder,
  requestLibraryFolderPermission,
  resetLibraryFolder,
  scanLocalLibraryFolder,
  readLocalLibraryFile,
  deleteLocalLibraryFile,
  getHistoryDirectoryInfo,
  pickHistoryDirectory,
  requestHistoryDirectoryPermission,
  formatBytes
} from './lib/storage.js';

const $ = (id) => document.getElementById(id);

const PASTEL_COVERS = [
  '#c7ddf5', // нежно-голубой (Яндекс Книги)
  '#eed7d5', // пудрово-розовый
  '#e7e1cd', // тёплый песочный
  '#d5e5d5', // шалфейный
  '#dfd7ee', // лавандовый
  '#f0dbc4'  // абрикосовый
];

let allBooks = []; // объединённый список из сохранённых переводов + локальной папки
let activeFilter = 'all';
let viewMode = 'covers'; // 'covers' | 'cards'
let sortMode = 'recent';
let searchQuery = '';

function showToast(msg, ms = 2800) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function pastelColorFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return PASTEL_COVERS[Math.abs(h) % PASTEL_COVERS.length];
}

function createCoverElement(book, showBadge = true) {
  const box = document.createElement('div');
  box.className = 'cover-box';

  if (book.coverDataUrl) {
    const img = document.createElement('img');
    img.src = book.coverDataUrl;
    img.alt = book.title;
    box.appendChild(img);
  } else {
    const typo = document.createElement('div');
    typo.className = 'typo-cover';
    typo.style.background = pastelColorFor(book.title || book.bookKey);

    const author = document.createElement('div');
    author.className = 'typo-cover-author';
    author.textContent = book.author || (book.format || 'Книга').toUpperCase();

    const title = document.createElement('div');
    title.className = 'typo-cover-title';
    title.textContent = book.title;

    const ext = document.createElement('div');
    ext.className = 'typo-cover-ext';
    ext.textContent = (book.format || 'book').toUpperCase();

    typo.appendChild(author);
    typo.appendChild(title);
    typo.appendChild(ext);
    box.appendChild(typo);
  }

  if (showBadge) {
    const pct = book.totalChapters > 0 ? Math.round((book.translatedCount / book.totalChapters) * 100) : 0;
    const badge = document.createElement('span');
    badge.className = 'cover-badge' + (pct === 100 && book.totalChapters > 0 ? ' done' : '');
    badge.textContent = book.translatedCount > 0 ? `${pct}%` : (book.format || 'NEW').toUpperCase();
    box.appendChild(badge);
  }
  return box;
}

/**
 * Если книга ещё не распарсена в кэше (лежит сырой в локальной папке),
 * парсит её на лету и сохраняет структуру/обложку/оригиналы.
 */
async function ensureBookParsed(book) {
  if (book.isCached && book.totalChapters > 0) return book.bookKey;

  showToast(`Открываю «${book.title}»...`, 10000);
  const file = await readLocalLibraryFile(book.fileName);
  if (!file) {
    throw new Error('Не удалось прочитать файл из локальной папки. Нажмите «Подключить» слева.');
  }
  const buffer = await file.arrayBuffer();
  const parsed = book.format === 'epub'
    ? await parseEpub(buffer, file.name)
    : await parsePdf(buffer, file.name);

  const originals = {};
  const chapterImages = {};
  const chapterMeta = parsed.chapters.map((ch, i) => {
    originals[i] = ch.text || '';
    if (Array.isArray(ch.images) && ch.images.length > 0) chapterImages[i] = ch.images;
    return { index: i, title: ch.title };
  });

  await saveBookTranslation(book.bookKey, {
    fileName: file.name,
    title: parsed.title,
    author: parsed.author || '',
    format: parsed.format,
    coverDataUrl: parsed.coverDataUrl || '',
    totalChapters: parsed.chapters.length,
    chapterMeta,
    originals,
    chapterImages
  });

  await refreshLibrary();
  return book.bookKey;
}

async function openInReader(book) {
  try {
    const key = await ensureBookParsed(book);
    const url = chrome.runtime.getURL(`reader.html?bookKey=${encodeURIComponent(key)}`);
    window.location.href = url;
  } catch (err) {
    showToast(`Ошибка: ${err.message}`, 4000);
  }
}

async function openInTranslator(book) {
  try {
    const key = await ensureBookParsed(book);
    const url = chrome.runtime.getURL(`app.html?bookKey=${encodeURIComponent(key)}`);
    window.location.href = url;
  } catch (err) {
    showToast(`Ошибка: ${err.message}`, 4000);
  }
}

async function handleDeleteBook(book) {
  if (book.fromLocalFolder) {
    const delFile = confirm(
      `Удалить «${book.title}»?\n\nОК — удалить перевод из истории (файл на диске останется, либо нажмите ещё раз чтобы удалить файл).\nОтмена — ничего не делать.`
    );
    if (!delFile) return;
    if (book.isCached) {
      await deleteBookTranslation(book.bookKey);
      showToast(`Перевод «${book.title}» удалён из истории.`);
    } else {
      const reallyDisk = confirm(`Книга не переведена и лежит в вашей папке «${book.fileName}». Удалить сам файл с диска?`);
      if (!reallyDisk) return;
      const ok = await deleteLocalLibraryFile(book.fileName);
      showToast(ok ? `Файл «${book.fileName}» удалён.` : 'Не удалось удалить файл.');
    }
  } else {
    if (!confirm(`Удалить «${book.title}» и весь её перевод из библиотеки?`)) return;
    await deleteBookTranslation(book.bookKey);
    showToast(`Книга «${book.title}» удалена.`);
  }
  await refreshLibrary();
}

// --- Загрузка файлов вручную (один или несколько) ---
async function importFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  let added = 0;
  for (const file of Array.from(fileList)) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'epub' && ext !== 'pdf') continue;
    try {
      showToast(`Загрузка: ${file.name}...`, 10000);
      const buffer = await file.arrayBuffer();
      const parsed = ext === 'epub'
        ? await parseEpub(buffer, file.name)
        : await parsePdf(buffer, file.name);
      const bookKey = `${file.name}::${file.size}`;
      const originals = {};
      const chapterImages = {};
      const chapterMeta = parsed.chapters.map((ch, i) => {
        originals[i] = ch.text || '';
        if (Array.isArray(ch.images) && ch.images.length > 0) chapterImages[i] = ch.images;
        return { index: i, title: ch.title };
      });
      await saveBookTranslation(bookKey, {
        fileName: file.name,
        title: parsed.title,
        author: parsed.author || '',
        format: parsed.format,
        coverDataUrl: parsed.coverDataUrl || '',
        totalChapters: parsed.chapters.length,
        chapterMeta,
        originals,
        chapterImages
      });
      added++;
    } catch (err) {
      showToast(`Ошибка чтения ${file.name}: ${err.message}`, 4000);
    }
  }
  if (added > 0) showToast(`Добавлено книг: ${added} ✓`);
  await refreshLibrary();
}

// --- Обновление списка книг (История + Локальная папка) ---
async function refreshLibrary() {
  const [libInfo, histInfo, savedRes, localFiles] = await Promise.all([
    getLibraryFolderInfo(),
    getHistoryDirectoryInfo(),
    listSavedTranslations(),
    scanLocalLibraryFolder()
  ]);

  // Статус локальной папки книг
  $('libFolderName').textContent = libInfo.connected
    ? `📁 ${libInfo.name}${libInfo.hasPermission ? '' : ' (нужен доступ)'}`
    : 'Не подключена';
  $('grantLibPermBtn').classList.toggle('hidden', !(libInfo.connected && !libInfo.hasPermission));
  $('rescanLibBtn').classList.toggle('hidden', !(libInfo.connected && libInfo.hasPermission));
  $('resetLibBtn').classList.toggle('hidden', !libInfo.connected);

  // Статус папки истории
  $('histFolderName').textContent = histInfo.custom
    ? `📁 ${histInfo.name}${histInfo.hasPermission ? '' : ' (нужен доступ)'}`
    : 'IndexedDB (браузер)';
  $('grantHistPermBtn').classList.toggle('hidden', !(histInfo.custom && !histInfo.hasPermission));
  $('storageStats').textContent = `Занято: ${formatBytes(savedRes.totalBytes)}`;

  // Объединяем кэшированные книги и файлы из локальной папки без дубликатов
  const byKey = new Map();
  for (const rec of savedRes.items) {
    byKey.set(rec.bookKey, {
      ...rec,
      isCached: true,
      fromLocalFolder: false
    });
  }
  for (const lf of localFiles) {
    const existing = byKey.get(lf.bookKey);
    if (existing) {
      existing.fromLocalFolder = true;
      existing.fileName = lf.fileName;
    } else {
      byKey.set(lf.bookKey, {
        bookKey: lf.bookKey,
        fileName: lf.fileName,
        title: lf.title,
        author: '',
        format: lf.format,
        coverDataUrl: '',
        totalChapters: 0,
        translatedCount: 0,
        updatedAt: lf.lastModified,
        sizeBytes: lf.sizeBytes,
        isCached: false,
        fromLocalFolder: true
      });
    }
  }

  allBooks = Array.from(byKey.values());
  updateCountsAndRender();
}

function getFilteredBooks() {
  let list = allBooks.slice();

  if (activeFilter === 'inprogress') {
    list = list.filter((b) => b.translatedCount > 0 && b.translatedCount < b.totalChapters);
  } else if (activeFilter === 'translated') {
    list = list.filter((b) => b.totalChapters > 0 && b.translatedCount >= b.totalChapters);
  } else if (activeFilter === 'untranslated') {
    list = list.filter((b) => b.translatedCount === 0);
  } else if (activeFilter === 'local') {
    list = list.filter((b) => b.fromLocalFolder);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter((b) =>
      (b.title || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q) ||
      (b.fileName || '').toLowerCase().includes(q)
    );
  }

  if (sortMode === 'title') {
    list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  } else if (sortMode === 'progress') {
    const p = (b) => (b.totalChapters > 0 ? b.translatedCount / b.totalChapters : -1);
    list.sort((a, b) => p(b) - p(a));
  } else {
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  return list;
}

function updateCountsAndRender() {
  $('cnt-all').textContent = String(allBooks.length);
  $('cnt-inprogress').textContent = String(allBooks.filter((b) => b.translatedCount > 0 && b.translatedCount < b.totalChapters).length);
  $('cnt-translated').textContent = String(allBooks.filter((b) => b.totalChapters > 0 && b.translatedCount >= b.totalChapters).length);
  $('cnt-untranslated').textContent = String(allBooks.filter((b) => b.translatedCount === 0).length);
  $('cnt-local').textContent = String(allBooks.filter((b) => b.fromLocalFolder).length);

  renderHeroShelf();
  renderCatalog();
}

function renderHeroShelf() {
  const row = $('heroRecentRow');
  row.innerHTML = '';
  const recent = allBooks
    .filter((b) => b.isCached)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 4);

  if (recent.length === 0) {
    row.innerHTML = '<div class="hero-empty">Нажмите «+ Загрузить книгу» или подключите «Папку с книгами», чтобы собрать свою полку.</div>';
    return;
  }

  for (const book of recent) {
    const item = document.createElement('div');
    item.className = 'hero-book';
    item.title = `Открыть «${book.title}» в читалке`;

    const pct = book.totalChapters > 0 ? Math.round((book.translatedCount / book.totalChapters) * 100) : 0;
    const pctEl = document.createElement('div');
    pctEl.className = 'hero-book-pct';
    pctEl.textContent = book.translatedCount > 0 ? `${pct}%` : 'Новая';

    item.appendChild(pctEl);
    item.appendChild(createCoverElement(book, false));
    item.addEventListener('click', () => openInReader(book));
    row.appendChild(item);
  }
}

function renderCatalog() {
  const container = $('booksContainer');
  const titles = {
    all: 'Все книги',
    inprogress: 'В процессе перевода',
    translated: 'Переведённые',
    untranslated: 'Непереведённые',
    local: 'Из локальной папки'
  };
  $('catalogTitle').textContent = titles[activeFilter] || 'Все книги';

  const books = getFilteredBooks();
  container.className = viewMode === 'cards' ? 'books-cards' : 'books-grid';
  container.innerHTML = '';

  if (books.length === 0) {
    container.innerHTML = '<div style="color:var(--muted);padding:24px 0;">В этом разделе пока нет книг.</div>';
    return;
  }

  for (const book of books) {
    const pct = book.totalChapters > 0 ? Math.round((book.translatedCount / book.totalChapters) * 100) : 0;
    const isDone = book.totalChapters > 0 && book.translatedCount >= book.totalChapters;

    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'act-btn read';
    readBtn.textContent = 'Читать';
    readBtn.addEventListener('click', () => openInReader(book));

    const transBtn = document.createElement('button');
    transBtn.type = 'button';
    transBtn.className = 'act-btn';
    transBtn.textContent = 'Перевод';
    transBtn.addEventListener('click', () => openInTranslator(book));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'act-btn del';
    delBtn.title = 'Удалить';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => handleDeleteBook(book));

    const actions = document.createElement('div');
    actions.className = 'book-actions';
    actions.appendChild(readBtn);
    actions.appendChild(transBtn);
    actions.appendChild(delBtn);

    if (viewMode === 'covers') {
      const tile = document.createElement('div');
      tile.className = 'book-tile';

      const cover = createCoverElement(book, true);
      cover.style.cursor = 'pointer';
      cover.addEventListener('click', () => openInReader(book));

      const top = document.createElement('div');
      top.className = 'book-tile-top';
      top.textContent = book.totalChapters > 0
        ? `${book.translatedCount} / ${book.totalChapters} гл.`
        : `${(book.format || '').toUpperCase()} · ${formatBytes(book.sizeBytes)}`;

      const titleEl = document.createElement('div');
      titleEl.className = 'book-tile-title';
      titleEl.textContent = book.title;
      titleEl.title = book.title;

      const authorEl = document.createElement('div');
      authorEl.className = 'book-tile-author';
      authorEl.textContent = book.author || (book.fromLocalFolder ? 'Локальная папка' : 'Загружена');

      tile.appendChild(top);
      tile.appendChild(cover);
      tile.appendChild(titleEl);
      tile.appendChild(authorEl);
      tile.appendChild(actions);
      container.appendChild(tile);
    } else {
      // Режим карточек (Ranobes style)
      const card = document.createElement('div');
      card.className = 'book-card';

      const cover = createCoverElement(book, false);
      cover.style.cursor = 'pointer';
      cover.addEventListener('click', () => openInReader(book));

      const body = document.createElement('div');
      body.className = 'book-card-body';

      const head = document.createElement('div');
      const titleEl = document.createElement('div');
      titleEl.className = 'book-tile-title';
      titleEl.style.fontSize = '14px';
      titleEl.textContent = book.title;

      const authorEl = document.createElement('div');
      authorEl.className = 'book-tile-author';
      authorEl.textContent = (book.author ? `${book.author} · ` : '') + `${(book.format || '').toUpperCase()} · ${formatBytes(book.sizeBytes)}`;
      head.appendChild(titleEl);
      head.appendChild(authorEl);

      const meter = document.createElement('div');
      meter.className = 'meter-wrap';
      meter.innerHTML = `<div class="meter-track"><div class="meter-fill ${isDone ? 'done' : ''}" style="width:${pct}%"></div></div><span class="meter-label">${book.totalChapters > 0 ? `${book.translatedCount}/${book.totalChapters} (${pct}%)` : 'Не открыта'}</span>`;

      body.appendChild(head);
      body.appendChild(meter);
      body.appendChild(actions);

      card.appendChild(cover);
      card.appendChild(body);
      container.appendChild(card);
    }
  }
}

// --- Инициализация ---
async function init() {
  await initI18n();
  const savedView = await chrome.storage.local.get('libraryViewMode');
  if (savedView.libraryViewMode === 'cards' || savedView.libraryViewMode === 'covers') {
    viewMode = savedView.libraryViewMode;
    $('viewCoversBtn').classList.toggle('active', viewMode === 'covers');
    $('viewCardsBtn').classList.toggle('active', viewMode === 'cards');
  }

  await refreshLibrary();

  $('uploadBookBtn').addEventListener('click', () => $('bookFileInput').click());
  $('bookFileInput').addEventListener('change', () => {
    importFiles($('bookFileInput').files);
    $('bookFileInput').value = '';
  });

  $('pickLibFolderBtn').addEventListener('click', async () => {
    try {
      const info = await pickLibraryFolder();
      showToast(`Подключена папка книг: «${info.name}» ✓`);
      await refreshLibrary();
    } catch (err) {
      if (err.name !== 'AbortError') showToast(`Ошибка: ${err.message}`, 4000);
    }
  });

  $('grantLibPermBtn').addEventListener('click', async () => {
    if (await requestLibraryFolderPermission()) {
      showToast('Доступ к папке книг восстановлен ✓');
      await refreshLibrary();
    }
  });

  $('rescanLibBtn').addEventListener('click', async () => {
    await refreshLibrary();
    showToast('Папка книг обновлена ✓');
  });

  $('resetLibBtn').addEventListener('click', async () => {
    await resetLibraryFolder();
    showToast('Локальная папка отключена.');
    await refreshLibrary();
  });

  $('pickHistFolderBtn').addEventListener('click', async () => {
    try {
      const info = await pickHistoryDirectory();
      showToast(`Папка истории: «${info.name}» (перенесено: ${info.migrated}) ✓`);
      await refreshLibrary();
    } catch (err) {
      if (err.name !== 'AbortError') showToast(`Ошибка: ${err.message}`, 4000);
    }
  });

  $('grantHistPermBtn').addEventListener('click', async () => {
    if (await requestHistoryDirectoryPermission()) {
      showToast('Доступ к папке истории восстановлен ✓');
      await refreshLibrary();
    }
  });

  $('clearAllBtn').addEventListener('click', async () => {
    if (!confirm('Удалить ВСЕ сохранённые переводы из памяти? Оригинальные файлы в вашей локальной папке не пострадают.')) return;
    await clearAllTranslations();
    showToast('Все переводы удалены, память очищена.');
    await refreshLibrary();
  });

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderCatalog();
    });
  });

  $('searchInput').addEventListener('input', () => {
    searchQuery = $('searchInput').value.trim();
    renderCatalog();
  });

  $('sortSelect').addEventListener('change', () => {
    sortMode = $('sortSelect').value;
    renderCatalog();
  });

  $('viewCoversBtn').addEventListener('click', () => {
    viewMode = 'covers';
    $('viewCoversBtn').classList.add('active');
    $('viewCardsBtn').classList.remove('active');
    chrome.storage.local.set({ libraryViewMode: 'covers' });
    renderCatalog();
  });

  $('viewCardsBtn').addEventListener('click', () => {
    viewMode = 'cards';
    $('viewCardsBtn').classList.add('active');
    $('viewCoversBtn').classList.remove('active');
    chrome.storage.local.set({ libraryViewMode: 'cards' });
    renderCatalog();
  });

  // Обновляем полку, если в соседней вкладке перевелась глава
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'BOOK_UPDATED') refreshLibrary();
  });
}

init();
