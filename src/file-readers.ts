/**
 * File reader utilities for the ConvoCore MCP server.
 *
 * COLD-START RULE: this module must NOT statically import any heavy
 * dependency. `sharp`, `pdf-parse`, `mammoth`, and `xlsx` are all loaded
 * via dynamic `import()` INSIDE the function that needs them, so the MCP
 * server boots in <100ms and only pays the parse cost the first time a
 * given file type is actually read.
 *
 * Only `node:fs/promises`, `node:path`, `node:url`, and `mime-types`
 * (≈10KB pure JS) are eagerly imported.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import mime from 'mime-types';

// ============================================================================
// CONFIG
// ============================================================================

/** 25 MB hard cap on any single file load (local or remote). */
const MAX_BYTES = Number(process.env.CONVOCORE_FILE_MAX_BYTES || 25 * 1024 * 1024);

/** Network timeout for url-mode downloads. */
const URL_TIMEOUT_MS = Number(process.env.CONVOCORE_FILE_URL_TIMEOUT_MS || 30_000);

/** Per-call token budget for read tools — used to refuse oversized reads. */
const MAX_TOKENS_PER_CALL = Number(process.env.CONVOCORE_FILE_MAX_TOKENS || 30_000);

/**
 * Image normalization defaults (sharp). Keeps payloads under Anthropic's
 * comfortable per-image budget and avoids the "MCP image returned as text"
 * token-waste bug in some clients.
 */
const IMAGE_MAX_DIMENSION = 2048;
const IMAGE_MAX_OUTPUT_BYTES = 1.5 * 1024 * 1024;

// ============================================================================
// TYPES
// ============================================================================

export type FileSource = {
  path?: string;
  url?: string;
  data?: string; // base64
  mimeType?: string;
};

export type FileKind =
  | 'text'
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'spreadsheet'
  | 'csv'
  | 'image'
  | 'json'
  | 'markdown'
  | 'html'
  | 'unknown';

export type LoadedFile = {
  bytes: Buffer;
  mimeType: string;
  kind: FileKind;
  /** Display name (basename of path/url, or "inline-base64"). */
  name: string;
  /** Origin descriptor for error messages. */
  origin: string;
};

// ============================================================================
// SOURCE RESOLUTION  (path | url | base64)
// ============================================================================

/** Approx token estimate — chars/4 is the standard cheap heuristic. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function ensureExactlyOneSource(src: FileSource): void {
  const provided = [src.path, src.url, src.data].filter(
    (v) => typeof v === 'string' && v.length > 0,
  ).length;
  if (provided !== 1) {
    throw new Error(
      'File source must specify exactly ONE of: path, url, or data (base64). ' +
        `Got ${provided}.`,
    );
  }
}

/** Resolve a `file://` or local path safely. Rejects path traversal. */
function resolveLocalPath(p: string): string {
  let resolved = p;
  if (p.startsWith('file://')) {
    resolved = fileURLToPath(p);
  }
  resolved = path.resolve(resolved);

  // Optional sandbox roots, comma-separated absolute paths.
  const rootsEnv = process.env.CONVOCORE_FILE_ROOTS;
  if (rootsEnv) {
    const roots = rootsEnv
      .split(',')
      .map((r) => path.resolve(r.trim()))
      .filter(Boolean);
    const allowed = roots.some((root) => {
      const rel = path.relative(root, resolved);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
    if (!allowed) {
      throw new Error(
        `Path is outside the allowed CONVOCORE_FILE_ROOTS sandbox: ${resolved}`,
      );
    }
  }
  return resolved;
}

function detectKind(mimeType: string, name: string): FileKind {
  const mt = (mimeType || '').toLowerCase();
  const ext = path.extname(name).toLowerCase();

  if (mt.startsWith('image/')) return 'image';
  if (mt === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (
    mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.docx'
  ) return 'docx';
  if (mt === 'application/msword' || ext === '.doc') return 'doc';
  if (
    mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mt === 'application/vnd.ms-excel' ||
    ext === '.xlsx' || ext === '.xlsm' || ext === '.xls' || ext === '.xltx' || ext === '.xltm'
  ) return 'spreadsheet';
  if (mt === 'text/csv' || ext === '.csv' || ext === '.tsv') return 'csv';
  if (mt === 'application/json' || ext === '.json') return 'json';
  if (mt === 'text/markdown' || ext === '.md' || ext === '.markdown') return 'markdown';
  if (mt === 'text/html' || ext === '.html' || ext === '.htm') return 'html';
  if (mt.startsWith('text/') || ['.txt', '.log', '.yaml', '.yml', '.xml', '.ini', '.toml', '.env'].includes(ext))
    return 'text';
  return 'unknown';
}

/** Loads bytes from any of the three source modes, with size + safety caps. */
export async function loadFile(src: FileSource): Promise<LoadedFile> {
  ensureExactlyOneSource(src);

  let bytes: Buffer;
  let name: string;
  let origin: string;
  let mimeFromSource: string | undefined = src.mimeType;

  if (src.path) {
    const resolved = resolveLocalPath(src.path);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error(`Not a regular file: ${resolved}`);
    if (stat.size > MAX_BYTES) {
      throw new Error(
        `File too large: ${stat.size} bytes (cap ${MAX_BYTES}). ` +
          `Override with CONVOCORE_FILE_MAX_BYTES.`,
      );
    }
    bytes = await fs.readFile(resolved);
    name = path.basename(resolved);
    origin = resolved;
  } else if (src.url) {
    const u = src.url;
    if (!/^https?:\/\//i.test(u)) {
      throw new Error('Only http(s) URLs are supported.');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), URL_TIMEOUT_MS);
    try {
      const res = await fetch(u, { signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText} for ${u}`);
      }
      const lenHeader = res.headers.get('content-length');
      if (lenHeader && Number(lenHeader) > MAX_BYTES) {
        throw new Error(
          `Remote file too large per Content-Length: ${lenHeader} bytes (cap ${MAX_BYTES}).`,
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        throw new Error(
          `Remote file too large after download: ${buf.byteLength} bytes (cap ${MAX_BYTES}).`,
        );
      }
      bytes = buf;
      mimeFromSource = mimeFromSource || res.headers.get('content-type') || undefined;
      name = decodeURIComponent(new URL(u).pathname.split('/').pop() || 'download');
      origin = u;
    } finally {
      clearTimeout(timer);
    }
  } else {
    // base64 data
    const raw = (src.data || '').replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (buf.byteLength === 0) throw new Error('Empty base64 data.');
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(
        `Inline base64 too large: ${buf.byteLength} bytes (cap ${MAX_BYTES}).`,
      );
    }
    bytes = buf;
    name = 'inline-base64';
    origin = `inline:${buf.byteLength}b`;
  }

  const mimeType =
    mimeFromSource?.split(';')[0]?.trim() ||
    (mime.lookup(name) as string | false) ||
    'application/octet-stream';
  const kind = detectKind(mimeType, name);

  return { bytes, mimeType, kind, name, origin };
}

// ============================================================================
// INSPECT  (cheap probe, no heavy parsing)
// ============================================================================

export type InspectResult = {
  origin: string;
  name: string;
  kind: FileKind;
  mimeType: string;
  sizeBytes: number;
  pageCount?: number;
  sheetNames?: string[];
  lineCount?: number;
  estimatedTokens?: number;
  imageDimensions?: { width: number; height: number };
};

export async function inspectFile(src: FileSource): Promise<InspectResult> {
  const file = await loadFile(src);
  const out: InspectResult = {
    origin: file.origin,
    name: file.name,
    kind: file.kind,
    mimeType: file.mimeType,
    sizeBytes: file.bytes.byteLength,
  };

  switch (file.kind) {
    case 'pdf': {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(file.bytes) });
      try {
        const parsed = await parser.getText();
        out.pageCount = parsed.total;
        out.estimatedTokens = estimateTokens(parsed.text || '');
      } finally {
        await parser.destroy();
      }
      break;
    }
    case 'docx': {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: file.bytes });
      out.estimatedTokens = estimateTokens(value);
      out.lineCount = value.split(/\r?\n/).length;
      break;
    }
    case 'spreadsheet': {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(file.bytes, { type: 'buffer' });
      out.sheetNames = wb.SheetNames;
      break;
    }
    case 'csv':
    case 'text':
    case 'markdown':
    case 'html':
    case 'json': {
      const text = file.bytes.toString('utf8');
      out.lineCount = text.split(/\r?\n/).length;
      out.estimatedTokens = estimateTokens(text);
      break;
    }
    case 'image': {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(file.bytes).metadata();
      if (meta.width && meta.height) {
        out.imageDimensions = { width: meta.width, height: meta.height };
      }
      break;
    }
    default:
      break;
  }
  return out;
}

// ============================================================================
// TEXT FILES
// ============================================================================

export type TextReadResult = {
  text: string;
  truncated: boolean;
  totalBytes: number;
  estimatedTokens: number;
};

export async function readTextFile(
  src: FileSource,
  maxBytes?: number,
): Promise<TextReadResult> {
  const file = await loadFile(src);
  const cap = Math.min(maxBytes ?? MAX_BYTES, MAX_BYTES);
  const slice = file.bytes.subarray(0, cap);
  const text = slice.toString('utf8');
  return {
    text,
    truncated: file.bytes.byteLength > slice.byteLength,
    totalBytes: file.bytes.byteLength,
    estimatedTokens: estimateTokens(text),
  };
}

// ============================================================================
// PDF
// ============================================================================

export type PdfReadResult = {
  text: string;
  totalPages: number;
  pagesReturned: number[];
  truncated: boolean;
  estimatedTokens: number;
  info?: Record<string, unknown>;
};

/** Parse a "1-3,5,7-9" range string into a unique sorted page array. */
export function parsePageRange(spec: string | undefined, total: number): number[] {
  if (!spec) return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set<number>();
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Math.max(1, parseInt(m[1], 10));
      const b = Math.min(total, parseInt(m[2], 10));
      for (let i = a; i <= b; i++) out.add(i);
    } else {
      const n = parseInt(part, 10);
      if (Number.isFinite(n) && n >= 1 && n <= total) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export async function readPdf(
  src: FileSource,
  pages?: string | number[],
): Promise<PdfReadResult> {
  const file = await loadFile(src);
  if (file.kind !== 'pdf') {
    throw new Error(`Expected a PDF, got kind=${file.kind} (${file.mimeType}).`);
  }
  const { PDFParse } = await import('pdf-parse');
  // pdf-parse v2 — class-based API. Buffer must be passed as Uint8Array.
  const parser = new PDFParse({ data: new Uint8Array(file.bytes) });
  let info: Record<string, unknown> | undefined;
  try {
    // First lightweight call: learn total page count so we can resolve a string range.
    const probe = await parser.getInfo();
    const totalPages = probe.total || 0;

    let pageList: number[];
    if (Array.isArray(pages)) {
      pageList = pages.filter((n) => n >= 1 && n <= totalPages);
    } else {
      pageList = parsePageRange(pages, totalPages);
    }
    if (pageList.length === 0) {
      pageList = Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    // Second call: only extract the pages we actually want.
    const parsed = await parser.getText({ partial: pageList });
    const byNum = new Map<number, string>();
    for (const p of parsed.pages) byNum.set(p.num, p.text);

    info = (probe.info as Record<string, unknown> | undefined) || undefined;

    const chunks = pageList.map((p) => `--- page ${p} ---\n${byNum.get(p) || ''}`);
    let text = chunks.join('\n\n');

    let truncated = false;
    const estTokens = estimateTokens(text);
    if (estTokens > MAX_TOKENS_PER_CALL) {
      const ratio = MAX_TOKENS_PER_CALL / estTokens;
      text = text.slice(0, Math.floor(text.length * ratio));
      truncated = true;
    }

    return {
      text,
      totalPages,
      pagesReturned: pageList,
      truncated,
      estimatedTokens: estimateTokens(text),
      info,
    };
  } finally {
    await parser.destroy();
  }
}

// ============================================================================
// DOCX
// ============================================================================

export type DocxReadResult = {
  text: string;
  format: 'text' | 'markdown' | 'html';
  truncated: boolean;
  estimatedTokens: number;
  warnings: string[];
};

export async function readDocx(
  src: FileSource,
  asMarkdown: boolean = false,
): Promise<DocxReadResult> {
  const file = await loadFile(src);
  if (file.kind !== 'docx') {
    throw new Error(
      `Expected a .docx, got kind=${file.kind} (${file.mimeType}). ` +
        `Legacy .doc is not supported — convert to .docx first.`,
    );
  }
  const mammoth = await import('mammoth');
  let text: string;
  let warnings: string[] = [];
  let format: 'text' | 'markdown' | 'html';
  if (asMarkdown) {
    const { value, messages } = await mammoth.convertToHtml({ buffer: file.bytes });
    text = htmlToMarkdown(value);
    warnings = messages.map((m: any) => m.message);
    format = 'markdown';
  } else {
    const { value, messages } = await mammoth.extractRawText({ buffer: file.bytes });
    text = value;
    warnings = messages.map((m: any) => m.message);
    format = 'text';
  }

  let truncated = false;
  if (estimateTokens(text) > MAX_TOKENS_PER_CALL) {
    const ratio = MAX_TOKENS_PER_CALL / estimateTokens(text);
    text = text.slice(0, Math.floor(text.length * ratio));
    truncated = true;
  }

  return { text, format, truncated, estimatedTokens: estimateTokens(text), warnings };
}

/** Tiny HTML → Markdown shim — good enough for headings/lists/links/code. */
function htmlToMarkdown(html: string): string {
  let out = html;
  out = out.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
  out = out.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
  out = out.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
  out = out.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
  out = out.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  out = out.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  out = out.replace(/<em[^>]*>(.*?)<\/em>/gi, '_$1_');
  out = out.replace(/<i[^>]*>(.*?)<\/i>/gi, '_$1_');
  out = out.replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  out = out.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  out = out.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  out = out.replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<[^>]+>/g, '');
  out = out.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================================================
// SPREADSHEETS
// ============================================================================

export type SpreadsheetReadResult = {
  sheetNames: string[];
  /** Present when a specific sheet was requested. */
  sheet?: {
    name: string;
    format: 'json' | 'csv' | 'markdown';
    rows?: any[][] | Record<string, any>[];
    csv?: string;
    markdown?: string;
    rowCount: number;
    columnCount: number;
    truncated: boolean;
  };
  estimatedTokens: number;
};

export async function readSpreadsheet(
  src: FileSource,
  opts: {
    sheet?: string | number;
    range?: string;
    format?: 'json' | 'csv' | 'markdown';
    headerRow?: boolean;
    maxRows?: number;
  } = {},
): Promise<SpreadsheetReadResult> {
  const file = await loadFile(src);
  if (file.kind !== 'spreadsheet' && file.kind !== 'csv') {
    throw new Error(`Expected a spreadsheet/csv, got kind=${file.kind} (${file.mimeType}).`);
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(file.bytes, { type: 'buffer' });

  const result: SpreadsheetReadResult = {
    sheetNames: wb.SheetNames,
    estimatedTokens: 0,
  };

  if (opts.sheet === undefined || opts.sheet === null || opts.sheet === '') {
    return result;
  }

  const sheetName =
    typeof opts.sheet === 'number' ? wb.SheetNames[opts.sheet] : (opts.sheet as string);
  if (!sheetName || !wb.Sheets[sheetName]) {
    throw new Error(
      `Sheet not found: ${opts.sheet}. Available: ${wb.SheetNames.join(', ')}`,
    );
  }
  const ws = wb.Sheets[sheetName];

  // Apply optional A1-style range
  let workingSheet = ws;
  if (opts.range) {
    const sliced = XLSX.utils.sheet_to_json<any[]>(ws, {
      header: 1,
      range: opts.range,
      blankrows: false,
      defval: null,
    });
    // Build a synthetic worksheet from the sliced rows for downstream conversion
    workingSheet = XLSX.utils.aoa_to_sheet(sliced);
  }

  const format = opts.format || 'markdown';
  const maxRows = Math.max(1, opts.maxRows ?? 1000);

  const rows2d = XLSX.utils.sheet_to_json<any[]>(workingSheet, {
    header: 1,
    blankrows: false,
    defval: null,
  });
  const truncated = rows2d.length > maxRows;
  const trimmed = rows2d.slice(0, maxRows);
  const colCount = trimmed.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);

  const sheetOut: NonNullable<SpreadsheetReadResult['sheet']> = {
    name: sheetName,
    format,
    rowCount: trimmed.length,
    columnCount: colCount,
    truncated,
  };

  let textForTokens = '';
  if (format === 'json') {
    if (opts.headerRow ?? true) {
      const headers = (trimmed[0] || []).map((h, i) => String(h ?? `col_${i + 1}`));
      const objects = trimmed.slice(1).map((row) => {
        const obj: Record<string, any> = {};
        headers.forEach((h, i) => (obj[h] = row?.[i] ?? null));
        return obj;
      });
      sheetOut.rows = objects;
      textForTokens = JSON.stringify(objects);
    } else {
      sheetOut.rows = trimmed;
      textForTokens = JSON.stringify(trimmed);
    }
  } else if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(workingSheet);
    sheetOut.csv = truncated ? csv.split(/\r?\n/).slice(0, maxRows).join('\n') : csv;
    textForTokens = sheetOut.csv;
  } else {
    sheetOut.markdown = sheetToMarkdown(trimmed);
    textForTokens = sheetOut.markdown;
  }

  result.sheet = sheetOut;
  result.estimatedTokens = estimateTokens(textForTokens);
  return result;
}

function sheetToMarkdown(rows: any[][]): string {
  if (rows.length === 0) return '';
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const norm = rows.map((r) => {
    const padded = [...r];
    while (padded.length < cols) padded.push('');
    return padded.map((c) => (c == null ? '' : String(c).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')));
  });
  const head = norm[0];
  const sep = head.map(() => '---');
  const body = norm.slice(1);
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

// ============================================================================
// IMAGES  (returns MCP-compatible base64 + mimeType)
// ============================================================================

export type ImageReadResult = {
  base64: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  sizeBytes: number;
  /** True if we re-encoded / downscaled the original. */
  normalized: boolean;
};

/**
 * Loads an image and normalizes it to a Claude-vision-safe format.
 * - SVG / TIFF / BMP / HEIC → rasterized to PNG
 * - Anything > IMAGE_MAX_DIMENSION → downscaled
 * - Anything > IMAGE_MAX_OUTPUT_BYTES → re-encoded as JPEG q80
 */
export async function readImage(
  src: FileSource,
  opts: { maxDimension?: number } = {},
): Promise<ImageReadResult> {
  const file = await loadFile(src);
  if (file.kind !== 'image') {
    throw new Error(`Expected an image, got kind=${file.kind} (${file.mimeType}).`);
  }
  const sharp = (await import('sharp')).default;

  const maxDim = Math.max(64, Math.min(opts.maxDimension ?? IMAGE_MAX_DIMENSION, 4096));
  const inputMeta = await sharp(file.bytes).metadata();

  // Anthropic vision supports png/jpeg/gif/webp. We prefer PNG, fall back to JPEG for size.
  const needsResize = (inputMeta.width || 0) > maxDim || (inputMeta.height || 0) > maxDim;
  const isSafeMime =
    file.mimeType === 'image/png' ||
    file.mimeType === 'image/jpeg' ||
    file.mimeType === 'image/webp';
  const needsTranscode = !isSafeMime || needsResize;

  let outBuf: Buffer;
  let outMime: ImageReadResult['mimeType'];

  if (!needsTranscode && file.bytes.byteLength <= IMAGE_MAX_OUTPUT_BYTES) {
    outBuf = file.bytes;
    outMime = file.mimeType as ImageReadResult['mimeType'];
  } else {
    let pipeline = sharp(file.bytes, { failOn: 'none' });
    if (needsResize) {
      pipeline = pipeline.resize({
        width: maxDim,
        height: maxDim,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    let png = await pipeline.clone().png({ compressionLevel: 9 }).toBuffer();
    if (png.byteLength > IMAGE_MAX_OUTPUT_BYTES) {
      png = await pipeline.clone().jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      outMime = 'image/jpeg';
    } else {
      outMime = 'image/png';
    }
    outBuf = png;
  }

  const finalMeta = await sharp(outBuf).metadata();

  return {
    base64: outBuf.toString('base64'),
    mimeType: outMime,
    width: finalMeta.width || inputMeta.width || 0,
    height: finalMeta.height || inputMeta.height || 0,
    sizeBytes: outBuf.byteLength,
    normalized: needsTranscode || outBuf !== file.bytes,
  };
}

// ============================================================================
// HIGH-LEVEL: extract any file to text/markdown for KB ingestion
// ============================================================================

export type ExtractedDoc = {
  name: string;
  origin: string;
  kind: FileKind;
  mimeType: string;
  text: string;
  estimatedTokens: number;
  truncated: boolean;
  meta: Record<string, unknown>;
};

export async function extractToText(
  src: FileSource,
  opts: {
    pages?: string | number[];
    sheet?: string | number;
    asMarkdown?: boolean;
  } = {},
): Promise<ExtractedDoc> {
  const file = await loadFile(src);
  const meta: Record<string, unknown> = {};
  let text = '';
  let truncated = false;

  switch (file.kind) {
    case 'pdf': {
      const r = await readPdf(src, opts.pages);
      text = r.text;
      truncated = r.truncated;
      meta.totalPages = r.totalPages;
      meta.pagesReturned = r.pagesReturned;
      break;
    }
    case 'docx': {
      const r = await readDocx(src, opts.asMarkdown ?? true);
      text = r.text;
      truncated = r.truncated;
      meta.format = r.format;
      meta.warnings = r.warnings;
      break;
    }
    case 'spreadsheet':
    case 'csv': {
      const r = await readSpreadsheet(src, {
        sheet: opts.sheet ?? 0,
        format: opts.asMarkdown === false ? 'csv' : 'markdown',
        maxRows: 5000,
      });
      const sheet = r.sheet!;
      text = sheet.markdown ?? sheet.csv ?? JSON.stringify(sheet.rows ?? []);
      truncated = sheet.truncated;
      meta.sheetNames = r.sheetNames;
      meta.sheet = sheet.name;
      break;
    }
    case 'image': {
      throw new Error(
        'Cannot extract text from an image without OCR. Use the read_image tool for vision-capable models.',
      );
    }
    case 'doc': {
      throw new Error('Legacy .doc is not supported. Convert to .docx first.');
    }
    default: {
      const r = await readTextFile(src);
      text = r.text;
      truncated = r.truncated;
      break;
    }
  }

  return {
    name: file.name,
    origin: file.origin,
    kind: file.kind,
    mimeType: file.mimeType,
    text,
    estimatedTokens: estimateTokens(text),
    truncated,
    meta,
  };
}
