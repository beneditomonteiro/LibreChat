import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Row } from '@tanstack/react-table';
import { FileSources, type TFile } from 'librechat-data-provider';
import PanelFileCell from '../PanelFileCell';

const mockShowToast = jest.fn();
const mockDownloadRefetch = jest.fn();
const mockFetchFilePreview = jest.fn();
let mockCreateObjectURL: jest.Mock;

jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    ...props
  }: { children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useFileDownload: () => ({ refetch: mockDownloadRefetch }),
  fetchFilePreview: (...args: unknown[]) => mockFetchFilePreview(...args),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/utils', () => ({
  ...jest.requireActual<typeof import('~/utils')>('~/utils'),
  getFileType: jest.fn(() => 'text'),
  triggerDownload: jest.fn(),
}));

const { triggerDownload: mockTriggerDownload } = jest.requireMock('~/utils') as {
  triggerDownload: jest.Mock;
};

jest.mock('recoil', () => ({
  useRecoilValue: () => ({ id: 'user-1' }),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    user: {},
  },
}));

jest.mock('~/components/Chat/Input/Files/ImagePreview', () => () => (
  <div data-testid="image-preview" />
));
jest.mock('~/components/Chat/Input/Files/FilePreview', () => () => (
  <div data-testid="file-preview" />
));

function makeFile(overrides: Partial<TFile> = {}): TFile {
  return {
    user: 'user-1',
    file_id: 'file-1',
    bytes: 1024,
    embedded: false,
    filename: 'report.md',
    filepath: '/files/report.md',
    object: 'file',
    type: 'text/markdown',
    usage: 0,
    source: FileSources.local,
    ...overrides,
  };
}

function renderCell(file: TFile) {
  const row = { original: file } as Row<TFile | undefined>;
  return render(<PanelFileCell row={row} />);
}

describe('PanelFileCell TXT actions', () => {
  beforeEach(() => {
    mockShowToast.mockClear();
    mockDownloadRefetch.mockClear();
    mockFetchFilePreview.mockClear();
    mockTriggerDownload.mockClear();
    mockDownloadRefetch.mockResolvedValue({ data: 'blob:download' });
    mockCreateObjectURL = jest.fn(() => 'blob:txt');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: mockCreateObjectURL,
    });
  });

  it('downloads text-like files with a .txt filename', async () => {
    const file = makeFile({
      filename: 'smoke_scanned.pdf',
      type: 'text/plain',
      text: 'hello world',
      textFormat: 'text',
      source: FileSources.text,
    });

    renderCell(file);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download smoke_scanned.pdf' }));

    expect(mockDownloadRefetch).not.toHaveBeenCalled();
    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalledTimes(1));
    expect(mockTriggerDownload).toHaveBeenCalledWith('blob:txt', 'smoke_scanned.txt');
  });

  it('exports plain extracted text for any file type without previewing', () => {
    const file = makeFile({
      filename: 'report.md',
      type: 'text/markdown',
      text: 'hello world',
      textFormat: 'text',
    });

    renderCell(file);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_export_txt report.md' }));

    expect(mockFetchFilePreview).not.toHaveBeenCalled();
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(mockTriggerDownload).toHaveBeenCalledWith('blob:txt', 'report.txt');
  });

  it('normalizes html text before exporting txt', async () => {
    const file = makeFile({
      filename: 'office.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      text: '<p>Hello <strong>world</strong></p>',
      textFormat: 'html',
    });

    renderCell(file);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_export_txt office.docx' }));

    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalledTimes(1));
    expect(mockCreateObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(mockTriggerDownload).toHaveBeenCalledWith('blob:txt', 'office.txt');
  });

  it('falls back to PDF preview conversion when no extracted text exists yet', async () => {
    mockFetchFilePreview.mockResolvedValue({
      file_id: 'file-1',
      status: 'ready',
      text: 'converted text',
      textFormat: 'text',
    });
    const file = makeFile({
      filename: 'scan.pdf',
      type: 'application/pdf',
      text: '',
      textFormat: null,
    });

    renderCell(file);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_convert_pdf_txt scan.pdf' }));

    await waitFor(() => expect(mockFetchFilePreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockTriggerDownload).toHaveBeenCalledWith('blob:txt', 'scan.txt'));
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
  });
});
