# LibraryAI

**English** | **[Русский](#русский)**

A local-first **Chrome/Chromium browser extension** and companion **Mobile PWA** for reading and translating English `.epub` and `.pdf` novels with AI (Gemini, DeepSeek, OpenAI/OpenRouter API, or logged-in browser chat tabs), with direct **Wi-Fi WebRTC sync** between PC and phone.

Live Mobile PWA: **https://kuskev1n.github.io/library-ai/**

---

## Features

### Chrome Extension (`extension/`)
- **Library**: Local folder scanning for `.epub` / `.pdf` books, cover extraction (plus pastel typographic covers), Covers/Cards view switcher, search, and filters.
- **Full-Book AI Translator**:
  - **API Mode**: Google Gemini (2.5 / 3 / 4), DeepSeek, OpenAI / OpenRouter / Ollama with temperature slider, Thinking/Reasoning toggle, custom system prompt, and glossary.
  - **Browser Chat Tab Mode**: Automates logged-in `gemini.google.com`, `chat.deepseek.com`, and `chatgpt.com` tabs with fresh-tab-per-chunk reliability and customizable skill prefixes (`@read`, `/read`, etc.).
  - **Chapter Exclusion**: Drag-to-toggle chapter checkboxes + one-click short-chapter filter (skip covers, TOCs, and watermark pages).
  - **Usage Statistics**: Tracks API tokens (input / output / thinking) and translated characters globally and per book.
  - **Export**: Rebuilt `.epub`, `.html`, Print-to-PDF, and `.txt`.
- **Dedicated Reader Mode**: Themes (Paper, Sepia, Sage, Night, Graphite, OLED + custom WCAG contrast), custom font upload (`.ttf` / `.otf` / `.woff2`), EPUB chapter illustrations (shown only in Reader), and subtle inline **Translate Chapter** button on untranslated chapters.
- **Wi-Fi Sync (`WebRTC + QR`)**: Bidirectional sync of books, covers, illustrations, translations, and reading positions with the Mobile PWA (plus offline `.json` backup export/import).
- **Auto Language Detection**: Automatically adapts to browser language (`Russian` / `English`), with manual override in Settings.

### Mobile PWA (Root directory)
- Installable offline-first mobile web app via Chrome (**Add to Home Screen / Install app**).
- Mobile carousel library, sticky **Continue Reading** bar, full-screen reader with illustrations & custom fonts, on-the-go single-chapter API translation, local storage manager, saved PC connections, and optional one-shot auto-sync on launch.

---

## Installation

### 1. Mobile PWA
1. Open **https://kuskev1n.github.io/library-ai/** in Chrome on your phone.
2. Tap the browser menu (`⋮`) → **Install app** (or **Add to Home screen**).

### 2. Chrome / Chromium Extension
1. Download the `extension/` folder (or the latest ZIP from **Releases**).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.

---

## Privacy & Licenses
- **100% Local**: No backend database. All books, translations, reading positions, and API keys stay strictly on your own PC (`chrome.storage.local` / `IndexedDB` / chosen local folder) and phone (`IndexedDB`).
- **PDF.js**: Uses Mozilla's [PDF.js](https://github.com/mozilla/pdf.js) under the **Apache 2.0 License**.

---

# Русский

Локальное **расширение для Chrome/Chromium** и мобильное **PWA-приложение** для чтения и перевода романов `.epub` и `.pdf` с помощью ИИ (Gemini, DeepSeek, OpenAI/OpenRouter API или через вкладку веб-чата) с двусторонней **синхронизацией по Wi-Fi (WebRTC)** между ПК и телефоном.

Мобильное PWA: **https://kuskev1n.github.io/library-ai/**

## Возможности

### Расширение для ПК (`extension/`)
- **Библиотека**: подключение локальной папки с `.epub` и `.pdf`, извлечение обложек, переключение вида «Обложки / Карточки», поиск и фильтры.
- **Переводчик книг**:
  - **Через API**: Gemini, DeepSeek, OpenAI / OpenRouter / локальные модели — с настройкой температуры, режима размышления (Thinking), системного промпта и глоссария.
  - **Через вкладку чата**: работа с открытыми вкладками `gemini.google.com`, `chat.deepseek.com`, `chatgpt.com` (включая режим «новая вкладка на фрагмент» и настраиваемый префикс навыка `@read` / `/read`).
  - **Исключение глав**: выделение галочек ведением мышки + кнопка «Убрать короткие главы» (обложки, оглавления, заглушки).
  - **Статистика**: подсчёт потраченных токенов API (вход / выход / размышление) и переведённых символов — общий и отдельно по каждой книге.
  - **Экспорт**: готовый `.epub`, `.html`, печать в PDF и `.txt`.
- **Режим чтения**: темы (Бумага, Сепия, Шалфей, Ночь, Графит, OLED + свои цвета), загрузка своих шрифтов (`.ttf` / `.otf` / `.woff2`), отображение иллюстраций EPUB только в читалке и незаметная кнопка **«Перевести главу»** на непереведённых главах.
- **Синхронизация по Wi-Fi (WebRTC + QR)**: двусторонний обмен книгами, обложками, картинками, переводами и последней прочитанной главой с телефоном (плюс ручной бэкап `.json`).
- **Автоязык интерфейса**: автоматически подстраивается под язык браузера (`Русский` / `English`), можно переключить вручную в настройках.

### Мобильное PWA (корень репозитория)
- Устанавливается на телефон из Chrome как полноценное приложение без адресной строки и работает офлайн.
- Карусель обложек, нижняя плашка «Продолжить чтение», читалка с иллюстрациями и шрифтами, перевод отдельных глав в дороге по API, менеджер памяти (удаление выбранных книг или полная очистка), список сохранённых связей и тихая однократная автосинхронизация при запуске.

## Установка

### 1. На телефон (PWA)
1. Откройте **https://kuskev1n.github.io/library-ai/** в Chrome на телефоне.
2. Нажмите `⋮` → **«Установить приложение»**.

### 2. В браузер на ПК
1. Скачайте папку `extension/` (или готовый ZIP из раздела **Releases**).
2. Откройте `chrome://extensions` и включите **«Режим разработчика»**.
3. Нажмите **«Загрузить распакованное расширение»** и выберите папку `extension`.

## Приватность и лицензии
- **Полная локальность**: никакой общей базы нет — книги, переводы и API-ключи хранятся только в памяти вашего ПК и вашего телефона.
- **PDF.js**: используется открытая библиотека Mozilla PDF.js по лицензии **Apache 2.0**.
