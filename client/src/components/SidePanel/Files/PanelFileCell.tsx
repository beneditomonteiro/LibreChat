import { useCallback, useMemo } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button, useToastContext } from '@librechat/client';
import { useRecoilValue } from 'recoil';
import type { Row } from '@tanstack/react-table';
import type { TFile } from 'librechat-data-provider';
import ImagePreview from '~/components/Chat/Input/Files/ImagePreview';
import FilePreview from '~/components/Chat/Input/Files/FilePreview';
import { useFileDownload, useFilePreview } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { getFileType, triggerDownload } from '~/utils';
import store from '~/store';

export default function PanelFileCell({ row }: { row: Row<TFile | undefined> }) {
  const file = row.original;
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const user = useRecoilValue(store.user);
  const { refetch: downloadFile } = useFileDownload(user?.id ?? '', file?.file_id, {
    source: file?.source,
  });
  const { refetch: fetchPreview } = useFilePreview(file?.file_id, {
    enabled: false,
    retry: false,
  });

  const isPdf = useMemo(
    () => Boolean(file?.type?.includes('pdf') || file?.filename?.toLowerCase().endsWith('.pdf')),
    [file?.filename, file?.type],
  );

  const baseName = useMemo(() => {
    const filename = file?.filename ?? 'file';
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  }, [file?.filename]);

  const hasPlainText = useMemo(
    () => Boolean(file?.text?.trim() && file.textFormat !== 'html'),
    [file?.text, file?.textFormat],
  );

  const showTxtAction = hasPlainText || isPdf;
  const txtActionLabel = hasPlainText
    ? localize('com_ui_export_txt')
    : localize('com_ui_convert_pdf_txt');

  const handleDownload = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!file?.file_id) {
        return;
      }

      try {
        const result = await downloadFile();
        if (!result.data) {
          showToast({
            message: localize('com_ui_download_error'),
            status: 'error',
          });
          return;
        }

        triggerDownload(result.data, file.filename ?? 'file');
      } catch (error) {
        console.error('[PanelFileCell] file download failed:', error);
        showToast({
          message: localize('com_ui_download_error'),
          status: 'error',
        });
      }
    },
    [downloadFile, file?.file_id, file?.filename, localize, showToast],
  );

  const handleTxtAction = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!file?.file_id || (!hasPlainText && !isPdf)) {
        return;
      }

      try {
        if (hasPlainText) {
          const text = file.text?.trim() ?? '';
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          triggerDownload(url, `${baseName}.txt`);
          return;
        }

        const result = await fetchPreview();
        const text = result.data?.text ?? file.text ?? '';

        if (!text.trim()) {
          showToast({
            message:
              result.data?.status === 'pending'
                ? localize('com_ui_pdf_text_pending')
                : localize('com_ui_pdf_text_unavailable'),
            status: 'warning',
          });
          return;
        }

        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        triggerDownload(url, `${baseName}.txt`);
      } catch (error) {
        console.error('[PanelFileCell] TXT export failed:', error);
        showToast({
          message: localize('com_ui_export_txt_error'),
          status: 'error',
        });
      }
    },
    [baseName, fetchPreview, file?.file_id, file?.text, hasPlainText, isPdf, localize, showToast],
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
