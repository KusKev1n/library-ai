// lib/i18n.js — Автоопределение языка браузера (auto) + мгновенное переключение Русский / English
// Работает и в расширении LibraryAI, и в мобильном LibraryAI PWA без переписывания логики.

const RU_TO_EN = {
  // Навигация и общие заголовки
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
  'В процессе': 'In Progress',
  'Новые': 'New',
  'Локальные': 'Local',
  'Обложки': 'Covers',
  'Карточки': 'Cards',
  'Загрузка...': 'Loading...',
  'Готов к работе.': 'Ready.',
  'Нет загруженных книг': 'No books loaded',
  'Пока нечего читать': 'Nothing to read yet',

  // Библиотека (ПК)
  'Загрузить книгу': 'Upload Book',
  'Папка с книгами': 'Books Folder',
  'Папка истории': 'History Folder',
  'Обновить': 'Refresh',
  'Подключить': 'Connect',
  'Сортировка: Недавние': 'Sort: Recent',
  'Сортировка: По названию': 'Sort: Title',
  'Сортировка: По прогрессу': 'Sort: Progress',
  'Поиск по книгам...': 'Search books...',
  'Загрузите EPUB/PDF или подключите локальную папку с книгами.': 'Upload an EPUB/PDF or connect a local books folder.',
  'Моя полка': 'My Shelf',
  'Библиотека пуста': 'Library is empty',

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

  // Настройки (ПК + PWA)
  'Язык интерфейса': 'Interface Language',
  'Авто (как в браузере)': 'Auto (browser language)',
  'Русский': 'Русский',
  'English': 'English',
  'Сбросить промпт': 'Reset Prompt',
  'Режим работы и API': 'Mode & API',
  'Режим по умолчанию': 'Default Mode',
  'Температура и размышление': 'Temperature & Thinking',
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
  'Размер шрифта': 'Font Size',
  'Межстрочный': 'Line Height',
  'Шрифт': 'Font',
  'Свой шрифт (.ttf / .woff2)': 'Custom Font (.ttf / .woff2)',
  'Загрузить': 'Upload',
  '▶ Автопрокрутка': '▶ Autoscroll',

  // Синхронизация (ПК + PWA)
  'Новый код': 'New Code',
  'Сопряжение с телефоном (Wi-Fi WebRTC)': 'Pair with Phone (Wi-Fi WebRTC)',
  'Код сопряжения': 'Pairing Code',
  'Ссылка на ваш LibraryAI PWA (GitHub Pages)': 'Your LibraryAI PWA URL (GitHub Pages)',
  'Книги для отправки на телефон': 'Books to Send to Phone',
  'Запасной способ без сети (файл .json):': 'Offline fallback (.json file):',
  'Экспорт .json': 'Export .json',
  'Импорт .json': 'Import .json',
  'Журнал синхронизации': 'Sync Log',
  'Подключение к ПК по Wi-Fi (WebRTC)': 'Connect to PC over Wi-Fi (WebRTC)',
  '📷 Сканировать QR камерой': '📷 Scan QR with Camera',
  'Закрыть камеру': 'Close Camera',
  'Готов к подключению': 'Ready to connect',
  'Ручной перенос файлом (.json)': 'Manual File Transfer (.json)',
  'Синхронизация с ПК': 'PC Sync',
  'Автосинхронизация при запуске': 'Auto-sync on launch',
  'Проверяет связь с ПК один раз при открытии или перезапуске приложения — батарею в фоне не тратит.': 'Checks for PC once on launch/restart — zero background battery drain.',
  'Сохранённые связи': 'Saved Connections',
  'Пока нет сохранённых связей.': 'No saved connections yet.',
  'Память и книги': 'Storage & Books',
  'Книги хранятся локально на телефоне (IndexedDB) и доступны офлайн. Выбери книги для удаления или очисти всю память.': 'Books are stored locally on your phone (IndexedDB) for offline reading. Select books to delete or clear all storage.',
  'Удалить выбранные': 'Delete Selected',
  'Очистить всё': 'Clear All',
  'Перевод глав в дороге (API)': 'On-the-Go Translation (API)',
  'Позволяет нажать «Перевести главу» прямо внутри читалки без ПК. Ключ хранится только на этом телефоне.': 'Lets you tap "Translate Chapter" right inside the reader without a PC. Key stays on this device only.',
  'Сохранить настройки API': 'Save API Settings',
  'Название книги или автор...': 'Book title or author...',
  '+ Синхронизировать с ПК': '+ Sync with PC',
  'Синхронизируй книги с ПК по QR или добавь .epub с телефона': 'Sync books from PC via QR or add an .epub from your phone'
};

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

export function applyI18n(pref = 'auto', root = document.body) {
  const lang = resolveEffectiveLang(pref);
  document.documentElement.lang = lang;

  // 1. Text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) {
      if (!origTextMap.has(node)) origTextMap.set(node, node.nodeValue);
      const orig = origTextMap.get(node);
      const trimmed = orig.trim();
      if (trimmed && RU_TO_EN[trimmed]) {
        node.nodeValue = lang === 'en' ? orig.replace(trimmed, RU_TO_EN[trimmed]) : orig;
      }
    }
    node = walker.nextNode();
  }

  // 2. Placeholders & titles
  root.querySelectorAll('[placeholder], [title]').forEach((el) => {
    if (el.hasAttribute('placeholder')) {
      if (!el.dataset.i18nPh) el.dataset.i18nPh = el.getAttribute('placeholder');
      const o = el.dataset.i18nPh;
      el.setAttribute('placeholder', lang === 'en' && RU_TO_EN[o] ? RU_TO_EN[o] : o);
    }
    if (el.hasAttribute('title')) {
      if (!el.dataset.i18nTitle) el.dataset.i18nTitle = el.getAttribute('title');
      const o = el.dataset.i18nTitle;
      el.setAttribute('title', lang === 'en' && RU_TO_EN[o] ? RU_TO_EN[o] : o);
    }
  });
}

export async function initI18n() {
  const pref = await loadUiLang();
  applyI18n(pref);
  return pref;
}
