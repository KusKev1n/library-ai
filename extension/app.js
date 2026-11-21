import { initI18n } from './lib/i18n.js';
// app.js — Режим перевода Novel AI v4.1 (исключение глав из перевода + автозагрузка из Библиотеки)

import { API_PROVIDERS, loadSettings, saveSettings, loadStats } from './defaults.js';
import { parseEpub, rebuildTranslatedEpub, buildFreshEpub, buildTranslatedHtml, buildTranslatedTxt } from './lib/epub.js';
import { parsePdf, isPdfJsAvailable } from './lib/pdf-reader.js';
import { checkChatTabStatus, openOrFocusChatTab, abortChatTab } from './lib/chat-bridge.js';
import {
  saveBookTranslation,
  loadBookTranslation,
  listSavedTranslations,
  deleteBookTranslation,
  clearAllTranslations,
  getHistoryDirectoryInfo,
  pickHistoryDirectory,
  requestHistoryDirectoryPermission,
  resetHistoryDirectory,
  formatBytes
} from './lib/storage.js';
import { translateChapterText, getLastSentences, abortableSleep } from './lib/translator.js';

const $ = (id) => document.getElementById(id);

let settings = null;
let currentBook = null;
let currentBookKey = '';
let selectedChapterIdx = -1;
let isTranslating = false;
let isPaused = false;
let abortController = null;
let dragCheckState = null;

function formatCompactNum(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString('ru-RU');
}

async function refreshStatsPill() {
  const el = $('statsPill');
  if (!el) return;
  const st = await loadStats();
  const curBookStat = currentBookKey ? st.byBook?.[currentBookKey] : null;
  el.textContent = `Токены: ${formatCompactNum(st.totalTokens)} · Симв.: ${formatCompactNum(st.translatedChars)}`;
  let tip = `Всего (все книги)\nТокены API: ${st.totalTokens.toLocaleString('ru-RU')} (вход ${st.promptTokens.toLocaleString('ru-RU')} / выход ${st.outputTokens.toLocaleString('ru-RU')} / размышл. ${st.thoughtTokens.toLocaleString('ru-RU')})\nПереведено символов: ${st.translatedChars.toLocaleString('ru-RU')} · Глав: ${st.chaptersTranslated}`;
  if (curBookStat) {
    tip += `\n\nТекущая книга («${curBookStat.title}»)\nТокены API: ${(curBookStat.totalTokens || 0).toLocaleString('ru-RU')} · Симв.: ${(curBookStat.translatedChars || 0).toLocaleString('ru-RU')} · Глав: ${curBookStat.chaptersTranslated || 0}`;
  }
  el.title = tip;
}

function log(msg, type = '') {
  const box = $('logBox');
  const line = document.createElement('div');
  line.className = 'log-line' + (type ? ` ${type}` : '');
  const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  line.textContent = `[${time}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

async function persistCurrentBookProgress(includeOriginals = false) {
  if (!currentBook || !currentBookKey) return;
  const chaptersMap = {};
  const originalsMap = includeOriginals ? {} : null;
  const chapterImagesMap = includeOriginals ? {} : null;
  const skippedChapters = [];
  const chapterMeta = currentBook.chapters.map((item, i) => {
    if (item.status === 'done' && item.translatedText) chaptersMap[i] = item.translatedText;
    if (originalsMap && item.text) originalsMap[i] = item.text;
    if (chapterImagesMap && Array.isArray(item.images) && item.images.length > 0) chapterImagesMap[i] = item.images;
    if (item.skipped) skippedChapters.push(i);
    return { index: i, title: item.title };
  });

  await saveBookTranslation(currentBookKey, {
    fileName: currentBook.fileName || currentBookKey.split('::')[0],
    title: currentBook.title,
    author: currentBook.author || '',
    format: currentBook.format || '',
    coverDataUrl: currentBook.coverDataUrl || '',
    totalChapters: currentBook.chapters.length,
    chapterMeta,
    chapters: chaptersMap,
    skippedChapters,
    ...(originalsMap ? { originals: originalsMap } : {}),
    ...(chapterImagesMap ? { chapterImages: chapterImagesMap } : {})
  });
}

function openReaderTab(bookKey, chapterIdx = null) {
  const params = new URLSearchParams();
  if (bookKey) params.set('bookKey', bookKey);
  if (chapterIdx !== null && chapterIdx >= 0) params.set('chapter', String(chapterIdx));
  window.location.href = chrome.runtime.getURL(`reader.html?${params.toString()}`);
}

async function renderHistoryModal() {
  const listEl = $('historyList');
  const summaryEl = $('historySummary');
  listEl.innerHTML = '<div class="hint">Загрузка...</div>';

  const dirInfo = await getHistoryDirectoryInfo();
  $('historyDirLabel').textContent = dirInfo.custom
    ? `📁 ${dirInfo.name}${dirInfo.hasPermission ? '' : ' (требуется доступ)'}`
    : dirInfo.name;
  $('resetHistoryDirBtn').classList.toggle('hidden', !dirInfo.custom);
  $('grantDirPermBtn').classList.toggle('hidden', !(dirInfo.custom && !dirInfo.hasPermission));

  const { items, totalBytes } = await listSavedTranslations();
  summaryEl.textContent = items.length === 0
    ? 'Сохранённых переводов нет (0 Б)'
    : `Книг в памяти: ${items.length} · Занято: ${formatBytes(totalBytes)}`;
  $('deleteAllHistoryBtn').disabled = items.length === 0;

  if (items.length === 0) {
    listEl.innerHTML = '<div class="hint" style="padding:12px 0;">История пуста.</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'history-item';
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = item.title;
    const dateStr = new Date(item.updatedAt).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const sub = document.createElement('div');
    sub.className = 'history-sub';
    sub.textContent = `Глав переведено: ${item.translatedCount} из ${item.totalChapters} · ${formatBytes(item.sizeBytes)} · ${dateStr}`;
    meta.appendChild(title);
    meta.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'controls-group';

    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'btn btn-primary btn-sm';
    readBtn.textContent = 'Читать';
    readBtn.addEventListener('click', () => openReaderTab(item.bookKey));

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn btn-sm';
    openBtn.textContent = 'Перевод';
    openBtn.addEventListener('click', () => {
      $('historyModal').classList.add('hidden');
      loadBookFromStorageKey(item.bookKey);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', async () => {
      await deleteBookTranslation(item.bookKey);
      if (currentBook && currentBookKey === item.bookKey) {
        currentBook.chapters.forEach((c) => { c.translatedText = ''; c.status = 'pending'; c.skipped = false; });
        if (selectedChapterIdx >= 0) selectChapter(selectedChapterIdx);
      }
      log(`Удалён перевод: «${item.title}»`);
      renderHistoryModal();
    });

    actions.appendChild(readBtn);
    actions.appendChild(openBtn);
    actions.appendChild(delBtn);
    row.appendChild(meta);
    row.appendChild(actions);
    listEl.appendChild(row);
  }
}

function populateApiModels(provider, selectedModel) {
  const sel = $('apiModel');
  const info = API_PROVIDERS[provider] || API_PROVIDERS.gemini;
  sel.innerHTML = '';
  for (const m of info.models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  sel.value = info.models.some((m) => m.id === selectedModel) ? selectedModel : info.defaultModel;
  $('tempHint').textContent = settings.mode === 'api'
    ? info.tempHint
    : 'В режиме веб-чата температуру задаёт сам сайт.';
}

function syncUiFromSettings() {
  const isApi = settings.mode === 'api';
  $('modeApiBtn').classList.toggle('active', isApi);
  $('modeChatBtn').classList.toggle('active', !isApi);
  $('apiSection').classList.toggle('hidden', !isApi);
  $('chatSection').classList.toggle('hidden', isApi);
  $('chatTabPill').classList.toggle('hidden', isApi);

  $('apiProvider').value = settings.apiProvider;
  populateApiModels(settings.apiProvider, settings.apiModel);
  $('apiCustomModel').value = settings.apiCustomModel || '';
  $('apiKey').value = settings.apiKey || '';

  $('chatProvider').value = settings.chatProvider || 'gemini';
  $('chatFreshTabPerChunk').checked = Boolean(settings.chatFreshTabPerChunk);
  $('chatUseSkillPrefix').checked = Boolean(settings.chatUseSkillPrefix);
  $('chatSkillPrefix').value = settings.chatSkillPrefix || '';
  $('skillPrefixBlock').classList.toggle('hidden', !settings.chatUseSkillPrefix);
  $('chatSkillFrequency').value = settings.chatSkillFrequency || 'every';
  $('chatSendSystemPrompt').checked = Boolean(settings.chatSendSystemPrompt);

  $('temperature').value = String(settings.temperature ?? 0.7);
  $('tempValue').textContent = String(settings.temperature ?? 0.7);
  $('thinkingEnabled').checked = Boolean(settings.thinkingEnabled);
  $('thinkingOptions').classList.toggle('hidden', !settings.thinkingEnabled);
  $('thinkingLevel').value = settings.thinkingLevel || 'medium';

  $('systemPrompt').value = settings.systemPrompt || '';
  $('glossary').value = settings.glossary || '';
  $('chunkSize').value = String(settings.chunkSize ?? 4500);
  $('delayMs').value = String(settings.delayMs ?? 1500);
}

async function persistQuickSettings() {
  settings = await saveSettings({
    mode: settings.mode,
    apiProvider: $('apiProvider').value,
    apiModel: $('apiModel').value,
    apiCustomModel: $('apiCustomModel').value.trim(),
    apiKey: $('apiKey').value.trim(),
    chatProvider: $('chatProvider').value,
    chatFreshTabPerChunk: $('chatFreshTabPerChunk').checked,
    chatUseSkillPrefix: $('chatUseSkillPrefix').checked,
    chatSkillPrefix: $('chatSkillPrefix').value.trim(),
    chatSkillFrequency: $('chatSkillFrequency').value,
    chatSendSystemPrompt: $('chatSendSystemPrompt').checked,
    temperature: parseFloat($('temperature').value),
    thinkingEnabled: $('thinkingEnabled').checked,
    thinkingLevel: $('thinkingLevel').value,
    systemPrompt: $('systemPrompt').value,
    glossary: $('glossary').value,
    chunkSize: Math.max(1000, parseInt($('chunkSize').value, 10) || 4500),
    delayMs: Math.max(0, parseInt($('delayMs').value, 10) || 1500)
  });
}

async function refreshChatStatus() {
  const provider = $('chatProvider').value;
  const pill = $('chatTabPill');
  const detail = $('chatStatusDetail');
  pill.classList.remove('ok', 'warn');
  pill.textContent = 'Чат: проверка...';
  try {
    const res = await checkChatTabStatus(provider);
    if (res && res.ok && res.ready) {
      pill.classList.add('ok');
      pill.textContent = `Чат ${provider}: готов ✓`;
      detail.textContent = `Подключена вкладка: ${res.title}`;
    } else if (res && res.found) {
      pill.classList.add('warn');
      pill.textContent = `Чат ${provider}: не готов`;
      detail.textContent = res.detail || 'Войдите в аккаунт во вкладке чата.';
    } else {
      pill.classList.add('warn');
      pill.textContent = `Чат ${provider}: не открыт`;
      detail.textContent = 'Нажмите «Открыть чат» или включите «Новая вкладка на фрагмент».';
    }
  } catch (err) {
    pill.classList.add('warn');
    pill.textContent = 'Чат: ошибка';
    detail.textContent = err.message;
  }
}

async function toggleChapterSkipped(idx, forceState = null) {
  if (!currentBook || idx < 0 || idx >= currentBook.chapters.length) return;
  const ch = currentBook.chapters[idx];
  ch.skipped = forceState !== null ? Boolean(forceState) : !ch.skipped;
  await persistCurrentBookProgress(false);
  if (selectedChapterIdx === idx) updatePreviewControls(ch);
  renderChapterList();
}

function updatePreviewControls(ch) {
  const len = (ch.text || '').trim().length;
  $('previewCharCount').textContent = len > 0 ? `${len.toLocaleString('ru-RU')} симв.` : 'пусто';

  const skipBtn = $('toggleSkipChapterBtn');
  skipBtn.disabled = !currentBook;
  if (ch.skipped) {
    skipBtn.textContent = 'Вернуть в перевод';
    skipBtn.classList.add('btn-warn');
  } else {
    skipBtn.textContent = 'Исключить из перевода';
    skipBtn.classList.remove('btn-warn');
  }

  $('transPreview').textContent = ch.translatedText
    || (ch.skipped ? 'Глава исключена из перевода (будет пропущена).' : 'Эта глава ещё не переведена.');
}

function getChapterStatusIcon(ch) {
  if (ch.skipped) return '⊘';
  if (ch.status === 'done') return '✅';
  if (ch.status === 'running') return '⏳';
  if (ch.status === 'error') return '❌';
  return '○';
}

function updateSkippedSummary() {
  if (!currentBook) return;
  const skippedCount = currentBook.chapters.filter((c) => c.skipped).length;
  $('skipShortBtn').disabled = false;
  $('unskipAllBtn').disabled = skippedCount === 0;
  $('skippedCounter').textContent = skippedCount > 0
    ? `В переводе: ${currentBook.chapters.length - skippedCount} · Исключено: ${skippedCount}`
    : `Все главы в переводе (${currentBook.chapters.length})`;
  updateProgressBar();
}

function applyDragSkipToRow(idx, targetSkipped) {
  const ch = currentBook?.chapters?.[idx];
  if (!ch || !dragCheckState || dragCheckState.touched.has(idx)) return;
  dragCheckState.touched.add(idx);
  if (ch.skipped === targetSkipped) return;

  ch.skipped = targetSkipped;
  const row = $('chapterList').querySelector(`.chapter-item[data-idx="${idx}"]`);
  if (row) {
    row.classList.toggle('skipped', ch.skipped);
    const cb = row.querySelector('.chapter-check');
    if (cb) cb.checked = !ch.skipped;
    const st = row.querySelector('.chapter-status');
    if (st) st.textContent = getChapterStatusIcon(ch);
  }
  if (selectedChapterIdx === idx) updatePreviewControls(ch);
  updateSkippedSummary();
}

async function finishDragCheck() {
  if (!dragCheckState) return;
  dragCheckState = null;
  $('chapterList').classList.remove('dragging-checks');
  await persistCurrentBookProgress(false);
}

function renderChapterList() {
  const list = $('chapterList');
  if (!currentBook) return;
  list.innerHTML = '';

  currentBook.chapters.forEach((ch, idx) => {
    const item = document.createElement('div');
    item.dataset.idx = String(idx);
    item.className = 'chapter-item'
      + (idx === selectedChapterIdx ? ' active' : '')
      + (ch.skipped ? ' skipped' : '');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'chapter-check';
    check.checked = !ch.skipped;
    check.title = 'Клик или зажмите и проведите по списку';

    // Зажатие ЛКМ на галочке начинает массовое выделение/снятие ведением курсора
    check.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const targetSkipped = !ch.skipped;
      dragCheckState = { targetSkipped, touched: new Set() };
      $('chapterList').classList.add('dragging-checks');
      applyDragSkipToRow(idx, targetSkipped);
    });
    check.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    check.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        toggleChapterSkipped(idx);
      }
    });

    item.addEventListener('mouseenter', () => {
      if (dragCheckState) applyDragSkipToRow(idx, dragCheckState.targetSkipped);
    });

    const titleSpan = document.createElement('span');
    titleSpan.className = 'chapter-title';
    titleSpan.textContent = `${idx + 1}. ${ch.title}`;

    const statusSpan = document.createElement('span');
    statusSpan.className = 'chapter-status';
    statusSpan.textContent = getChapterStatusIcon(ch);

    item.appendChild(check);
    item.appendChild(titleSpan);
    item.appendChild(statusSpan);
    item.addEventListener('click', () => {
      if (!dragCheckState) selectChapter(idx);
    });
    list.appendChild(item);
  });

  updateSkippedSummary();
}

function selectChapter(idx) {
  if (!currentBook || idx < 0 || idx >= currentBook.chapters.length) return;
  selectedChapterIdx = idx;
  const ch = currentBook.chapters[idx];
  $('previewTitle').textContent = `${idx + 1}. ${ch.title}`;
  $('origPreview').textContent = ch.text || '';
  updatePreviewControls(ch);
  $('retranslateChapterBtn').disabled = isTranslating;
  renderChapterList();
}

function updateProgressBar() {
  if (!currentBook) return;
  const total = currentBook.chapters.length;
  const skipped = currentBook.chapters.filter((c) => c.skipped).length;
  const activeTotal = Math.max(0, total - skipped);
  const doneActive = currentBook.chapters.filter((c) => c.status === 'done' && !c.skipped).length;
  const doneAll = currentBook.chapters.filter((c) => c.status === 'done').length;
  const pct = activeTotal > 0 ? Math.round((doneActive / activeTotal) * 100) : 0;

  $('progressBar').style.width = `${pct}%`;
  const skipNote = skipped > 0 ? ` · исключено ${skipped}` : '';
  $('progressText').textContent = `${currentBook.title} · переведено ${doneActive} из ${activeTotal} (${pct}%)${skipNote}`;

  const hasAny = doneAll > 0;
  $('openReaderBtn').disabled = false;
  $('exportEpubBtn').disabled = !hasAny;
  $('exportHtmlBtn').disabled = !hasAny;
  $('exportPdfBtn').disabled = !hasAny;
  $('exportTxtBtn').disabled = !hasAny;
  $('clearSavedBtn').classList.toggle('hidden', !hasAny);
}

/**
 * Загружает книгу в переводчик напрямую из сохранённой библиотеки (по ?bookKey=).
 */
async function loadBookFromStorageKey(bookKey) {
  const rec = await loadBookTranslation(bookKey);
  if (!rec) return false;

  const skippedSet = new Set(rec.skippedChapters || []);
  const chapters = (rec.chapterMeta || []).map((m) => ({
    index: m.index + 1,
    title: m.title,
    text: rec.originals?.[m.index] || '',
    translatedText: rec.chapters?.[m.index] || '',
    status: rec.chapters?.[m.index] ? 'done' : 'pending',
    skipped: skippedSet.has(m.index)
  }));

  if (chapters.length === 0) return false;

  currentBook = {
    format: rec.format || 'epub',
    fileName: rec.fileName,
    title: rec.title,
    author: rec.author || '',
    coverDataUrl: rec.coverDataUrl || '',
    chapters
  };
  currentBookKey = rec.bookKey;

  $('fileInfo').textContent = `«${rec.title}» — ${chapters.length} глав (из Библиотеки)`;
  $('fromChapter').value = '1';
  $('fromChapter').max = String(chapters.length);
  $('toChapter').value = String(chapters.length);
  $('toChapter').max = String(chapters.length);
  $('startBtn').disabled = false;
  const navRead = $('navReaderLink');
  if (navRead) navRead.href = `reader.html?bookKey=${encodeURIComponent(currentBookKey)}`;
  log(`Книга «${rec.title}» загружена из Библиотеки (глав: ${chapters.length}).`, 'ok');
  selectChapter(0);
  return true;
}

async function handleFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'epub' && ext !== 'pdf') {
    log('Поддерживаются только файлы .epub и .pdf', 'err');
    return;
  }

  log(`Загрузка файла: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} МБ)...`);
  $('fileInfo').textContent = 'Чтение файла...';

  try {
    const buffer = await file.arrayBuffer();
    if (ext === 'epub') {
      currentBook = await parseEpub(buffer, file.name);
      log(`EPUB загружен: «${currentBook.title}», глав: ${currentBook.chapters.length}`, 'ok');
    } else {
      currentBook = await parsePdf(buffer, file.name, (p, total) => {
        if (p % 15 === 0 || p === total) $('fileInfo').textContent = `Чтение PDF: стр. ${p} из ${total}...`;
      });
      log(`PDF загружен: «${currentBook.title}», разделов: ${currentBook.chapters.length}`, 'ok');
    }

    currentBook.fileName = file.name;
    currentBookKey = `${file.name}::${file.size}`;
    const savedRec = await loadBookTranslation(currentBookKey);
    const saved = savedRec?.chapters || null;
    const skippedSet = new Set(savedRec?.skippedChapters || []);
    let restoredCount = 0;

    currentBook.chapters.forEach((ch, idx) => {
      ch.skipped = skippedSet.has(idx);
      if (saved && saved[idx]) {
        ch.translatedText = saved[idx];
        ch.status = 'done';
        restoredCount++;
      } else {
        ch.translatedText = '';
        ch.status = 'pending';
      }
    });

    await persistCurrentBookProgress(true);

    $('fileInfo').textContent = `${file.name} — ${currentBook.chapters.length} глав` +
      (restoredCount > 0 ? ` (восстановлено: ${restoredCount})` : '');
    $('fromChapter').value = '1';
    $('fromChapter').max = String(currentBook.chapters.length);
    $('toChapter').value = String(currentBook.chapters.length);
    $('toChapter').max = String(currentBook.chapters.length);
    $('startBtn').disabled = false;
    const navRead = $('navReaderLink');
    if (navRead) navRead.href = `reader.html?bookKey=${encodeURIComponent(currentBookKey)}`;

    selectChapter(0);
  } catch (err) {
    log(`Ошибка чтения файла: ${err.message}`, 'err');
    $('fileInfo').textContent = `Ошибка: ${err.message}`;
  }
}

async function translateSingleChapter(chIdx, runtimeState) {
  const ch = currentBook.chapters[chIdx];
  const signal = abortController?.signal;

  ch.skipped = false;
  ch.status = 'running';
  renderChapterList();

  while (isPaused && isTranslating) await abortableSleep(250, signal);

  const translated = await translateChapterText(settings, ch.text, {
    signal,
    runtimeState,
    bookInfo: { bookKey: currentBookKey, title: currentBook.title },
    onChunkStart: (cur, total, len) => log(`Глава ${chIdx + 1}/${currentBook.chapters.length}, фрагмент ${cur}/${total} (${len} симв.)...`),
    onChunkDone: (partialText) => {
      ch.translatedText = partialText;
      if (selectedChapterIdx === chIdx) $('transPreview').textContent = ch.translatedText;
    },
    onRetry: (attempt, maxAttempts, err) => log(`Попытка ${attempt}/${maxAttempts} не удалась: ${err.message}`, 'err')
  });

  ch.translatedText = translated;
  ch.status = 'done';
  await persistCurrentBookProgress(false);
  chrome.runtime.sendMessage({ type: 'BOOK_UPDATED', bookKey: currentBookKey, chapterIdx: chIdx }).catch(() => {});
  if (selectedChapterIdx === chIdx) updatePreviewControls(ch);
  renderChapterList();
  log(`Глава ${chIdx + 1} («${ch.title}») переведена ✓`, 'ok');
}

async function runTranslation(onlyChapterIdx = null) {
  if (!currentBook || isTranslating) return;
  await persistQuickSettings();

  if (settings.mode === 'api' && !settings.apiKey && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(settings.apiBaseUrl || '')) {
    log('Укажите API-ключ или переключитесь на «Чат во вкладке».', 'err');
    return;
  }

  isTranslating = true;
  isPaused = false;
  abortController = new AbortController();

  $('startBtn').disabled = true;
  $('retranslateChapterBtn').disabled = true;
  $('pauseBtn').classList.remove('hidden');
  $('pauseBtn').textContent = 'Пауза';
  $('stopBtn').classList.remove('hidden');

  const startIdx = onlyChapterIdx !== null ? onlyChapterIdx : Math.max(0, (parseInt($('fromChapter').value, 10) || 1) - 1);
  const endIdx = onlyChapterIdx !== null ? onlyChapterIdx : Math.min(currentBook.chapters.length - 1, (parseInt($('toChapter').value, 10) || currentBook.chapters.length) - 1);

  const runtimeState = { isFirstInChat: true, chatMsgCount: 0, lastTranslatedTail: '' };
  log(`Старт перевода (${settings.mode === 'api' ? `API: ${settings.apiProvider}` : `Чат: ${settings.chatProvider}`}), главы ${startIdx + 1}–${endIdx + 1}...`);

  let stoppedByUser = false;
  let skippedInRun = 0;
  try {
    for (let i = startIdx; i <= endIdx; i++) {
      if (!isTranslating) { stoppedByUser = true; break; }
      const ch = currentBook.chapters[i];
      if (onlyChapterIdx === null && ch.skipped) {
        skippedInRun++;
        continue;
      }
      if (onlyChapterIdx === null && ch.status === 'done') {
        runtimeState.lastTranslatedTail = getLastSentences(ch.translatedText, 2);
        continue;
      }
      try {
        await translateSingleChapter(i, runtimeState);
      } catch (err) {
        if (!isTranslating || err.name === 'AbortError') {
          stoppedByUser = true;
          if (ch.status === 'running') ch.status = 'pending';
          break;
        }
        ch.status = 'error';
        renderChapterList();
        log(`Ошибка в главе ${i + 1}: ${err.message}`, 'err');
        break;
      }
    }
    if (!stoppedByUser && isTranslating) {
      const skipMsg = skippedInRun > 0 ? ` (пропущено исключённых глав: ${skippedInRun})` : '';
      log(`Перевод завершён!${skipMsg} Можно читать или скачивать файл.`, 'ok');
    } else if (stoppedByUser) {
      log('Перевод остановлен.', 'err');
    }
  } finally {
    isTranslating = false;
    isPaused = false;
    abortController = null;
    $('startBtn').disabled = false;
    $('retranslateChapterBtn').disabled = selectedChapterIdx < 0;
    $('pauseBtn').classList.add('hidden');
    $('stopBtn').classList.add('hidden');
    renderChapterList();
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function getSafeBaseName() {
  return (currentBook?.title || 'translated_book').replace(/[\\/:*?"<>|]+/g, '_').trim() + '_RU';
}

async function init() {
  await initI18n();
  settings = await loadSettings();
  syncUiFromSettings();
  refreshStatsPill();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.translationStats) refreshStatsPill();
  });

  const pdfOk = await isPdfJsAvailable();
  const pdfPill = $('pdfjsStatus');
  pdfPill.textContent = pdfOk ? 'PDF.js ✓' : 'PDF базовый';
  pdfPill.classList.add(pdfOk ? 'ok' : 'warn');

  if (settings.mode === 'chat') refreshChatStatus();

  const params = new URLSearchParams(location.search);
  const keyParam = params.get('bookKey');
  if (keyParam) {
    await loadBookFromStorageKey(keyParam);
  }

  chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg?.type === 'BOOK_UPDATED' && currentBook && msg.bookKey === currentBookKey) {
      const rec = await loadBookTranslation(currentBookKey);
      if (rec?.chapters?.[msg.chapterIdx]) {
        const ch = currentBook.chapters[msg.chapterIdx];
        if (ch) {
          ch.translatedText = rec.chapters[msg.chapterIdx];
          ch.status = 'done';
          if (selectedChapterIdx === msg.chapterIdx) updatePreviewControls(ch);
          renderChapterList();
        }
      }
    }
  });

  $('modeApiBtn').addEventListener('click', async () => { settings.mode = 'api'; syncUiFromSettings(); await persistQuickSettings(); });
  $('modeChatBtn').addEventListener('click', async () => { settings.mode = 'chat'; syncUiFromSettings(); await persistQuickSettings(); refreshChatStatus(); });
  $('apiProvider').addEventListener('change', async () => { populateApiModels($('apiProvider').value, ''); await persistQuickSettings(); });

  ['apiModel', 'apiCustomModel', 'apiKey', 'chatProvider', 'chatSkillPrefix', 'chatSkillFrequency', 'thinkingLevel', 'systemPrompt', 'glossary', 'chunkSize', 'delayMs'].forEach((id) => {
    $(id).addEventListener('change', persistQuickSettings);
  });

  $('chatProvider').addEventListener('change', refreshChatStatus);
  $('chatFreshTabPerChunk').addEventListener('change', persistQuickSettings);
  $('chatUseSkillPrefix').addEventListener('change', async () => {
    $('skillPrefixBlock').classList.toggle('hidden', !$('chatUseSkillPrefix').checked);
    await persistQuickSettings();
  });
  $('chatSendSystemPrompt').addEventListener('change', persistQuickSettings);
  $('temperature').addEventListener('input', () => { $('tempValue').textContent = $('temperature').value; });
  $('temperature').addEventListener('change', persistQuickSettings);
  $('thinkingEnabled').addEventListener('change', async () => {
    $('thinkingOptions').classList.toggle('hidden', !$('thinkingEnabled').checked);
    await persistQuickSettings();
  });

  document.querySelectorAll('.chip[data-skill]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      $('chatSkillPrefix').value = btn.dataset.skill;
      $('chatUseSkillPrefix').checked = Boolean(btn.dataset.skill);
      $('skillPrefixBlock').classList.toggle('hidden', !$('chatUseSkillPrefix').checked);
      await persistQuickSettings();
    });
  });

  $('openChatTabBtn').addEventListener('click', async () => {
    await openOrFocusChatTab($('chatProvider').value);
    setTimeout(refreshChatStatus, 1500);
  });
  $('checkChatTabBtn').addEventListener('click', refreshChatStatus);

  // Панель исключения глав
  $('skipShortBtn').addEventListener('click', async () => {
    if (!currentBook) return;
    const threshold = Math.max(20, parseInt($('shortThresholdInput').value, 10) || 350);
    let newlySkipped = 0;
    currentBook.chapters.forEach((ch) => {
      const len = (ch.text || '').trim().length;
      if (len < threshold && ch.status !== 'done' && !ch.skipped) {
        ch.skipped = true;
        newlySkipped++;
      }
    });
    await persistCurrentBookProgress(false);
    if (selectedChapterIdx >= 0) updatePreviewControls(currentBook.chapters[selectedChapterIdx]);
    renderChapterList();
    log(newlySkipped > 0
      ? `Исключено коротких глав (< ${threshold} симв.): ${newlySkipped}.`
      : `Новых глав короче ${threshold} симв. не найдено.`);
  });

  $('unskipAllBtn').addEventListener('click', async () => {
    if (!currentBook) return;
    currentBook.chapters.forEach((ch) => { ch.skipped = false; });
    await persistCurrentBookProgress(false);
    if (selectedChapterIdx >= 0) updatePreviewControls(currentBook.chapters[selectedChapterIdx]);
    renderChapterList();
    log('Все главы возвращены в перевод.');
  });

  $('toggleSkipChapterBtn').addEventListener('click', () => {
    if (selectedChapterIdx >= 0) toggleChapterSkipped(selectedChapterIdx);
  });

  // История / Память
  $('openHistoryBtn').addEventListener('click', () => { $('historyModal').classList.remove('hidden'); renderHistoryModal(); });
  $('closeHistoryBtn').addEventListener('click', () => $('historyModal').classList.add('hidden'));
  $('historyModal').addEventListener('click', (e) => { if (e.target === $('historyModal')) $('historyModal').classList.add('hidden'); });
  $('pickHistoryDirBtn').addEventListener('click', async () => {
    try {
      const info = await pickHistoryDirectory();
      log(`Папка истории: «${info.name}» (перенесено: ${info.migrated}).`, 'ok');
      renderHistoryModal();
    } catch (err) {
      if (err.name !== 'AbortError') log(`Ошибка выбора папки: ${err.message}`, 'err');
    }
  });
  $('grantDirPermBtn').addEventListener('click', async () => {
    if (await requestHistoryDirectoryPermission()) log('Доступ к папке истории восстановлен ✓', 'ok');
    renderHistoryModal();
  });
  $('resetHistoryDirBtn').addEventListener('click', async () => {
    await resetHistoryDirectory();
    log('История возвращена в IndexedDB.');
    renderHistoryModal();
  });
  $('deleteAllHistoryBtn').addEventListener('click', async () => {
    if (!confirm('Удалить ВСЕ сохранённые переводы?')) return;
    await clearAllTranslations();
    if (currentBook) {
      currentBook.chapters.forEach((c) => { c.translatedText = ''; c.status = 'pending'; c.skipped = false; });
      if (selectedChapterIdx >= 0) selectChapter(selectedChapterIdx);
    }
    log('Все переводы удалены.', 'ok');
    renderHistoryModal();
  });

  $('openReaderBtn').addEventListener('click', async () => {
    if (!currentBook) return;
    await persistCurrentBookProgress(false);
    openReaderTab(currentBookKey, selectedChapterIdx >= 0 ? selectedChapterIdx : 0);
  });

  const dz = $('dropzone');
  const fi = $('fileInput');
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => handleFile(fi.files[0]));
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]);
  });

  window.addEventListener('mouseup', finishDragCheck);
  window.addEventListener('blur', finishDragCheck);

  $('startBtn').addEventListener('click', () => runTranslation(null));
  $('retranslateChapterBtn').addEventListener('click', () => { if (selectedChapterIdx >= 0) runTranslation(selectedChapterIdx); });
  $('pauseBtn').addEventListener('click', () => {
    isPaused = !isPaused;
    $('pauseBtn').textContent = isPaused ? 'Продолжить' : 'Пауза';
    log(isPaused ? 'Пауза.' : 'Продолжено.');
  });
  $('stopBtn').addEventListener('click', () => {
    isTranslating = false;
    isPaused = false;
    if (settings.mode === 'chat') abortChatTab(settings.chatProvider);
    if (abortController) abortController.abort();
    log('Остановка перевода...', 'err');
  });
  $('clearSavedBtn').addEventListener('click', async () => {
    if (!currentBook) return;
    await deleteBookTranslation(currentBookKey);
    currentBook.chapters.forEach((c) => { c.translatedText = ''; c.status = 'pending'; c.skipped = false; });
    if (selectedChapterIdx >= 0) selectChapter(selectedChapterIdx);
    log('Прогресс очищен.');
  });

  $('exportEpubBtn').addEventListener('click', async () => {
    if (!currentBook) return;
    try {
      const blob = currentBook.format === 'epub'
        ? await rebuildTranslatedEpub(currentBook, currentBook.chapters)
        : await buildFreshEpub(currentBook.title, currentBook.author, currentBook.chapters);
      downloadBlob(blob, `${getSafeBaseName()}.epub`);
      log('EPUB сохранён ✓', 'ok');
    } catch (err) { log(`Ошибка EPUB: ${err.message}`, 'err'); }
  });
  $('exportHtmlBtn').addEventListener('click', () => {
    if (!currentBook) return;
    const html = buildTranslatedHtml(currentBook.title, currentBook.author, currentBook.chapters, false);
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${getSafeBaseName()}.html`);
    log('HTML сохранён ✓', 'ok');
  });
  $('exportPdfBtn').addEventListener('click', () => {
    if (!currentBook) return;
    const html = buildTranslatedHtml(currentBook.title, currentBook.author, currentBook.chapters, true);
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '_blank');
  });
  $('exportTxtBtn').addEventListener('click', () => {
    if (!currentBook) return;
    const txt = buildTranslatedTxt(currentBook.title, currentBook.chapters);
    downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), `${getSafeBaseName()}.txt`);
    log('TXT сохранён ✓', 'ok');
  });
}

init();
