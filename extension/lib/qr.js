// lib/qr.js — Автономный генератор QR-кодов в SVG (ISO/IEC 18004, Byte mode, ECC Level L, версии 1–10)
// Без внешних библиотек и CDN — полностью совместим с Chrome MV3 CSP.

const EC_CODEWORDS_L = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
const NUM_BLOCKS_L   = [0, 1,  1,  1,  1,  1,  2,  2,  2,  2,  4];
const TOTAL_CW       = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const ALIGN_POS = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
];

// GF(256) с полиномом 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcc(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) {
      rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

function chooseVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const dataCw = TOTAL_CW[v] - EC_CODEWORDS_L[v] * NUM_BLOCKS_L[v];
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (headerBits + byteLen * 8 <= dataCw * 8) return v;
  }
  throw new Error('Строка слишком длинная для QR-кода');
}

function encodeDataCodewords(bytes, version) {
  const totalDataCw = TOTAL_CW[version] - EC_CODEWORDS_L[version] * NUM_BLOCKS_L[version];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = totalDataCw * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (cw.length < totalDataCw) {
    cw.push(padBytes[pi % 2]);
    pi++;
  }
  return cw;
}

function interleaveBlocks(dataCw, version) {
  const ecLen = EC_CODEWORDS_L[version];
  const numBlocks = NUM_BLOCKS_L[version];
  const shortLen = Math.floor(dataCw.length / numBlocks);
  const numLong = dataCw.length % numBlocks;
  const numShort = numBlocks - numLong;

  const dataBlocks = [];
  const eccBlocks = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = shortLen + (b >= numShort ? 1 : 0);
    const blk = dataCw.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(blk);
    eccBlocks.push(rsComputeEcc(blk, ecLen));
  }

  const out = [];
  const maxDataLen = shortLen + (numLong > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataBlocks[b].length) out.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (let b = 0; b < numBlocks; b++) out.push(eccBlocks[b][i]);
  }
  return out;
}

function makeMatrix(version) {
  const size = version * 4 + 17;
  const mod = Array.from({ length: size }, () => new Uint8Array(size));
  const isFn = Array.from({ length: size }, () => new Uint8Array(size));

  const setFn = (r, c, v) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      mod[r][c] = v ? 1 : 0;
      isFn[r][c] = 1;
    }
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        setFn(r, c, dist !== 2 && dist !== 4);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const pos = ALIGN_POS[version];
  for (const r0 of pos) {
    for (const c0 of pos) {
      if (isFn[r0][c0]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFn(r0 + dr, c0 + dc, dist !== 1);
        }
      }
    }
  }

  // Reserve format info areas + dark module
  for (let i = 0; i <= 8; i++) {
    if (!isFn[8][i]) setFn(8, i, 0);
    if (!isFn[i][8]) setFn(i, 8, 0);
  }
  for (let i = size - 8; i < size; i++) {
    setFn(8, i, 0);
    setFn(i, 8, 0);
  }
  setFn(size - 8, 8, 1);

  // Version info for v >= 7
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = (vBits >>> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  return { size, mod, isFn };
}

function placeData(matrix, codewords) {
  const { size, mod, isFn } = matrix;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFn[r][c]) {
          let bit = 0;
          if (bitIdx < totalBits) {
            bit = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
          // Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) bit ^= 1;
          mod[r][c] = bit;
        }
      }
    }
    upward = !upward;
  }

  // Format info for ECC Level L (01) + Mask 0 (000) -> data = 0b01000 = 8
  const fmtData = 0b01000;
  let rem = fmtData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fmtBits = ((fmtData << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) mod[8][i] = (fmtBits >>> (14 - i)) & 1;
  mod[8][7] = (fmtBits >>> 8) & 1;
  mod[8][8] = (fmtBits >>> 7) & 1;
  mod[7][8] = (fmtBits >>> 6) & 1;
  for (let i = 9; i < 15; i++) mod[14 - i][8] = (fmtBits >>> (14 - i)) & 1;

  for (let i = 0; i < 8; i++) mod[8][size - 1 - i] = (fmtBits >>> i) & 1;
  for (let i = 8; i < 15; i++) mod[size - 15 + i][8] = (fmtBits >>> i) & 1;
}

export function generateQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = chooseVersion(bytes.length);
  const dataCw = encodeDataCodewords(bytes, version);
  const allCw = interleaveBlocks(dataCw, version);
  const matrix = makeMatrix(version);
  placeData(matrix, allCw);
  return matrix;
}

export function generateQrSvg(text, { sizePx = 220, fg = '#191817', bg = '#ffffff' } = {}) {
  const { size, mod } = generateQrMatrix(text);
  const quiet = 3;
  const full = size + quiet * 2;
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (mod[r][c]) path += `M${c + quiet},${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`;
}
