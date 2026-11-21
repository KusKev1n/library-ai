// lib/epub.js — Парсер EPUB (с извлечением обложки!), сборщик переведённого EPUB и экспорт в HTML/TXT/Print-PDF

import { unzipBytes, zipEntries } from './zip.js';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

function resolvePath(baseDir, relativePath) {
  const cleanRel = decodeURIComponent(relativePath.split('#')[0]);
  if (!baseDir) return cleanRel.replace(/^\/+/, '');
  const parts = (baseDir + '/' + cleanRel).split('/');
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTagText(doc, localNames) {
  for (const name of localNames) {
    const els = doc.getElementsByTagName(name);
    if (els.length > 0 && els[0].textContent.trim()) return els[0].textContent.trim();
    const nsEls = doc.getElementsByTagNameNS('*', name);
    if (nsEls.length > 0 && nsEls[0].textContent.trim()) return nsEls[0].textContent.trim();
  }
  return '';
}

function bytesToDataUrl(bytes, mime = 'image/jpeg') {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Сжимает обложку EPUB до аккуратной миниатюры (~260px) для быстрого отображения в библиотеке.
 */
async function createCoverThumbnail(rawBytes, mediaType) {
  try {
    const blob = new Blob([rawBytes], { type: mediaType || 'image/jpeg' });
    const bmp = await createImageBitmap(blob);
    const maxW = 280;
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (_) {
    if (rawBytes.length <= 220000) return bytesToDataUrl(rawBytes, mediaType || 'image/jpeg');
    return '';
  }
}

async function compressChapterImage(rawBytes, mediaType) {
  try {
    const blob = new Blob([rawBytes], { type: mediaType || 'image/jpeg' });
    const bmp = await createImageBitmap(blob);
    const maxW = 920;
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const outMime = /png|webp|gif/i.test(mediaType || '') && rawBytes.length < 350000 ? 'image/png' : 'image/jpeg';
    return canvas.toDataURL(outMime, 0.85);
  } catch (_) {
    if (rawBytes.length <= 450000) return bytesToDataUrl(rawBytes, mediaType || 'image/jpeg');
    return '';
  }
}

function guessImageMime(path) {
  const lower = (path || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

function extractBlocksFromXhtml(xhtmlText) {
  const parser = new DOMParser();
  let doc = parser.parseFromString(xhtmlText, 'application/xhtml+xml');
  if (doc.querySelector('parsererror')) {
    doc = parser.parseFromString(xhtmlText, 'text/html');
  }
  const body = doc.body || doc.documentElement;
  if (!body) return { title: '', paragraphs: [] };

  let title = '';
  const headingEl = body.querySelector('h1, h2, h3');
  if (headingEl) title = headingEl.textContent.replace(/\s+/g, ' ').trim();
  if (!title) {
    const docTitle = doc.querySelector('title');
    if (docTitle) title = docTitle.textContent.replace(/\s+/g, ' ').trim();
  }

  const blockSelector = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre';
  const nodes = Array.from(body.querySelectorAll(blockSelector)).filter((el) => {
    const parentBlock = el.parentElement ? el.parentElement.closest(blockSelector) : null;
    return !parentBlock;
  });

  const paragraphs = [];
  for (const node of nodes) {
    const text = node.textContent.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    const tag = node.tagName.toLowerCase();
    paragraphs.push({ tag, isHeading: /^h[1-6]$/.test(tag), text });
  }

  if (paragraphs.length === 0) {
    const raw = (body.textContent || '').replace(/\r\n/g, '\n');
    for (const line of raw.split(/\n{2,}/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      paragraphs.push({ tag: 'p', isHeading: false, text: line });
    }
  }

  // Извлекаем изображения главы и их позицию относительно абзацев
  const rawImages = [];
  const allImgNodes = Array.from(body.querySelectorAll('img, image'));
  let seenBlocks = 0;
  const blockSet = new Set(nodes);
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  let curEl = walker.nextNode();
  while (curEl) {
    if (blockSet.has(curEl)) {
      const txt = curEl.textContent.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
      if (txt) seenBlocks++;
    }
    const lname = curEl.localName ? curEl.localName.toLowerCase() : curEl.tagName.toLowerCase();
    if (lname === 'img' || lname === 'image') {
      const src = curEl.getAttribute('src')
        || curEl.getAttribute('href')
        || curEl.getAttribute('xlink:href')
        || curEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
        || '';
      if (src && !src.startsWith('data:image/svg')) {
        const alt = (curEl.getAttribute('alt') || '').trim();
        rawImages.push({ src, alt, afterParagraph: seenBlocks });
      }
    }
    curEl = walker.nextNode();
  }
  // Fallback if TreeWalker missed any (e.g. XML parser quirk)
  if (rawImages.length === 0 && allImgNodes.length > 0) {
    for (const imgEl of allImgNodes) {
      const src = imgEl.getAttribute('src') || imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href') || '';
      if (src) rawImages.push({ src, alt: (imgEl.getAttribute('alt') || '').trim(), afterParagraph: 0 });
    }
  }

  return { title, paragraphs, rawImages };
}

/**
 * Парсит EPUB, включая обложку, метаданные и все главы.
 */
export async function parseEpub(arrayBuffer, fallbackFileName = 'book.epub') {
  const files = await unzipBytes(arrayBuffer);
  const containerBytes = files.get('META-INF/container.xml');
  if (!containerBytes) throw new Error('В EPUB не найден META-INF/container.xml');

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(decoder.decode(containerBytes), 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath || !files.has(opfPath)) throw new Error('Не найден корневой OPF-файл внутри EPUB');

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opfDoc = parser.parseFromString(decoder.decode(files.get(opfPath)), 'application/xml');

  const bookTitle = getTagText(opfDoc, ['title', 'dc:title']) || fallbackFileName.replace(/\.epub$/i, '');
  const bookAuthor = getTagText(opfDoc, ['creator', 'dc:creator']) || '';

  const manifest = new Map();
  let coverItem = null;
  const coverMetaId = opfDoc.querySelector('meta[name="cover"]')?.getAttribute('content') || '';

  for (const item of Array.from(opfDoc.querySelectorAll('manifest > item, item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type') || '';
    const props = item.getAttribute('properties') || '';
    if (id && href) {
      const entry = { id, href, mediaType, fullPath: resolvePath(opfDir, href) };
      manifest.set(id, entry);
      if (props.includes('cover-image') || (coverMetaId && id === coverMetaId)) {
        coverItem = entry;
      } else if (!coverItem && /image\//i.test(mediaType) && /cover/i.test(id + href)) {
        coverItem = entry;
      }
    }
  }

  let coverDataUrl = '';
  if (coverItem && files.has(coverItem.fullPath)) {
    coverDataUrl = await createCoverThumbnail(files.get(coverItem.fullPath), coverItem.mediaType);
  }

  const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref, itemref'));
  const chapters = [];
  let idx = 0;

  for (const ref of spineRefs) {
    const entry = manifest.get(ref.getAttribute('idref'));
    if (!entry) continue;
    if (!/html|xml/i.test(entry.mediaType) && !/\.(xhtml|html|htm)$/i.test(entry.fullPath)) continue;
    const rawBytes = files.get(entry.fullPath);
    if (!rawBytes) continue;

    const xhtmlText = decoder.decode(rawBytes);
    const { title, paragraphs, rawImages } = extractBlocksFromXhtml(xhtmlText);
    if (paragraphs.length === 0) continue;

    // Разрешаем и сжимаем картинки этой главы (только для режима чтения)
    const chDir = entry.fullPath.includes('/') ? entry.fullPath.slice(0, entry.fullPath.lastIndexOf('/')) : '';
    const images = [];
    const totalP = Math.max(1, paragraphs.length);
    for (const ri of rawImages || []) {
      const imgPath = resolvePath(chDir, ri.src);
      let imgBytes = files.get(imgPath);
      if (!imgBytes) {
        // Иногда пути в EPUB различаются регистром
        const lowerTarget = imgPath.toLowerCase();
        for (const [k, v] of files.entries()) {
          if (k.toLowerCase() === lowerTarget) { imgBytes = v; break; }
        }
      }
      if (!imgBytes) continue;
      const mime = guessImageMime(imgPath);
      const dataUrl = await compressChapterImage(imgBytes, mime);
      if (!dataUrl) continue;
      // Если картинка идёт сразу после заголовка главы (0 или 1 текстовый блок, и первый блок — заголовок), ставим её сверху
      const isAfterOnlyHeading = ri.afterParagraph === 1 && paragraphs[0]?.isHeading;
      const isTop = ri.afterParagraph === 0 || isAfterOnlyHeading;
      const isBottom = !isTop && ri.afterParagraph >= totalP;
      images.push({
        dataUrl,
        alt: ri.alt || '',
        isTop,
        isBottom,
        ratio: Math.min(1, Math.max(0, ri.afterParagraph / totalP))
      });
    }

    idx++;
    chapters.push({
      index: idx,
      id: entry.id,
      filePath: entry.fullPath,
      title: title || `Глава ${idx}`,
      text: paragraphs.map((p) => p.text).join('\n\n'),
      paragraphs,
      images,
      originalXhtml: xhtmlText
    });
  }

  if (chapters.length === 0) throw new Error('Не удалось извлечь текстовые главы из EPUB.');

  return {
    format: 'epub',
    title: bookTitle,
    author: bookAuthor,
    coverDataUrl,
    opfPath,
    opfDir,
    files,
    chapters
  };
}

function buildTranslatedChapterXhtml(originalXhtml, translatedText, fallbackTitle) {
  const headMatch = originalXhtml ? originalXhtml.match(/<head[\s\S]*?<\/head>/i) : null;
  const headHtml = headMatch
    ? headMatch[0]
    : `<head><meta charset="utf-8"/><title>${escapeXml(fallbackTitle)}</title><style>body{font-family:Georgia,serif;line-height:1.65;margin:1.2em;}p{text-indent:1.2em;margin:0.45em 0;}h1,h2,h3{text-indent:0;margin:1em 0 0.6em;}</style></head>`;

  const cleanLines = translatedText
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const bodyParts = cleanLines.map((block, i) => {
    if (i === 0 && block.length < 120 && !/[.!?…]$/.test(block)) {
      return `  <h2>${escapeXml(block)}</h2>`;
    }
    return `  <p>${escapeXml(block).replace(/\n/g, '<br/>')}</p>`;
  });

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru" lang="ru">
${headHtml}
<body>
${bodyParts.join('\n')}
</body>
</html>`;
}

export async function rebuildTranslatedEpub(book, translatedChapters) {
  if (!book.files) {
    return buildFreshEpub(book.title, book.author, translatedChapters);
  }
  const updatedFiles = new Map(book.files);
  for (const ch of translatedChapters) {
    if (!ch.filePath) continue;
    const newXhtml = buildTranslatedChapterXhtml(ch.originalXhtml, ch.translatedText || ch.text, ch.title);
    updatedFiles.set(ch.filePath, encoder.encode(newXhtml));
  }
  if (book.opfPath && updatedFiles.has(book.opfPath)) {
    let opf = decoder.decode(updatedFiles.get(book.opfPath));
    opf = opf.replace(/<dc:language>[^<]*<\/dc:language>/i, '<dc:language>ru</dc:language>');
    updatedFiles.set(book.opfPath, encoder.encode(opf));
  }

  const entries = [{ name: 'mimetype', data: encoder.encode('application/epub+zip'), store: true }];
  for (const [name, data] of updatedFiles.entries()) {
    if (name !== 'mimetype') entries.push({ name, data, store: false });
  }
  const zipData = await zipEntries(entries);
  return new Blob([zipData], { type: 'application/epub+zip' });
}

export async function buildFreshEpub(title, author, chapters) {
  const safeTitle = escapeXml(title || 'Переведённая книга');
  const safeAuthor = escapeXml(author || 'Novel AI Translator');
  const bookId = 'urn:uuid:' + crypto.randomUUID();

  const entries = [
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    },
    {
      name: 'OEBPS/style.css',
      data: `body{font-family:Georgia,serif;line-height:1.65;margin:1.2em;color:#1f1f1f;}h1,h2{text-align:center;margin:1.2em 0 0.8em;}p{text-indent:1.3em;margin:0.4em 0;text-align:justify;}`
    }
  ];

  const manifestItems = [
    '    <item id="css" href="style.css" media-type="text/css"/>',
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
  ];
  const spineItems = [];
  const navLinks = [];

  chapters.forEach((ch, idx) => {
    const num = idx + 1;
    const fname = `chapter_${String(num).padStart(4, '0')}.xhtml`;
    const chTitle = ch.translatedTitle || ch.title || `Раздел ${num}`;
    const paragraphs = (ch.translatedText || ch.text || '')
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean)
      .map((b) => `  <p>${escapeXml(b).replace(/\n/g, '<br/>')}</p>`)
      .join('\n');

    entries.push({
      name: `OEBPS/${fname}`,
      data: `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru" lang="ru"><head><meta charset="utf-8"/><title>${escapeXml(chTitle)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h2>${escapeXml(chTitle)}</h2>\n${paragraphs}\n</body></html>`
    });
    manifestItems.push(`    <item id="ch${num}" href="${fname}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`    <itemref idref="ch${num}"/>`);
    navLinks.push(`      <li><a href="${fname}">${escapeXml(chTitle)}</a></li>`);
  });

  entries.push({
    name: 'OEBPS/nav.xhtml',
    data: `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ru" lang="ru"><head><meta charset="utf-8"/><title>Содержание</title></head><body><nav epub:type="toc" id="toc"><h1>Содержание</h1><ol>\n${navLinks.join('\n')}\n</ol></nav></body></html>`
  });

  entries.push({
    name: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="BookId">${bookId}</dc:identifier><dc:title>${safeTitle}</dc:title><dc:creator>${safeAuthor}</dc:creator><dc:language>ru</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest>\n${manifestItems.join('\n')}\n</manifest><spine>\n${spineItems.join('\n')}\n</spine></package>`
  });

  const zipData = await zipEntries(entries);
  return new Blob([zipData], { type: 'application/epub+zip' });
}

export function buildTranslatedHtml(title, author, chapters, autoPrint = false) {
  const safeTitle = escapeXml(title || 'Переведённая книга');
  const safeAuthor = escapeXml(author || '');
  const sections = chapters.map((ch, i) => {
    const chTitle = escapeXml(ch.translatedTitle || ch.title || `Глава ${i + 1}`);
    const body = (ch.translatedText || ch.text || '')
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean)
      .map((b) => `<p>${escapeXml(b).replace(/\n/g, '<br>')}</p>`)
      .join('\n');
    return `<section class="chapter"><h2>${chTitle}</h2>${body}</section>`;
  }).join('\n');

  const printScript = autoPrint ? '<script>window.onload=()=>setTimeout(()=>window.print(),400);</script>' : '';
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} (RU)</title><style>:root{color-scheme:light dark}body{max-width:740px;margin:0 auto;padding:40px 24px 80px;font-family:Georgia,serif;font-size:18px;line-height:1.72;background:#fbf9f4;color:#1f1c18}@media(prefers-color-scheme:dark){body{background:#1b1a19;color:#e6e2dc}}header{text-align:center;margin-bottom:3em;border-bottom:1px solid #d6d0c4;padding-bottom:1.5em}h1{font-size:2em;margin:0 0 .3em}.author{opacity:.72;font-style:italic}.chapter{margin-top:2.5em;page-break-before:always}.chapter:first-of-type{page-break-before:auto}h2{font-size:1.35em;text-align:center;margin:0 0 1em}p{text-indent:1.4em;margin:.55em 0;text-align:justify}@media print{body{background:#fff!important;color:#000!important;font-size:12pt;max-width:none;padding:0}@page{margin:18mm 16mm}}</style></head><body><header><h1>${safeTitle}</h1>${safeAuthor ? `<div class="author">${safeAuthor}</div>` : ''}</header>${sections}${printScript}</body></html>`;
}

export function buildTranslatedTxt(title, chapters) {
  const parts = [];
  if (title) parts.push(`${title}\n${'='.repeat(Math.min(title.length, 60))}\n`);
  for (const ch of chapters) parts.push(`\n### ${ch.translatedTitle || ch.title}\n\n${ch.translatedText || ch.text || ''}\n`);
  return parts.join('\n');
}
