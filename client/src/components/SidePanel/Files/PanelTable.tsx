import { useState, useCallback, useMemo, useRef } from 'react';
import { ArrowUpLeft, FileText, FileUp, Paperclip, X } from 'lucide-react';
import {
  Table,
  Button,
  Checkbox,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  FilterInput,
  TableHeader,
  useToastContext,
} from '@librechat/client';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  megabyte,
  mergeFileConfig,
  checkOpenAIStorage,
  isAssistantsEndpoint,
  getEndpointFileConfig,
  fileConfig as defaultFileConfig,
} from 'librechat-data-provider';
import type { TFile } from 'librechat-data-provider';
import { MyFilesModal } from '~/components/Chat/Input/Files/MyFilesModal';
import { useFileMapContext, useChatContext } from '~/Providers';
import type { ExtendedFile } from '~/common';
import { useFileHandling, useLocalize, useUpdateFiles } from '~/hooks';
import { useGetFileConfig } from '~/data-provider';
import { triggerDownload } from '~/utils';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

const toTxtFilename = (filename?: string) => {
  const baseName = filename ?? 'file';
  const dotIndex = baseName.lastIndexOf('.');
  return `${dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName}.txt`;
};

const getColumnWidth = (columnId: string): string => {
  if (columnId === 'select') {
    return '44px';
  }
  if (columnId === 'updatedAt') {
    return '120px';
  }
  return 'calc(100% - 164px)';
};

const getHeaderAlignClass = (columnId: string): string => {
  if (columnId === 'select') {
    return 'flex justify-center px-1';
  }
  if (columnId === 'updatedAt') {
    return 'flex justify-end px-1';
  }
  return 'px-2';
};

const getCellClass = (columnId: string): string => {
  if (columnId === 'filename') {
    return 'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text-primary';
  }
  if (columnId === 'select') {
    return 'px-2';
  }
  return '';
};

export default function DataTable<TData, TValue>({ columns, data }: DataTableProps<TData, TValue>) {
  const localize = useLocalize();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [{ pageIndex, pageSize }, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [showFilesModal, setShowFilesModal] = useState(false);
  const manageFilesRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileMap = useFileMapContext();
  const { showToast } = useToastContext();
  const { files, setFiles, conversation } = useChatContext();
  const { handleFileChange } = useFileHandling();
  const { data: fileConfig = null } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });
  const { addFile } = useUpdateFiles(setFiles);

  const selectColumn = useMemo<ColumnDef<TData, unknown>>(
    () => ({
      id: 'select',
      size: 44,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label={localize('com_ui_select_all')}
          className="flex"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={localize('com_ui_select_row')}
          className="flex"
        />
      ),
    }),
    [localize],
  );

  const tableColumns = useMemo<ColumnDef<TData, TValue>[]>(() => {
    return [selectColumn as ColumnDef<TData, TValue>, ...columns];
  }, [columns, selectColumn]);

  const pagination = useMemo(
    () => ({
      pageIndex,
      pageSize,
    }),
    [pageIndex, pageSize],
  );

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      pagination,
      rowSelection,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => (row as TFile).file_id,
    defaultColumn: {
      minSize: 0,
      size: 10,
      maxSize: 10,
      enableResizing: true,
    },
  });

  const attachFile = useCallback(
    (file: TFile, currentFiles: Map<string, ExtendedFile>) => {
      if (!fileMap?.[file.file_id] || !conversation?.endpoint) {
        showToast({
          message: localize('com_ui_attach_error'),
          status: 'error',
        });
        return false;
      }

      const fileData = fileMap[file.file_id];
      const endpoint = conversation.endpoint;
      const endpointType = conversation.endpointType;

      if (!fileData.source) {
        return false;
      }

      const isOpenAIStorage = checkOpenAIStorage(fileData.source);
      const isAssistants = isAssistantsEndpoint(endpoint);

      if (isOpenAIStorage && !isAssistants) {
        showToast({
          message: localize('com_ui_attach_error_openai'),
          status: 'error',
        });
        return false;
      }

      if (!isOpenAIStorage && isAssistants) {
        showToast({
          message: localize('com_ui_attach_warn_endpoint'),
          status: 'warning',
        });
      }

      const endpointFileConfig = getEndpointFileConfig({
        fileConfig,
        endpoint,
        endpointType,
      });

      if (endpointFileConfig.disabled === true) {
        showToast({
          message: localize('com_ui_attach_error_disabled'),
          status: 'error',
        });
        return false;
      }

      if (endpointFileConfig.fileLimit && currentFiles.size >= endpointFileConfig.fileLimit) {
        showToast({
          message: `${localize('com_ui_attach_error_limit')} ${endpointFileConfig.fileLimit} files (${endpoint})`,
          status: 'error',
        });
        return false;
      }

      if (fileData.bytes >= (endpointFileConfig.fileSizeLimit ?? Number.MAX_SAFE_INTEGER)) {
        showToast({
          message: `${localize('com_ui_attach_error_size')} ${
            (endpointFileConfig.fileSizeLimit ?? 0) / megabyte
          } MB (${endpoint})`,
          status: 'error',
        });
        return false;
      }

      if (!defaultFileConfig.checkType(file.type, endpointFileConfig.supportedMimeTypes ?? [])) {
        showToast({
          message: `${localize('com_ui_attach_error_type')} ${file.type} (${endpoint})`,
          status: 'error',
        });
        return false;
      }

      if (endpointFileConfig.totalSizeLimit) {
        const existing = currentFiles.get(fileData.file_id);
        let currentTotalSize = 0;
        for (const f of currentFiles.values()) {
          currentTotalSize += f.size;
        }
        currentTotalSize -= existing?.size ?? 0;
        if (currentTotalSize + fileData.bytes > endpointFileConfig.totalSizeLimit) {
          showToast({
            message: `${localize('com_ui_attach_error_total_size')} ${endpointFileConfig.totalSizeLimit / megabyte} MB (${endpoint})`,
            status: 'error',
          });
          return false;
        }
      }

      const attachedFile: ExtendedFile = {
        progress: 1,
        attached: true,
        file_id: fileData.file_id,
        filepath: fileData.filepath,
        preview: fileData.filepath,
        type: fileData.type,
        height: fileData.height,
        width: fileData.width,
        filename: fileData.filename,
        source: fileData.source,
        size: fileData.bytes,
        metadata: fileData.metadata,
      };

      addFile(attachedFile);
      currentFiles.set(fileData.file_id, attachedFile);
      return true;
    },
    [addFile, conversation, fileConfig, fileMap, localize, showToast],
  );

  const handleFileClick = useCallback(
    (file: TFile) => {
      attachFile(file, new Map(files));
    },
    [attachFile, files],
  );

  const filenameFilter = table.getColumn('filename')?.getFilterValue() as string;
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const selectedFiles = table
    .getSelectedRowModel()
    .rows.map((row) => row.original as TFile)
    .filter((file): file is TFile => Boolean(file));
  const exportableSelectedFiles = selectedFiles.filter(
    (file) => Boolean(file.text?.trim()) && file.textFormat !== 'html',
  );

  const handleClearSelection = useCallback(() => {
    table.resetRowSelection();
  }, [table]);

  const handleAttachSelected = useCallback(() => {
    if (!selectedFiles.length) {
      return;
    }

    const currentFiles = new Map(files);
    for (const file of selectedFiles) {
      attachFile(file, currentFiles);
    }

    table.resetRowSelection();
  }, [attachFile, files, selectedFiles, table]);

  const handleExportSelectedTxt = useCallback(() => {
    if (!exportableSelectedFiles.length) {
      showToast({
        message: localize('com_ui_export_txt_none'),
        status: 'warning',
      });
      return;
    }

    for (const file of exportableSelectedFiles) {
      const text = file.text?.trim();
      if (!text) {
        continue;
      }

      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, toTxtFilename(file.filename));
    }

    table.resetRowSelection();
  }, [exportableSelectedFiles, localize, showToast, table]);

  return (
    <div role="region" aria-label={localize('com_files_table')} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <FilterInput
          inputId="filename-filter"
          label={localize('com_files_filter')}
          value={filenameFilter ?? ''}
          onChange={(event) => table.getColumn('filename')?.setFilterValue(event.target.value)}
          containerClassName="flex-1"
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={handleUploadClick}
          aria-label={localize('com_ui_upload_files')}
        >
          <FileUp className="h-4 w-4" aria-hidden="true" />
          <span className="ml-2">{localize('com_ui_upload_files')}</span>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
          tabIndex={-1}
        />
      </div>

      {selectedFiles.length > 0 && (
        <div className="bg-surface-secondary/30 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-light px-3 py-2">
          <div className="text-xs text-text-secondary">
            {localize('com_ui_files_count_selected', { count: selectedFiles.length })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAttachSelected}
              aria-label={localize('com_ui_attach_selected')}
            >
              <Paperclip className="h-4 w-4" aria-hidden="true" />
              <span className="ml-2">{localize('com_ui_attach_selected')}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportSelectedTxt}
              disabled={!exportableSelectedFiles.length}
              aria-label={localize('com_ui_export_txt')}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span className="ml-2">{localize('com_ui_export_txt')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearSelection}
              aria-label={localize('com_ui_clear')}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="ml-2">{localize('com_ui_clear')}</span>
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border-light bg-transparent shadow-sm transition-colors">
        <div className="overflow-hidden">
          <Table className="table-fixed">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="border-b border-border-light">
                  {headerGroup.headers.map((header) => {
                    const columnId = header.column.id;

                    return (
                      <TableHead
                        key={header.id}
                        style={{ width: getColumnWidth(columnId) }}
                        className="bg-surface-secondary py-2 text-sm font-medium text-text-secondary"
                      >
                        <div className={getHeaderAlignClass(columnId)}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                    className="border-b border-border-light transition-colors hover:bg-surface-secondary [&:last-child]:border-0"
                  >
                    {row.getVisibleCells().map((cell) => {
                      const columnId = cell.column.id;
                      const isFilenameCell = columnId === 'filename';

                      return (
                        <TableCell
                          key={cell.id}
                          style={{
                            width: getColumnWidth(columnId),
                            maxWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          className={getCellClass(columnId)}
                          data-skip-refocus="true"
                          role={isFilenameCell ? 'button' : undefined}
                          tabIndex={isFilenameCell ? 0 : undefined}
                          onClick={(e) => {
                            if (isFilenameCell) {
                              const clickedElement = e.target as HTMLElement;
                              if (
                                clickedElement.closest('td') &&
                                !clickedElement.closest('button, a')
                              ) {
                                e.preventDefault();
                                e.stopPropagation();
                                handleFileClick(row.original as TFile);
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            if (isFilenameCell && (e.key === 'Enter' || e.key === ' ')) {
                              const clickedElement = e.target as HTMLElement;
                              if (
                                clickedElement.closest('td') &&
                                !clickedElement.closest('button, a')
                              ) {
                                e.preventDefault();
                                e.stopPropagation();
                                handleFileClick(row.original as TFile);
                              }
                            }
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={tableColumns.length}
                    className="h-24 text-center text-sm text-text-secondary"
                  >
                    {localize('com_files_no_results')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="space-y-2">
        <Button
          ref={manageFilesRef}
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setShowFilesModal(true)}
          aria-label={localize('com_sidepanel_manage_files')}
        >
          <ArrowUpLeft className="h-4 w-4" aria-hidden="true" />
          <span className="ml-2">{localize('com_sidepanel_manage_files')}</span>
        </Button>

        <div
          className="flex items-center justify-between"
          role="navigation"
          aria-label="Pagination"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label={localize('com_ui_prev')}
          >
            {localize('com_ui_prev')}
          </Button>
          <div aria-live="polite" className="text-sm">
            {`${pageIndex + 1} / ${table.getPageCount()}`}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label={localize('com_ui_next')}
          >
            {localize('com_ui_next')}
          </Button>
        </div>
      </div>
      <MyFilesModal
        open={showFilesModal}
        onOpenChange={setShowFilesModal}
        triggerRef={manageFilesRef}
      />
    </div>
  );
}
