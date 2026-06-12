import {
  TextPaths,
  FilePaths,
  CodePaths,
  AudioPaths,
  VideoPaths,
  SheetPaths,
} from '@librechat/client';
import {
  megabyte,
  QueryKeys,
  inferMimeType,
  excelMimeTypes,
  documentParserMimeTypes,
  EToolResources,
  FileSources,
  dataService,
  fileConfig as defaultFileConfig,
} from 'librechat-data-provider';
import type { TFile, EndpointFileConfig, FileConfig } from 'librechat-data-provider';
import type { QueryClient } from '@tanstack/react-query';
import type { ExtendedFile } from '~/common';

export const partialTypes = ['text/x-'];

const textDocument = {
  paths: TextPaths,
  fill: '#FF5588',
  title: 'Document',
};

const spreadsheet = {
  paths: SheetPaths,
  fill: '#10A37F',
  title: 'Spreadsheet',
};

const codeFile = {
  paths: CodePaths,
  fill: '#FF6E3C',
  // TODO: make this dynamic to the language
  title: 'Code',
};

const artifact = {
  paths: CodePaths,
  fill: '#2D305C',
  title: 'Code',
};

const audioFile = {
  paths: AudioPaths,
  fill: '#FF6B35',
  title: 'Audio',
};

const videoFile = {
  paths: VideoPaths,
  fill: '#8B5CF6',
  title: 'Video',
};

export const fileTypes = {
  /* Category matches */
  file: {
    paths: FilePaths,
    fill: '#0000FF',
    title: 'File',
  },
  text: textDocument,
  txt: textDocument,
  audio: audioFile,
  video: videoFile,
  // application:,

  /* Partial matches */
  csv: spreadsheet,
  'application/pdf': textDocument,
  pdf: textDocument,
  'text/x-': codeFile,
  artifact: artifact,

  /* Exact matches */
  // 'application/json':,
  // 'text/html':,
  // 'text/css':,
  // image,
};

export const toTxtFilename = (filename?: string): string => {
  const baseName = filename ?? 'file';
  const dotIndex = baseName.lastIndexOf('.');
  return `${dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName}.txt`;
};

export const isNativeTextFile = (file?: Pick<TFile, 'filename' | 'type'> | null): boolean => {
  if (!file) {
    return false;
  }

  return file.type === 'text/plain' || file.filename?.toLowerCase().endsWith('.txt') === true;
};

export const isTextLikeFile = (
  file?: Pick<TFile, 'filename' | 'source' | 'textFormat' | 'type'> | null,
): boolean => {
  if (!file) {
    return false;
  }

  return (
    file.source === FileSources.text ||
    file.textFormat === 'text' ||
    file.type?.startsWith('text/') === true ||
    file.filename?.toLowerCase().endsWith('.txt') === true
  );
};

export const getDownloadFilename = (
  file?: Pick<TFile, 'filename' | 'source' | 'textFormat' | 'type'> | null,
): string => {
  if (!file?.filename) {
    return 'file';
  }

  return isTextLikeFile(file) ? toTxtFilename(file.filename) : file.filename;
};

export const htmlToPlainText = (html: string): string => {
  if (!html) {
    return '';
  }

  if (typeof DOMParser === 'undefined') {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
};

export const normalizeExportText = (
  text?: string | null,
  textFormat?: 'html' | 'text' | null,
): string => {
  const value = text?.trim() ?? '';
  if (!value) {
    return '';
  }

  return textFormat === 'html' ? htmlToPlainText(value) : value;
};

export const createTextDownloadUrl = (text: string): string => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  return URL.createObjectURL(blob);
};

// export const getFileType = (type = '') => {
//   let fileType = fileTypes.file;
//   const exactMatch = fileTypes[type];
//   const partialMatch = !exactMatch && partialTypes.find((type) => type.includes(type));
//   const category = (!partialMatch && (type.split('/')[0] ?? 'text') || 'text');

//   if (exactMatch) {
//     fileType = exactMatch;
//   } else if (partialMatch) {
//     fileType = fileTypes[partialMatch];
//   } else if (fileTypes[category]) {
//     fileType = fileTypes[category];
//   }

//   if (!fileType) {
//     fileType = fileTypes.file;
//   }

//   return fileType;
// };

export const getFileType = (
  type = '',
): {
  paths: React.FC;
  fill: string;
  title: string;
} => {
  // Direct match check
  if (fileTypes[type]) {
    return fileTypes[type];
  }

  if (excelMimeTypes.test(type)) {
    return spreadsheet;
  }

  // Partial match check
  const partialMatch = partialTypes.find((partial) => type.includes(partial));
  if (partialMatch && fileTypes[partialMatch]) {
    return fileTypes[partialMatch];
  }

  // Category check
  const category = type.split('/')[0] || 'text';
  if (fileTypes[category]) {
    return fileTypes[category];
  }

  // Default file type
  return fileTypes.file;
};

/**
 * Format a date string to a human readable format
 * @example
 * formatDate('2020-01-01T00:00:00.000Z') // '1 Jan 2020'
 */
export function formatDate(dateString: string, isSmallScreen = false) {
  if (!dateString) {
    return '';
  }

  const date = new Date(dateString);

  if (isSmallScreen) {
    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    });
  }

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  return `${day} ${month} ${year}`;
}

/**
 * Adds a file to the query cache
 */
export function addFileToCache(queryClient: QueryClient, newfile: TFile) {
  const currentFiles = queryClient.getQueryData<TFile[]>([QueryKeys.files]);

  if (!currentFiles) {
    console.warn('No current files found in cache, skipped updating file query cache');
    return;
  }

  const fileIndex = currentFiles.findIndex((file) => file.file_id === newfile.file_id);

  if (fileIndex > -1) {
    console.warn('File already exists in cache, skipped updating file query cache');
    return;
  }

  queryClient.setQueryData<TFile[]>(
    [QueryKeys.files],
    [
      {
        ...newfile,
      },
      ...currentFiles,
    ],
  );
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) {
    return 0;
  }
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
}

const { checkType } = defaultFileConfig;

export const validateFiles = ({
  files,
  fileList,
  setError,
  endpointFileConfig,
  toolResource,
  fileConfig,
  enablePaddleOCR,
}: {
  fileList: File[];
  files: Map<string, ExtendedFile>;
  setError: (error: string) => void;
  endpointFileConfig: EndpointFileConfig;
  toolResource?: string;
  enablePaddleOCR?: boolean;
  fileConfig: FileConfig | null;
}) => {
  const { fileLimit, fileSizeLimit, totalSizeLimit, supportedMimeTypes, disabled } =
    endpointFileConfig;
  /** Block all uploads if the endpoint is explicitly disabled */
  if (disabled === true) {
    setError('com_ui_attach_error_disabled');
    return false;
  }
  const existingFiles = Array.from(files.values());
  const incomingTotalSize = fileList.reduce((total, file) => total + file.size, 0);
  if (incomingTotalSize === 0) {
    setError('com_error_files_empty');
    return false;
  }
  const currentTotalSize = existingFiles.reduce((total, file) => total + file.size, 0);

  if (fileLimit && fileList.length + files.size > fileLimit) {
    setError(`File limit reached: ${fileLimit} files`);
    return false;
  }

  for (let i = 0; i < fileList.length; i++) {
    let originalFile = fileList[i];
    const fileType = inferMimeType(originalFile.name, originalFile.type);

    // Check if the file type is still empty after the extension check
    if (!fileType) {
      setError('Unable to determine file type for: ' + originalFile.name);
      return false;
    }

    // Replace empty type with inferred type
    if (originalFile.type !== fileType) {
      const newFile = new File([originalFile], originalFile.name, { type: fileType });
      originalFile = newFile;
      fileList[i] = newFile;
    }

    let mimeTypesToCheck = supportedMimeTypes;
    if (toolResource === EToolResources.context || (enablePaddleOCR && !toolResource)) {
      mimeTypesToCheck = [
        ...(fileConfig?.text?.supportedMimeTypes || []),
        ...(fileConfig?.ocr?.supportedMimeTypes || []),
        ...(fileConfig?.stt?.supportedMimeTypes || []),
        ...documentParserMimeTypes,
      ];
    }

    if (!checkType(originalFile.type, mimeTypesToCheck)) {
      setError(`Unsupported file type: ${originalFile.type}`);
      return false;
    }

    if (fileSizeLimit && originalFile.size >= fileSizeLimit) {
      setError(`File size limit exceeded: ${fileSizeLimit / megabyte} MB`);
      return false;
    }
  }

  if (totalSizeLimit && currentTotalSize + incomingTotalSize > totalSizeLimit) {
    setError(`Total file size limit exceeded: ${totalSizeLimit / megabyte} MB`);
    return false;
  }

  const combinedFilesInfo = [
    ...existingFiles.map(
      (file) =>
        `${file.file?.name ?? file.filename}-${file.size}-${file.type?.split('/')[0] ?? 'file'}`,
    ),
    ...fileList.map(
      (file: File | undefined) =>
        `${file?.name}-${file?.size}-${file?.type.split('/')[0] ?? 'file'}`,
    ),
  ];

  const uniqueFilesSet = new Set(combinedFilesInfo);

  if (uniqueFilesSet.size !== combinedFilesInfo.length) {
    setError('com_error_files_dupe');
    return false;
  }

  return true;
};

export function sortPagesByRelevance(
  pages: number[],
  pageRelevance: Record<number, number>,
): number[] {
  if (!pageRelevance || Object.keys(pageRelevance).length === 0) {
    return pages;
  }
  return [...pages].sort((a, b) => (pageRelevance[b] || 0) - (pageRelevance[a] || 0));
}

export const canExportToTxt = (
  file?: Pick<TFile, 'filename' | 'source' | 'textFormat' | 'type' | 'text'> | null,
): boolean => {
  if (!file || isNativeTextFile(file)) {
    return false;
  }
  const hasPlainText = Boolean(normalizeExportText(file.text, file.textFormat));
  const isTextFile = isTextLikeFile(file);
  return hasPlainText || isTextFile;
};

export const resolveExportText = async (file: TFile, userId: string): Promise<string | null> => {
  const directText = normalizeExportText(file.text, file.textFormat);
  if (directText) {
    return directText;
  }

  if (!file.file_id) {
    return null;
  }

  try {
    if (isTextLikeFile(file) && userId) {
      const response = await dataService.getFileDownload(userId, file.file_id);
      const blob = response.data as Blob;
      const rawText = normalizeExportText(await blob.text(), file.textFormat);
      if (rawText) {
        return rawText;
      }
    }
  } catch (error) {
    console.error('[resolveExportText] TXT export failed:', error);
  }

  return null;
};
