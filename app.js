import { initI18n, saveUiLang, applyI18n } from './lib/i18n.js';
// app.js — Логика мобильного PWA LibraryAI (IndexedDB, Яндекс-карусель, Читалка с картинками и API-переводом, WebRTC QR-синхронизация)

import { parseEpub } from './lib/epub.js';
import { splitIntoChunks, translateChunkViaApi } from './lib/api-client.js';
import { connectSyncClient, mergeBookRecords } from './lib/sync-rtc.js';

const $ = (id) => document.getElementById(id);

const DB_NAME = 'LibraryAIPwaDB';
const DB_VER = 1;
const STORE_BOOKS = 'books';
const STORE_FONTS = 'fonts';

const PASTELS = ['#c7ddf5', '#eed7d5', '#e7e1cd', '#d5e5d5', '#dfd7ee', '#f0dbc4'];
const THEMES = {
  paper:    { bg: '#f9f8f4', text: '#1f1f1f' },
  sepia:    { bg: '#f3e8d2', text: '#3d2f1e' },
  graphite: { bg: '#1b1a19', text: '#e6e2dc' },
  night:    { bg: '#161d2b', text: '#dce3f0' },
  oled:     { bg: '#000000', text: '#d4d4d8' }
};

let dbPromise = null;
let allBooks = [];
let activeFilter = 'all';
let heroIdx = 0;
let selectedForDelete = new Set();

let readerBook = null;
let readerIndices = [];
let readerPos = 0;
let readerShowingOrig = false;
let readerAbort = null;
let qrStream = null;
let qrScanLoop = null;
let syncClient = null;

// --- IndexedDB ---
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) db.createObjectStore(STORE_BOOKS, { keyPath: 'bookKey' });
      if (!db.objectStoreNames.contains(STORE_FONTS)) db.createObjectStore(STORE_FONTS, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function estimateBytes(obj) {
  try { return new TextEncoder().encode(JSON.stringify(obj)).length; } catch (_) { return 0; }
}

function formatBytes(b) {
  if (!b || b <= 0) return '0 Б';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / (1024 * 1024)).toFixed(2)} МБ`;
}

async function listBooks() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readonly');
    const req = tx.objectStore(STORE_BOOKS).getAll();
    req.onsuccess = () => {
      const items = (req.result || []).map((r) => ({
        ...r,
        translatedCount: Object.keys(r.chapters || {}).filter((k) => Boolean(r.chapters[k])).length,
        totalChapters: r.totalChapters || (r.chapterMeta || []).length,
        sizeBytes: r.sizeBytes || estimateBytes(r)
      }));
      items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getBook(bookKey) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readonly');
    const req = tx.objectStore(STORE_BOOKS).get(bookKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function saveBook(rec) {
  const existing = await getBook(rec.bookKey).catch(() => null);
  const merged = mergeBookRecords(existing, rec);
  merged.sizeBytes = estimateBytes(merged);
  merged.updatedAt = merged.updatedAt || Date.now();
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readwrite');
    tx.objectStore(STORE_BOOKS).put(merged);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return merged;
}

async function deleteBook(bookKey) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readwrite');
    tx.objectStore(STORE_BOOKS).delete(bookKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  localStorage.removeItem(`lastPos::${bookKey}`);
}

async function clearAllBooks() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, 'readwrite');
    tx.objectStore(STORE_BOOKS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function saveCustomFont(name, buf) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FONTS, 'readwrite');
    tx.objectStore(STORE_FONTS).put({ name, data: buf });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadCustomFonts() {
  const db = await openDb();
  const fonts = await new Promise((resolve) => {
    const tx = db.transaction(STORE_FONTS, 'readonly');
    const req = tx.objectStore(STORE_FONTS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
  const sel = $('rFontFamily');
  for (const f of fonts) {
    try {
      const face = new FontFace(f.name, f.data);
      await face.load();
      document.fonts.add(face);
      const val = `"${f.name}", serif`;
      if (!Array.from(sel.options).some((o) => o.value === val)) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = `★ ${f.name}`;
        sel.appendChild(opt);
      }
    } catch (_) {}
  }
}

// --- Настройки и UI-утилиты ---
function getApiCfg() {
  try {
    return JSON.parse(localStorage.getItem('libraryAiApiCfg') || '{}');
  } catch (_) {
    return {};
  }
}

function saveApiCfg(cfg) {
  localStorage.setItem('libraryAiApiCfg', JSON.stringify(cfg));
}

function getReaderPrefs() {
  try {
    return {
      theme: 'graphite',
      fontSize: 18,
      lineHeight: 1.7,
      fontFamily: 'Georgia, "Times New Roman", serif',
      ...JSON.parse(localStorage.getItem('libraryAiReaderPrefs') || '{}')
    };
  } catch (_) {
    return { theme: 'graphite', fontSize: 18, lineHeight: 1.7, fontFamily: 'Georgia, "Times New Roman", serif' };
  }
}

function applyReaderPrefs() {
  const p = getReaderPrefs();
  const t = THEMES[p.theme] || THEMES.graphite;
  const root = document.documentElement;
  root.style.setProperty('--r-bg', t.bg);
  root.style.setProperty('--r-text', t.text);
  root.style.setProperty('--r-size', `${p.fontSize}px`);
  root.style.setProperty('--r-line', String(p.lineHeight));
  root.style.setProperty('--r-font', p.fontFamily);

  $('rFontSizeVal').textContent = `${p.fontSize} px`;
  $('rLineHeightVal').textContent = Number(p.lineHeight).toFixed(1);
  $('rFontFamily').value = p.fontFamily;
  document.querySelectorAll('.r-theme-chip').forEach((b) => b.classList.toggle('active', b.dataset.theme === p.theme));
}

function showToast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function pastelFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return PASTELS[Math.abs(h) % PASTELS.length];
}

function buildCover(book, showPct = true) {
  const card = document.createElement('div');
  card.className = 'cover-card';
  if (book.coverDataUrl) {
    const img = document.createElement('img');
    img.src = book.coverDataUrl;
    img.alt = book.title;
    card.appendChild(img);
  } else {
    const t = document.createElement('div');
    t.className = 'typo-cover';
    t.style.background = pastelFor(book.title || book.bookKey);
    t.innerHTML = `<div class="typo-author"></div><div class="typo-title"></div><div class="typo-ext">EPUB</div>`;
    t.querySelector('.typo-author').textContent = book.author || 'Книга';
    t.querySelector('.typo-title').textContent = book.title;
    card.appendChild(t);
  }
  if (showPct) {
    const pct = book.totalChapters > 0 ? Math.round((book.translatedCount / book.totalChapters) * 100) : 0;
    const b = document.createElement('span');
    b.className = 'cover-pct' + (pct === 100 && book.totalChapters > 0 ? ' done' : '');
    b.textContent = book.translatedCount > 0 ? `${pct}%` : 'NEW';
    card.appendChild(b);
  }
  return card;
}

// --- Переключение вкладок ---
function switchTab(tabId) {
  document.querySelectorAll('.tab-view').forEach((v) => v.classList.toggle('active', v.id === tabId));
  document.querySelectorAll('.bnav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
  if (tabId === 'viewSettings') { renderStorageManager(); renderPairedPcsList(); }
  if (tabId === 'viewSearch') renderSearchResults();
  if (tabId !== 'viewSync') stopQrScanner();
}

// --- Рендер Библиотеки (Яндекс Книги mobile) ---
function getFilteredBooks() {
  return allBooks.filter((b) => {
    const pct = b.totalChapters > 0 ? Math.round((b.translatedCount / b.totalChapters) * 100) : 0;
    if (activeFilter === 'reading') return b.translatedCount > 0 && pct < 100;
    if (activeFilter === 'translated') return b.translatedCount > 0 && pct === 100;
    if (activeFilter === 'new') return b.translatedCount === 0;
    return true;
  });
}

function updateHeroActive(books, idx) {
  heroIdx = Math.max(0, Math.min(books.length - 1, idx));
  const b = books[heroIdx];
  document.querySelectorAll('.hero-slide').forEach((el, i) => el.classList.toggle('active', i === heroIdx));
  if (!b) return;
  $('heroBookTitle').textContent = b.title;
  const pct = b.totalChapters > 0 ? Math.round((b.translatedCount / b.totalChapters) * 100) : 0;
  $('heroBookSub').textContent = `${b.author ? b.author + ' · ' : ''}Переведено ${b.translatedCount} из ${b.totalChapters} (${pct}%)`;
  const btn = $('heroPrimaryBtn');
  btn.textContent = 'Читать';
  btn.onclick = () => openReader(b.bookKey);
  const glowColor = pastelFor(b.title || b.bookKey);
  $('heroAmbient').style.background = `radial-gradient(circle at 50% 38%, ${glowColor}44, transparent 68%)`;
}

function renderMiniPlayer() {
  const lastKey = localStorage.getItem('libraryAiLastBook');
  const book = allBooks.find((b) => b.bookKey === lastKey) || allBooks[0];
  const bar = $('miniPlayer');
  if (!book) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const mc = $('miniCover');
  mc.innerHTML = '';
  if (book.coverDataUrl) {
    const img = document.createElement('img');
    img.src = book.coverDataUrl;
    mc.appendChild(img);
  } else {
    mc.style.background = pastelFor(book.title);
  }
  $('miniTitle').textContent = book.title;
  const lastCh = parseInt(localStorage.getItem(`lastPos::${book.bookKey}`) || '0', 10);
  $('miniSub').textContent = `Глава ${lastCh + 1} из ${book.totalChapters}`;
  $('miniReadBtn').onclick = () => openReader(book.bookKey);
}

function renderLibrary() {
  const books = getFilteredBooks();
  const carousel = $('heroCarousel');
  const grid = $('bookGrid');
  carousel.innerHTML = '';
  grid.innerHTML = '';
  $('shelfCount').textContent = String(books.length);

  if (books.length === 0) {
    $('heroBookTitle').textContent = allBooks.length === 0 ? 'Библиотека пуста' : 'Нет книг в этой категории';
    $('heroBookSub').textContent = 'Синхронизируй книги с ПК по QR или добавь .epub с телефона';
    const btn = $('heroPrimaryBtn');
    btn.textContent = '+ Синхронизировать с ПК';
    btn.onclick = () => switchTab('viewSync');
    renderMiniPlayer();
    return;
  }

  books.slice(0, 8).forEach((b, i) => {
    const slide = document.createElement('div');
    slide.className = 'hero-slide' + (i === 0 ? ' active' : '');
    slide.appendChild(buildCover(b, true));
    slide.addEventListener('click', () => {
      if (i === heroIdx) openReader(b.bookKey);
      else {
        slide.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        updateHeroActive(books, i);
      }
    });
    carousel.appendChild(slide);
  });
  updateHeroActive(books, 0);

  carousel.onscroll = () => {
    const center = carousel.scrollLeft + carousel.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    carousel.querySelectorAll('.hero-slide').forEach((el, i) => {
      const mid = el.offsetLeft + el.clientWidth / 2;
      const d = Math.abs(mid - center);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    if (best !== heroIdx) updateHeroActive(books, best);
  };

  for (const b of books) {
    const cell = document.createElement('div');
    cell.className = 'grid-book';
    cell.appendChild(buildCover(b, true));
    const t = document.createElement('div');
    t.className = 'grid-book-title';
    t.textContent = b.title;
    const sub = document.createElement('div');
    sub.className = 'grid-book-sub';
    sub.textContent = `${b.translatedCount}/${b.totalChapters} гл.`;
    cell.appendChild(t);
    cell.appendChild(sub);
    cell.addEventListener('click', () => openReader(b.bookKey));
    grid.appendChild(cell);
  }
  renderMiniPlayer();
}

function renderSearchResults() {
  const q = ($('mobSearchInput').value || '').trim().toLowerCase();
  const grid = $('searchResultsGrid');
  grid.innerHTML = '';
  const list = q
    ? allBooks.filter((b) => (b.title || '').toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q))
    : allBooks;
  for (const b of list) {
    const cell = document.createElement('div');
    cell.className = 'grid-book';
    cell.appendChild(buildCover(b, true));
    const t = document.createElement('div');
    t.className = 'grid-book-title';
    t.textContent = b.title;
    cell.appendChild(t);
    cell.addEventListener('click', () => openReader(b.bookKey));
    grid.appendChild(cell);
  }
}

// --- Менеджер памяти в Настройках ---
function renderStorageManager() {
  const totalBytes = allBooks.reduce((s, b) => s + (b.sizeBytes || 0), 0);
  $('storageUsageLabel').textContent = `${allBooks.length} книг · ${formatBytes(totalBytes)}`;
  const list = $('storageBooksList');
  list.innerHTML = '';
  selectedForDelete.clear();
  $('deleteSelectedBooksBtn').disabled = true;

  if (allBooks.length === 0) {
    list.innerHTML = '<div class="mob-hint" style="margin:4px 0;">Память пуста.</div>';
    return;
  }

  for (const b of allBooks) {
    const row = document.createElement('label');
    row.className = 'storage-book-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => {
      if (cb.checked) selectedForDelete.add(b.bookKey);
      else selectedForDelete.delete(b.bookKey);
      $('deleteSelectedBooksBtn').disabled = selectedForDelete.size === 0;
    });
    const meta = document.createElement('div');
    meta.className = 'storage-book-meta';
    meta.innerHTML = `<div class="storage-book-title"></div><div class="storage-book-sub"></div>`;
    meta.querySelector('.storage-book-title').textContent = b.title;
    meta.querySelector('.storage-book-sub').textContent = `${formatBytes(b.sizeBytes)} · ${b.translatedCount}/${b.totalChapters} гл.`;
    row.appendChild(cb);
    row.appendChild(meta);
    list.appendChild(row);
  }
}

// --- Загрузка EPUB с телефона ---
async function handleEpubFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (!file.name.toLowerCase().endsWith('.epub')) continue;
    try {
      showToast(`Загружаю ${file.name}...`, 8000);
      const parsed = await parseEpub(await file.arrayBuffer(), file.name);
      const originals = {};
      const chapterImages = {};
      const chapterMeta = parsed.chapters.map((ch, i) => {
        originals[i] = ch.text || '';
        if (Array.isArray(ch.images) && ch.images.length > 0) chapterImages[i] = ch.images;
        return { index: i, title: ch.title };
      });
      await saveBook({
        bookKey: `${file.name}::${file.size}`,
        fileName: file.name,
        title: parsed.title,
        author: parsed.author || '',
        format: 'epub',
        coverDataUrl: parsed.coverDataUrl || '',
        totalChapters: parsed.chapters.length,
        chapterMeta,
        chapters: {},
        originals,
        chapterImages,
        updatedAt: Date.now()
      });
      showToast(`Добавлена: «${parsed.title}» ✓`);
    } catch (err) {
      showToast(`Ошибка: ${err.message}`, 4000);
    }
  }
  allBooks = await listBooks();
  renderLibrary();
  renderStorageManager();
}

// --- ПОЛНОЭКРАННАЯ ЧИТАЛКА ---
function closeReaderSheets() {
  $('rSheetBackdrop').classList.add('hidden');
  $('rTocSheet').classList.add('hidden');
  $('rAppearanceSheet').classList.add('hidden');
}

function renderReaderContent(text, chIdx) {
  const el = $('rContent');
  el.innerHTML = '';
  const imgs = readerBook?.chapterImages?.[chIdx] || [];
  const paras = (text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const appendImg = (im) => {
    const f = document.createElement('figure');
    f.className = 'r-illustration';
    const img = document.createElement('img');
    img.src = im.dataUrl;
    img.alt = im.alt || '';
    f.appendChild(img);
    el.appendChild(f);
  };

  const top = imgs.filter((i) => i.isTop);
  const bottom = imgs.filter((i) => !i.isTop && i.isBottom);
  const mid = imgs.filter((i) => !i.isTop && !i.isBottom);
  for (const im of top) appendImg(im);

  const midMap = new Map();
  for (const im of mid) {
    const idx = Math.min(paras.length - 1, Math.max(0, Math.round((im.ratio || 0.5) * paras.length) - 1));
    if (!midMap.has(idx)) midMap.set(idx, []);
    midMap.get(idx).push(im);
  }

  paras.forEach((p, i) => {
    const pe = document.createElement('p');
    pe.textContent = p;
    el.appendChild(pe);
    if (midMap.has(i)) midMap.get(i).forEach(appendImg);
  });
  for (const im of bottom) appendImg(im);
}

function renderReaderChapter(pos) {
  if (!readerBook || readerIndices.length === 0) return;
  readerPos = Math.max(0, Math.min(readerIndices.length - 1, pos));
  readerShowingOrig = false;
  const chIdx = readerIndices[readerPos];
  const meta = (readerBook.chapterMeta || []).find((m) => m.index === chIdx);
  const title = meta?.title || `Глава ${chIdx + 1}`;
  const trans = readerBook.chapters?.[chIdx] || '';
  const orig = readerBook.originals?.[chIdx] || '';
  const isTr = Boolean(trans);

  $('rBookTitle').textContent = readerBook.title;
  $('rChapterTitle').textContent = title;
  $('rChapterSub').textContent = isTr
    ? `Глава ${chIdx + 1} из ${readerIndices.length}`
    : `Глава ${chIdx + 1} из ${readerIndices.length} · оригинал`;

  const bar = $('rChapterActions');
  const trBtn = $('rTranslateBtn');
  const origBtn = $('rToggleOrigBtn');

  if (!isTr) {
    bar.classList.remove('hidden');
    trBtn.classList.remove('hidden');
    trBtn.disabled = !orig;
    trBtn.textContent = orig ? 'Перевести главу' : 'Нет оригинала';
    origBtn.classList.add('hidden');
    renderReaderContent(orig, chIdx);
  } else {
    bar.classList.toggle('hidden', !orig);
    trBtn.classList.add('hidden');
    origBtn.classList.toggle('hidden', !orig);
    origBtn.textContent = 'Показать оригинал';
    renderReaderContent(trans, chIdx);
  }

  $('rPrevBtn').disabled = readerPos <= 0;
  $('rNextBtn').disabled = readerPos >= readerIndices.length - 1;
  $('rScrollArea').scrollTop = 0;

  localStorage.setItem(`lastPos::${readerBook.bookKey}`, String(chIdx));
  localStorage.setItem('libraryAiLastBook', readerBook.bookKey);
}

async function openReader(bookKey) {
  readerBook = await getBook(bookKey);
  if (!readerBook) return;
  const set = new Set();
  (readerBook.chapterMeta || []).forEach((m) => set.add(Number(m.index)));
  Object.keys(readerBook.chapters || {}).forEach((k) => set.add(Number(k)));
  Object.keys(readerBook.originals || {}).forEach((k) => set.add(Number(k)));
  readerIndices = Array.from(set).sort((a, b) => a - b);

  const savedCh = parseInt(localStorage.getItem(`lastPos::${bookKey}`) || '-1', 10);
  let start = readerIndices.indexOf(savedCh);
  if (start < 0) start = Math.max(0, readerIndices.findIndex((i) => Boolean(readerBook.chapters?.[i])));

  $('readerOverlay').classList.remove('hidden');
  $('rHeader').classList.remove('chrome-hidden');
  renderReaderChapter(start);
}

async function translateChapterInPwa() {
  if (!readerBook || readerAbort) return;
  const chIdx = readerIndices[readerPos];
  const orig = readerBook.originals?.[chIdx] || '';
  if (!orig) return;

  const cfg = getApiCfg();
  const chunks = splitIntoChunks(orig, 4200);
  readerAbort = new AbortController();
  const trBtn = $('rTranslateBtn');
  const stopBtn = $('rStopTranslateBtn');
  trBtn.disabled = true;
  stopBtn.classList.remove('hidden');

  const out = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      trBtn.textContent = `Перевод ${i + 1}/${chunks.length}...`;
      const part = await translateChunkViaApi(cfg, chunks[i], readerAbort.signal);
      out.push(part);
      renderReaderContent(out.join('\n\n'), chIdx);
    }
    const finalText = out.join('\n\n');
    readerBook.chapters = readerBook.chapters || {};
    readerBook.chapters[chIdx] = finalText;
    readerBook.updatedAt = Date.now();
    await saveBook(readerBook);
    allBooks = await listBooks();
    renderReaderChapter(readerPos);
    showToast('Глава переведена ✓');
  } catch (err) {
    if (err.name === 'AbortError') showToast('Перевод остановлен');
    else showToast(`Ошибка: ${err.message}`, 4500);
    trBtn.disabled = false;
    trBtn.textContent = 'Перевести главу';
  } finally {
    readerAbort = null;
    stopBtn.classList.add('hidden');
  }
}

// --- WebRTC Wi-Fi синхронизация ---
function stopQrScanner() {
  clearInterval(qrScanLoop);
  qrScanLoop = null;
  if (qrStream) {
    qrStream.getTracks().forEach((t) => t.stop());
    qrStream = null;
  }
  $('qrCameraWrap').classList.add('hidden');
}

async function startQrScanner() {
  if (!('BarcodeDetector' in window)) {
    showToast('Отсканируй QR обычной камерой телефона или введи 6-значный код вручную.', 4000);
    return;
  }
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('qrVideo');
    video.srcObject = qrStream;
    $('qrCameraWrap').classList.remove('hidden');
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    qrScanLoop = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          const val = codes[0].rawValue || '';
          stopQrScanner();
          const m = val.match(/[?&]pair=([A-Z0-9]{4,10})/i) || val.match(/^([A-Z0-9]{4,10})$/i);
          if (m) {
            $('pairCodeInput').value = m[1].toUpperCase();
            runSyncWithCode(m[1].toUpperCase());
          } else {
            showToast('QR не похож на код LibraryAI');
          }
        }
      } catch (_) {}
    }, 450);
  } catch (err) {
    showToast(`Камера недоступна: ${err.message}`, 3500);
  }
}

function getPhoneDeviceId() {
  let id = localStorage.getItem('libraryAiPhoneId');
  if (!id) {
    id = 'mob_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('libraryAiPhoneId', id);
  }
  return id;
}

function getPhoneDeviceName() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Телефон (Android)';
  if (/iPhone|iPad/i.test(ua)) return 'Телефон (iOS)';
  return 'Мобильное устройство';
}

function getPairedPcs() {
  try {
    const arr = JSON.parse(localStorage.getItem('libraryAiPairedPcs') || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function savePairedPc(code, name = '') {
  const clean = (code || '').trim().toUpperCase();
  if (clean.length < 4) return;
  const list = getPairedPcs();
  const prev = list.find((x) => x.code === clean);
  const filtered = list.filter((x) => x.code !== clean);
  filtered.unshift({
    code: clean,
    name: name || prev?.name || `ПК (${clean})`,
    lastSync: Date.now()
  });
  localStorage.setItem('libraryAiPairedPcs', JSON.stringify(filtered.slice(0, 12)));
  localStorage.setItem('libraryAiSavedPairCode', clean);
  renderPairedPcsList();
}

function deletePairedPc(code) {
  const next = getPairedPcs().filter((x) => x.code !== code);
  localStorage.setItem('libraryAiPairedPcs', JSON.stringify(next));
  if (localStorage.getItem('libraryAiSavedPairCode') === code) {
    if (next.length > 0) {
      localStorage.setItem('libraryAiSavedPairCode', next[0].code);
      $('pairCodeInput').value = next[0].code;
    } else {
      localStorage.removeItem('libraryAiSavedPairCode');
      $('pairCodeInput').value = '';
    }
  }
  renderPairedPcsList();
}

function renderPairedPcsList() {
  const el = $('mobPairedList');
  if (!el) return;
  const list = getPairedPcs();
  if (list.length === 0) {
    el.innerHTML = '<div class="mob-hint" style="margin:0;">Пока нет сохранённых связей.</div>';
    return;
  }
  el.innerHTML = '';
  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'storage-book-row';

    const meta = document.createElement('div');
    meta.className = 'storage-book-meta';
    const dt = item.lastSync ? new Date(item.lastSync).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    meta.innerHTML = '<div class="storage-book-title"></div><div class="storage-book-sub"></div>';
    meta.querySelector('.storage-book-title').textContent = item.name;
    meta.querySelector('.storage-book-sub').textContent = `Код: ${item.code} · ${dt}`;

    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 'ghost-btn sm';
    syncBtn.textContent = 'Синхр.';
    syncBtn.addEventListener('click', () => {
      switchTab('viewSync');
      runSyncWithCode(item.code, { silent: false });
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger-btn outline';
    delBtn.style.flex = '0 0 auto';
    delBtn.style.padding = '7px 10px';
    delBtn.style.fontSize = '12px';
    delBtn.textContent = '×';
    delBtn.title = 'Удалить связь';
    delBtn.addEventListener('click', () => {
      deletePairedPc(item.code);
      showToast('Связь удалена');
    });

    row.appendChild(meta);
    row.appendChild(syncBtn);
    row.appendChild(delBtn);
    el.appendChild(row);
  }
}

function getAllLocalPositions() {
  const pos = {};
  for (const b of allBooks) {
    const v = parseInt(localStorage.getItem(`lastPos::${b.bookKey}`) || '-1', 10);
    if (v >= 0) pos[b.bookKey] = v;
  }
  return pos;
}

function runSyncWithCode(code, { silent = false } = {}) {
  const clean = (code || '').trim().toUpperCase();
  if (clean.length < 4) {
    if (!silent) showToast('Введите 6-значный код с экрана ПК');
    return;
  }
  localStorage.setItem('libraryAiSavedPairCode', clean);
  $('pairCodeInput').value = clean;

  if (syncClient) syncClient.close();
  if (!silent) $('mobSyncBar').style.width = '5%';

  let receivedBooks = 0;
  let totalExpected = 0;
  let connected = false;
  let silentTimer = null;

  if (silent) {
    // Однократная тихая проверка: если ПК не на связи за 6 секунд, закрываем сокет и не тратим батарею
    silentTimer = setTimeout(() => {
      if (!connected && syncClient) {
        syncClient.close();
        syncClient = null;
        $('mobSyncStatus').textContent = 'ПК не в сети (офлайн-режим)';
      }
    }, 6000);
  }

  syncClient = connectSyncClient(clean, {
    onStatus: (s) => { $('mobSyncStatus').textContent = s; },
    onProgress: (_dir, pct) => { $('mobSyncBar').style.width = `${pct}%`; },
    onError: (err) => {
      clearTimeout(silentTimer);
      if (silent) {
        $('mobSyncStatus').textContent = 'ПК не в сети (офлайн-режим)';
        if (syncClient) { syncClient.close(); syncClient = null; }
        return;
      }
      $('mobSyncStatus').textContent = err.message;
      showToast(err.message, 4000);
    },
    onConnected: async (framed) => {
      connected = true;
      clearTimeout(silentTimer);
      await framed.sendJson({ type: 'PHONE_HELLO', deviceId: getPhoneDeviceId(), deviceName: getPhoneDeviceName() });
      savePairedPc(clean);
      await framed.sendJson({ type: 'PHONE_POSITIONS', positions: getAllLocalPositions() });
      for (const b of allBooks) {
        if (b.translatedCount > 0) {
          const full = await getBook(b.bookKey);
          if (full) await framed.sendJson({ type: 'BOOK_DATA', book: full });
        }
      }
      await framed.sendJson({ type: 'PHONE_SYNC_DONE' });
    },
    onMessage: async (msg) => {
      if (msg.type === 'SYNC_START') {
        if (msg.pcName) savePairedPc(clean, msg.pcName);
        if (msg.apiConfig && typeof msg.apiConfig === 'object') {
          const mergedCfg = { ...getApiCfg(), ...msg.apiConfig };
          saveApiCfg(mergedCfg);
          $('mobApiProvider').value = mergedCfg.apiProvider || 'gemini';
          $('mobApiModel').value = mergedCfg.apiModel || 'gemini-2.5-flash';
          $('mobApiKey').value = mergedCfg.apiKey || '';
          $('mobApiBaseUrl').value = mergedCfg.apiBaseUrl || '';
          $('mobTemp').value = String(mergedCfg.temperature ?? 0.7);
          $('mobTempVal').textContent = String(mergedCfg.temperature ?? 0.7);
          $('mobThinking').checked = Boolean(mergedCfg.thinkingEnabled);
        }
        totalExpected = msg.total || 0;
        if (msg.positions) {
          for (const [bk, ch] of Object.entries(msg.positions)) {
            if (localStorage.getItem(`lastPos::${bk}`) === null) {
              localStorage.setItem(`lastPos::${bk}`, String(ch));
            }
          }
        }
      } else if (msg.type === 'BOOK_DATA' && msg.book?.bookKey) {
        await saveBook(msg.book);
        receivedBooks++;
        $('mobSyncStatus').textContent = `Принято книг: ${receivedBooks}${totalExpected ? ` из ${totalExpected}` : ''}`;
        if (totalExpected > 0) $('mobSyncBar').style.width = `${Math.round((receivedBooks / totalExpected) * 100)}%`;
      } else if (msg.type === 'SYNC_DONE') {
        $('mobSyncBar').style.width = '100%';
        $('mobSyncStatus').textContent = `Синхронизация завершена! Книг получено: ${receivedBooks} ✓`;
        allBooks = await listBooks();
        renderLibrary();
        renderStorageManager();
        showToast(silent ? `Автосинхронизация: обновлено книг ${receivedBooks} ✓` : `Синхронизировано книг: ${receivedBooks} ✓`);
        if (syncClient) { syncClient.close(); syncClient = null; }
      }
    }
  });
}

// --- Инициализация ---
async function init() {
  const uiLang = await initI18n();
  $('mobUiLang').value = uiLang;
  $('mobUiLang').addEventListener('change', async () => {
    const v = await saveUiLang($('mobUiLang').value);
    applyI18n(v);
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  await loadCustomFonts();
  applyReaderPrefs();

  const cfg = getApiCfg();
  $('mobApiProvider').value = cfg.apiProvider || 'gemini';
  $('mobApiModel').value = cfg.apiModel || 'gemini-2.5-flash';
  $('mobApiKey').value = cfg.apiKey || '';
  $('mobApiBaseUrl').value = cfg.apiBaseUrl || '';
  $('mobTemp').value = String(cfg.temperature ?? 0.7);
  $('mobTempVal').textContent = String(cfg.temperature ?? 0.7);
  $('mobThinking').checked = Boolean(cfg.thinkingEnabled);

  allBooks = await listBooks();
  renderLibrary();

  const autoSyncEnabled = localStorage.getItem('libraryAiAutoSync') !== 'false';
  $('mobAutoSyncToggle').checked = autoSyncEnabled;
  $('mobAutoSyncToggle').addEventListener('change', () => {
    localStorage.setItem('libraryAiAutoSync', String($('mobAutoSyncToggle').checked));
    showToast($('mobAutoSyncToggle').checked ? 'Автосинхронизация при запуске включена' : 'Автосинхронизация отключена');
  });

  const savedCode = localStorage.getItem('libraryAiSavedPairCode') || '';
  if (savedCode) $('pairCodeInput').value = savedCode;

  // Автозапуск синхронизации по QR-ссылке ?pair=XXXXXX или тихая однократная проверка при запуске
  const params = new URLSearchParams(location.search);
  const pairParam = params.get('pair');
  if (pairParam) {
    switchTab('viewSync');
    $('pairCodeInput').value = pairParam.toUpperCase();
    runSyncWithCode(pairParam, { silent: false });
  } else if (autoSyncEnabled && savedCode && navigator.onLine) {
    runSyncWithCode(savedCode, { silent: true });
  }

  // Навигация и фильтры
  document.querySelectorAll('.bnav-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.querySelectorAll('.f-pill').forEach((b) => b.addEventListener('click', () => {
    activeFilter = b.dataset.filter;
    document.querySelectorAll('.f-pill').forEach((x) => x.classList.toggle('active', x === b));
    renderLibrary();
  }));

  $('addEpubBtn').addEventListener('click', () => $('epubFileInput').click());
  $('epubFileInput').addEventListener('change', () => { handleEpubFiles($('epubFileInput').files); $('epubFileInput').value = ''; });
  $('mobSearchInput').addEventListener('input', renderSearchResults);

  // Синхронизация
  $('connectPairBtn').addEventListener('click', () => runSyncWithCode($('pairCodeInput').value));
  $('scanQrBtn').addEventListener('click', startQrScanner);
  $('stopScanBtn').addEventListener('click', stopQrScanner);

  $('mobImportJsonBtn').addEventListener('click', () => $('mobImportJsonInput').click());
  $('mobImportJsonInput').addEventListener('change', async () => {
    const file = $('mobImportJsonInput').files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const books = Array.isArray(parsed.books) ? parsed.books : [];
      for (const b of books) if (b?.bookKey) await saveBook(b);
      if (parsed.positions) {
        for (const [k, v] of Object.entries(parsed.positions)) localStorage.setItem(`lastPos::${k}`, String(v));
      }
      allBooks = await listBooks();
      renderLibrary();
      renderStorageManager();
      showToast(`Импортировано книг: ${books.length} ✓`);
    } catch (err) {
      showToast(`Ошибка импорта: ${err.message}`, 4000);
    }
    $('mobImportJsonInput').value = '';
  });

  $('mobExportJsonBtn').addEventListener('click', async () => {
    const books = [];
    for (const b of allBooks) { const full = await getBook(b.bookKey); if (full) books.push(full); }
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), books, positions: getAllLocalPositions() })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LibraryAI_phone_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  // Память и API настройки
  $('deleteSelectedBooksBtn').addEventListener('click', async () => {
    if (selectedForDelete.size === 0) return;
    if (!confirm(`Удалить выбранные книги (${selectedForDelete.size})?`)) return;
    for (const k of selectedForDelete) await deleteBook(k);
    allBooks = await listBooks();
    renderLibrary();
    renderStorageManager();
    showToast('Выбранные книги удалены ✓');
  });

  $('clearAllStorageBtn').addEventListener('click', async () => {
    if (!confirm('Очистить ВСЮ память и удалить все книги с телефона?')) return;
    await clearAllBooks();
    allBooks = [];
    renderLibrary();
    renderStorageManager();
    showToast('Память очищена ✓');
  });

  $('mobTemp').addEventListener('input', () => { $('mobTempVal').textContent = $('mobTemp').value; });
  $('saveMobApiBtn').addEventListener('click', () => {
    saveApiCfg({
      apiProvider: $('mobApiProvider').value,
      apiModel: $('mobApiModel').value.trim(),
      apiKey: $('mobApiKey').value.trim(),
      apiBaseUrl: $('mobApiBaseUrl').value.trim(),
      temperature: parseFloat($('mobTemp').value),
      thinkingEnabled: $('mobThinking').checked
    });
    showToast('Настройки API сохранены ✓');
  });

  // Читалка
  $('rBackBtn').addEventListener('click', () => {
    closeReaderSheets();
    $('readerOverlay').classList.add('hidden');
    renderMiniPlayer();
  });
  $('rPrevBtn').addEventListener('click', () => renderReaderChapter(readerPos - 1));
  $('rNextBtn').addEventListener('click', () => renderReaderChapter(readerPos + 1));
  $('rContent').addEventListener('click', () => $('rHeader').classList.toggle('chrome-hidden'));

  $('rTranslateBtn').addEventListener('click', translateChapterInPwa);
  $('rStopTranslateBtn').addEventListener('click', () => { if (readerAbort) readerAbort.abort(); });
  $('rToggleOrigBtn').addEventListener('click', () => {
    if (!readerBook) return;
    const chIdx = readerIndices[readerPos];
    readerShowingOrig = !readerShowingOrig;
    $('rToggleOrigBtn').textContent = readerShowingOrig ? 'Показать перевод' : 'Показать оригинал';
    renderReaderContent(readerShowingOrig ? readerBook.originals?.[chIdx] : readerBook.chapters?.[chIdx], chIdx);
  });

  $('rTocBtn').addEventListener('click', () => {
    closeReaderSheets();
    const list = $('rTocList');
    list.innerHTML = '';
    readerIndices.forEach((chIdx, pos) => {
      const meta = (readerBook.chapterMeta || []).find((m) => m.index === chIdx);
      const isTr = Boolean(readerBook.chapters?.[chIdx]);
      const row = document.createElement('div');
      row.className = 'r-toc-item' + (pos === readerPos ? ' active' : '') + (isTr ? '' : ' untranslated');
      row.innerHTML = `<span></span><span>${isTr ? '✓' : '○'}</span>`;
      row.firstChild.textContent = `${chIdx + 1}. ${meta?.title || `Глава ${chIdx + 1}`}`;
      row.addEventListener('click', () => { renderReaderChapter(pos); closeReaderSheets(); });
      list.appendChild(row);
    });
    $('rSheetBackdrop').classList.remove('hidden');
    $('rTocSheet').classList.remove('hidden');
  });

  $('rSettingsBtn').addEventListener('click', () => {
    closeReaderSheets();
    $('rSheetBackdrop').classList.remove('hidden');
    $('rAppearanceSheet').classList.remove('hidden');
  });
  $('rCloseTocBtn').addEventListener('click', closeReaderSheets);
  $('rCloseAppearanceBtn').addEventListener('click', closeReaderSheets);
  $('rSheetBackdrop').addEventListener('click', closeReaderSheets);

  const updatePref = (patch) => {
    const next = { ...getReaderPrefs(), ...patch };
    localStorage.setItem('libraryAiReaderPrefs', JSON.stringify(next));
    applyReaderPrefs();
  };
  document.querySelectorAll('.r-theme-chip').forEach((b) => b.addEventListener('click', () => updatePref({ theme: b.dataset.theme })));
  $('rFontMinus').addEventListener('click', () => updatePref({ fontSize: Math.max(12, getReaderPrefs().fontSize - 1) }));
  $('rFontPlus').addEventListener('click', () => updatePref({ fontSize: Math.min(30, getReaderPrefs().fontSize + 1) }));
  $('rLineMinus').addEventListener('click', () => updatePref({ lineHeight: Math.max(1.2, +(getReaderPrefs().lineHeight - 0.1).toFixed(1)) }));
  $('rLinePlus').addEventListener('click', () => updatePref({ lineHeight: Math.min(2.4, +(getReaderPrefs().lineHeight + 0.1).toFixed(1)) }));
  $('rFontFamily').addEventListener('change', () => updatePref({ fontFamily: $('rFontFamily').value }));
  $('rUploadFontBtn').addEventListener('click', () => $('rUploadFontInput').click());
  $('rUploadFontInput').addEventListener('change', async () => {
    const f = $('rUploadFontInput').files?.[0];
    if (!f) return;
    const name = f.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[^a-zA-Zа-яА-ЯёЁ0-9 _-]+/g, '').trim() || 'CustomFont';
    await saveCustomFont(name, await f.arrayBuffer());
    await loadCustomFonts();
    updatePref({ fontFamily: `"${name}", serif` });
    showToast(`Шрифт «${name}» добавлен ✓`);
    $('rUploadFontInput').value = '';
  });
}

init();
