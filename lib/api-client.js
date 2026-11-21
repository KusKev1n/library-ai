// lib/api-client.js — Автономный API-клиент для LibraryAI PWA (Gemini, DeepSeek, OpenAI/OpenRouter)

export const DEFAULT_SYSTEM_PROMPT = `Ты — профессиональный художественный переводчик англоязычной литературы на русский язык.
Переводи естественно, живо и литературно, сохраняя стиль автора и разбиение на абзацы. Не сокращай текст. Возвращай ТОЛЬКО перевод без вступлений и комментариев.`;

const DEFAULT_URLS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions'
};

const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-v4-flash',
  openai: 'gpt-4.1-mini'
};

export function splitIntoChunks(text, maxChars = 4500) {
  const clean = (text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > maxChars && cur) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export async function translateChunkViaApi(cfg, chunkText, signal = null) {
  const provider = cfg.apiProvider || 'gemini';
  const apiKey = (cfg.apiKey || '').trim();
  const model = (cfg.apiModel || DEFAULT_MODELS[provider]).trim();
  const temp = Number(cfg.temperature ?? 0.7);
  const thinking = Boolean(cfg.thinkingEnabled);
  const sysPrompt = cfg.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  if (provider === 'gemini') {
    if (!apiKey) throw new Error('Укажите API-ключ в разделе «Настройки».');
    const base = (cfg.apiBaseUrl || DEFAULT_URLS.gemini).replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const generationConfig = { temperature: temp };
    if (/gemini-2\.5/i.test(model)) {
      generationConfig.thinkingConfig = { thinkingBudget: thinking ? -1 : 0 };
    } else if (/gemini-[34]/i.test(model)) {
      generationConfig.thinkingConfig = { thinkingLevel: thinking ? 'medium' : (/gemini-4/i.test(model) ? 'low' : 'minimal') };
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sysPrompt }] },
        contents: [{ role: 'user', parts: [{ text: chunkText }] }],
        generationConfig
      }),
      signal
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const out = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('').trim();
    if (!out) throw new Error('Пустой ответ Gemini API.');
    return out;
  }

  const url = (cfg.apiBaseUrl || DEFAULT_URLS[provider] || DEFAULT_URLS.openai).trim();
  if (!apiKey && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url)) {
    throw new Error('Укажите API-ключ в разделе «Настройки».');
  }
  const body = {
    model,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: chunkText }
    ],
    stream: false
  };
  if (provider === 'deepseek') {
    body.temperature = temp;
    if (model !== 'deepseek-reasoner' && model !== 'deepseek-chat') {
      body.thinking = { type: thinking ? 'enabled' : 'disabled' };
    }
  } else {
    const isReasoning = /^(o1|o3|o4|gpt-5)/i.test(model);
    if (thinking && isReasoning) body.reasoning_effort = 'medium';
    else body.temperature = temp;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
  const out = (data?.choices?.[0]?.message?.content || '').trim();
  if (!out) throw new Error('Пустой ответ API.');
  return out;
}
