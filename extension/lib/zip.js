// lib/zip.js — Самодостаточный ZIP-архиватор и распаковщик для EPUB (без внешних зависимостей)
// Использует нативные Web Streams API (DecompressionStream / CompressionStream 'deflate-raw').

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

async function streamTransform(bytes, transformStream) {
  const writer = transformStream.writable.getWriter();
  const writePromise = writer.write(bytes).then(() => writer.close());
  const reader = transformStream.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await writePromise;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function inflateRaw(bytes) {
  return streamTransform(bytes, new DecompressionStream('deflate-raw'));
}

export async function deflateRaw(bytes) {
  return streamTransform(bytes, new CompressionStream('deflate-raw'));
}

/**
 * Распаковывает ZIP-архив (ArrayBuffer или Uint8Array) в Map<string, Uint8Array>.
 */
export async function unzipBytes(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder('utf-8');

  // Ищем End of Central Directory (EOCD) с конца файла: 0x06054b50
  let eocdOffset = -1;
  const minOffset = Math.max(0, data.length - 65557);
  for (let i = data.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Файл не является корректным ZIP/EPUB архивом (EOCD не найден).');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const files = new Map();
  let ptr = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error('Повреждена центральная директория ZIP.');
    }
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const name = decoder.decode(data.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;

    // Читаем локальный заголовок для точного смещения данных
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Повреждён локальный заголовок для ${name}`);
    }
    const lhNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lhExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const rawSlice = data.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      files.set(name, new Uint8Array(rawSlice));
    } else if (method === 8) {
      const uncompressed = await inflateRaw(rawSlice);
      files.set(name, uncompressed);
    } else {
      throw new Error(`Неподдерживаемый метод сжатия ZIP (${method}) для ${name}`);
    }
  }

  return files;
}

/**
 * Упаковывает массив записей [{ name, data: Uint8Array|string, store?: boolean }] в ZIP Uint8Array.
 * Для EPUB файл 'mimetype' должен быть первым и без сжатия (store: true).
 */
export async function zipEntries(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const rawBytes = typeof entry.data === 'string'
      ? encoder.encode(entry.data)
      : (entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data));

    const shouldStore = Boolean(entry.store) || rawBytes.length < 64;
    const compBytes = shouldStore ? rawBytes : await deflateRaw(rawBytes);
    const method = shouldStore ? 0 : 8;
    const crc = crc32(rawBytes);

    // Local file header (30 bytes + name)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lhv = new DataView(lh.buffer);
    lhv.setUint32(0, 0x04034b50, true);
    lhv.setUint16(4, 20, true);            // version needed
    lhv.setUint16(6, 0x0800, true);        // UTF-8 flag
    lhv.setUint16(8, method, true);
    lhv.setUint16(10, 0, true);            // mod time
    lhv.setUint16(12, 0, true);            // mod date
    lhv.setUint32(14, crc, true);
    lhv.setUint32(18, compBytes.length, true);
    lhv.setUint32(22, rawBytes.length, true);
    lhv.setUint16(26, nameBytes.length, true);
    lhv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    localParts.push(lh, compBytes);

    // Central directory header (46 bytes + name)
    const ch = new Uint8Array(46 + nameBytes.length);
    const chv = new DataView(ch.buffer);
    chv.setUint32(0, 0x02014b50, true);
    chv.setUint16(4, 20, true);
    chv.setUint16(6, 20, true);
    chv.setUint16(8, 0x0800, true);        // UTF-8 flag
    chv.setUint16(10, method, true);
    chv.setUint16(12, 0, true);
    chv.setUint16(14, 0, true);
    chv.setUint32(16, crc, true);
    chv.setUint32(20, compBytes.length, true);
    chv.setUint32(24, rawBytes.length, true);
    chv.setUint16(28, nameBytes.length, true);
    chv.setUint16(30, 0, true);
    chv.setUint16(32, 0, true);
    chv.setUint16(34, 0, true);
    chv.setUint16(36, 0, true);
    chv.setUint32(38, 0, true);
    chv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    centralParts.push(ch);
    offset += lh.length + compBytes.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const ch of centralParts) cdSize += ch.length;

  // EOCD (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);

  const totalSize = cdStart + cdSize + 22;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const part of localParts) {
    out.set(part, pos);
    pos += part.length;
  }
  for (const part of centralParts) {
    out.set(part, pos);
    pos += part.length;
  }
  out.set(eocd, pos);
  return out;
}
