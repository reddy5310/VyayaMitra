import type { CsvTable } from '../core/types';

/** Decode bytes as UTF-8 (BOM removed), falling back to Windows-1252 for legacy Excel exports. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    text = new TextDecoder('windows-1252').decode(body);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function sniffDelimiter(text: string): string {
  // Count candidate delimiters outside quotes on the first few non-empty lines.
  const candidates = [',', ';', '\t', '|'];
  const counts = new Map<string, number>(candidates.map((c) => [c, 0]));
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 8; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines++;
    } else if (!inQuotes && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best = ',';
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/**
 * RFC 4180 reader: quoted fields, doubled quotes, embedded commas and newlines, CRLF / LF / CR record
 * separators. Blank records are dropped. The delimiter is sniffed (comma, semicolon, tab or pipe).
 */
export function readCsv(text: string, delimiter?: string): CsvTable {
  const d = delimiter ?? sniffDelimiter(text);
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let fieldStarted = false;

  const endField = () => {
    record.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    if (record.some((f) => f.trim() !== '')) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === d) {
      endField();
    } else if (ch === '\n') {
      endRecord();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRecord();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (fieldStarted || field !== '' || record.length > 0) endRecord();
  return { records };
}
