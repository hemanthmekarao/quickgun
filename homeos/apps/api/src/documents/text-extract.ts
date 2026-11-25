import { Logger } from '@nestjs/common';
import { llmConfigured, transcribeImage } from '../assistant/llm';

const logger = new Logger('TextExtract');

export type OcrStatus = 'DONE' | 'NOT_SUPPORTED' | 'FAILED';

export const ALLOWED_MIME: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'image/heic': ['heic'],
  'text/plain': ['txt', 'log'],
  'text/csv': ['csv'],
  'text/markdown': ['md'],
  'message/rfc822': ['eml'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
};

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED_MIME).flatMap(([mime, exts]) => exts.map((e) => [e, mime])),
);

/** Resolve the stored content type from the file name; the client-supplied type is not trusted. */
export function resolveMime(fileName: string, declared?: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  if (declared && ALLOWED_MIME[declared] && !fileName.includes('.')) return declared;
  return null;
}

/** Cheap content sniffing to reject files whose bytes contradict their extension. */
export function contentMatches(mime: string, data: Buffer): boolean {
  const head = data.subarray(0, 12);
  switch (mime) {
    case 'application/pdf':
      return head.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/png':
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8;
    case 'image/gif':
      return head.subarray(0, 3).toString('latin1') === 'GIF';
    case 'image/webp':
      return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
    default:
      return true;
  }
}

/** Text layer of a PDF, page by page, using Mozilla's pdf.js (legacy CommonJS build for Node). */
export async function pdfText(data: Buffer, maxPages = 300): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(text.replace(/[ \t]+\n/g, '\n').trim());
    }
    return pages.join('\n\n').trim();
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/**
 * Extract searchable text from an uploaded file.
 * - Text formats: read directly.
 * - PDF: text layer only (scanned PDFs without a text layer yield nothing).
 * - Images: transcribed by the configured vision model; without one, reported as NOT_SUPPORTED.
 */
export async function extractText(data: Buffer, mime: string): Promise<{ text: string; status: OcrStatus }> {
  try {
    if (mime.startsWith('text/') || mime === 'message/rfc822') {
      return { text: data.toString('utf8').slice(0, 200_000), status: 'DONE' };
    }
    if (mime === 'application/pdf') {
      return { text: (await pdfText(data)).slice(0, 200_000), status: 'DONE' };
    }
    if (mime.startsWith('image/')) {
      if (!llmConfigured() || mime === 'image/heic') return { text: '', status: 'NOT_SUPPORTED' };
      const text = await transcribeImage(data, mime);
      if (text === null) return { text: '', status: 'FAILED' };
      return { text: text.slice(0, 200_000), status: 'DONE' };
    }
    return { text: '', status: 'NOT_SUPPORTED' };
  } catch (err) {
    logger.warn(`Text extraction failed: ${(err as Error).message}`);
    return { text: '', status: 'FAILED' };
  }
}
