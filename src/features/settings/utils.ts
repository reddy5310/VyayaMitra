import { todayIso } from '@/lib/dates';

/** Message safe to show: ValidationError and other Errors carry user-presentable text. */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Nothing was changed.'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** vyayamitra-backup-YYYY-MM-DD.json, using the LOCAL calendar date (not UTC). */
export function backupFileName(now: Date = new Date()): string {
  return `vyayamitra-backup-${todayIso(now)}.json`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
