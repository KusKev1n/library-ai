// lib/storage.js — Хранилище библиотеки, локальной папки с книгами (PDF/EPUB), папки истории и своих шрифтов

const DB_NAME = 'NovelAITranslatorDB';
const DB_VERSION = 2;
const STORE_TRANSLATIONS = 'translations';
const STORE_META = 'meta';
const STORE_FONTS = 'customFonts';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRANSLATIONS)) {
        db.createObjectStore(STORE_TRANSLATIONS, { keyPath: 'bookKey' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_FONTS)) {
        db.createObjectStore(STORE_FONTS, { keyPath: 'name' });
      }
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('База данных занята другой вкладкой. Обновите вкладки расширения (F5).'));
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function estimateBytes(obj) {
  try { return new TextEncoder().encode(JSON.stringify(obj)).length; } catch (_) { return 0; }
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

function safeFileNameFromKey(bookKey) {
  let hash = 0;
  for (let i = 0; i < bookKey.length; i++) hash = ((hash << 5) - hash + bookKey.charCodeAt(i)) | 0;
  const base = bookKey.split('::')[0].replace(/\.(epub|pdf)$/i, '').replace(/[^a-zA-Zа-яА-ЯёЁ0-9._-]+/g, '_').slice(0, 60);
  return `${base || 'book'}_${(hash >>> 0).toString(16)}.json`;
}

async function getMetaHandle(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => resolve(req.result?.handle || null);
    req.onerror = () => reject(req.error);
  });
}

async function setMetaHandle(key, handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    if (handle) tx.objectStore(STORE_META).put({ key, handle, name: handle.name });
    else tx.objectStore(STORE_META).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function verifyDirPermission(handle, mode = 'readwrite', interactive = false) {
  if (!handle) return false;
  try {
    if ((await handle.queryPermission({ mode })) === 'granted') return true;
    if (interactive && (await handle.requestPermission({ mode })) === 'granted') return true;
  } catch (_) {}
  return false;
}

// --- 1. Папка хранения истории переводов (.json) ---
export async function getHistoryDirectoryInfo() {
  const handle = await getMetaHandle('historyDirHandle');
  if (!handle) return { custom: false, name: 'IndexedDB (встроенная память браузера)', hasPermission: true };
  return { custom: true, name: handle.name, hasPermission: await verifyDirPermission(handle, 'readwrite', false) };
}

export async function pickHistoryDirectory() {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Браузер не поддерживает выбор папки (File System Access API).');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await setMetaHandle('historyDirHandle', handle);
  const existing = await listFromIndexedDb();
  for (const rec of existing) await writeRecordToDir(handle, rec).catch(() => {});
  return { custom: true, name: handle.name, hasPermission: true, migrated: existing.length };
}

export async function requestHistoryDirectoryPermission() {
  const handle = await getMetaHandle('historyDirHandle');
  return handle ? verifyDirPermission(handle, 'readwrite', true) : false;
}

export async function resetHistoryDirectory() {
  await setMetaHandle('historyDirHandle', null);
}

// --- 2. Локальная папка библиотеки с книгами (.epub / .pdf) ---
export async function getLibraryFolderInfo() {
  const handle = await getMetaHandle('libraryDirHandle');
  if (!handle) return { connected: false, name: '', hasPermission: false };
  return { connected: true, name: handle.name, hasPermission: await verifyDirPermission(handle, 'readwrite', false) };
}

export async function pickLibraryFolder() {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Браузер не поддерживает выбор папки (File System Access API).');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await setMetaHandle('libraryDirHandle', handle);
  return { connected: true, name: handle.name, hasPermission: true };
}

export async function requestLibraryFolderPermission() {
  const handle = await getMetaHandle('libraryDirHandle');
  return handle ? verifyDirPermission(handle, 'readwrite', true) : false;
}

export async function resetLibraryFolder() {
  await setMetaHandle('libraryDirHandle', null);
}

/**
 * Сканирует выбранную локальную папку и возвращает все найденные .epub и .pdf файлы.
 */
export async function scanLocalLibraryFolder() {
  const handle = await getMetaHandle('libraryDirHandle');
  if (!handle || !(await verifyDirPermission(handle, 'read', false))) return [];

  const found = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue;
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.epub') && !lower.endsWith('.pdf')) continue;
    try {
      const file = await entry.getFile();
      const format = lower.endsWith('.epub') ? 'epub' : 'pdf';
      found.push({
        bookKey: `${file.name}::${file.size}`,
        fileName: file.name,
        title: file.name.replace(/\.(epub|pdf)$/i, '').replace(/[_]+/g, ' ').trim(),
        format,
        sizeBytes: file.size,
        lastModified: file.lastModified || Date.now(),
        fromLocalFolder: true
      });
    } catch (_) {}
  }
  return found;
}

/**
 * Читает File объект книги из локальной папки библиотеки по её имени.
 */
export async function readLocalLibraryFile(fileName) {
  const handle = await getMetaHandle('libraryDirHandle');
  if (!handle) return null;
  const ok = await verifyDirPermission(handle, 'read', true);
  if (!ok) return null;
  try {
    const fh = await handle.getFileHandle(fileName);
    return await fh.getFile();
  } catch (_) {
    return null;
  }
}

export async function deleteLocalLibraryFile(fileName) {
  const handle = await getMetaHandle('libraryDirHandle');
  if (!handle) return false;
  const ok = await verifyDirPermission(handle, 'readwrite', true);
  if (!ok) return false;
  try {
    await handle.removeEntry(fileName);
    return true;
  } catch (_) {
    return false;
  }
}

// --- 3. Записи книг и переводов ---
async function writeRecordToDir(handle, record) {
  const fh = await handle.getFileHandle(safeFileNameFromKey(record.bookKey), { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(record));
  await writable.close();
}

async function deleteRecordFromDir(handle, bookKey) {
  try { await handle.removeEntry(safeFileNameFromKey(bookKey)); } catch (_) {}
}

async function listFromDir(handle) {
  const items = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    try {
      const file = await entry.getFile();
      const parsed = JSON.parse(await file.text());
      if (parsed && parsed.bookKey) {
        parsed.sizeBytes = file.size;
        items.push(normalizeRecord(parsed));
      }
    } catch (_) {}
  }
  return items;
}

async function listFromIndexedDb() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, 'readonly');
    const req = tx.objectStore(STORE_TRANSLATIONS).getAll();
    req.onsuccess = () => resolve((req.result || []).map(normalizeRecord));
    req.onerror = () => reject(req.error);
  });
}

function normalizeRecord(rec) {
  const chapters = rec.chapters || {};
  const originals = rec.originals || {};
  const fallbackTitle = (rec.bookKey || 'Книга').split('::')[0].replace(/\.(epub|pdf)$/i, '').replace(/[_]+/g, ' ').trim();
  const chapterMeta = Array.isArray(rec.chapterMeta) && rec.chapterMeta.length > 0
    ? rec.chapterMeta
    : Object.keys(chapters).map(Number).sort((a, b) => a - b).map((idx) => ({ index: idx, title: `Глава ${idx + 1}` }));

  return {
    bookKey: rec.bookKey,
    fileName: rec.fileName || (rec.bookKey || '').split('::')[0],
    title: rec.title || fallbackTitle,
    author: rec.author || '',
    format: rec.format || '',
    coverDataUrl: rec.coverDataUrl || '',
    totalChapters: rec.totalChapters || chapterMeta.length,
    translatedCount: Object.keys(chapters).filter((k) => Boolean(chapters[k])).length,
    chapterMeta,
    chapters,
    originals,
    chapterImages: rec.chapterImages || {},
    skippedChapters: Array.isArray(rec.skippedChapters) ? rec.skippedChapters : [],
    updatedAt: rec.updatedAt || Date.now(),
    sizeBytes: rec.sizeBytes || estimateBytes(rec)
  };
}

export async function saveBookTranslation(bookKey, payload) {
  if (!bookKey) return null;
  const existing = await loadBookTranslation(bookKey).catch(() => null);

  const mergedChapters = { ...(existing?.chapters || {}), ...(payload.chapters || {}) };
  const mergedOriginals = payload.originals
    ? { ...(existing?.originals || {}), ...payload.originals }
    : (existing?.originals || {});
  const chapterMeta = (payload.chapterMeta && payload.chapterMeta.length > 0)
    ? payload.chapterMeta
    : (existing?.chapterMeta || []);
  const mergedChapterImages = payload.chapterImages
    ? { ...(existing?.chapterImages || {}), ...payload.chapterImages }
    : (existing?.chapterImages || {});
  const skippedChapters = Array.isArray(payload.skippedChapters)
    ? payload.skippedChapters
    : (existing?.skippedChapters || []);

  const record = {
    bookKey,
    fileName: payload.fileName || existing?.fileName || bookKey.split('::')[0],
    title: payload.title || existing?.title || bookKey.split('::')[0],
    author: payload.author ?? existing?.author ?? '',
    format: payload.format || existing?.format || '',
    coverDataUrl: payload.coverDataUrl || existing?.coverDataUrl || '',
    totalChapters: payload.totalChapters || existing?.totalChapters || chapterMeta.length || Object.keys(mergedChapters).length,
    chapterMeta,
    chapters: mergedChapters,
    originals: mergedOriginals,
    chapterImages: mergedChapterImages,
    skippedChapters,
    updatedAt: Date.now()
  };
  record.sizeBytes = estimateBytes(record);

  const dirHandle = await getMetaHandle('historyDirHandle');
  if (dirHandle && (await verifyDirPermission(dirHandle, 'readwrite', false))) {
    await writeRecordToDir(dirHandle, record);
  }

  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite');
    tx.objectStore(STORE_TRANSLATIONS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return normalizeRecord(record);
}

export async function loadBookTranslation(bookKey) {
  if (!bookKey) return null;
  const dirHandle = await getMetaHandle('historyDirHandle');
  if (dirHandle && (await verifyDirPermission(dirHandle, 'read', false))) {
    try {
      const fh = await dirHandle.getFileHandle(safeFileNameFromKey(bookKey));
      const file = await fh.getFile();
      const parsed = JSON.parse(await file.text());
      if (parsed && parsed.bookKey) {
        parsed.sizeBytes = file.size;
        return normalizeRecord(parsed);
      }
    } catch (_) {}
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, 'readonly');
    const req = tx.objectStore(STORE_TRANSLATIONS).get(bookKey);
    req.onsuccess = () => resolve(req.result ? normalizeRecord(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

export async function listSavedTranslations() {
  const dirHandle = await getMetaHandle('historyDirHandle');
  const items = (dirHandle && (await verifyDirPermission(dirHandle, 'read', false)))
    ? await listFromDir(dirHandle)
    : await listFromIndexedDb();
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  const totalBytes = items.reduce((sum, it) => sum + (it.sizeBytes || 0), 0);
  return { items, totalBytes };
}

export async function deleteBookTranslation(bookKey) {
  if (!bookKey) return;
  const dirHandle = await getMetaHandle('historyDirHandle');
  if (dirHandle && (await verifyDirPermission(dirHandle, 'readwrite', false))) {
    await deleteRecordFromDir(dirHandle, bookKey);
  }
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite');
    tx.objectStore(STORE_TRANSLATIONS).delete(bookKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllTranslations() {
  const dirHandle = await getMetaHandle('historyDirHandle');
  if (dirHandle && (await verifyDirPermission(dirHandle, 'readwrite', false))) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.json')) {
        await dirHandle.removeEntry(entry.name).catch(() => {});
      }
    }
  }
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite');
    tx.objectStore(STORE_TRANSLATIONS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- 4. Пользовательские шрифты ---
export async function saveCustomFont(name, arrayBuffer) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FONTS, 'readwrite');
    tx.objectStore(STORE_FONTS).put({ name, data: arrayBuffer, addedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listCustomFonts() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FONTS, 'readonly');
    const req = tx.objectStore(STORE_FONTS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCustomFont(name) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FONTS, 'readwrite');
    tx.objectStore(STORE_FONTS).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
