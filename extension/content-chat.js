// content-chat.js — Контент-скрипт для автоматизации веб-чатов Gemini, DeepSeek и ChatGPT
// Версия 2.1: надёжная проверка отправки текста (без пропусков) и мгновенная остановка CHAT_ABORT.

(() => {
  if (window.__NOVEL_AI_TRANSLATOR_LOADED__) return;
  window.__NOVEL_AI_TRANSLATOR_LOADED__ = true;

  let currentAborted = false;

  function detectProvider() {
    const host = location.hostname;
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('deepseek.com')) return 'deepseek';
    if (host.includes('chatgpt.com') || host.includes('openai.com')) return 'chatgpt';
    return 'unknown';
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function queryFirstVisible(selectors, root = document) {
    for (const sel of selectors) {
      const nodes = root.querySelectorAll(sel);
      for (const n of nodes) {
        if (isVisible(n)) return n;
      }
    }
    return null;
  }

  function getInputValue(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return (el.value || '').trim();
    }
    return (el.innerText || el.textContent || '').trim();
  }

  // --- Адаптеры DOM для каждого веб-чата ---
  const ADAPTERS = {
    gemini: {
      findInput() {
        return queryFirstVisible([
          'rich-textarea .ql-editor[contenteditable="true"]',
          'div.ql-editor[contenteditable="true"]',
          'div[role="textbox"][contenteditable="true"]',
          'textarea'
        ]);
      },
      findSendButton() {
        return queryFirstVisible([
          'button.send-button:not([disabled])',
          'button[aria-label*="Send" i]:not([disabled])',
          'button[aria-label*="Отправить" i]:not([disabled])',
          'button[data-test-id="send-button"]:not([disabled])'
        ]);
      },
      findStopButton() {
        return queryFirstVisible([
          'button[aria-label*="Stop" i]',
          'button[aria-label*="Остановить" i]',
          'button.stop-button',
          '.stop-icon'
        ]);
      },
      isGenerating() {
        return Boolean(this.findStopButton());
      },
      getResponses() {
        const containers = document.querySelectorAll(
          'model-response message-content, .model-response-text, response-container .markdown, message-content .markdown'
        );
        const list = [];
        for (const el of containers) {
          if (el.closest('model-thoughts, .thoughts-container, [data-test-id="thoughts"]')) continue;
          const clone = el.cloneNode(true);
          clone.querySelectorAll('model-thoughts, .thoughts-container, button, .code-block-decoration').forEach((n) => n.remove());
          const txt = (clone.innerText || clone.textContent || '').trim();
          if (txt) list.push(txt);
        }
        return list;
      },
      findNewChatButton() {
        return queryFirstVisible([
          'a[href="/app"]',
          'button[aria-label*="New chat" i]',
          'button[aria-label*="Новый чат" i]',
          '[data-test-id="new-chat-button"]'
        ]);
      },
      toggleThinking(_enabled) {}
    },

    deepseek: {
      findInput() {
        return queryFirstVisible([
          'textarea#chat-input',
          'textarea[placeholder*="DeepSeek" i]',
          'textarea[placeholder*="Message" i]',
          'textarea[placeholder*="сообщ" i]',
          'textarea'
        ]);
      },
      findSendButton(inputEl) {
        // 1. Сначала ищем явные кнопки отправки
        const direct = queryFirstVisible([
          'button[aria-label*="Send" i]:not([disabled])',
          'button[aria-label*="Отправить" i]:not([disabled])',
          'button[type="submit"]:not([disabled])'
        ]);
        if (direct) return direct;

        // 2. В DeepSeek кнопка отправки — это ПРАВАЯ/ПОСЛЕДНЯЯ активная кнопка с иконкой без текста
        // внутри блока композитора вокруг textarea (исключая DeepThink / Search / Attach).
        const composer = inputEl?.closest('form, [class*="editor"], [class*="input"], [class*="chat-input"]')?.parentElement || inputEl?.parentElement?.parentElement;
        if (composer) {
          const candidates = Array.from(composer.querySelectorAll('button, div[role="button"]')).filter((btn) => {
            if (!isVisible(btn)) return false;
            if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
            const txt = (btn.textContent || '').trim();
            // Исключаем текстовые переключатели типа "DeepThink", "Search", "Поиск"
            if (txt.length > 0) return false;
            if (!btn.querySelector('svg')) return false;
            return true;
          });
          if (candidates.length > 0) {
            return candidates[candidates.length - 1];
          }
        }
        return null;
      },
      findStopButton() {
        return queryFirstVisible([
          'button[aria-label*="Stop" i]',
          'button[aria-label*="Остановить" i]',
          'div[role="button"][aria-label*="Stop" i]'
        ]);
      },
      isGenerating() {
        if (this.findStopButton()) return true;
        // В DeepSeek во время генерации кнопка отправки часто меняет иконку на квадрат (rect)
        const input = this.findInput();
        const composer = input?.parentElement?.parentElement;
        if (composer) {
          const stopRect = composer.querySelector('div[role="button"] svg rect[rx], button svg rect[rx]');
          if (stopRect && isVisible(stopRect)) return true;
        }
        return false;
      },
      getResponses() {
        const nodes = document.querySelectorAll('.ds-markdown, .markdown-body');
        const list = [];
        for (const el of nodes) {
          if (el.closest('.ds-think-content, [class*="think"], [class*="reason"]')) continue;
          const txt = (el.innerText || el.textContent || '').trim();
          if (txt) list.push(txt);
        }
        return list;
      },
      findNewChatButton() {
        return queryFirstVisible([
          'button[aria-label*="New chat" i]',
          'div[role="button"][aria-label*="New chat" i]',
          'a[href="/"]'
        ]);
      },
      toggleThinking(enabled) {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const deepThinkBtn = buttons.find((b) =>
          isVisible(b) && /deepthink|r1|мышлени|размышл/i.test(b.textContent || '')
        );
        if (!deepThinkBtn) return;
        const isActive =
          deepThinkBtn.getAttribute('aria-pressed') === 'true' ||
          /active|selected|checked/i.test(deepThinkBtn.className || '');
        if (Boolean(enabled) !== isActive) {
          deepThinkBtn.click();
        }
      }
    },

    chatgpt: {
      findInput() {
        return queryFirstVisible([
          '#prompt-textarea',
          'div#prompt-textarea[contenteditable="true"]',
          'textarea[data-id="root"]',
          'div[role="textbox"][contenteditable="true"]',
          'textarea'
        ]);
      },
      findSendButton() {
        return queryFirstVisible([
          'button[data-testid="send-button"]:not([disabled])',
          'button[aria-label*="Send" i]:not([disabled])',
          'button[aria-label*="Отправить" i]:not([disabled])'
        ]);
      },
      findStopButton() {
        return queryFirstVisible([
          'button[data-testid="stop-button"]',
          'button[aria-label*="Stop" i]',
          'button[aria-label*="Остановить" i]'
        ]);
      },
      isGenerating() {
        return Boolean(this.findStopButton());
      },
      getResponses() {
        const nodes = document.querySelectorAll(
          '[data-message-author-role="assistant"] .markdown, article[data-testid*="conversation-turn"] .markdown'
        );
        const list = [];
        for (const el of nodes) {
          const txt = (el.innerText || el.textContent || '').trim();
          if (txt) list.push(txt);
        }
        return list;
      },
      findNewChatButton() {
        return queryFirstVisible([
          'a[data-testid="create-new-chat-button"]',
          'button[data-testid="create-new-chat-button"]',
          'a[href="/"]'
        ]);
      },
      toggleThinking(enabled) {
        const buttons = Array.from(document.querySelectorAll('button'));
        const reasonBtn = buttons.find((b) =>
          isVisible(b) && /\b(reason|think|размышл)\b/i.test(b.textContent || b.getAttribute('aria-label') || '')
        );
        if (!reasonBtn) return;
        const isActive = reasonBtn.getAttribute('aria-pressed') === 'true';
        if (Boolean(enabled) !== isActive) {
          reasonBtn.click();
        }
      }
    }
  };

  // --- Надёжная вставка текста в React textarea или contenteditable ---
  async function setInputText(el, text) {
    el.focus();
    await sleep(150);

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // ContentEditable (Gemini Quill / ChatGPT ProseMirror)
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
    } catch (_) {
      el.textContent = '';
    }

    const inserted = document.execCommand('insertText', false, text);
    if (!inserted || !getInputValue(el)) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  function dispatchEnter(inputEl) {
    inputEl.focus();
    const opts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      bubbles: true,
      cancelable: true
    };
    inputEl.dispatchEvent(new KeyboardEvent('keydown', opts));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', opts));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  /**
   * Отправляет сообщение и ПРОВЕРЯЕТ, что поле ввода очистилось (текст реально ушёл в чат).
   * Делает до 3 попыток (Enter + клик по кнопке отправки).
   */
  async function sendAndVerify(adapter, inputEl, text, prevResponseCount) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (currentAborted) throw new Error('Остановлено пользователем');

      // Если поле пустое (например, не вставилось) — вставляем заново
      if (!getInputValue(inputEl)) {
        await setInputText(inputEl, text);
        await sleep(250);
      }

      if (attempt === 1) {
        // Сначала пробуем клик по кнопке отправки, если она найдена; иначе Enter
        const btn = adapter.findSendButton(inputEl);
        if (btn) btn.click();
        else dispatchEnter(inputEl);
      } else if (attempt === 2) {
        // Вторая попытка: Enter
        dispatchEnter(inputEl);
      } else {
        // Третья попытка: перевставка + клик по кнопке
        await setInputText(inputEl, text);
        await sleep(300);
        const btn = adapter.findSendButton(inputEl);
        if (btn) btn.click();
        else dispatchEnter(inputEl);
      }

      // Ждём до 2.2 сек подтверждения отправки (поле очистилось ИЛИ началась генерация)
      for (let w = 0; w < 11; w++) {
        if (currentAborted) throw new Error('Остановлено пользователем');
        await sleep(200);
        const curInput = adapter.findInput();
        const remaining = getInputValue(curInput);
        const generating = adapter.isGenerating();
        const respCount = adapter.getResponses().length;
        if (!remaining || generating || respCount > prevResponseCount) {
          return true;
        }
      }
    }

    throw new Error('Текст не удалось отправить в чат (поле ввода не очистилось после 3 попыток).');
  }

  async function waitForCompleteResponse(adapter, prevCount, prevLastText, timeoutMs) {
    const start = Date.now();
    let seenGeneration = false;
    let lastText = '';
    let stableSince = 0;

    while (Date.now() - start < timeoutMs) {
      if (currentAborted) {
        // Пробуем остановить генерацию в самом чате
        const stopBtn = adapter.findStopButton?.();
        if (stopBtn) stopBtn.click();
        const err = new Error('Остановлено пользователем');
        err.aborted = true;
        throw err;
      }

      await sleep(350);
      if (currentAborted) continue;

      const generating = adapter.isGenerating();
      if (generating) seenGeneration = true;

      const responses = adapter.getResponses();
      const hasNew = responses.length > prevCount;
      const latest = responses.length > 0 ? responses[responses.length - 1] : '';
      const changedFromPrev = hasNew || (latest && latest !== prevLastText);

      if (changedFromPrev && latest) {
        if (latest !== lastText) {
          lastText = latest;
          stableSince = Date.now();
        } else if (!generating && stableSince > 0) {
          const requiredStableMs = seenGeneration ? 2000 : 3000;
          if (Date.now() - stableSince >= requiredStableMs) {
            return lastText;
          }
        }
      }
    }

    if (lastText) return lastText;
    throw new Error('Превышено время ожидания ответа от вкладки чата. Проверьте вкладку браузера.');
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === 'CHAT_PING') {
      sendResponse({ ok: true, provider: detectProvider() });
      return false;
    }

    if (message.type === 'CHAT_ABORT') {
      currentAborted = true;
      const adapter = ADAPTERS[detectProvider()];
      const stopBtn = adapter?.findStopButton?.();
      if (stopBtn) stopBtn.click();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'CHAT_CHECK_READY') {
      const provider = detectProvider();
      const adapter = ADAPTERS[provider];
      if (!adapter) {
        sendResponse({ ready: false, detail: 'Неподдерживаемый сайт' });
        return false;
      }
      const input = adapter.findInput();
      sendResponse({
        ready: Boolean(input),
        provider,
        detail: input ? 'Поле ввода готово' : 'Войдите в аккаунт или дождитесь загрузки чата'
      });
      return false;
    }

    if (message.type === 'CHAT_CLICK_NEW') {
      const provider = detectProvider();
      const adapter = ADAPTERS[provider];
      const btn = adapter?.findNewChatButton();
      if (btn) {
        btn.click();
        setTimeout(() => sendResponse({ ok: true }), 1200);
        return true;
      }
      sendResponse({ ok: false, error: 'Кнопка нового чата не найдена' });
      return false;
    }

    if (message.type === 'CHAT_EXECUTE_PROMPT') {
      currentAborted = false;
      (async () => {
        try {
          const provider = detectProvider();
          const adapter = ADAPTERS[provider];
          if (!adapter) throw new Error('Неподдерживаемая вкладка чата.');

          const input = adapter.findInput();
          if (!input) {
            throw new Error('Не найдено поле ввода чата. Убедитесь, что вы вошли в аккаунт на этой вкладке.');
          }

          if (message.autoToggleThinking && typeof adapter.toggleThinking === 'function') {
            try {
              adapter.toggleThinking(Boolean(message.thinkingEnabled));
              await sleep(200);
            } catch (_) {}
          }

          const beforeResponses = adapter.getResponses();
          const prevCount = beforeResponses.length;
          const prevLastText = prevCount > 0 ? beforeResponses[prevCount - 1] : '';

          await setInputText(input, message.prompt);
          await sleep(250);
          await sendAndVerify(adapter, input, message.prompt, prevCount);

          const text = await waitForCompleteResponse(
            adapter,
            prevCount,
            prevLastText,
            message.timeoutMs || 180000
          );

          sendResponse({ ok: true, text });
        } catch (err) {
          sendResponse({
            ok: false,
            aborted: Boolean(err?.aborted || currentAborted),
            error: err.message || String(err)
          });
        }
      })();
      return true;
    }

    return false;
  });
})();
