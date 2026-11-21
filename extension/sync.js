import { initI18n } from './lib/i18n.js';
// sync.js — Двусторонняя синхронизация библиотеки ПК ↔ Телефон (WebRTC + QR + JSON бэкап)

import { generateQrSvg } from './lib/qr.js';
import { generatePairingCode, startSyncHost, mergeBookRecords } from './lib/sync-rtc.js';
import { listSavedTranslations, loadBookTranslation, saveBookTranslation, formatBytes } from './lib/storage.js';

const $ = (id) => document.getElementById(id);

let currentCode = '';
let pwaUrl = '';
let hostHandle = null;
let cachedBooks = [];
let selectedKeys = new Set();

function log(msg, type = '') {
  const box = $('syncLog');
  const div = document.createElement('div');
  div.className = 'log-line' + (type ? ` ${type}` : '');
  const t = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  div.textContent = `[${t}] ${msg}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function setStatus(msg) {
  $('syncStatus').textContent = msg;
}

function setProgress(pct) {
  $('syncProgressBar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function renderQr() {
  const cleanUrl = (pwaUrl || '').trim();
  let qrPayload = currentCode;
  if (cleanUrl && /^https?:\/\//i.test(cleanUrl)) {
    const sep = cleanUrl.includes('?') ? '&' : '?';
    qrPayload = `${cleanUrl}${sep}pair=${encodeURIComponent(currentCode)}`;
  }
  $('pairCodeDisplay').textContent = currentCode;
  $('qrBox').innerHTML = generateQrSvg(qrPayload, { sizePx: 184, fg: '#191817', bg: '#ffffff' });
}

async function loadBooksList() {
  const { items, totalBytes } = await listSavedTranslations();
  cachedBooks = items;
  if (selectedKeys.size === 0) {
    items.forEach((b) => selectedKeys.add(b.bookKey));
  }

  $('syncBooksSummary').textContent = `${items.length} книг · ${formatBytes(totalBytes)}`;
  const listEl = $('syncBookList');
  if (items.length === 0) {
    listEl.innerHTML = '<div class="hint" style="padding:12px;">В библиотеке пока нет сохранённых книг. Откройте или переведите книгу на ПК.</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const b of items) {
    const row = document.createElement('label');
    row.className = 'sync-book-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'chapter-check';
    cb.checked = selectedKeys.has(b.bookKey);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedKeys.add(b.bookKey);
      else selectedKeys.delete(b.bookKey);
    });

    const info = document.createElement('div');
    info.className = 'sync-book-info';
    const title = document.createElement('div');
    title.className = 'sync-book-title';
    title.textContent = b.title;
    const sub = document.createElement('div');
    sub.className = 'hint';
    sub.style.margin = '0';
    sub.textContent = `Переведено ${b.translatedCount} из ${b.totalChapters} · ${formatBytes(b.sizeBytes)}`;
    info.appendChild(title);
    info.appendChild(sub);

    row.appendChild(cb);
    row.appendChild(info);
    listEl.appendChild(row);
  }
}

async function getReadingPositions(bookKeys) {
  const keys = bookKeys.map((k) => `readerLastPos::${k}`);
  if (keys.length === 0) return {};
  const data = await chrome.storage.local.get(keys);
  const out = {};
  for (const bk of bookKeys) {
    const v = data[`readerLastPos::${bk}`];
    if (v !== undefined) out[bk] = v;
  }
  return out;
}

async function applyReadingPositions(posMap) {
  if (!posMap || typeof posMap !== 'object') return;
  const toSet = {};
  for (const [bk, chIdx] of Object.entries(posMap)) {
    if (typeof chIdx === 'number' && chIdx >= 0) {
      toSet[`readerLastPos::${bk}`] = chIdx;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
}

async function sendSelectedBooksToPhone(framed) {
  const keysToSend = cachedBooks.map((b) => b.bookKey).filter((k) => selectedKeys.has(k));
  const positions = await getReadingPositions(keysToSend);

  const pcLabel = `ПК (${navigator.platform || 'Chrome'})`;
  await framed.sendJson({ type: 'SYNC_START', total: keysToSend.length, positions, pcName: pcLabel });
  log(`Отправка книг на телефон: ${keysToSend.length}...`);

  for (let i = 0; i < keysToSend.length; i++) {
    const rec = await loadBookTranslation(keysToSend[i]);
    if (!rec) continue;
    log(`Отправляю (${i + 1}/${keysToSend.length}): «${rec.title}»...`);
    await framed.sendJson({ type: 'BOOK_DATA', book: rec });
    setProgress(Math.round(((i + 1) / Math.max(1, keysToSend.length)) * 100));
  }

  await framed.sendJson({ type: 'SYNC_DONE' });
  log(`Готово! На телефон отправлено книг: ${keysToSend.length} ✓`, 'ok');
  setStatus('Синхронизация завершена ✓');
}

async function startHostSession(forceNewCode = false) {
  if (hostHandle) {
    hostHandle.close();
    hostHandle = null;
  }
  if (forceNewCode || !currentCode) {
    currentCode = generatePairingCode(6);
    await chrome.storage.local.set({ libraryAiPairCode: currentCode });
  }
  renderQr();
  setProgress(0);

  hostHandle = startSyncHost(currentCode, {
    onStatus: (s) => setStatus(s),
    onProgress: (_dir, pct) => setProgress(pct),
    onError: (err) => {
      setStatus('Ошибка соединения');
      log(err.message, 'err');
    },
    onPeerConnected: async (framed) => {
      log('Телефон подключён по Wi-Fi (WebRTC) ✓', 'ok');
      await sendSelectedBooksToPhone(framed);
    },
    onMessage: async (msg) => {
      if (msg.type === 'PHONE_HELLO') {
        const d = await chrome.storage.local.get('libraryAiPairedDevices');
        const list = Array.isArray(d.libraryAiPairedDevices) ? d.libraryAiPairedDevices : [];
        const devId = msg.deviceId || 'phone';
        const devName = msg.deviceName || 'Телефон';
        const filtered = list.filter((x) => x.id !== devId);
        filtered.unshift({ id: devId, name: devName, code: currentCode, lastSync: Date.now() });
        await chrome.storage.local.set({ libraryAiPairedDevices: filtered.slice(0, 20) });
        log(`Устройство сохранено в связях: ${devName}`, 'ok');
      } else if (msg.type === 'PHONE_POSITIONS' && msg.positions) {
        await applyReadingPositions(msg.positions);
        log('Позиции чтения с телефона обновлены ✓', 'ok');
      } else if (msg.type === 'BOOK_DATA' && msg.book?.bookKey) {
        const local = await loadBookTranslation(msg.book.bookKey);
        const merged = mergeBookRecords(local, msg.book);
        await saveBookTranslation(merged.bookKey, merged);
        log(`Принята/обновлена книга с телефона: «${merged.title}» ✓`, 'ok');
        await loadBooksList();
      } else if (msg.type === 'PHONE_SYNC_DONE') {
        log('Двусторонний обмен с телефоном полностью завершён ✓', 'ok');
      }
    }
  });
}

async function init() {
  await initI18n();
  const stored = await chrome.storage.local.get(['libraryAiPwaUrl', 'libraryAiPairCode']);
  pwaUrl = stored.libraryAiPwaUrl || '';
  currentCode = stored.libraryAiPairCode || '';
  $('pwaUrlInput').value = pwaUrl;

  await loadBooksList();
  await startHostSession(!currentCode);

  $('refreshCodeBtn').addEventListener('click', () => {
    log('Создан новый постоянный код сопряжения.');
    startHostSession(true);
  });

  $('savePwaUrlBtn').addEventListener('click', async () => {
    pwaUrl = $('pwaUrlInput').value.trim();
    await chrome.storage.local.set({ libraryAiPwaUrl: pwaUrl });
    renderQr();
    log('Ссылка PWA сохранена, QR обновлён ✓', 'ok');
  });

  $('exportBackupBtn').addEventListener('click', async () => {
    const keys = cachedBooks.map((b) => b.bookKey).filter((k) => selectedKeys.has(k));
    const books = [];
    for (const k of keys) {
      const rec = await loadBookTranslation(k);
      if (rec) books.push(rec);
    }
    const positions = await getReadingPositions(keys);
    const payload = { version: 1, exportedAt: Date.now(), books, positions };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LibraryAI_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    log(`Экспортирован файл бэкапа (${books.length} книг) ✓`, 'ok');
  });

  $('importBackupBtn').addEventListener('click', () => $('importBackupInput').click());
  $('importBackupInput').addEventListener('change', async () => {
    const file = $('importBackupInput').files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const books = Array.isArray(parsed.books) ? parsed.books : [];
      for (const b of books) {
        if (!b?.bookKey) continue;
        const local = await loadBookTranslation(b.bookKey);
        const merged = mergeBookRecords(local, b);
        await saveBookTranslation(merged.bookKey, merged);
      }
      if (parsed.positions) await applyReadingPositions(parsed.positions);
      await loadBooksList();
      log(`Импортировано и объединено книг: ${books.length} ✓`, 'ok');
    } catch (err) {
      log(`Ошибка импорта: ${err.message}`, 'err');
    }
    $('importBackupInput').value = '';
  });

  window.addEventListener('beforeunload', () => {
    if (hostHandle) hostHandle.close();
  });
}

init();
