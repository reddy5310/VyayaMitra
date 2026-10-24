import type { StatementFile } from '@/parsing';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILE_LABEL = '25 MB';
export const ACCEPTED_EXTENSIONS = ['.pdf', '.csv', '.txt', '.xls', '.xlsx', '.xlsm', '.ods', '.ofx', '.qfx'];

/** Returns a user-presentable reason when a file cannot be imported, or null when it is acceptable. */
export function validateFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  const name = file.name.toLowerCase();
  const okType = ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext)) || file.type === 'application/pdf' || file.type === 'text/csv';
  if (!okType) return `“${file.name}” is not a statement file. Use PDF, CSV, Excel (XLS, XLSX, ODS), OFX/QFX or TXT.`;
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > MAX_FILE_BYTES) {
    return `“${file.name}” is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which is over the ${MAX_FILE_LABEL} limit. Download a statement for a shorter period and try again.`;
  }
  return null;
}

function readWithFileReader(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

/** Reads a picked file fully on this device. */
export async function toStatementFile(file: File): Promise<StatementFile> {
  const buffer = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await readWithFileReader(file);
  return { name: file.name, bytes: new Uint8Array(buffer), type: file.type || undefined };
}
