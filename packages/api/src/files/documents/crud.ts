import axios from "axios";
import FormData from "form-data";
import * as fs from 'fs';
import yauzl from 'yauzl';
import { megabyte, excelMimeTypes, FileSources } from 'librechat-data-provider';
import { generateShortLivedToken } from '~/crypto/jwt';
import { logAxiosError } from '~/utils/axios';
import type { ServerRequest } from '~/types';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { MistralOCRUploadResult } from '~/types';
import { assertSafeZipSize } from './zipSafety';

type FileParseFn = (params: { req: ServerRequest; file: Express.Multer.File }) => Promise<string>;

const DOCUMENT_PARSER_MAX_FILE_SIZE = 15 * megabyte;
const ODT_MAX_DECOMPRESSED_SIZE = 50 * megabyte;

/**
 * Parses an uploaded document and extracts its text content and metadata.
 * Handled types must stay in sync with `documentParserMimeTypes` from data-provider.
 *
 * @throws {Error} if `file.mimetype` is not handled, file exceeds size limit, or no text is found.
 */
export async function parseDocument({
  req,
  file,
}: {
  req: ServerRequest;
  file: Express.Multer.File;
}): Promise<MistralOCRUploadResult> {
  const parseFn = getParserForMimeType(file.mimetype);
  if (!parseFn) {
    throw new Error(`Unsupported file type in document parser: ${file.mimetype}`);
  }

  const fileSize = file.size ?? (file.path != null ? (await fs.promises.stat(file.path)).size : 0);
  if (fileSize > DOCUMENT_PARSER_MAX_FILE_SIZE) {
    const limitMB = DOCUMENT_PARSER_MAX_FILE_SIZE / megabyte;
    const sizeMB = Math.ceil(fileSize / megabyte);
    throw new Error(
      `File "${file.originalname}" exceeds the ${limitMB}MB document parser limit (${sizeMB}MB).`,
    );
  }

  const text = await parseFn({ req, file });

  if (!text?.trim()) {
    throw new Error('No text found in document');
  }

  return {
    filename: file.originalname,
    bytes: Buffer.byteLength(text, 'utf8'),
    filepath: FileSources.document_parser,
    text,
    images: [],
  };
}

/** Maps a MIME type to its document parser function, or `undefined` if unsupported. */
function getParserForMimeType(mimetype: string): FileParseFn | undefined {
    if (mimetype === "application/msword" || mimetype === "application/vnd.ms-word") {
      return docToText;
    }
    if (mimetype === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || mimetype === "application/vnd.ms-powerpoint") {
      return pptToText;
    }
  if (mimetype === 'application/pdf') {
    return pdfToText;
  }
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return wordDocToText;
  }
  if (
    excelMimeTypes.test(mimetype) ||
    mimetype === 'application/vnd.oasis.opendocument.spreadsheet'
  ) {
    return excelSheetToText;
  }
  if (mimetype === 'application/vnd.oasis.opendocument.text') {
    return odtToText;
  }
  return undefined;
}

/** Parses PDF, returns text inside. */
async function pdfToText({ file }: { file: Express.Multer.File }): Promise<string> {
  // Imported inline so that Jest can test other routes without failing due to loading ESM
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(await fs.promises.readFile(file.path));
  const pdf = await getDocument({ data }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item): item is TextItem => !('type' in item))
      .map((item) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}

/** Parses Word document, returns text inside. */
async function wordDocToText({ file }: { file: Express.Multer.File }): Promise<string> {
  const buffer = await fs.promises.readFile(file.path);
  /* Reject zip-bomb DOCX before mammoth's internal extractor runs.
   * mammoth has no decompressed-size cap of its own; without this, a
   * sub-1MB compressed bomb (~200x ratio) would block the event loop
   * and spike RSS to ~1GB. See SEC review on PR #12934. */
  await assertSafeZipSize(buffer, { name: file.originalname ?? 'docx' });
  const { extractRawText } = await import('mammoth');
  const rawText = await extractRawText({ buffer });
  return rawText.value;
}

/** Parses Excel sheet, returns text inside. */
async function excelSheetToText({ file }: { file: Express.Multer.File }): Promise<string> {
  // xlsx CDN build (0.20.x) does not bind fs internally when dynamically imported;
  // readFile() fails with "Cannot access file". read() takes a pre-loaded Buffer instead.
  const { read, utils } = await import('xlsx');
  const data = await fs.promises.readFile(file.path);
  /* Reject zip-bomb XLSX/ODS before SheetJS's internal extractor runs.
   * `.xls` (BIFF/CFB) is not a ZIP — magic-byte check skips the
   * validator for it (yauzl would reject it as malformed anyway). */
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b) {
    await assertSafeZipSize(data, { name: file.originalname ?? 'spreadsheet' });
  }
  const workbook = read(data, { type: 'buffer' });

  let text = '';
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const worksheetAsCsvString = utils.sheet_to_csv(worksheet);
    text += `${sheetName}:\n${worksheetAsCsvString}\n`;
  }

  return text;
}

/**
 * Parses OpenDocument Text (.odt) by extracting the body text from content.xml.
 * Uses regex-based XML extraction scoped to <office:body>: paragraph/heading
 * boundaries become newlines, tab and spacing elements are preserved, and the
 * five standard XML entities are decoded. Complex elements such as frames,
 * text boxes, and annotations are stripped without replacement.
 */
async function odtToText({ file }: { file: Express.Multer.File }): Promise<string> {
  const xml = await extractOdtContentXml(file.path);
  const bodyMatch = xml.match(/<office:body[^>]*>([\s\S]*?)<\/office:body>/);
  if (!bodyMatch) {
    return '';
  }
  return bodyMatch[1]
    .replace(/<\/text:p>/g, '\n')
    .replace(/<\/text:h>/g, '\n')
    .replace(/<text:line-break\/>/g, '\n')
    .replace(/<text:tab\/>/g, '\t')
    .replace(/<text:s[^>]*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Streams content.xml out of an ODT ZIP archive using yauzl, counting real
 * decompressed bytes and aborting mid-inflate if the cap is exceeded.
 * Unlike JSZip metadata checks, this cannot be bypassed by falsifying
 * the ZIP central directory's uncompressedSize fields.
 *
 * The zipfile is closed on all exit paths (success, size cap, missing entry,
 * error) to prevent file descriptor leaks.
 */
function extractOdtContentXml(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        return reject(err);
      }
      if (!zipfile) {
        return reject(new Error('Failed to open ODT file'));
      }

      let settled = false;
      const finish = (error: Error | null, result?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        zipfile.close();
        if (error) {
          reject(error);
        } else {
          resolve(result as string);
        }
      };

      let found = false;
      zipfile.readEntry();

      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== 'content.xml') {
          zipfile.readEntry();
          return;
        }
        found = true;
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) {
            return finish(streamErr);
          }
          if (!readStream) {
            return finish(new Error('Failed to open content.xml stream'));
          }

          let totalBytes = 0;
          const chunks: Buffer[] = [];

          readStream.on('data', (chunk: Buffer) => {
            totalBytes += chunk.byteLength;
            if (totalBytes > ODT_MAX_DECOMPRESSED_SIZE) {
              readStream.destroy(
                new Error(
                  `ODT content.xml exceeds the ${ODT_MAX_DECOMPRESSED_SIZE / megabyte}MB decompressed limit`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });

          readStream.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
          readStream.on('error', (readErr: Error) => finish(readErr));
        });
      });

      zipfile.on('end', () => {
        if (!found) {
          finish(new Error('ODT file is missing content.xml'));
        }
      });

      zipfile.on('error', (zipErr: Error) => finish(zipErr));
    });
  });
}


/** Generic RAG API extraction fallback for complex binary formats. */
async function ragExtract({
  req,
  file,
  label,
}: {
  req: ServerRequest;
  file: Express.Multer.File;
  label: string;
}): Promise<string> {
  const userId = req.user?.id;
  if (!userId) {
    logger.warn(`[ragExtract] No user ID provided for ${label} parsing; skipping`);
    return "";
  }
  const ragApiUrl = process.env.RAG_API_URL;
  if (!ragApiUrl) {
    logger.warn(`[ragExtract] RAG_API_URL not defined; ${label} parsing unavailable`);
    return "";
  }

  try {
    const jwtToken = generateShortLivedToken(userId);
    const formData = new FormData();
    formData.append("file", fs.createReadStream(file.path), { filename: file.originalname });
    formData.append("strategy", "builtin");

    const formHeaders = formData.getHeaders();

    const response = await axios.post(`${ragApiUrl}/extract`, formData, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        accept: "application/json",
        ...formHeaders,
      },
      timeout: 600000,
    });

    if (!response.data || typeof response.data.text !== "string") {
      throw new Error(`RAG API did not return valid extracted text for ${label}`);
    }

    return response.data.text;
  } catch (error) {
    logAxiosError({
      message: `[${label}ToText] RAG API extraction failed:`,
      error,
    });
    throw error;
  }
}

/** Parses legacy Word document using RAG API. */
async function docToText({ req, file }: { req: ServerRequest; file: Express.Multer.File }): Promise<string> {
  return await ragExtract({ req, file, label: "doc" });
}

/** Parses PowerPoint document using RAG API. */
async function pptToText({ req, file }: { req: ServerRequest; file: Express.Multer.File }): Promise<string> {
  return await ragExtract({ req, file, label: "ppt" });
}
