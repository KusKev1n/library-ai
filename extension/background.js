// background.js — Service Worker расширения Novel AI Translator v4.0

const CHAT_URL_PATTERNS = {
  gemini: ['https://gemini.google.com/*'],
  deepseek: ['https://chat.deepseek.com/*'],
  chatgpt: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
};

const CHAT_DEFAULT_URLS = {
  gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com/',
  chatgpt: 'https://chatgpt.com/'
};

let activeChatTabId = null;
let abortedFlag = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Клик по иконке открывает главную Библиотеку
chrome.action.onClicked.addListener(async () => {
  const libUrl = chrome.runtime.getURL('library.html');
  const existing = await chrome.tabs.query({ url: libUrl });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: libUrl });
  }
});

function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    function listener(updatedId, info) {
      if (updatedId === tabId && info.status === 'complete') setTimeout(done, 800);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === 'complete') setTimeout(done, 500);
    }).catch(done);
  });
}

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'CHAT_PING' });
    if (pong && pong.ok) return true;
  } catch (_) {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-chat.js'] });
  await sleep(350);
  return true;
}

async function waitForChatInputReady(tabId, provider, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (abortedFlag) throw new Error('Остановлено пользователем');
    try {
      await ensureContentScript(tabId);
      const status = await chrome.tabs.sendMessage(tabId, { type: 'CHAT_CHECK_READY', provider });
      if (status && status.ready) return true;
    } catch (_) {}
    await sleep(600);
  }
  throw new Error('Поле ввода в новой вкладке чата не появилось за 25 сек. Проверьте, что вы вошли в аккаунт.');
}

async function findExistingChatTab(provider, createIfMissing = false) {
  const patterns = CHAT_URL_PATTERNS[provider] || CHAT_URL_PATTERNS.gemini;
  const tabs = await chrome.tabs.query({ url: patterns });
  if (tabs.length > 0) {
    return tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }
  if (createIfMissing) {
    const url = CHAT_DEFAULT_URLS[provider] || CHAT_DEFAULT_URLS.gemini;
    const tab = await chrome.tabs.create({ url, active: false });
    await waitForTabComplete(tab.id, 25000);
    await waitForChatInputReady(tab.id, provider, 25000);
    return tab;
  }
  return null;
}

async function openFreshChatTab(provider) {
  const prevTabId = activeChatTabId;
  const url = CHAT_DEFAULT_URLS[provider] || CHAT_DEFAULT_URLS.gemini;
  const newTab = await chrome.tabs.create({ url, active: false });
  activeChatTabId = newTab.id;
  if (prevTabId && prevTabId !== newTab.id) {
    chrome.tabs.remove(prevTabId).catch(() => {});
  }
  await waitForTabComplete(newTab.id, 25000);
  if (abortedFlag) throw new Error('Остановлено пользователем');
  await waitForChatInputReady(newTab.id, provider, 25000);
  if (abortedFlag) throw new Error('Остановлено пользователем');
  return newTab;
}

async function abortAllChatTabs(provider) {
  abortedFlag = true;
  const patterns = provider && CHAT_URL_PATTERNS[provider]
    ? CHAT_URL_PATTERNS[provider]
    : [...CHAT_URL_PATTERNS.gemini, ...CHAT_URL_PATTERNS.deepseek, ...CHAT_URL_PATTERNS.chatgpt];
  const tabs = await chrome.tabs.query({ url: patterns }).catch(() => []);
  await Promise.all(tabs.map((t) => chrome.tabs.sendMessage(t.id, { type: 'CHAT_ABORT' }).catch(() => {})));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'CHAT_ABORT') {
    abortAllChatTabs(message.provider).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'CHAT_STATUS') {
    (async () => {
      try {
        const tab = await findExistingChatTab(message.provider, false);
        if (!tab) return sendResponse({ ok: false, found: false, error: 'Вкладка чата не найдена' });
        await ensureContentScript(tab.id);
        const status = await chrome.tabs.sendMessage(tab.id, { type: 'CHAT_CHECK_READY', provider: message.provider });
        sendResponse({
          ok: true, found: true, tabId: tab.id, title: tab.title || tab.url, url: tab.url,
          ready: Boolean(status && status.ready), detail: status?.detail || ''
        });
      } catch (err) {
        sendResponse({ ok: false, found: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'CHAT_OPEN_TAB') {
    (async () => {
      try {
        const patterns = CHAT_URL_PATTERNS[message.provider] || CHAT_URL_PATTERNS.gemini;
        const existing = await chrome.tabs.query({ url: patterns });
        let tab;
        if (existing.length > 0) {
          tab = existing[0];
          await chrome.tabs.update(tab.id, { active: true });
        } else {
          tab = await chrome.tabs.create({ url: CHAT_DEFAULT_URLS[message.provider] || CHAT_DEFAULT_URLS.gemini, active: true });
        }
        sendResponse({ ok: true, tabId: tab.id, url: tab.url });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'CHAT_NEW_CONVERSATION') {
    (async () => {
      try {
        const tab = await findExistingChatTab(message.provider, true);
        if (!tab) throw new Error('Не удалось открыть вкладку чата');
        await ensureContentScript(tab.id);
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'CHAT_CLICK_NEW', provider: message.provider });
        sendResponse(res || { ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'CHAT_SEND_PROMPT') {
    (async () => {
      abortedFlag = false;
      try {
        const tab = message.freshTab
          ? await openFreshChatTab(message.provider)
          : await findExistingChatTab(message.provider, true);
        if (tab && !message.freshTab) activeChatTabId = tab.id;
        if (!tab) return sendResponse({ ok: false, error: 'Не удалось найти или открыть вкладку чата.' });
        if (abortedFlag) return sendResponse({ ok: false, aborted: true, error: 'Остановлено пользователем' });
        await ensureContentScript(tab.id);
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'CHAT_EXECUTE_PROMPT',
          provider: message.provider,
          prompt: message.prompt,
          thinkingEnabled: message.thinkingEnabled,
          autoToggleThinking: message.autoToggleThinking,
          timeoutMs: message.timeoutMs || 180000
        });
        sendResponse(res || { ok: false, error: 'Пустой ответ от вкладки чата' });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});
