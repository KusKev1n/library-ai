// lib/sync-rtc.js — Двусторонняя P2P-синхронизация LibraryAI (ПК ↔ Телефон) через WebRTC DataChannel
// Сигналинг в 1 скан QR через бесплатный PeerJS WebSocket (книги и тексты идут напрямую по Wi-Fi P2P).

const SIGNAL_WS_BASE = 'wss://0.peerjs.com/peerjs?key=peerjs';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
const CHUNK_SIZE = 32768;

export function generatePairingCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

function makePeerId(code, role) {
  return `libraryai_${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}_${role}`;
}

function randomToken() {
  return Math.random().toString(36).slice(2, 12);
}

/**
 * Протокол передачи больших JSON-сообщений (с обложками и картинками) поверх WebRTC DataChannel.
 */
function attachFramedChannel(dc, onMessage, onProgress) {
  let incomingMeta = null;
  let incomingParts = [];
  let receivedLen = 0;

  dc.onmessage = (ev) => {
    const raw = ev.data;
    if (typeof raw !== 'string') return;
    if (raw.startsWith('META:')) {
      incomingMeta = JSON.parse(raw.slice(5));
      incomingParts = [];
      receivedLen = 0;
      return;
    }
    if (raw.startsWith('CHUNK:')) {
      const part = raw.slice(6);
      incomingParts.push(part);
      receivedLen += part.length;
      if (incomingMeta && onProgress) {
        onProgress('download', Math.min(100, Math.round((receivedLen / Math.max(1, incomingMeta.len)) * 100)));
      }
      return;
    }
    if (raw === 'END') {
      try {
        const parsed = JSON.parse(incomingParts.join(''));
        onMessage(parsed);
      } catch (_) {}
      incomingMeta = null;
      incomingParts = [];
      receivedLen = 0;
      return;
    }
    try {
      onMessage(JSON.parse(raw));
    } catch (_) {}
  };

  async function sendJson(obj) {
    const str = JSON.stringify(obj);
    if (str.length <= CHUNK_SIZE) {
      dc.send(str);
      return;
    }
    dc.send('META:' + JSON.stringify({ len: str.length }));
    for (let i = 0; i < str.length; i += CHUNK_SIZE) {
      while (dc.bufferedAmount > 512 * 1024) {
        await new Promise((r) => setTimeout(r, 25));
      }
      dc.send('CHUNK:' + str.slice(i, i + CHUNK_SIZE));
      if (onProgress) {
        onProgress('upload', Math.min(100, Math.round(((i + CHUNK_SIZE) / str.length) * 100)));
      }
    }
    dc.send('END');
  }

  return { sendJson };
}

/**
 * Запускает хост синхронизации на ПК (расширение) и ждёт подключения телефона по 6-значному коду.
 */
export function startSyncHost(code, { onStatus, onPeerConnected, onMessage, onProgress, onError } = {}) {
  const myId = makePeerId(code, 'pc');
  const wsUrl = `${SIGNAL_WS_BASE}&id=${encodeURIComponent(myId)}&token=${randomToken()}`;
  let ws = null;
  let pc = null;
  let framed = null;
  let closed = false;
  let hbTimer = null;

  const cleanup = () => {
    closed = true;
    clearInterval(hbTimer);
    try { pc?.close(); } catch (_) {}
    try { ws?.close(); } catch (_) {}
  };

  onStatus?.('Подключение к серверу сопряжения...');
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    hbTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
    }, 15000);
  };

  ws.onerror = () => {
    if (!closed) onError?.(new Error('Не удалось подключиться к сигнальному серверу. Используйте ручной экспорт/импорт .json.'));
  };

  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }

    if (msg.type === 'OPEN') {
      onStatus?.('Ожидание сканирования QR на телефоне...');
      return;
    }

    if (msg.type === 'OFFER' && msg.payload?.sdp) {
      const remoteId = msg.src;
      onStatus?.('Телефон найден, устанавливаю прямое соединение по Wi-Fi...');
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = (e) => {
        if (e.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'CANDIDATE',
            dst: remoteId,
            payload: { candidate: e.candidate, connectionId: msg.payload.connectionId, type: 'data' }
          }));
        }
      };

      pc.ondatachannel = (e) => {
        const dc = e.channel;
        dc.onopen = () => {
          framed = attachFramedChannel(dc, (data) => onMessage?.(data, framed), onProgress);
          onStatus?.('Соединение установлено ✓ Синхронизация...');
          onPeerConnected?.(framed);
        };
        dc.onclose = () => {
          if (!closed) onStatus?.('Телефон отключился.');
        };
      };

      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({
        type: 'ANSWER',
        dst: remoteId,
        payload: { sdp: pc.localDescription, connectionId: msg.payload.connectionId, type: 'data' }
      }));
      return;
    }

    if (msg.type === 'CANDIDATE' && msg.payload?.candidate && pc) {
      try { await pc.addIceCandidate(new RTCIceCandidate(msg.payload.candidate)); } catch (_) {}
    }
  };

  return { close: cleanup };
}

/**
 * Подключается с телефона (PWA) к открытому хосту ПК по 6-значному коду.
 */
export function connectSyncClient(code, { onStatus, onConnected, onMessage, onProgress, onError } = {}) {
  const myId = makePeerId(code, 'mob') + '_' + Math.random().toString(36).slice(2, 6);
  const dstId = makePeerId(code, 'pc');
  const connId = 'dc_' + Math.random().toString(36).slice(2, 10);
  const wsUrl = `${SIGNAL_WS_BASE}&id=${encodeURIComponent(myId)}&token=${randomToken()}`;

  let ws = null;
  let pc = null;
  let framed = null;
  let closed = false;

  const cleanup = () => {
    closed = true;
    try { pc?.close(); } catch (_) {}
    try { ws?.close(); } catch (_) {}
  };

  onStatus?.('Поиск ПК по коду...');
  ws = new WebSocket(wsUrl);

  ws.onerror = () => {
    if (!closed) onError?.(new Error('Ошибка сети при подключении. Проверьте интернет или используйте импорт .json.'));
  };

  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }

    if (msg.type === 'OPEN') {
      onStatus?.('Отправка запроса на ПК...');
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const dc = pc.createDataChannel('libraryai');

      dc.onopen = () => {
        framed = attachFramedChannel(dc, (data) => onMessage?.(data, framed), onProgress);
        onStatus?.('Подключено к ПК ✓ Синхронизация...');
        onConnected?.(framed);
      };
      dc.onclose = () => {
        if (!closed) onStatus?.('Соединение с ПК закрыто.');
      };

      pc.onicecandidate = (e) => {
        if (e.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'CANDIDATE',
            dst: dstId,
            payload: { candidate: e.candidate, connectionId: connId, type: 'data' }
          }));
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({
        type: 'OFFER',
        dst: dstId,
        payload: { sdp: pc.localDescription, connectionId: connId, type: 'data', label: 'libraryai', serialization: 'raw' }
      }));
      return;
    }

    if (msg.type === 'ANSWER' && msg.payload?.sdp && pc) {
      onStatus?.('ПК ответил, открываю канал Wi-Fi...');
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
      return;
    }

    if (msg.type === 'CANDIDATE' && msg.payload?.candidate && pc) {
      try { await pc.addIceCandidate(new RTCIceCandidate(msg.payload.candidate)); } catch (_) {}
      return;
    }

    if (msg.type === 'ERROR') {
      onError?.(new Error('ПК с таким кодом не найден. Убедитесь, что на ПК открыто окно «Синхронизация».'));
    }
  };

  return { close: cleanup };
}

/**
 * Объединяет запись книги с удалённого устройства с локальной (не теряет переводы с обеих сторон).
 */
export function mergeBookRecords(localRec, remoteRec) {
  if (!localRec) return remoteRec;
  if (!remoteRec) return localRec;

  const mergedChapters = { ...(localRec.chapters || {}) };
  for (const [k, v] of Object.entries(remoteRec.chapters || {})) {
    if (v && (!mergedChapters[k] || (remoteRec.updatedAt || 0) >= (localRec.updatedAt || 0))) {
      mergedChapters[k] = v;
    }
  }
  const mergedOriginals = { ...(remoteRec.originals || {}), ...(localRec.originals || {}) };
  const mergedImages = { ...(remoteRec.chapterImages || {}), ...(localRec.chapterImages || {}) };
  const chapterMeta = (localRec.chapterMeta?.length >= (remoteRec.chapterMeta?.length || 0))
    ? localRec.chapterMeta
    : remoteRec.chapterMeta;

  return {
    ...remoteRec,
    ...localRec,
    title: localRec.title || remoteRec.title,
    author: localRec.author || remoteRec.author || '',
    coverDataUrl: localRec.coverDataUrl || remoteRec.coverDataUrl || '',
    totalChapters: Math.max(localRec.totalChapters || 0, remoteRec.totalChapters || 0),
    chapterMeta,
    chapters: mergedChapters,
    originals: mergedOriginals,
    chapterImages: mergedImages,
    skippedChapters: (localRec.skippedChapters?.length ? localRec.skippedChapters : remoteRec.skippedChapters) || [],
    updatedAt: Math.max(localRec.updatedAt || 0, remoteRec.updatedAt || 0)
  };
}
