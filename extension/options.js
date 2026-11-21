import { initI18n, saveUiLang, applyI18n } from './lib/i18n.js';
// options.js — Логика страницы настроек

import { API_PROVIDERS, DEFAULT_SYSTEM_PROMPT, loadSettings, saveSettings, loadStats, resetTranslationStats } from './defaults.js';

const $ = (id) => document.getElementById(id);

function populateModels(provider, selectedModel) {
  const sel = $('apiModel');
  const info = API_PROVIDERS[provider] || API_PROVIDERS.gemini;
  sel.innerHTML = '';
  for (const m of info.models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  sel.value = info.models.some((m) => m.id === selectedModel) ? selectedModel : info.defaultModel;
  $('tempHint').textContent = info.tempHint;
}

async function renderStats() {
  const st = await loadStats();
  const fmt = (n) => (Number(n) || 0).toLocaleString('ru-RU');
  $('statTotalTokens').textContent = fmt(st.totalTokens);
  $('statTokensBreakdown').textContent = `Вход: ${fmt(st.promptTokens)} · Выход: ${fmt(st.outputTokens)} · Размышл.: ${fmt(st.thoughtTokens)}`;
  $('statTranslatedChars').textContent = fmt(st.translatedChars);
  $('statSourceChars').textContent = `Из оригинала: ${fmt(st.sourceChars)} симв.`;
  $('statChapters').textContent = fmt(st.chaptersTranslated);
  $('statRequests').textContent = fmt(st.apiRequests + st.chatRequests);
  $('statRequestsBreakdown').textContent = `API: ${fmt(st.apiRequests)} · Веб-чат: ${fmt(st.chatRequests)}`;

  const listEl = $('bookStatsList');
  const entries = Object.entries(st.byBook || {})
    .map(([key, val]) => ({ bookKey: key, ...val }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (entries.length === 0) {
    listEl.innerHTML = '<div class="hint">Пока нет переведённых книг в статистике.</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const item of entries) {
    const row = document.createElement('div');
    row.className = 'book-stat-row';

    const title = document.createElement('div');
    title.className = 'book-stat-title';
    title.textContent = item.title || item.bookKey;

    const metrics = document.createElement('div');
    metrics.className = 'book-stat-metrics';
    metrics.textContent = `Токены: ${fmt(item.totalTokens)} (вх. ${fmt(item.promptTokens)} / вых. ${fmt(item.outputTokens)}${item.thoughtTokens ? ` / разм. ${fmt(item.thoughtTokens)}` : ''}) · Символов: ${fmt(item.translatedChars)} · Глав: ${fmt(item.chaptersTranslated)}`;

    row.appendChild(title);
    row.appendChild(metrics);
    listEl.appendChild(row);
  }
}

async function renderPairedDevices() {
  const listEl = $('pairedDevicesList');
  if (!listEl) return;
  const data = await chrome.storage.local.get(['libraryAiPairedDevices', 'libraryAiPairCode']);
  const devices = Array.isArray(data.libraryAiPairedDevices) ? data.libraryAiPairedDevices : [];
  if (devices.length === 0) {
    listEl.innerHTML = `<div class="hint">Сопряжённых телефонов пока нет.${data.libraryAiPairCode ? ` Текущий код ПК: <strong>${data.libraryAiPairCode}</strong>.` : ''}</div>`;
    return;
  }
  listEl.innerHTML = '';
  for (const dev of devices) {
    const row = document.createElement('div');
    row.className = 'book-stat-row';

    const title = document.createElement('div');
    title.className = 'book-stat-title';
    title.textContent = dev.name || 'Телефон';

    const meta = document.createElement('div');
    meta.className = 'book-stat-metrics';
    const dt = dev.lastSync ? new Date(dev.lastSync).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    meta.textContent = `Код: ${dev.code || '—'} · Синхр.: ${dt}`;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger btn-xs';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', async () => {
      const next = devices.filter((x) => x.id !== dev.id);
      await chrome.storage.local.set({ libraryAiPairedDevices: next });
      renderPairedDevices();
    });

    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(delBtn);
    listEl.appendChild(row);
  }
}

async function init() {
  const uiLang = await initI18n();
  $('uiLang').value = uiLang;
  $('uiLang').addEventListener('change', async () => {
    const v = await saveUiLang($('uiLang').value);
    applyI18n(v);
  });
  const s = await loadSettings();

  $('mode').value = s.mode;
  $('apiProvider').value = s.apiProvider;
  populateModels(s.apiProvider, s.apiModel);
  $('apiCustomModel').value = s.apiCustomModel || '';
  $('apiKey').value = s.apiKey || '';
  $('apiBaseUrl').value = s.apiBaseUrl || '';

  $('temperature').value = String(s.temperature ?? 0.7);
  $('tempValue').textContent = String(s.temperature ?? 0.7);
  $('thinkingEnabled').checked = Boolean(s.thinkingEnabled);
  $('thinkingLevel').value = s.thinkingLevel || 'medium';
  $('thinkingBudget').value = String(s.thinkingBudget ?? 4096);

  $('chatProvider').value = s.chatProvider || 'gemini';
  $('chatTimeoutSec').value = String(s.chatTimeoutSec ?? 180);
  $('chatUseSkillPrefix').checked = Boolean(s.chatUseSkillPrefix);
  $('chatSkillPrefix').value = s.chatSkillPrefix || '';
  $('chatSkillFrequency').value = s.chatSkillFrequency || 'every';
  $('chatSystemPromptFrequency').value = s.chatSystemPromptFrequency || 'first';
  $('chatNewChatEvery').value = String(s.chatNewChatEvery ?? 0);
  $('chatSendSystemPrompt').checked = Boolean(s.chatSendSystemPrompt);
  $('chatAutoToggleThinking').checked = Boolean(s.chatAutoToggleThinking);

  $('systemPrompt').value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  $('glossary').value = s.glossary || '';
  $('chunkSize').value = String(s.chunkSize ?? 4500);
  $('delayMs').value = String(s.delayMs ?? 1500);
  $('maxRetries').value = String(s.maxRetries ?? 2);
  $('includePrevContext').checked = Boolean(s.includePrevContext);

  $('apiProvider').addEventListener('change', () => {
    populateModels($('apiProvider').value, '');
  });

  $('temperature').addEventListener('input', () => {
    $('tempValue').textContent = $('temperature').value;
  });

  $('resetPromptBtn').addEventListener('click', () => {
    $('systemPrompt').value = DEFAULT_SYSTEM_PROMPT;
  });

  await renderStats();
  await renderPairedDevices();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.translationStats) renderStats();
    if (area === 'local' && (changes.libraryAiPairedDevices || changes.libraryAiPairCode)) renderPairedDevices();
  });

  $('clearPairsBtn').addEventListener('click', async () => {
    if (!confirm('Отвязать все устройства и сбросить код сопряжения?')) return;
    await chrome.storage.local.remove(['libraryAiPairedDevices', 'libraryAiPairCode']);
    await renderPairedDevices();
  });

  $('resetStatsBtn').addEventListener('click', async () => {
    if (!confirm('Сбросить всю статистику токенов и символов?')) return;
    await resetTranslationStats();
    await renderStats();
  });

  $('backToAppBtn').addEventListener('click', () => {
    window.location.href = chrome.runtime.getURL('app.html');
  });

  $('saveBtn').addEventListener('click', async () => {
    await saveSettings({
      mode: $('mode').value,
      apiProvider: $('apiProvider').value,
      apiModel: $('apiModel').value,
      apiCustomModel: $('apiCustomModel').value.trim(),
      apiKey: $('apiKey').value.trim(),
      apiBaseUrl: $('apiBaseUrl').value.trim(),
      temperature: parseFloat($('temperature').value),
      thinkingEnabled: $('thinkingEnabled').checked,
      thinkingLevel: $('thinkingLevel').value,
      thinkingBudget: parseInt($('thinkingBudget').value, 10) || -1,
      chatProvider: $('chatProvider').value,
      chatTimeoutSec: parseInt($('chatTimeoutSec').value, 10) || 180,
      chatUseSkillPrefix: $('chatUseSkillPrefix').checked,
      chatSkillPrefix: $('chatSkillPrefix').value.trim(),
      chatSkillFrequency: $('chatSkillFrequency').value,
      chatSystemPromptFrequency: $('chatSystemPromptFrequency').value,
      chatNewChatEvery: Math.max(0, parseInt($('chatNewChatEvery').value, 10) || 0),
      chatSendSystemPrompt: $('chatSendSystemPrompt').checked,
      chatAutoToggleThinking: $('chatAutoToggleThinking').checked,
      systemPrompt: $('systemPrompt').value,
      glossary: $('glossary').value,
      chunkSize: Math.max(1000, parseInt($('chunkSize').value, 10) || 4500),
      delayMs: Math.max(0, parseInt($('delayMs').value, 10) || 1500),
      maxRetries: Math.max(0, parseInt($('maxRetries').value, 10) || 2),
      includePrevContext: $('includePrevContext').checked
    });

    $('saveStatus').textContent = 'Настройки сохранены!';
    setTimeout(() => { $('saveStatus').textContent = ''; }, 2500);
  });
}

init();
