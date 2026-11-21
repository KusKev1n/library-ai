// lib/translator.js — Общий движок перевода главы (используется и в app.js, и напрямую в reader.js)

import { translateViaApi } from './api-client.js';
import { addTranslationStats } from '../defaults.js';
import { translateViaChatTab, startNewChatConversation } from './chat-bridge.js';

export function splitTextIntoChunks(text, maxChars = 4500) {
  const clean = (text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paragraphs = clean.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;

    if (p.length > maxChars) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      const sentences = p.match(/[^.!?…]+[.!?…]+["”»']*|[^.!?…]+$/g) || [p];
      let sub = '';
      for (const s of sentences) {
        if ((sub + ' ' + s).trim().length > maxChars && sub) {
          chunks.push(sub.trim());
          sub = s;
        } else {
          sub = sub ? `${sub} ${s}` : s;
        }
      }
      if (sub.trim()) chunks.push(sub.trim());
      continue;
    }

    if ((current + '\n\n' + p).trim().length > maxChars && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function getLastSentences(text, count = 2) {
  if (!text) return '';
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]+/g);
  if (!sentences || sentences.length === 0) return text.slice(-260);
  return sentences.slice(-count).join(' ').trim();
}

export function abortableSleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('Остановлено пользователем');
      e.name = 'AbortError';
      return reject(e);
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      const e = new Error('Остановлено пользователем');
      e.name = 'AbortError';
      reject(e);
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Переводит текст одной главы по фрагментам через выбранный в настройках режим (API или Чат во вкладке).
 */
export async function translateChapterText(settings, chapterText, {
  signal = null,
  prevContext = '',
  runtimeState = null,
  onChunkStart = null,
  onChunkDone = null,
  onRetry = null,
  bookInfo = null
} = {}) {
  const chunks = splitTextIntoChunks(chapterText, settings.chunkSize || 4500);
  if (chunks.length === 0) return '';

  const state = runtimeState || { isFirstInChat: true, chatMsgCount: 0, lastTranslatedTail: prevContext };
  if (prevContext && !state.lastTranslatedTail) state.lastTranslatedTail = prevContext;

  const translatedParts = [];

  for (let c = 0; c < chunks.length; c++) {
    if (signal?.aborted) {
      const e = new Error('Остановлено пользователем');
      e.name = 'AbortError';
      throw e;
    }

    const chunkText = chunks[c];
    if (onChunkStart) onChunkStart(c + 1, chunks.length, chunkText.length);

    if (
      settings.mode === 'chat' &&
      !settings.chatFreshTabPerChunk &&
      settings.chatNewChatEvery > 0 &&
      state.chatMsgCount > 0 &&
      state.chatMsgCount % settings.chatNewChatEvery === 0
    ) {
      await startNewChatConversation(settings.chatProvider);
      state.isFirstInChat = true;
      await abortableSleep(1500, signal);
    }

    const ctx = settings.includePrevContext ? state.lastTranslatedTail : '';
    let result = '';
    let chunkUsage = null;
    const maxAttempts = Math.max(1, (settings.maxRetries ?? 2) + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (settings.mode === 'api') {
          const res = await translateViaApi(settings, chunkText, {
            glossary: settings.glossary,
            prevContext: ctx,
            signal
          });
          result = typeof res === 'string' ? res : (res.text || '');
          chunkUsage = typeof res === 'object' ? (res.usage || null) : null;
        } else {
          result = await translateViaChatTab(settings, chunkText, {
            isFirstInChat: state.isFirstInChat,
            glossary: settings.glossary,
            prevContext: ctx,
            signal
          });
          state.isFirstInChat = false;
          state.chatMsgCount++;
        }
        break;
      } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) {
          const e = new Error('Остановлено пользователем');
          e.name = 'AbortError';
          throw e;
        }
        if (onRetry) onRetry(attempt, maxAttempts, err);
        if (attempt === maxAttempts) throw err;
        await abortableSleep(2000 * attempt, signal);
      }
    }

    await addTranslationStats({
      ...(chunkUsage || {}),
      sourceChars: chunkText.length,
      translatedChars: result.length,
      apiRequests: settings.mode === 'api' ? 1 : 0,
      chatRequests: settings.mode === 'chat' ? 1 : 0
    }, bookInfo).catch(() => {});

    translatedParts.push(result);
    state.lastTranslatedTail = getLastSentences(result, 2);
    if (onChunkDone) onChunkDone(translatedParts.join('\n\n'), c + 1, chunks.length, chunkUsage);

    if (settings.delayMs > 0 && c < chunks.length - 1) {
      await abortableSleep(settings.delayMs, signal);
    }
  }

  await addTranslationStats({ chaptersTranslated: 1 }, bookInfo).catch(() => {});
  return translatedParts.join('\n\n');
}
