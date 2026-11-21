// defaults.js — Настройки по умолчанию и пресеты моделей

export const DEFAULT_SYSTEM_PROMPT = `Ты — профессиональный художественный переводчик англоязычной литературы (романов, фэнтези, веб-новелл) на русский язык.

Правила перевода:
1. Переводи естественно, живо и литературно, сохраняя стиль автора, интонацию, ритм и эмоциональную окраску.
2. Не сокращай и не пересказывай текст — переводи каждый абзац полностью.
3. Сохраняй разбиение на абзацы (пустые строки между абзацами) и оформление диалогов.
4. Имена собственные, названия локаций и термины переводи единообразно (если дан глоссарий — строго следуй ему).
5. Возвращай ТОЛЬКО переведённый текст, без вступлений, комментариев, примечаний и рамок markdown.`;

export const API_PROVIDERS = {
  gemini: {
    label: 'Google Gemini API',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (быстрый, thinkingBudget)' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (высокое качество)' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (thinkingLevel)' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (thinkingLevel)' },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon (thinkingLevel)' }
    ],
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    tempHint: 'Рекомендуется 0.4–1.0 для художественного перевода.'
  },
  deepseek: {
    label: 'DeepSeek API',
    defaultModel: 'deepseek-v4-flash',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (быстрый, поддержка thinking)' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (высокое качество)' },
      { id: 'deepseek-chat', label: 'deepseek-chat (совместимость)' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner (совместимость)' }
    ],
    defaultBaseUrl: 'https://api.deepseek.com/v1/chat/completions',
    tempHint: 'DeepSeek рекомендует 1.3 для перевода (в режиме размышления temperature игнорируется API).'
  },
  openai: {
    label: 'OpenAI / Совместимый API (OpenRouter, Ollama и др.)',
    defaultModel: 'gpt-4.1-mini',
    models: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-5-mini', label: 'GPT-5 Mini (reasoning_effort)' },
      { id: 'o4-mini', label: 'o4-mini (reasoning_effort)' }
    ],
    defaultBaseUrl: 'https://api.openai.com/v1/chat/completions',
    tempHint: 'Обычно 0.5–1.0. Для локальных/OpenRouter моделей укажите свой Base URL.'
  }
};

export const DEFAULT_SETTINGS = {
  // Режим работы: 'api' | 'chat'
  mode: 'api',

  // API настройки
  apiProvider: 'gemini',
  apiKey: '',
  apiModel: 'gemini-2.5-flash',
  apiCustomModel: '',
  apiBaseUrl: '',

  // Параметры генерации
  temperature: 0.7,
  thinkingEnabled: false,
  thinkingLevel: 'medium', // 'low' | 'medium' | 'high'
  thinkingBudget: 4096,    // для Gemini 2.5 (-1 = авто, >0 = бюджет токенов)

  // Настройки режима чата во вкладке
  chatProvider: 'gemini',
  chatFreshTabPerChunk: true,     // Новая вкладка на каждый фрагмент (старая закрывается) — самый стабильный режим!
  chatUseSkillPrefix: true,
  chatSkillPrefix: '@read',       // настраиваемый навык: @read, /read, @noveltranslate и т.д.
  chatSkillFrequency: 'every',    // 'every' (перед каждым фрагментом) | 'first' (только в 1-м сообщении)
  chatSendSystemPrompt: true,
  chatSystemPromptFrequency: 'first', // 'first' | 'every'
  chatAutoToggleThinking: true,   // пробовать переключить DeepThink/Thinking в UI чата
  chatNewChatEvery: 0,            // 0 = не сбрасывать (для режима одной вкладки)
  chatTimeoutSec: 180,            // таймаут ожидания ответа от чата

  // Общие настройки перевода
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  glossary: '',
  chunkSize: 4500,                // макс. символов в одном фрагменте
  delayMs: 1500,                  // пауза между запросами (мс)
  includePrevContext: true,       // передавать 2 последних предложения прошлого фрагмента для связности
  maxRetries: 2,
  targetLanguage: 'русский'
};

export async function loadSettings() {
  const data = await chrome.storage.local.get('translatorSettings');
  return { ...DEFAULT_SETTINGS, ...(data.translatorSettings || {}) };
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ translatorSettings: merged });
  return merged;
}

export const DEFAULT_STATS = {
  promptTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  totalTokens: 0,
  sourceChars: 0,
  translatedChars: 0,
  apiRequests: 0,
  chatRequests: 0,
  chaptersTranslated: 0,
  byBook: {}
};

function mergeCounters(base, delta) {
  return {
    promptTokens: (base.promptTokens || 0) + (Number(delta.promptTokens) || 0),
    outputTokens: (base.outputTokens || 0) + (Number(delta.outputTokens) || 0),
    thoughtTokens: (base.thoughtTokens || 0) + (Number(delta.thoughtTokens) || 0),
    totalTokens: (base.totalTokens || 0) + (Number(delta.totalTokens) || 0),
    sourceChars: (base.sourceChars || 0) + (Number(delta.sourceChars) || 0),
    translatedChars: (base.translatedChars || 0) + (Number(delta.translatedChars) || 0),
    apiRequests: (base.apiRequests || 0) + (Number(delta.apiRequests) || 0),
    chatRequests: (base.chatRequests || 0) + (Number(delta.chatRequests) || 0),
    chaptersTranslated: (base.chaptersTranslated || 0) + (Number(delta.chaptersTranslated) || 0)
  };
}

export async function loadStats() {
  const data = await chrome.storage.local.get('translationStats');
  const raw = data.translationStats || {};
  return { ...DEFAULT_STATS, ...raw, byBook: { ...(raw.byBook || {}) } };
}

export async function addTranslationStats(delta = {}, bookInfo = null) {
  const cur = await loadStats();
  const byBook = { ...(cur.byBook || {}) };

  if (bookInfo && bookInfo.bookKey) {
    const prev = byBook[bookInfo.bookKey] || { title: bookInfo.title || bookInfo.bookKey.split('::')[0] };
    byBook[bookInfo.bookKey] = {
      ...mergeCounters(prev, delta),
      title: bookInfo.title || prev.title || bookInfo.bookKey.split('::')[0],
      updatedAt: Date.now()
    };
  }

  const next = { ...mergeCounters(cur, delta), byBook };
  await chrome.storage.local.set({ translationStats: next });
  return next;
}

export async function resetTranslationStats() {
  const empty = { ...DEFAULT_STATS, byBook: {} };
  await chrome.storage.local.set({ translationStats: empty });
  return empty;
}
