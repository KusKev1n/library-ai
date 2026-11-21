// lib/pdf-reader.js — Извлечение текста из PDF через PDF.js (lib/pdf.mjs) с резервным встроенным парсером

let cachedPdfjs = null;

async function tryLoadPdfJs() {
  if (cachedPdfjs) return cachedPdfjs;
  try {
    const modUrl = chrome.runtime.getURL('lib/pdf.mjs');
    const pdfjs = await import(modUrl);
    if (pdfjs && pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.mjs');
    }
    cachedPdfjs = pdfjs;
    return pdfjs;
  } catch (err) {
    return null;
  }
}

export async function isPdfJsAvailable() {
  const mod = await tryLoadPdfJs();
  return Boolean(mod);
}

/**
 * Аккуратно собирает абзацы из textContent.items одной страницы PDF.js.
 */
function reconstructPageText(items) {
  if (!items || items.length === 0) return '';
  const lines = [];
  let currentLine = '';
  let lastY = null;

  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform ? Math.round(item.transform[5]) : lastY;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
      if (currentLine.trim()) lines.push({ y: lastY, text: currentLine.trim() });
      currentLine = item.str;
    } else {
      if (currentLine && !currentLine.endsWith(' ') && !item.str.startsWith(' ')) {
        currentLine += ' ';
      }
      currentLine += item.str;
    }
    if (item.hasEOL) {
      if (currentLine.trim()) lines.push({ y, text: currentLine.trim() });
      currentLine = '';
      lastY = null;
    } else {
      lastY = y;
    }
  }
  if (currentLine.trim()) lines.push({ y: lastY, text: currentLine.trim() });

  // Склеиваем переносы строк внутри абзацев, сохраняя разрывы абзацев
  const paragraphs = [];
  let para = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : null;
    const yGap = (prev && prev.y !== null && line.y !== null) ? Math.abs(prev.y - line.y) : 0;

    // Большой вертикальный отступ или строка после конца предложения -> новый абзац
    const startsNewPara =
      (yGap > 20) ||
      (para && /[.!?…»”"]$/.test(para) && /^[A-ZА-ЯЁ"“«—-]/.test(line.text) && line.text.length > 0 && yGap > 14);

    if (startsNewPara && para) {
      paragraphs.push(para.trim());
      para = line.text;
    } else if (para.endsWith('-') && /^[a-zа-яё]/i.test(line.text)) {
      para = para.slice(0, -1) + line.text;
    } else {
      para = para ? `${para} ${line.text}` : line.text;
    }
  }
  if (para.trim()) paragraphs.push(para.trim());
  return paragraphs.join('\n\n');
}

/**
 * Простой встроенный резервный парсер текстовых потоков PDF (FlateDecode / несжатых)
 * на случай, если пользователь ещё не скопировал lib/pdf.mjs из claudeproject.rar.
 */
async function fallbackExtractPdfText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const latin1 = new TextDecoder('latin1').decode(bytes);
  const extractedChunks = [];

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;

  while ((match = streamRegex.exec(latin1)) !== null) {
    const rawStr = match[1];
    const rawBytes = new Uint8Array(rawStr.length);
    for (let i = 0; i < rawStr.length; i++) rawBytes[i] = rawStr.charCodeAt(i) & 0xff;

    let decodedText = rawStr;
    // Если поток сжат zlib (0x78), распаковываем через DecompressionStream('deflate')
    if (rawBytes.length > 2 && rawBytes[0] === 0x78) {
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        const wp = writer.write(rawBytes).then(() => writer.close());
        const reader = ds.readable.getReader();
        const parts = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
        }
        await wp;
        const total = parts.reduce((acc, p) => acc + p.length, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const p of parts) { merged.set(p, off); off += p.length; }
        decodedText = new TextDecoder('latin1').decode(merged);
      } catch (_) {
        continue;
      }
    }

    // Ищем текстовые операторы Tj / TJ внутри блоков BT...ET
    const btMatches = decodedText.match(/BT[\s\S]*?ET/g);
    if (!btMatches) continue;
    const pageParts = [];
    for (const block of btMatches) {
      const literalRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
      let lm;
      let line = '';
      while ((lm = literalRegex.exec(block)) !== null) {
        const clean = lm[1]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '')
          .replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\');
        line += clean;
      }
      if (line.trim()) pageParts.push(line.trim());
    }
    const joined = pageParts.join(' ').replace(/\s+/g, ' ').trim();
    if (joined.length > 20) extractedChunks.push(joined);
  }

  return extractedChunks;
}

/**
 * Парсит PDF в список «глав/секций» (группируя по страницам или по найденным заголовкам).
 */
export async function parsePdf(arrayBuffer, fileName = 'book.pdf', onProgress = null) {
  const title = fileName.replace(/\.pdf$/i, '');
  const pdfjs = await tryLoadPdfJs();

  if (pdfjs) {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;
    const pages = [];

    for (let p = 1; p <= totalPages; p++) {
      const page = await pdfDoc.getPage(p);
      const tc = await page.getTextContent();
      const text = reconstructPageText(tc.items);
      if (text.trim()) {
        pages.push({ pageNum: p, text });
      }
      if (onProgress) onProgress(p, totalPages);
    }

    if (pages.length === 0) {
      throw new Error('В PDF не найден текстовый слой (возможно, это скан из картинок).');
    }

    // Группируем страницы в главы/разделы (по 5 страниц или по заголовку Chapter/Глава)
    const chapters = [];
    let current = null;

    for (const pg of pages) {
      const firstLine = pg.text.split('\n')[0].trim();
      const looksLikeChapter = /^(chapter|part|prologue|epilogue|глава|часть)\b/i.test(firstLine) && firstLine.length < 100;

      if (!current || looksLikeChapter || current.pages.length >= 5) {
        if (current) chapters.push(current);
        current = {
          index: chapters.length + 1,
          title: looksLikeChapter ? firstLine : `Страницы ${pg.pageNum}`,
          startPage: pg.pageNum,
          endPage: pg.pageNum,
          pages: [pg.pageNum],
          text: pg.text
        };
      } else {
        current.endPage = pg.pageNum;
        current.pages.push(pg.pageNum);
        current.text += '\n\n' + pg.text;
        if (!/^(chapter|part|prologue|epilogue|глава|часть)\b/i.test(current.title)) {
          current.title = `Страницы ${current.startPage}–${current.endPage}`;
        }
      }
    }
    if (current) chapters.push(current);

    return {
      format: 'pdf',
      engine: 'pdfjs',
      title,
      author: '',
      totalPages,
      chapters
    };
  }

  // Резервный режим без lib/pdf.mjs
  const rawChunks = await fallbackExtractPdfText(arrayBuffer);
  if (rawChunks.length === 0) {
    throw new Error(
      'Не найден lib/pdf.mjs (PDF.js), а встроенный парсер не смог прочитать этот PDF (шрифты/кодировка). ' +
      'Скопируйте папку lib/ (pdf.mjs и pdf.worker.mjs) из вашего claudeproject.rar или запустите download_pdfjs.bat.'
    );
  }

  const chapters = rawChunks.map((text, idx) => ({
    index: idx + 1,
    title: `Секция ${idx + 1}`,
    text
  }));

  return {
    format: 'pdf',
    engine: 'fallback',
    title,
    author: '',
    totalPages: rawChunks.length,
    chapters
  };
}
