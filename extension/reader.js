import { initI18n } from './lib/i18n.js';
// reader.js — Логика вкладки «Режим чтения» (v2.3: все главы, перевод прямо из читалки, свои шрифты)

import { loadSettings } from './defaults.js';
import { parseEpub } from './lib/epub.js';
import {
  loadBookTranslation,
  saveBookTranslation,
  listSavedTranslations,
  saveCustomFont,
  listCustomFonts,
  deleteCustomFont,
  readLocalLibraryFile
} from './lib/storage.js';
import { translateChapterText, getLastSentences } from './lib/translator.js';
import { abortChatTab } from './lib/chat-bridge.js';

const $ = (id) => document.getElementById(id);

const BUILTIN_FONTS = [
  { label: 'Georgia (книжный)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Palatino', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { label: 'Системный (без засечек)', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Моноширинный', value: '"Courier New", Consolas, monospace' }
];

const THEMES = {
  paper:    { bg: '#f9f8f4', text: '#1f1f1f', border: 'rgba(0,0,0,0.1)' },
  sepia:    { bg: '#f3e8d2', text: '#3d2f1e', border: 'rgba(61,47,30,0.14)' },
  sage:     { bg: '#e9efe4', text: '#222e22', border: 'rgba(34,46,34,0.14)' },
  night:    { bg: '#161d2b', text: '#dce3f0', border: 'rgba(255,255,255,0.1)' },
  graphite: { bg: '#1e1f22', text: '#d8d9de', border: 'rgba(255,255,255,0.1)' },
  oled:     { bg: '#000000', text: '#d4d4d8', border: 'rgba(255,255,255,0.12)' }
};

const DEFAULT_READER_PREFS = {
  theme: 'graphite',
  customBg: '#1e1f22',
  customText: '#d8d9de',
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 18,
  lineHeight: 1.7,
  paraGap: 16,
  fontWeight: 400,
  firstLineIndent: true,
  textAlign: 'left',
  fullWidth: false,
  contentWidth: 740,
  keepScreenOn: false,
  showTimeLeft: true,
  showAutoscroll: false,
  hidePanels: false
};

let prefs = { ...DEFAULT_READER_PREFS };
let bookRecord = null;
let allChapterIndices = [];
let currentPos = 0;
let showingOriginal = false;
let customFontNames = [];
let wakeLock = null;
let autoscrollTimer = null;
let autoscrollSpeed = 1.0;
let lastScrollY = 0;
let readerAbortController = null;
let isChapterTranslating = false;

// --- Расчёт контрастности WCAG ---
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function calcContrast(bgHex, textHex) {
  try {
    const l1 = luminance(hexToRgb(bgHex));
    const l2 = luminance(hexToRgb(textHex));
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    return ratio.toFixed(1);
  } catch (_) {
    return '—';
  }
}

// --- Пользовательские шрифты ---
async function loadAndRegisterCustomFonts() {
  const fonts = await listCustomFonts();
  customFontNames = [];
  for (const f of fonts) {
    try {
      const face = new FontFace(f.name, f.data);
      await face.load();
      document.fonts.add(face);
      customFontNames.push(f.name);
    } catch (_) {}
  }
  rebuildFontSelect();
}

function rebuildFontSelect() {
  const sel = $('fontFamily');
  sel.innerHTML = '';

  for (const bf of BUILTIN_FONTS) {
    const opt = document.createElement('option');
    opt.value = bf.value;
    opt.textContent = bf.label;
    sel.appendChild(opt);
  }

  for (const name of customFontNames) {
    const opt = document.createElement('option');
    opt.value = `"${name}", serif`;
    opt.textContent = `★ ${name} (свой)`;
    sel.appendChild(opt);
  }

  // Если выбран системный шрифт, введённый вручную
  const exists = Array.from(sel.options).some((o) => o.value === prefs.fontFamily);
  if (!exists && prefs.fontFamily) {
    const cleanName = prefs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const opt = document.createElement('option');
    opt.value = prefs.fontFamily;
    opt.textContent = `${cleanName} (системный)`;
    sel.appendChild(opt);
  }

  sel.value = prefs.fontFamily;
  updateDeleteFontBtn();
}

function updateDeleteFontBtn() {
  const matched = customFontNames.find((n) => prefs.fontFamily === `"${n}", serif`);
  $('deleteCustomFontBtn').classList.toggle('hidden', !matched);
}

// --- Применение настроек читалки ---
async function savePrefs() {
  await chrome.storage.local.set({ readerPrefs: prefs });
}

async function applyWakeLock() {
  if (prefs.keepScreenOn && 'wakeLock' in navigator) {
    try {
      if (!wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) {}
  } else if (wakeLock) {
    try { await wakeLock.release(); } catch (_) {}
    wakeLock = null;
  }
}

function applyPrefs() {
  const root = document.documentElement;
  const preset = THEMES[prefs.theme];
  const bg = prefs.theme === 'custom' ? prefs.customBg : (preset?.bg || '#1e1f22');
  const text = prefs.theme === 'custom' ? prefs.customText : (preset?.text || '#d8d9de');
  const border = preset?.border || 'rgba(128,128,128,0.22)';

  root.style.setProperty('--reader-bg', bg);
  root.style.setProperty('--reader-text', text);
  root.style.setProperty('--reader-border', border);
  root.style.setProperty('--font-family', prefs.fontFamily);
  root.style.setProperty('--font-size', `${prefs.fontSize}px`);
  root.style.setProperty('--line-height', String(prefs.lineHeight));
  root.style.setProperty('--para-gap', `${prefs.paraGap}px`);
  root.style.setProperty('--font-weight', String(prefs.fontWeight));
  root.style.setProperty('--text-indent', prefs.firstLineIndent ? '1.5em' : '0em');
  root.style.setProperty('--text-align', prefs.textAlign);
  root.style.setProperty('--content-width', `${prefs.contentWidth}px`);

  $('readerMain').classList.toggle('full-width', Boolean(prefs.fullWidth));

  document.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === prefs.theme);
  });
  $('customBg').value = bg;
  $('customText').value = text;
  $('contrastReadout').textContent = `Контраст: ${calcContrast(bg, text)}:1`;

  rebuildFontSelect();
  $('fontSizeVal').textContent = `${prefs.fontSize} px`;
  $('lineHeightVal').textContent = Number(prefs.lineHeight).toFixed(1);
  $('paraGapVal').textContent = `${prefs.paraGap} px`;
  $('fontWeightVal').textContent = String(prefs.fontWeight);
  $('contentWidthVal').textContent = `${prefs.contentWidth} px`;
  $('firstLineIndent').checked = Boolean(prefs.firstLineIndent);
  $('fullWidth').checked = Boolean(prefs.fullWidth);

  document.querySelectorAll('.align-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.align === prefs.textAlign);
  });

  $('keepScreenOn').checked = Boolean(prefs.keepScreenOn);
  $('showTimeLeft').checked = Boolean(prefs.showTimeLeft);
  $('showAutoscroll').checked = Boolean(prefs.showAutoscroll);
  $('hidePanels').checked = Boolean(prefs.hidePanels);

  $('progressTrack').classList.toggle('hidden', !prefs.showTimeLeft);
  $('timeLeftPill').classList.toggle('hidden', !prefs.showTimeLeft);
  $('autoscrollBar').classList.toggle('hidden', !prefs.showAutoscroll);
  if (!prefs.showAutoscroll) stopAutoscroll();
  if (!prefs.hidePanels) $('readerHeader').classList.remove('auto-hidden');

  applyWakeLock();
  updateScrollMetrics();
}

// --- Автопрокрутка ---
function stopAutoscroll() {
  if (autoscrollTimer) {
    cancelAnimationFrame(autoscrollTimer);
    autoscrollTimer = null;
  }
  $('autoToggleBtn').textContent = '▶ Автопрокрутка';
}

function toggleAutoscroll() {
  if (autoscrollTimer) {
    stopAutoscroll();
    return;
  }
  $('autoToggleBtn').textContent = '⏸ Пауза';
  const step = () => {
    window.scrollBy(0, 0.7 * autoscrollSpeed);
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) {
      stopAutoscroll();
      return;
    }
    autoscrollTimer = requestAnimationFrame(step);
  };
  autoscrollTimer = requestAnimationFrame(step);
}

// --- Прогресс и оставшееся время чтения ---
function updateScrollMetrics() {
  if (!prefs.showTimeLeft) return;
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const ratio = Math.min(1, Math.max(0, window.scrollY / maxScroll));
  $('progressFill').style.width = `${Math.round(ratio * 100)}%`;

  const totalWords = ($('chapterContent').textContent || '').trim().split(/\s+/).filter(Boolean).length;
  const remainingWords = Math.round(totalWords * (1 - ratio));
  const minsLeft = Math.max(1, Math.ceil(remainingWords / 200));
  $('timeLeftPill').textContent = ratio >= 0.98 ? 'Глава прочитана ✓' : `~${minsLeft} мин. осталось (${Math.round(ratio * 100)}%)`;
}

// --- Оглавление (все главы: и переведённые, и непереведённые) ---
function renderToc() {
  const list = $('tocList');
  list.innerHTML = '';
  allChapterIndices.forEach((chIdx, pos) => {
    const meta = bookRecord.chapterMeta.find((m) => m.index === chIdx);
    const title = meta?.title || `Глава ${chIdx + 1}`;
    const isTranslated = Boolean(bookRecord.chapters[chIdx]);

    const item = document.createElement('div');
    item.className = 'toc-item' + (pos === currentPos ? ' active' : '') + (isTranslated ? '' : ' untranslated');

    const nameSpan = document.createElement('span');
    nameSpan.style.overflow = 'hidden';
    nameSpan.style.textOverflow = 'ellipsis';
    nameSpan.style.whiteSpace = 'nowrap';
    nameSpan.textContent = `${chIdx + 1}. ${title}`;

    const dot = document.createElement('span');
    dot.className = 'toc-dot';
    dot.textContent = isTranslated ? '✓' : '○';

    item.appendChild(nameSpan);
    item.appendChild(dot);
    item.addEventListener('click', () => {
      renderChapter(pos);
      closeAllDrawers();
    });
    list.appendChild(item);
  });
}

function appendImageFigure(container, imgObj) {
  const fig = document.createElement('figure');
  fig.className = 'reader-illustration';
  const img = document.createElement('img');
  img.src = imgObj.dataUrl;
  img.alt = imgObj.alt || '';
  img.loading = 'lazy';
  fig.appendChild(img);
  container.appendChild(fig);
}

function renderParagraphs(text, images = null) {
  const contentEl = $('chapterContent');
  contentEl.innerHTML = '';
  const chIdx = allChapterIndices[currentPos];
  const chImages = Array.isArray(images) ? images : (bookRecord?.chapterImages?.[chIdx] || []);
  const paragraphs = (text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  if (paragraphs.length === 0 && chImages.length === 0) {
    const pEl = document.createElement('p');
    pEl.style.opacity = '0.6';
    pEl.textContent = 'Текст этой главы не найден в кэше. Загрузите файл книги в окне переводчика один раз, чтобы оригинал сохранился для чтения.';
    contentEl.appendChild(pEl);
    return;
  }

  const topImgs = chImages.filter((im) => im.isTop);
  const bottomImgs = chImages.filter((im) => !im.isTop && im.isBottom);
  const midImgs = chImages.filter((im) => !im.isTop && !im.isBottom);

  for (const im of topImgs) appendImageFigure(contentEl, im);

  const midByIdx = new Map();
  for (const im of midImgs) {
    const targetIdx = Math.min(paragraphs.length - 1, Math.max(0, Math.round((im.ratio || 0.5) * paragraphs.length) - 1));
    if (!midByIdx.has(targetIdx)) midByIdx.set(targetIdx, []);
    midByIdx.get(targetIdx).push(im);
  }

  paragraphs.forEach((para, i) => {
    const pEl = document.createElement('p');
    pEl.textContent = para;
    contentEl.appendChild(pEl);
    const imgsAfter = midByIdx.get(i);
    if (imgsAfter) {
      for (const im of imgsAfter) appendImageFigure(contentEl, im);
    }
  });

  for (const im of bottomImgs) appendImageFigure(contentEl, im);
}

function renderChapter(pos) {
  if (!bookRecord || allChapterIndices.length === 0) return;
  currentPos = Math.max(0, Math.min(allChapterIndices.length - 1, pos));
  showingOriginal = false;

  const chIdx = allChapterIndices[currentPos];
  const meta = bookRecord.chapterMeta.find((m) => m.index === chIdx);
  const title = meta?.title || `Глава ${chIdx + 1}`;
  const translated = bookRecord.chapters[chIdx] || '';
  const original = bookRecord.originals?.[chIdx] || '';
  const isTranslated = Boolean(translated);
  const translatedCount = Object.keys(bookRecord.chapters).filter((k) => Boolean(bookRecord.chapters[k])).length;

  $('bookHeading').textContent = bookRecord.title;
  document.title = `${title} — ${bookRecord.title}`;
  $('chapterTitle').textContent = title;
  $('chapterSub').textContent = isTranslated
    ? `Глава ${chIdx + 1} из ${allChapterIndices.length} · переведено глав: ${translatedCount}`
    : `Глава ${chIdx + 1} из ${allChapterIndices.length} · оригинал (не переведена)`;

  // Незаметная панель действий под заголовком
  const actionsBar = $('chapterActionsBar');
  const translateBtn = $('translateHereBtn');
  const toggleOrigBtn = $('toggleOrigBtn');

  if (!isTranslated) {
    actionsBar.classList.remove('hidden');
    translateBtn.classList.remove('hidden');
    translateBtn.disabled = isChapterTranslating || !original;
    translateBtn.textContent = original ? 'Перевести главу' : 'Оригинал не загружен';
    toggleOrigBtn.classList.add('hidden');
    renderParagraphs(original);
  } else {
    actionsBar.classList.toggle('hidden', !original);
    translateBtn.classList.add('hidden');
    if (original) {
      toggleOrigBtn.classList.remove('hidden');
      toggleOrigBtn.textContent = 'Показать оригинал';
    } else {
      toggleOrigBtn.classList.add('hidden');
    }
    renderParagraphs(translated);
  }

  const hasPrev = currentPos > 0;
  const hasNext = currentPos < allChapterIndices.length - 1;
  $('prevTopBtn').disabled = !hasPrev;
  $('prevBottomBtn').disabled = !hasPrev;
  $('nextTopBtn').disabled = !hasNext;
  $('nextBottomBtn').disabled = !hasNext;

  renderToc();
  window.scrollTo({ top: 0, behavior: 'instant' });
  updateScrollMetrics();

  chrome.storage.local.set({ [`readerLastPos::${bookRecord.bookKey}`]: chIdx });
}

// --- Перевод текущей непереведённой главы прямо из читалки ---
async function translateCurrentChapterInReader() {
  if (!bookRecord || isChapterTranslating) return;
  const chIdx = allChapterIndices[currentPos];
  const original = bookRecord.originals?.[chIdx] || '';
  if (!original) return;

  const settings = await loadSettings();
  if (settings.mode === 'api' && !settings.apiKey && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(settings.apiBaseUrl || '')) {
    $('chapterSub').textContent = 'Ошибка: укажите API-ключ в настройках или выберите режим «Чат во вкладке».';
    return;
  }

  isChapterTranslating = true;
  readerAbortController = new AbortController();
  const btn = $('translateHereBtn');
  const stopBtn = $('stopTranslateHereBtn');
  btn.disabled = true;
  btn.textContent = 'Перевожу...';
  stopBtn.classList.remove('hidden');

  const prevTranslated = chIdx > 0 ? (bookRecord.chapters[chIdx - 1] || '') : '';
  const prevContext = prevTranslated ? getLastSentences(prevTranslated, 2) : '';

  try {
    const translated = await translateChapterText(settings, original, {
      signal: readerAbortController.signal,
      prevContext,
      bookInfo: { bookKey: bookRecord.bookKey, title: bookRecord.title },
      onChunkStart: (cur, total) => {
        btn.textContent = `Перевод: ${cur}/${total}...`;
      },
      onChunkDone: (partialText) => {
        // Живой вывод перевода по мере готовности фрагментов
        if (allChapterIndices[currentPos] === chIdx) {
          renderParagraphs(partialText);
        }
      }
    });

    bookRecord.chapters[chIdx] = translated;
    await saveBookTranslation(bookRecord.bookKey, {
      chapters: { [chIdx]: translated }
    });

    // Уведомляем открытую вкладку переводчика, чтобы обновила статус главы
    chrome.runtime.sendMessage({
      type: 'BOOK_UPDATED',
      bookKey: bookRecord.bookKey,
      chapterIdx: chIdx
    }).catch(() => {});

    if (allChapterIndices[currentPos] === chIdx) {
      renderChapter(currentPos);
    } else {
      renderToc();
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      $('chapterSub').textContent = 'Перевод остановлен.';
    } else {
      $('chapterSub').textContent = `Ошибка перевода: ${err.message}`;
    }
    btn.disabled = false;
    btn.textContent = 'Перевести главу';
  } finally {
    isChapterTranslating = false;
    readerAbortController = null;
    stopBtn.classList.add('hidden');
  }
}

// --- Панели (TOC и Настройки) ---
function closeAllDrawers() {
  $('tocDrawer').classList.add('hidden');
  $('settingsDrawer').classList.add('hidden');
  $('drawerBackdrop').classList.add('hidden');
}

function openDrawer(drawerId) {
  closeAllDrawers();
  $(drawerId).classList.remove('hidden');
  $('drawerBackdrop').classList.remove('hidden');
}

// --- Инициализация ---
async function init() {
  await initI18n();
  const stored = await chrome.storage.local.get('readerPrefs');
  prefs = { ...DEFAULT_READER_PREFS, ...(stored.readerPrefs || {}) };
  await loadAndRegisterCustomFonts();
  applyPrefs();

  const params = new URLSearchParams(location.search);
  let bookKey = params.get('bookKey');
  const requestedChapter = params.has('chapter') ? parseInt(params.get('chapter'), 10) : null;

  if (bookKey) {
    bookRecord = await loadBookTranslation(bookKey);
  }
  const navTr = $('navTranslateLink');
  if (navTr && bookRecord?.bookKey) {
    navTr.href = `app.html?bookKey=${encodeURIComponent(bookRecord.bookKey)}`;
  }

  if (!bookRecord) {
    const { items } = await listSavedTranslations();
    if (items.length > 0) bookRecord = items[0];
  }

  if (!bookRecord) {
    $('bookHeading').textContent = 'Нет загруженных книг';
    $('chapterTitle').textContent = 'Пока нечего читать';
    $('chapterContent').innerHTML = '<p>Загрузите PDF или EPUB в LibraryAI, затем нажмите «Режим чтения».</p>';
    return;
  }

  // Строим список ВСЕХ глав (и переведённых, и непереведённых)
  const indexSet = new Set();
  for (const m of (bookRecord.chapterMeta || [])) indexSet.add(Number(m.index));
  for (const k of Object.keys(bookRecord.chapters || {})) indexSet.add(Number(k));
  for (const k of Object.keys(bookRecord.originals || {})) indexSet.add(Number(k));
  allChapterIndices = Array.from(indexSet).sort((a, b) => a - b);

  let initialPos = 0;
  if (requestedChapter !== null && allChapterIndices.includes(requestedChapter)) {
    initialPos = allChapterIndices.indexOf(requestedChapter);
  } else {
    const lastKey = `readerLastPos::${bookRecord.bookKey}`;
    const lastData = await chrome.storage.local.get(lastKey);
    if (lastData[lastKey] !== undefined && allChapterIndices.includes(lastData[lastKey])) {
      initialPos = allChapterIndices.indexOf(lastData[lastKey]);
    } else {
      const firstTranslated = allChapterIndices.findIndex((idx) => Boolean(bookRecord.chapters[idx]));
      if (firstTranslated >= 0) initialPos = firstTranslated;
    }
  }
  renderChapter(initialPos);
  // Если книга была добавлена до v4.6 без картинок, пробуем тихо подтянуть иллюстрации из локальной папки
  if (bookRecord.format === 'epub' && Object.keys(bookRecord.chapterImages || {}).length === 0 && bookRecord.fileName) {
    readLocalLibraryFile(bookRecord.fileName).then(async (file) => {
      if (!file) return;
      const parsed = await parseEpub(await file.arrayBuffer(), file.name);
      const chapterImages = {};
      parsed.chapters.forEach((ch, i) => {
        if (Array.isArray(ch.images) && ch.images.length > 0) chapterImages[i] = ch.images;
      });
      if (Object.keys(chapterImages).length > 0) {
        bookRecord.chapterImages = chapterImages;
        await saveBookTranslation(bookRecord.bookKey, { chapterImages });
        renderChapter(currentPos);
      }
    }).catch(() => {});
  }


  // Живая синхронизация, если перевод идёт в соседней вкладке app.html
  chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg?.type === 'BOOK_UPDATED' && bookRecord && msg.bookKey === bookRecord.bookKey) {
      const fresh = await loadBookTranslation(bookRecord.bookKey);
      if (fresh) {
        bookRecord = fresh;
        renderToc();
        if (allChapterIndices[currentPos] === msg.chapterIdx && !isChapterTranslating) {
          renderChapter(currentPos);
        }
      }
    }
  });

  // Кнопки навигации и перевода главы
  const goPrev = () => renderChapter(currentPos - 1);
  const goNext = () => renderChapter(currentPos + 1);
  $('prevTopBtn').addEventListener('click', goPrev);
  $('prevBottomBtn').addEventListener('click', goPrev);
  $('nextTopBtn').addEventListener('click', goNext);
  $('nextBottomBtn').addEventListener('click', goNext);

  $('translateHereBtn').addEventListener('click', translateCurrentChapterInReader);
  $('stopTranslateHereBtn').addEventListener('click', async () => {
    const s = await loadSettings();
    if (s.mode === 'chat') abortChatTab(s.chatProvider);
    if (readerAbortController) readerAbortController.abort();
  });

  $('toggleOrigBtn').addEventListener('click', () => {
    const chIdx = allChapterIndices[currentPos];
    showingOriginal = !showingOriginal;
    if (showingOriginal) {
      renderParagraphs(bookRecord.originals?.[chIdx] || '');
      $('toggleOrigBtn').textContent = 'Показать перевод';
    } else {
      renderParagraphs(bookRecord.chapters?.[chIdx] || '');
      $('toggleOrigBtn').textContent = 'Показать оригинал';
    }
  });

  $('tocBtn').addEventListener('click', () => openDrawer('tocDrawer'));
  $('settingsBtn').addEventListener('click', () => openDrawer('settingsDrawer'));
  $('closeTocBtn').addEventListener('click', closeAllDrawers);
  $('closeSettingsBtn').addEventListener('click', closeAllDrawers);
  $('drawerBackdrop').addEventListener('click', closeAllDrawers);

  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.add('hidden'));
      tab.classList.add('active');
      $(`tab-${tab.dataset.tab}`).classList.remove('hidden');
    });
  });

  document.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.addEventListener('click', async () => {
      prefs.theme = btn.dataset.theme;
      applyPrefs();
      await savePrefs();
    });
  });

  $('customBg').addEventListener('input', async () => {
    prefs.theme = 'custom';
    prefs.customBg = $('customBg').value;
    applyPrefs();
    await savePrefs();
  });

  $('customText').addEventListener('input', async () => {
    prefs.theme = 'custom';
    prefs.customText = $('customText').value;
    applyPrefs();
    await savePrefs();
  });

  // Выбор и загрузка пользовательского шрифта
  $('fontFamily').addEventListener('change', async () => {
    prefs.fontFamily = $('fontFamily').value;
    applyPrefs();
    await savePrefs();
  });

  $('uploadFontBtn').addEventListener('click', () => $('fontFileInput').click());
  $('fontFileInput').addEventListener('change', async () => {
    const file = $('fontFileInput').files?.[0];
    if (!file) return;
    try {
      const fontName = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/["']/g, '').trim() || 'CustomFont';
      const buf = await file.arrayBuffer();
      const face = new FontFace(fontName, buf);
      await face.load();
      document.fonts.add(face);
      await saveCustomFont(fontName, buf);
      if (!customFontNames.includes(fontName)) customFontNames.push(fontName);
      prefs.fontFamily = `"${fontName}", serif`;
      applyPrefs();
      await savePrefs();
      $('fontStatusHint').textContent = `Шрифт «${fontName}» добавлен и применён ✓`;
    } catch (err) {
      $('fontStatusHint').textContent = `Ошибка загрузки шрифта: ${err.message}`;
    } finally {
      $('fontFileInput').value = '';
    }
  });

  $('deleteCustomFontBtn').addEventListener('click', async () => {
    const matched = customFontNames.find((n) => prefs.fontFamily === `"${n}", serif`);
    if (!matched) return;
    await deleteCustomFont(matched);
    customFontNames = customFontNames.filter((n) => n !== matched);
    prefs.fontFamily = DEFAULT_READER_PREFS.fontFamily;
    applyPrefs();
    await savePrefs();
    $('fontStatusHint').textContent = `Шрифт «${matched}» удалён.`;
  });

  $('applySystemFontBtn').addEventListener('click', async () => {
    const name = $('systemFontInput').value.trim().replace(/["']/g, '');
    if (!name) return;
    prefs.fontFamily = `"${name}", Georgia, serif`;
    applyPrefs();
    await savePrefs();
    $('fontStatusHint').textContent = `Применён системный шрифт: ${name}`;
  });

  const LIMITS = {
    fontSize: [12, 32],
    lineHeight: [1.2, 2.4],
    paraGap: [4, 40],
    fontWeight: [300, 700],
    contentWidth: [500, 1200]
  };

  document.querySelectorAll('button[data-step]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.step;
      const delta = parseFloat(btn.dataset.delta);
      const [min, max] = LIMITS[key];
      let next = Number(prefs[key]) + delta;
      if (key === 'lineHeight') next = Math.round(next * 10) / 10;
      prefs[key] = Math.min(max, Math.max(min, next));
      applyPrefs();
      await savePrefs();
    });
  });

  document.querySelectorAll('.align-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      prefs.textAlign = btn.dataset.align;
      applyPrefs();
      await savePrefs();
    });
  });

  [
    ['firstLineIndent', 'firstLineIndent'],
    ['fullWidth', 'fullWidth'],
    ['keepScreenOn', 'keepScreenOn'],
    ['showTimeLeft', 'showTimeLeft'],
    ['showAutoscroll', 'showAutoscroll'],
    ['hidePanels', 'hidePanels']
  ].forEach(([elId, key]) => {
    $(elId).addEventListener('change', async () => {
      prefs[key] = $(elId).checked;
      applyPrefs();
      await savePrefs();
    });
  });

  $('resetReaderBtn').addEventListener('click', async () => {
    prefs = { ...DEFAULT_READER_PREFS };
    applyPrefs();
    await savePrefs();
  });

  $('autoToggleBtn').addEventListener('click', toggleAutoscroll);
  $('autoSlowerBtn').addEventListener('click', () => {
    autoscrollSpeed = Math.max(0.3, Math.round((autoscrollSpeed - 0.2) * 10) / 10);
    $('autoSpeedLabel').textContent = `${autoscrollSpeed.toFixed(1)}x`;
  });
  $('autoFasterBtn').addEventListener('click', () => {
    autoscrollSpeed = Math.min(4.0, Math.round((autoscrollSpeed + 0.2) * 10) / 10);
    $('autoSpeedLabel').textContent = `${autoscrollSpeed.toFixed(1)}x`;
  });

  window.addEventListener('scroll', () => {
    updateScrollMetrics();
    if (prefs.hidePanels) {
      const y = window.scrollY;
      if (y > 80 && y > lastScrollY) {
        $('readerHeader').classList.add('auto-hidden');
      } else if (y < lastScrollY) {
        $('readerHeader').classList.remove('auto-hidden');
      }
      lastScrollY = y;
    }
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllDrawers();
    if (e.key === 'ArrowLeft' && e.altKey) goPrev();
    if (e.key === 'ArrowRight' && e.altKey) goNext();
  });
}

init();
