// lib/chat-bridge.js — Мост для перевода через открытую вкладку чата (Gemini, DeepSeek, ChatGPT)

export async function checkChatTabStatus(provider) {
  return chrome.runtime.sendMessage({
    type: 'CHAT_STATUS',
    provider
  });
}

export async function openOrFocusChatTab(provider) {
  return chrome.runtime.sendMessage({
    type: 'CHAT_OPEN_TAB',
    provider
  });
}

export async function startNewChatConversation(provider) {
  return chrome.runtime.sendMessage({
    type: 'CHAT_NEW_CONVERSATION',
    provider
  });
}

export async function abortChatTab(provider) {
  try {
    await chrome.runtime.sendMessage({ type: 'CHAT_ABORT', provider });
  } catch (_) {
    // Игнорируем, если сервис-воркер уже закрыл канал
  }
}

/**
 * Собирает промпт для отправки в веб-чат с учётом:
 * - префикса навыка (@read, /read или любой свой из настроек)
 * - системного промпта (в 1-м сообщении или перед каждым фрагментом)
 * - глоссария и контекста предыдущего фрагмента
 */
export function composeChatPrompt(settings, chunkText, { isFirstInChat = false, glossary = '', prevContext = '' } = {}) {
  const blocks = [];

  // 1. Префикс навыка перед текстом (например, @read или /read)
  const skill = (settings.chatSkillPrefix || '').trim();
  const shouldAddSkill =
    Boolean(settings.chatUseSkillPrefix) &&
    skill.length > 0 &&
    (settings.chatSkillFrequency === 'every' || isFirstInChat);

  if (shouldAddSkill) {
    blocks.push(skill);
  }

  // 2. Системный промпт (если включён для чата)
  const sysPrompt = (settings.systemPrompt || '').trim();
  const shouldAddSystem =
    Boolean(settings.chatSendSystemPrompt) &&
    sysPrompt.length > 0 &&
    (settings.chatSystemPromptFrequency === 'every' || isFirstInChat);

  if (shouldAddSystem) {
    blocks.push(sysPrompt);
  }

  // 3. Глоссарий
  if (glossary && glossary.trim() && (isFirstInChat || settings.chatSystemPromptFrequency === 'every')) {
    blocks.push(`[Глоссарий]\n${glossary.trim()}`);
  }

  // 4. Короткий контекст прошлого фрагмента (полезно в новом чате / новой вкладке)
  if (prevContext && prevContext.trim() && isFirstInChat) {
    blocks.push(`[Контекст предыдущего фрагмента — НЕ переводи повторно, только для связности]\n${prevContext.trim()}`);
  }

  // 5. Сам текст для перевода
  blocks.push(chunkText);

  return blocks.join('\n\n');
}

/**
 * Отправляет один фрагмент в вкладку чата и ждёт готовый перевод.
 * Поддерживает мгновенную отмену через AbortSignal (без зависания на таймауте!).
 */
export async function translateViaChatTab(
  settings,
  chunkText,
  { isFirstInChat = false, glossary = '', prevContext = '', signal = null } = {}
) {
  if (signal?.aborted) {
    const e = new Error('Остановлено пользователем');
    e.name = 'AbortError';
    throw e;
  }

  const freshTab = Boolean(settings.chatFreshTabPerChunk);
  const effectiveFirst = freshTab ? true : isFirstInChat;
  const prompt = composeChatPrompt(settings, chunkText, {
    isFirstInChat: effectiveFirst,
    glossary,
    prevContext
  });
  const timeoutMs = Math.max(30, Number(settings.chatTimeoutSec || 180)) * 1000;
  const provider = settings.chatProvider || 'gemini';

  const sendPromise = chrome.runtime.sendMessage({
    type: 'CHAT_SEND_PROMPT',
    provider,
    freshTab,
    prompt,
    thinkingEnabled: Boolean(settings.thinkingEnabled),
    autoToggleThinking: Boolean(settings.chatAutoToggleThinking),
    timeoutMs
  });

  let response;
  if (signal) {
    let onAbort;
    const abortPromise = new Promise((_, reject) => {
      onAbort = () => {
        abortChatTab(provider);
        const e = new Error('Остановлено пользователем');
        e.name = 'AbortError';
        reject(e);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      response = await Promise.race([sendPromise, abortPromise]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  } else {
    response = await sendPromise;
  }

  if (!response || !response.ok) {
    if (response?.aborted) {
      const e = new Error('Остановлено пользователем');
      e.name = 'AbortError';
      throw e;
    }
    throw new Error(response?.error || 'Не удалось получить ответ из вкладки чата.');
  }

  const text = (response.text || '').trim();
  if (!text) {
    throw new Error('Вкладка чата вернула пустой ответ.');
  }
  return text;
}
