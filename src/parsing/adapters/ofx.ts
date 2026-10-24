/**
 * OFX / QFX reader (SGML 1.x and XML 2.x). One table with a fixed header so the universal engine can
 * treat it like any other sheet:  Date | Description | Amount | Reference | Type | Balance
 * Only the last 4 characters of the account id are ever returned.
 */
import type { StatementFile } from '../index';
import { UnsupportedStatementError } from '../errors';
import { extensionOf, headText, leadingNonSpace } from './sniff';
import type { SheetTable } from './types';

export const OFX_HEADER = ['Date', 'Description', 'Amount', 'Reference', 'Type', 'Balance'] as const;

export function isOfx(file: StatementFile): boolean {
  const b = file.bytes;
  if (b.length < 20) return false;
  const text = leadingNonSpace(headText(b, 8192));
  if (text.startsWith('ofxheader:') || /<ofx[\s>]/.test(text)) return true;
  const ext = extensionOf(file.name);
  return (ext === 'ofx' || ext === 'qfx') && /<stmttrn>|<bankmsgsrsv1>|<creditcardmsgsrsv1>/.test(headText(b, 262144));
}

function decode(bytes: Uint8Array): string {
  const head = headText(bytes, 2048);
  const charset = /charset:\s*(\S+)/.exec(head)?.[1];
  const latin = charset === '1252' || /windows-1252|iso-8859-1/.test(head);
  return new TextDecoder(latin ? 'windows-1252' : 'utf-8').decode(bytes);
}

/** Value of the first <TAG> in `block` (works for SGML without closers and for XML). */
function field(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i').exec(block);
  const v = m?.[1]?.trim();
  return v ? decodeEntities(v) : undefined;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** 20250914120000[+5:30:IST] → 2025-09-14 */
export function ofxDate(v: string | undefined): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

function amountText(v: string | undefined): string | undefined {
  if (!v) return undefined;
  let s = v.replace(/\s+/g, '');
  // Some exports use a decimal comma.
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  return /^[+-]?\d*\.?\d+$/.test(s) ? s : undefined;
}

export async function readOfx(
  file: StatementFile,
): Promise<{ table: SheetTable; accountType?: 'savings' | 'current' | 'credit_card'; accountMask?: string; currency?: string }> {
  const text = decode(file.bytes);
  const blocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((m) => m[1]);
  if (blocks.length === 0) {
    throw new UnsupportedStatementError('This OFX/QFX file has no transactions in it.', ['Check that the export covers a date range with activity.']);
  }

  let accountType: 'savings' | 'current' | 'credit_card' | undefined;
  let acctId: string | undefined;
  const bank = /<BANKACCTFROM>([\s\S]*?)<\/BANKACCTFROM>/i.exec(text)?.[1];
  const card = /<CCACCTFROM>([\s\S]*?)<\/CCACCTFROM>/i.exec(text)?.[1];
  if (card !== undefined) {
    accountType = 'credit_card';
    acctId = field(card, 'ACCTID');
  } else if (bank !== undefined) {
    const t = field(bank, 'ACCTTYPE')?.toUpperCase();
    accountType = t === 'CHECKING' ? 'current' : 'savings';
    acctId = field(bank, 'ACCTID');
  }
  const compact = acctId?.replace(/\s+/g, '');
  const accountMask = compact && compact.length >= 4 ? compact.slice(-4) : undefined;
  const currency = field(text, 'CURDEF');

  const rows = blocks.map((b, order) => {
    const date = ofxDate(field(b, 'DTPOSTED')) ?? ofxDate(field(b, 'DTUSER')) ?? '';
    const name = field(b, 'NAME') ?? field(b, 'PAYEE') ?? '';
    const memo = field(b, 'MEMO') ?? '';
    const description = [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return {
      order,
      date,
      cells: [date, description, amountText(field(b, 'TRNAMT')) ?? '', field(b, 'FITID') ?? field(b, 'CHECKNUM') ?? '', field(b, 'TRNTYPE') ?? '', ''],
    };
  });
  // Oldest first so "the last row" is the latest transaction (the ledger balance is as of the statement end).
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

  const ledger = /<LEDGERBAL>([\s\S]*?)<\/LEDGERBAL>/i.exec(text)?.[1];
  const balance = ledger ? amountText(field(ledger, 'BALAMT')) : undefined;
  const records = rows.map((r) => r.cells);
  if (balance !== undefined) records[records.length - 1][5] = balance;

  return {
    table: { name: 'OFX', records: [[...OFX_HEADER], ...records] },
    accountType,
    accountMask,
    currency,
  };
}
