// lib/i18n.js — Полный двуязычный переводчик интерфейса (auto / ru / en) с MutationObserver

const RU_TO_EN = {
  // Навигация и общие
  'Мои книги': 'My Books',
  'Переводчик': 'Translator',
  'Чтение': 'Reader',
  'Настройки': 'Settings',
  'Синхронизация': 'Sync',
  'Книги': 'Books',
  'Синхр.': 'Sync',
  'Поиск': 'Search',
  'История / Память': 'History / Storage',
  'Открыть переводчик': 'Open Translator',
  'Открыть синхронизацию': 'Open Sync',
  'Закрыть': 'Close',
  'Сохранить': 'Save',
  'Сбросить': 'Reset',
  'Удалить': 'Delete',
  'Читать': 'Read',
  'Перевод': 'Translate',
  'Все': 'All',
  'Читаю': 'Reading',
  'Переведённые': 'Translated',
  'Непереведённые': 'Untranslated',
  'В процессе': 'In Progress',
  'Новые': 'New',
  'Локальные': 'Local',
  'Локальная папка': 'Local Folder',
  'Локальная папка книг': 'Local Books Folder',
  'Хранилище переводов': 'Translations Storage',
  'Обложки': 'Covers',
  'Карточки': 'Cards',
  'Загрузка...': 'Loading...',
  'Готов к работе.': 'Ready.',
  'Нет загруженных книг': 'No books loaded',
  'Пока нечего читать': 'Nothing to read yet',

  // Библиотека (ПК)
  'Все книги': 'All Books',
  '+ Загрузить книгу': '+ Upload Book',
  'Загрузить книгу': 'Upload Book',
  '📁 Папка с книгами': '📁 Books Folder',
  'Папка с книгами': 'Books Folder',
  '💾 Папка истории': '💾 History Folder',
  'Папка истории': 'History Folder',
  'Обновить': 'Refresh',
  'Подключить': 'Connect',
  'Отключить': 'Disconnect',
  'Выбрать папку': 'Choose Folder',
  'Сначала недавние': 'Recent First',
  'По названию (А–Я)': 'Title (A–Z)',
  'По прогрессу перевода': 'Translation Progress',
  'Поиск по книгам...': 'Search books...',
  'Загрузите EPUB/PDF или подключите локальную папку с книгами.': 'Upload an EPUB/PDF or connect a local books folder.',
  'Моя полка': 'My Shelf',
  'Библиотека пуста': 'Library is empty',
  'Нет книг в этой категории': 'No books in this category',
  'Очистить всё': 'Clear All',

  // Переводчик (ПК)
  '1. Книга': '1. Book',
  '2. Режим перевода': '2. Translation Mode',
  'Перетащите PDF или EPUB сюда': 'Drop PDF or EPUB here',
  'или выберите файл (также можно открыть из Библиотеки)': 'or choose a file (or open from Library)',
  'Через API': 'Via API',
  'Чат во вкладке': 'Browser Chat Tab',
  'Провайдер API': 'API Provider',
  'API провайдер': 'API Provider',
  'Модель': 'Model',
  'Своя модель (необязательно)': 'Custom Model (optional)',
  'Своя модель (перекрывает список)': 'Custom Model (overrides list)',
  'API-ключ': 'API Key',
  'Вставьте ключ API...': 'Paste API key...',
  'Свой Base URL': 'Custom Base URL',
  'Свой Base URL (необязательно)': 'Custom Base URL (optional)',
  'По умолчанию официальный': 'Official URL by default',
  'Сайт чата': 'Chat Website',
  'Открыть чат': 'Open Chat',
  'Проверить вкладку': 'Check Tab',
  'Откройте вкладку чата и войдите в аккаунт.': 'Open the chat tab and sign in.',
  'Новая вкладка на фрагмент': 'Fresh tab per chunk',
  'Навык/команда перед текстом': 'Skill/command prefix',
  'Префикс навыка (редактируется)': 'Skill prefix (editable)',
  'Без префикса': 'No prefix',
  'Когда добавлять навык': 'When to add skill',
  'Перед каждым фрагментом': 'Before every chunk',
  'Только в 1-м сообщении чата': 'First chat message only',
  'Только в 1-м сообщении': 'First message only',
  'Добавлять системный промпт': 'Include system prompt',
  'Температура': 'Temperature',
  'В режиме веб-чата температуру задаёт сам сайт.': 'In web chat mode, temperature is controlled by the site.',
  'Включить размышление (Thinking)': 'Enable Thinking / Reasoning',
  'Включить размышление (Thinking / Reasoning)': 'Enable Thinking / Reasoning',
  'Размышление (Thinking)': 'Thinking / Reasoning',
  'Уровень размышления': 'Thinking Level',
  'Низкий (low)': 'Low',
  'Средний (medium)': 'Medium',
  'Высокий (high)': 'High',
  'Системный промпт и глоссарий': 'System Prompt & Glossary',
  'Системный промпт': 'System Prompt',
  'Глоссарий (Имя = Перевод)': 'Glossary (Name = Translation)',
  'Размер куска': 'Chunk size',
  'Пауза (мс)': 'Delay (ms)',
  'Начать перевод': 'Start Translation',
  'Пауза': 'Pause',
  'Продолжить': 'Resume',
  'Остановить': 'Stop',
  '📖 Читать': '📖 Read',
  'Сбросить перевод': 'Reset Translation',
  'Предпросмотр главы': 'Chapter Preview',
  'Исключить из перевода': 'Skip Chapter',
  'Вернуть в перевод': 'Include Chapter',
  'Перевести эту главу заново': 'Retranslate Chapter',
  'Оригинал появится здесь...': 'Original text will appear here...',
  'Перевод появится здесь...': 'Translation will appear here...',
  'Эта глава ещё не переведена.': 'This chapter is not translated yet.',
  'Глава исключена из перевода (будет пропущена).': 'Chapter excluded from translation (will be skipped).',
  'Список глав появится после загрузки книги.': 'Chapter list will appear after loading a book.',
  'Выберите книгу из Библиотеки или загрузите PDF/EPUB.': 'Pick a book from Library or upload a PDF/EPUB.',
  'Убрать <': 'Skip <',
  'симв.': 'chars',
  'Галочка — включить в перевод': 'Checked = include in translation',
  'История сохранённых переводов': 'Saved Translations History',
  'Папка хранения истории': 'History Storage Folder',
  '📁 Выбрать папку...': '📁 Choose folder...',
  'Переводы можно хранить в любой локальной папке.': 'Translations can be stored in any local folder.',
  'Удалить все переводы': 'Delete All Translations',
  'История пуста.': 'History is empty.',

  // Настройки (ПК + PWA)
  'Язык интерфейса': 'Interface Language',
  'Авто (как в браузере)': 'Auto (browser language)',
  'Сбросить промпт': 'Reset Prompt',
  'Режим работы и API': 'Mode & API',
  'Режим по умолчанию': 'Default Mode',
  'Через API (Gemini, DeepSeek, OpenAI)': 'Via API (Gemini, DeepSeek, OpenAI)',
  'Чат во вкладке браузера (Gemini, DeepSeek, ChatGPT)': 'Browser Chat Tab (Gemini, DeepSeek, ChatGPT)',
  'Температура и размышление': 'Temperature & Thinking',
  'Температура (0.0 — строже, 1.3–2.0 — креативнее)': 'Temperature (0.0 strict — 2.0 creative)',
  'Уровень (Gemini 3/4, OpenAI)': 'Level (Gemini 3/4, OpenAI)',
  'Бюджет (Gemini 2.5; -1 = авто)': 'Budget (Gemini 2.5; -1 = auto)',
  'Чат во вкладке браузера': 'Browser Chat Tab',
  'Провайдер веб-чата': 'Web Chat Provider',
  'Таймаут ответа (сек)': 'Response Timeout (sec)',
  'Вставлять префикс навыка перед текстом': 'Insert skill prefix before text',
  'Префикс навыка': 'Skill Prefix',
  'Частота навыка': 'Skill Frequency',
  'Системный промпт в чат': 'System Prompt in Chat',
  'Новый чат каждые N (0 = нет)': 'New chat every N chunks (0 = off)',
  'Отправлять системный промпт в веб-чат': 'Send system prompt to web chat',
  'Автопереключение DeepThink / Reason в чате': 'Auto-toggle DeepThink / Reason in chat',
  'Разбивка и связность': 'Chunking & Context',
  'Макс. символов в одном фрагменте': 'Max characters per chunk',
  'Пауза между запросами (мс)': 'Delay between requests (ms)',
  'Повторов при ошибке': 'Retries on error',
  'Передавать 2 последних предложения прошлого куска': 'Pass last 2 sentences of previous chunk',
  'Инструкции для переводчика': 'Translator Instructions',
  'Глоссарий имён и терминов': 'Names & Terms Glossary',
  'Формат: Оригинал = Перевод (по строке)': 'Format: Original = Translation (one per line)',
  'Статистика переводов': 'Translation Statistics',
  'Сбросить статистику': 'Reset Stats',
  'Всего токенов (API)': 'Total Tokens (API)',
  'Переведено символов': 'Characters Translated',
  'Переведено глав': 'Chapters Translated',
  'Через переводчик и читалку': 'Via Translator & Reader',
  'Выполнено запросов': 'Requests Completed',
  'По книгам': 'By Book',
  'Пока нет переведённых книг в статистике.': 'No translated books recorded yet.',
  'Сохранённые связи (телефоны)': 'Saved Connections (Phones)',
  'Отвязать все': 'Unlink All',
  'Пока нет сопряжённых устройств.': 'No paired devices yet.',
  'Настройки сохранены!': 'Settings saved!',

  // Читалка (ПК + PWA)
  '☰ Главы': '☰ Chapters',
  '← Пред.': '← Prev',
  'След. →': 'Next →',
  'Aa Вид': 'Aa Style',
  '← Предыдущая глава': '← Previous Chapter',
  'Следующая глава →': 'Next Chapter →',
  '← Пред. глава': '← Prev Chapter',
  'След. глава →': 'Next Chapter →',
  'Перевести главу': 'Translate Chapter',
  'Показать оригинал': 'Show Original',
  'Показать перевод': 'Show Translation',
  'Оглавление': 'Table of Contents',
  'Настройки чтения': 'Reading Settings',
  'Цвета': 'Colors',
  'Текст': 'Text',
  'Тема': 'Theme',
  'Бумага': 'Paper',
  'Сепия': 'Sepia',
  'Шалфей': 'Sage',
  'Ночь': 'Night',
  'Графит': 'Graphite',
  'Свои цвета': 'Custom Colors',
  'Фон': 'Background',
  'Размер': 'Size',
  'Размер шрифта': 'Font Size',
  'Межстрочный': 'Line Height',
  'Абзацы': 'Paragraph Gap',
  'Толщина': 'Weight',
  'Красная строка': 'First-line indent',
  'Выравнивание': 'Alignment',
  'По левому': 'Left',
  'По центру': 'Center',
  'По ширине': 'Justify',
  'Во всю ширину': 'Full width',
  'Ширина колонки': 'Column width',
  'Шрифт': 'Font',
  'Свой шрифт (.ttf / .woff2)': 'Custom Font (.ttf / .woff2)',
  'Загрузить': 'Upload',
  '▶ Автопрокрутка': '▶ Autoscroll',
  'Не выключать экран': 'Keep screen awake',
  'Прогресс и время чтения': 'Progress & time left',
  'Панель автопрокрутки': 'Autoscroll bar',
  'Скрывать верхнюю панель при прокрутке': 'Auto-hide header on scroll',
  'Сбросить настройки читалки': 'Reset Reader Settings',

  // Синхронизация (ПК + PWA)
  'Новый код': 'New Code',
  'Передать настройки API и ключ на телефон': 'Sync API settings & key to phone',
  'Сопряжение с телефоном (Wi-Fi WebRTC)': 'Pair with Phone (Wi-Fi WebRTC)',
  'Код сопряжения': 'Pairing Code',
  'Ссылка на ваш LibraryAI PWA (GitHub Pages)': 'Your LibraryAI PWA URL (GitHub Pages)',
  'Если указать ссылку, скан обычной камерой телефона сразу откроет PWA и запустит синхронизацию. Без ссылки в QR хранится сам 6-значный код.': 'With your PWA URL saved, scanning the QR with your phone camera opens the PWA and syncs automatically. Without a URL, the QR stores the 6-char code.',
  'Книги для отправки на телефон': 'Books to Send to Phone',
  'Запасной способ без сети (файл .json):': 'Offline fallback (.json file):',
  'Экспорт .json': 'Export .json',
  'Импорт .json': 'Import .json',
  'Журнал синхронизации': 'Sync Log',
  'Подключение к ПК по Wi-Fi (WebRTC)': 'Connect to PC over Wi-Fi (WebRTC)',
  'Открой в расширении на ПК иконку телефона («Синхронизация») и введи 6-значный код или отсканируй QR.': 'Open the phone icon ("Sync") in the PC extension and enter the 6-char code or scan the QR.',
  '📷 Сканировать QR камерой': '📷 Scan QR with Camera',
  'Закрыть камеру': 'Close Camera',
  'Готов к подключению': 'Ready to connect',
  'Ручной перенос файлом (.json)': 'Manual File Transfer (.json)',
  'Запасной вариант без сети: экспортируй бэкап в расширении и импортируй его здесь (или обратно).': 'Offline backup: export .json in the extension and import it here (or vice versa).',
  'Синхронизация с ПК': 'PC Sync',
  'Автосинхронизация при запуске': 'Auto-sync on launch',
  'Проверяет связь с ПК один раз при открытии или перезапуске приложения — батарею в фоне не тратит.': 'Checks for PC once on launch/restart — zero background battery drain.',
  'Сохранённые связи': 'Saved Connections',
  'Пока нет сохранённых связей.': 'No saved connections yet.',
  'Память и книги': 'Storage & Books',
  'Память пуста.': 'Storage is empty.',
  'Книги хранятся локально на телефоне (IndexedDB) и доступны офлайн. Выбери книги для удаления или очисти всю память.': 'Books are stored locally on your phone (IndexedDB) for offline reading. Select books to delete or clear all storage.',
  'Удалить выбранные': 'Delete Selected',
  'Перевод глав в дороге (API)': 'On-the-Go Translation (API)',
  'Позволяет нажать «Перевести главу» прямо внутри читалки без ПК. Ключ хранится только на этом телефоне.': 'Lets you tap "Translate Chapter" right inside the reader without a PC. Key stays on this device only.',
  'Сохранить настройки API': 'Save API Settings',
  'Название книги или автор...': 'Book title or author...',
  '+ Синхронизировать с ПК': '+ Sync with PC',
  'Синхронизируй книги с ПК по QR или добавь .epub с телефона': 'Sync books from PC via QR or add an .epub from your phone',
  'Ожидание сканирования QR на телефоне...': 'Waiting for phone QR scan...',
  'Подключение к серверу сопряжения...': 'Connecting to pairing server...',
  'Инициализация...': 'Initializing...',
  'Синхронизация завершена ✓': 'Sync complete ✓',
  'ПК не в сети (офлайн-режим)': 'PC offline (offline mode)'
};

const DYNAMIC_PATTERNS = [
  [/^Занято:\s*(.+)$/i, (_, s) => `Used: ${s.replace('МБ', 'MB').replace('КБ', 'KB').replace('Б', 'B')}`],
  [/^Токены:\s*([^\s·]+)\s*·\s*Симв\.:\s*(.+)$/i, (_, a, b) => `Tokens: ${a} · Chars: ${b}`],
  [/^Вход:\s*([^·]+)\s*·\s*Выход:\s*([^·]+)\s*·\s*Размышл\.:\s*(.+)$/i, (_, a, b, c) => `In: ${a.trim()} · Out: ${b.trim()} · Think: ${c.trim()}`],
  [/^Из оригинала:\s*(.+)\s*симв\.$/i, (_, a) => `Source: ${a.trim()} chars`],
  [/^API:\s*([^·]+)\s*·\s*Веб-чат:\s*(.+)$/i, (_, a, b) => `API: ${a.trim()} · Web Chat: ${b.trim()}`],
  [/^(\d+)\s+книг\s*·\s*(.+)$/i, (_, n, sz) => `${n} books · ${sz.replace('МБ', 'MB').replace('КБ', 'KB').replace('Б', 'B')}`],
  [/^Переведено\s+(\d+)\s+из\s+(\d+)\s*(.*)$/i, (_, a, b, r) => `Translated ${a} of ${b} ${r}`.trim()],
  [/^Глава\s+(\d+)\s+из\s+(\d+)(.*)$/i, (_, a, b, r) => `Chapter ${a} of ${b}${r.replace('переведено глав:', 'translated:').replace('оригинал (не переведена)', 'original (untranslated)').replace('оригинал', 'original')}`],
  [/^Все главы в переводе \((\d+)\)$/i, (_, n) => `All chapters included (${n})`],
  [/^В переводе:\s*(\d+)\s*·\s*Исключено:\s*(\d+)$/i, (_, a, b) => `Included: ${a} · Skipped: ${b}`],
  [/^Чат\s+(\w+):\s*готов ✓$/i, (_, p) => `Chat ${p}: ready ✓`],
  [/^Чат\s+(\w+):\s*не открыт$/i, (_, p) => `Chat ${p}: not open`],
  [/^Чат\s+(\w+):\s*не готов$/i, (_, p) => `Chat ${p}: not ready`],
  [/^(.+?)\s*·\s*EPUB\s*·\s*(.+)$/i, (_, a, b) => `${a} · EPUB · ${b.replace('МБ', 'MB').replace('КБ', 'KB').replace('Б', 'B')}`],
  [/^(.+?)\s*·\s*PDF\s*·\s*(.+)$/i, (_, a, b) => `${a} · PDF · ${b.replace('МБ', 'MB').replace('КБ', 'KB').replace('Б', 'B')}`]
];

function translateText(ruStr) {
  const trimmed = ruStr.trim();
  if (!trimmed) return null;
  if (RU_TO_EN[trimmed]) return RU_TO_EN[trimmed];
  for (const [re, fn] of DYNAMIC_PATTERNS) {
    const m = trimmed.match(re);
    if (m) return fn(...m);
  }
  return null;
}

export function resolveEffectiveLang(pref = 'auto') {
  if (pref === 'ru' || pref === 'en') return pref;
  const nav = (navigator.language || navigator.languages?.[0] || 'en').toLowerCase();
  return nav.startsWith('ru') ? 'ru' : 'en';
}

export async function loadUiLang() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get('libraryAiUiLang');
      return data.libraryAiUiLang || 'auto';
    }
  } catch (_) {}
  return localStorage.getItem('libraryAiUiLang') || 'auto';
}

export async function saveUiLang(pref) {
  const val = (pref === 'ru' || pref === 'en') ? pref : 'auto';
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ libraryAiUiLang: val });
    }
  } catch (_) {}
  try { localStorage.setItem('libraryAiUiLang', val); } catch (_) {}
  return val;
}

const origTextMap = new WeakMap();
let currentPref = 'auto';
let observer = null;
let isApplying = false;

function translateSubtree(root, lang) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const parent = root.parentElement;
    if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) return;
    if (!origTextMap.has(root)) origTextMap.set(root, root.nodeValue);
    const orig = origTextMap.get(root);
    const en = translateText(orig);
    if (en) {
      const trimmed = orig.trim();
      const target = lang === 'en' ? orig.replace(trimmed, en) : orig;
      if (root.nodeValue !== target) root.nodeValue = target;
    }
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) {
      if (!origTextMap.has(node)) origTextMap.set(node, node.nodeValue);
      const orig = origTextMap.get(node);
      const en = translateText(orig);
      if (en) {
        const trimmed = orig.trim();
        const target = lang === 'en' ? orig.replace(trimmed, en) : orig;
        if (node.nodeValue !== target) node.nodeValue = target;
      }
    }
    node = walker.nextNode();
  }

  if (root.querySelectorAll) {
    root.querySelectorAll('[placeholder], [title]').forEach((el) => {
      if (el.hasAttribute('placeholder')) {
        if (!el.dataset.i18nPh) el.dataset.i18nPh = el.getAttribute('placeholder');
        const o = el.dataset.i18nPh;
        const en = translateText(o);
        el.setAttribute('placeholder', lang === 'en' && en ? en : o);
      }
      if (el.hasAttribute('title')) {
        if (!el.dataset.i18nTitle) el.dataset.i18nTitle = el.getAttribute('title');
        const o = el.dataset.i18nTitle;
        const en = translateText(o);
        el.setAttribute('title', lang === 'en' && en ? en : o);
      }
    });
  }
}

export function applyI18n(pref = 'auto', root = document.body) {
  currentPref = pref;
  const lang = resolveEffectiveLang(pref);
  document.documentElement.lang = lang;

  isApplying = true;
  try {
    translateSubtree(root, lang);
  } finally {
    isApplying = false;
  }

  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver((mutations) => {
      if (isApplying) return;
      const eff = resolveEffectiveLang(currentPref);
      if (eff !== 'en') return;
      isApplying = true;
      try {
        for (const m of mutations) {
          if (m.type === 'characterData' && m.target) {
            origTextMap.set(m.target, m.target.nodeValue);
            translateSubtree(m.target, eff);
          } else {
            for (const added of m.addedNodes) {
              if (added.nodeType === Node.ELEMENT_NODE || added.nodeType === Node.TEXT_NODE) {
                translateSubtree(added, eff);
              }
            }
          }
        }
      } finally {
        isApplying = false;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
}

export async function initI18n() {
  const pref = await loadUiLang();
  applyI18n(pref);
  return pref;
}
