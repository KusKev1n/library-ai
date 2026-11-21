// lib/api-client.js — API клиент для Gemini, DeepSeek и OpenAI-совместимых провайдеров
// Поддерживает настройку температуры (temperature) и включение/выключение размышления (thinking/reasoning).

import { API_PROVIDERS } from '../defaults.js';

function getActiveModel(settings) {
  const custom = (settings.apiCustomModel || '').trim();
  if (custom) return custom;
  return settings.apiModel || API_PROVIDERS[settings.apiProvider]?.defaultModel || 'gemini-2.5-flash';
}

function buildUserMessage(chunkText, { glossary, prevContext }) {
  const parts = [];
  if (glossary && glossary.trim()) {
    parts.push(`[ГЛОССАРИЙ — строго используй эти варианты имён и терминов]\n${glossary.trim()}`);
  }
  if (prevContext && prevContext.trim()) {
    parts.push(`[КОНТЕКСТ ИЗ ПРЕДЫДУЩЕГО ФРАГМЕНТА — НЕ переводи повторно, используй только для связности]\n${prevContext.trim()}`);
  }
  parts.push(`[ТЕКСТ ДЛЯ ПЕРЕВОДА]\n${chunkText}`);
  return parts.join('\n\n');
}

/**
 * Запрос к Google Gemini REST API
 */
async function callGemini(settings, userMessage, signal) {
  const apiKey = (settings.apiKey || '').trim();
  if (!apiKey) throw new Error('Укажите API-ключ Google Gemini в настройках.');

  const model = getActiveModel(settings);
  const baseUrl = (settings.apiBaseUrl || API_PROVIDERS.gemini.defaultBaseUrl).replace(/\/+$/, '');
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const generationConfig = {
    temperature: Number(settings.temperature ?? 0.7)
  };

  // Настройка размышления (thinkingConfig):
  // Gemini 2.5 использует thinkingBudget (0 = выкл, -1 или >0 = вкл)
  // Gemini 3 / Gemini 4 использует thinkingLevel ('minimal' | 'low' | 'medium' | 'high')
  const isGemini25 = /gemini-2\.5/i.test(model);
  const isGemini3or4 = /gemini-[34]/i.test(model);

  if (isGemini25) {
    generationConfig.thinkingConfig = {
      thinkingBudget: settings.thinkingEnabled ? Number(settings.thinkingBudget ?? -1) : 0
    };
  } else if (isGemini3or4) {
    const isGemini4 = /gemini-4/i.test(model);
    generationConfig.thinkingConfig = {
      thinkingLevel: settings.thinkingEnabled
        ? (settings.thinkingLevel || 'medium')
        : (isGemini4 ? 'low' : 'minimal')
    };
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig
  };

  if (settings.systemPrompt && settings.systemPrompt.trim()) {
    body.systemInstruction = {
      parts: [{ text: settings.systemPrompt.trim() }]
    };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const errMsg = data?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`Gemini API: ${errMsg}`);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  // Отфильтровываем части с thought: true, чтобы размышления не попадали в перевод книги
  const translated = parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();

  if (!translated) {
    const finishReason = data?.candidates?.[0]?.finishReason || 'UNKNOWN';
    throw new Error(`Gemini вернул пустой ответ (finishReason: ${finishReason}).`);
  }
  const um = data?.usageMetadata || {};
  const promptTokens = Number(um.promptTokenCount) || 0;
  const outputTokens = Number(um.candidatesTokenCount) || 0;
  const thoughtTokens = Number(um.thoughtsTokenCount) || 0;
  const totalTokens = Number(um.totalTokenCount) || (promptTokens + outputTokens + thoughtTokens);
  return { text: translated, usage: { promptTokens, outputTokens, thoughtTokens, totalTokens } };
}

/**
 * Запрос к DeepSeek API (OpenAI-совместимый формат + параметр thinking)
 */
async function callDeepSeek(settings, userMessage, signal) {
  const apiKey = (settings.apiKey || '').trim();
  if (!apiKey) throw new Error('Укажите API-ключ DeepSeek в настройках.');

  const model = getActiveModel(settings);
  const url = (settings.apiBaseUrl || API_PROVIDERS.deepseek.defaultBaseUrl).trim();

  const messages = [];
  if (settings.systemPrompt && settings.systemPrompt.trim()) {
    messages.push({ role: 'system', content: settings.systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: userMessage });

  const body = {
    model,
    messages,
    stream: false
  };

  // Температура (DeepSeek в режиме thinking её игнорирует, в обычном — применяет)
  if (settings.temperature !== undefined && settings.temperature !== null) {
    body.temperature = Number(settings.temperature);
  }

  // Управление режимом размышления DeepSeek API
  if (model !== 'deepseek-reasoner' && model !== 'deepseek-chat') {
    body.thinking = { type: settings.thinkingEnabled ? 'enabled' : 'disabled' };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const errMsg = data?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`DeepSeek API: ${errMsg}`);
  }

  // Берём только message.content (reasoning_content игнорируем)
  const translated = (data?.choices?.[0]?.message?.content || '').trim();
  if (!translated) {
    throw new Error('DeepSeek API вернул пустой ответ.');
  }
  const u = data?.usage || {};
  const promptTokens = Number(u.prompt_tokens) || 0;
  const outputTokens = Number(u.completion_tokens) || 0;
  const thoughtTokens = Number(u.completion_tokens_details?.reasoning_tokens) || 0;
  const totalTokens = Number(u.total_tokens) || (promptTokens + outputTokens);
  return { text: translated, usage: { promptTokens, outputTokens, thoughtTokens, totalTokens } };
}

/**
 * Запрос к OpenAI / OpenRouter / локальному OpenAI-совместимому API
 */
async function callOpenAICompatible(settings, userMessage, signal) {
  const apiKey = (settings.apiKey || '').trim();
  const url = (settings.apiBaseUrl || API_PROVIDERS.openai.defaultBaseUrl).trim();
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
  if (!apiKey && !isLocal) {
    throw new Error('Укажите API-ключ в настройках.');
  }

  const model = getActiveModel(settings);
  const messages = [];
  if (settings.systemPrompt && settings.systemPrompt.trim()) {
    messages.push({ role: 'system', content: settings.systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: userMessage });

  const body = {
    model,
    messages,
    stream: false
  };

  const isReasoningModel = /^(o1|o3|o4|gpt-5)/i.test(model);
  if (settings.thinkingEnabled && isReasoningModel) {
    body.reasoning_effort = settings.thinkingLevel || 'medium';
  }
  if (!isReasoningModel || !settings.thinkingEnabled) {
    body.temperature = Number(settings.temperature ?? 0.7);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const errMsg = data?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`API ошибка: ${errMsg}`);
  }

  const translated = (data?.choices?.[0]?.message?.content || '').trim();
  if (!translated) {
    throw new Error('API вернул пустой ответ.');
  }
  const u = data?.usage || {};
  const promptTokens = Number(u.prompt_tokens) || 0;
  const outputTokens = Number(u.completion_tokens) || 0;
  const thoughtTokens = Number(u.completion_tokens_details?.reasoning_tokens) || 0;
  const totalTokens = Number(u.total_tokens) || (promptTokens + outputTokens);
  return { text: translated, usage: { promptTokens, outputTokens, thoughtTokens, totalTokens } };
}

/**
 * Единая точка перевода одного текстового фрагмента через выбранный API.
 */
export async function translateViaApi(settings, chunkText, { glossary = '', prevContext = '', signal = null } = {}) {
  const userMessage = buildUserMessage(chunkText, { glossary, prevContext });
  const provider = settings.apiProvider || 'gemini';

  if (provider === 'gemini') {
    return callGemini(settings, userMessage, signal);
  }
  if (provider === 'deepseek') {
    return callDeepSeek(settings, userMessage, signal);
  }
  return callOpenAICompatible(settings, userMessage, signal);
}
