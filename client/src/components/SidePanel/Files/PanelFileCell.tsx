import { useCallback, useMemo } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button, useToastContext } from '@librechat/client';
import { useRecoilValue } from 'recoil';
import type { Row } from '@tanstack/react-table';
import type { TFile } from 'librechat-data-provider';
import ImagePreview from '~/components/Chat/Input/Files/ImagePreview';
import FilePreview from '~/components/Chat/Input/Files/FilePreview';
import { useFileDownload } from '~/data-provider';
import { useLocalize } from '~/hooks';
import {
  createTextDownloadUrl,
  getDownloadFilename,
  getFileType,
  isTextLikeFile,
  canExportToTxt,
  resolveExportText,
  normalizeExportText,
  toTxtFilename,
  triggerDownload,
} from '~/utils';
import store from '~/store';

export default function PanelFileCell({ row }: { row: Row<TFile | undefined> }) {
  const file = row.original;
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const user = useRecoilValue(store.user);
  const { refetch: downloadFile } = useFileDownload(user?.id ?? '', file?.file_id, {
    source: file?.source,
    direct: false,
  });

  const isPdf = useMemo(
    () => Boolean(file?.type?.includes('pdf') || file?.filename?.toLowerCase().endsWith('.pdf')),
    [file?.filename, file?.type],
  );
  const isTextFile = useMemo(() => isTextLikeFile(file), [file]);

  const showTxtAction = useMemo(() => canExportToTxt(file), [file]);
  const txtActionLabel = isPdf ? localize('com_ui_convert_pdf_txt') : localize('com_ui_export_txt');
  const downloadFilename = useMemo(() => getDownloadFilename(file), [file]);
  const txtFilename = useMemo(() => toTxtFilename(file?.filename), [file?.filename]);

  const handleDownload = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!file?.file_id) {
        return;
      }

      try {
        if (isTextFile) {
          const inlineText = normalizeExportText(file.text, file.textFormat);
          if (inlineText) {
            triggerDownload(createTextDownloadUrl(inlineText), downloadFilename);
            return;
          }
        }

        const result = await downloadFile();
        if (!result.data) {
          showToast({
            message: localize('com_ui_download_error'),
            status: 'error',
          });
          return;
        }

        triggerDownload(result.data, downloadFilename);
      } catch (error) {
        console.error('[PanelFileCell] file download failed:', error);
        showToast({
          message: localize('com_ui_download_error'),
          status: 'error',
        });
      }
    },
    [
      downloadFile,
      downloadFilename,
      file?.file_id,
      file?.text,
      file?.textFormat,
      isTextFile,
      localize,
      showToast,
    ],
  );

  const handleTxtAction = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!file?.file_id) {
        return;
      }

      try {
        const text = await resolveExportText(file, user?.id ?? '');
        if (text) {
          triggerDownload(createTextDownloadUrl(text), txtFilename);
          return;
        }

        showToast({
          message: localize('com_ui_export_txt_error'),
          status: 'warning',
        });
      } catch (error) {
        console.error('[PanelFileCell] TXT export failed:', error);
        showToast({
          message: localize('com_ui_export_txt_error'),
          status: 'error',
        });
      }
    },
    [file, localize, showToast, txtFilename, user?.id],
  );

  if (!file) {
    return null;
  }

  return (
    <div className="flex w-full items-center gap-2">
      {file?.type?.startsWith('image') === true ? (
        <ImagePreview
          url={file.filepath}
          className="h-8 w-8 flex-shrink-0"
          source={file.source}
          alt={file.filename}
        />
      ) : (
        <FilePreview fileType={getFileType(file?.type)} file={file} />
      )}
      <div className="min-w-0 flex-1 overflow-hidden">
        <span className="block w-full overflow-hidden truncate text-ellipsis whitespace-nowrap text-xs">
          {file?.filename}
        </span>
        <div className="mt-1 flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            onClick={handleDownload}
            title={localize('com_ui_download')}
            aria-label={`${localize('com_ui_download')} ${file.filename}`}
          >
            <Download className="size-3.5" aria-hidden="true" />
          </Button>
          {showTxtAction && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              onClick={handleTxtAction}
              title={txtActionLabel}
              aria-label={`${txtActionLabel} ${file.filename}`}
            >
              <FileText className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
