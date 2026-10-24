/**
 * Structural parsing of statement descriptions (ICICI, DBS and credit-card layouts, with generic
 * fallbacks for other banks). Pure string work: no judgement about kind or category happens here.
 */
import type { AccountType, Channel } from '@/domain/types';
import {
  IFSC,
  IFSC_ANYWHERE,
  bankFromIfsc,
  cleanCardDescriptor,
  cleanNote,
  cleanVpa,
  collectMasks,
  digitsOnly,
  findBank,
  looksLikeVpa,
  NOTE_NOISE,
  parseMandateNarration,
  parseTransferNarration,
  parseUpiNarration,
  parseWalletText,
  stripGateway,
  type Narration,
} from './grammars';
import { repairBankName, squish } from './text';

export type Scheme =
  | 'upi'
  | 'imps'
  | 'neft'
  | 'rtgs'
  | 'ach'
  | 'cms'
  | 'bil_transfer'
  | 'bil'
  | 'inf'
  | 'cred'
  | 'card_upi'
  | 'card_plain'
  | 'transfer'
  | 'plain';

export interface ParsedDescription {
  scheme: Scheme;
  channel: Channel;
  /** Whole description with runs of whitespace collapsed. */
  text: string;
  /** Upper-case copy for keyword regexes. */
  upper: string;
  reference?: string;
  /** Lower-case VPA, spaces removed. May be truncated (no domain). */
  vpa?: string;
  /** Raw payee/payer name as printed (not repaired). */
  name?: string;
  /** User remark / UPI note ("Family", "Payment from Ph"). */
  note?: string;
  bank?: string;
  ifsc?: string;
  /** Last-4 masks printed like XX1234. */
  maskedAccounts: string[];
  /** Raw merchant fragment for card statements and plain bank descriptions. */
  merchantText?: string;
  /** UPI P2M / P2A tag when the bank prints one: merchant payment vs person transfer. */
  mode?: 'merchant' | 'person';
  /** ISO code when the card descriptor ended in a foreign amount ("* 25 USD"). */
  currency?: string;
  /** The purchase was converted to EMI at checkout ("(Pay in EMIs)"). */
  emi?: boolean;
  /** Payment gateway named by a "RAZ*"-style prefix; the prefix is already removed from merchantText. */
  gateway?: string;
}

const TXID = /^(?:AXL|YBL|IBL|HDF|ICI|PPPL|YJP|UTIB|SBIN|OKS|OKA|OKH|OKI|APL|PTY|FBP|SBI|PYT)[A-Za-z0-9]{8,}$/;

function parseUpiSlash(parts: string[], base: ParsedDescription): ParsedDescription | null {
  // Classic ICICI order: UPI/<ref>/<note>/<vpa>/<bank>/<txn id>.
  // Some rows print UPI/<vpa>/<note>/<bank>/<ref>/<txn id>, so anything else is classified by shape.
  const rest = parts.slice(1);
  if (rest.length < 2) return null;
  const classic = digitsOnly(rest[0]).length >= 9 && /^\d[\d\s]*$/.test(rest[0]);
  let ref: string | undefined;
  let vpa: string | undefined;
  let bank: string | undefined;
  const notes: string[] = [];
  if (classic) {
    ref = digitsOnly(rest[0]);
    notes.push(rest[1] ?? '');
    const vpaPart = rest[2] ?? '';
    if (!vpaPart || !looksLikeVpa(vpaPart)) return null;
    vpa = cleanVpa(vpaPart);
    // Some banks print UPI/<ref>/<NAME>/<vpa>/<note>: an ALL-CAPS two-word segment that echoes the handle is a name
    const candidate = squish(rest[1] ?? '');
    const first = candidate.split(' ')[0]?.toLowerCase() ?? '';
    if (/^[A-Z][A-Z .']+$/.test(candidate) && candidate.includes(' ') && first.length >= 3 && vpa.includes(first)) {
      const note = cleanNote(rest[4]);
      return { ...base, scheme: 'upi', channel: 'UPI', reference: ref, name: candidate, note, vpa, bank: findBank(rest[3] ?? '') };
    }
    const bankPart = rest[3];
    if (bankPart && !TXID.test(bankPart.replace(/\s+/g, ''))) bank = repairBankName(bankPart) ?? squish(bankPart);
  } else {
    for (const part of rest) {
      const compact = part.replace(/\s+/g, '');
      if (!compact) continue;
      if (/^\d{9,}$/.test(compact)) ref ??= compact;
      else if (TXID.test(compact)) continue;
      else if (compact.includes('@')) vpa ??= cleanVpa(part);
      else if (findBank(part)) bank ??= findBank(part);
      else notes.push(part);
    }
    if (!vpa) {
      // a handle truncated before its '@' ("sunil.varma77-"): first single-token, non-noise fragment
      const idx = notes.findIndex((n) => /^[a-z0-9][a-z0-9._-]{3,}$/i.test(n) && !NOTE_NOISE.test(n));
      if (idx < 0) return null;
      vpa = cleanVpa(notes.splice(idx, 1)[0]).replace(/[._-]+$/, '');
    }
  }
  return { ...base, scheme: 'upi', channel: 'UPI', reference: ref, note: cleanNote(notes.join(' ')), vpa, bank };
}

/** "Asha EV-HDFC BANK LIMITED HDFC0000123" → name "Asha EV", bank from the IFSC, IFSC. */
function splitNameBank(rest: string): { name?: string; bank?: string; ifsc?: string } {
  let t = squish(rest);
  const ifsc = IFSC_ANYWHERE.exec(t)?.[1];
  if (ifsc) t = squish(t.replace(ifsc, ''));
  const dash = t.lastIndexOf('-');
  if (dash > 0) {
    const tail = squish(t.slice(dash + 1));
    if (/bank|ltd|limited|co-?op/i.test(tail) || findBank(tail)) {
      return { name: squish(t.slice(0, dash)) || undefined, bank: bankFromIfsc(ifsc) ?? findBank(tail) ?? tail, ifsc };
    }
  }
  return { name: t || undefined, bank: bankFromIfsc(ifsc), ifsc };
}

function fromNarration(base: ParsedDescription, scheme: Scheme, channel: Channel, n: Narration): ParsedDescription {
  return { ...base, scheme, channel, reference: n.reference, vpa: n.vpa, name: n.name, note: n.note, bank: n.bank, ifsc: n.ifsc, mode: n.mode };
}

/** Parse one raw description. `accountType` only matters for credit-card layouts. */
export function parseDescription(rawDescription: string, accountType: AccountType): ParsedDescription {
  const parsed = parseRaw(rawDescription, accountType);
  if (parsed.ifsc && !parsed.bank) parsed.bank = bankFromIfsc(parsed.ifsc);
  return parsed;
}

const CURRENCIES = 'USD|EUR|GBP|SGD|AED|AUD|CAD|JPY|CHF|HKD|NZD|SEK|NOK|DKK|CNY|THB|MYR|IDR|SAR|QAR|ZAR|KRW|PHP|VND|LKR|NPR|BDT|TRY|ILS|PLN|CZK|HUF|RUB|BRL|MXN';
/** "* 25 USD", "* 48 25 USD" (reward points + foreign amount), "9 USD" at the end of a card descriptor. */
const FOREIGN_TAIL = new RegExp(`(?:\\s*\\*)?(?:\\s+\\d+(?:\\.\\d+)?){1,2}\\s+(${CURRENCIES})\\s*$`, 'i');
const EMI_NOTE = /\(\s*pay\s+in\s+emis?\s*\)|\bpay\s+in\s+emis?\b/i;
/** A parser may leave the statement-period header in front of the first row. */
const STATEMENT_PERIOD = /^for\s+statement\s+period\s*:?.*?\bto\s+\d{1,2}[\s/-]+[A-Za-z0-9]{2,9}[\s/-]+\d{2,4}\s*/i;

function parseRaw(rawDescription: string, accountType: AccountType): ParsedDescription {
  let text = squish(rawDescription);
  const withoutPeriod = squish(text.replace(STATEMENT_PERIOD, ''));
  if (withoutPeriod) text = withoutPeriod;
  let emi: boolean | undefined;
  if (EMI_NOTE.test(text)) {
    emi = true;
    text = squish(text.replace(EMI_NOTE, ' ')) || text;
  }
  let currency: string | undefined;
  if (accountType === 'credit_card' || /^(?:POS|ECOM|PUR)\b/i.test(text)) {
    const fx = FOREIGN_TAIL.exec(text);
    if (fx && fx.index > 0) {
      currency = fx[1].toUpperCase();
      text = squish(text.slice(0, fx.index).replace(/\s*\*\s*$/, ''));
    }
  }
  const upper = text.toUpperCase();
  const base: ParsedDescription = {
    scheme: 'plain',
    channel: 'OTHER',
    text,
    upper,
    maskedAccounts: collectMasks(text),
    ...(currency ? { currency } : {}),
    ...(emi ? { emi } : {}),
  };

  // ── credit-card layouts ──────────────────────────────────────────────────────────────────────
  if (accountType === 'credit_card') {
    const m = /^UPI[-/](\d{9,})[-/](.*)$/i.exec(text);
    if (m) return { ...base, scheme: 'card_upi', channel: 'UPI', reference: m[1], merchantText: squish(m[2]) };
    const gw = stripGateway(cleanCardDescriptor(text) || text);
    return { ...base, scheme: 'card_plain', channel: 'CARD', merchantText: gw.text, ...(gw.gateway ? { gateway: gw.gateway } : {}) };
  }

  // ── DBS ──────────────────────────────────────────────────────────────────────────────────────
  let m = /^UPI~(\d{6,})~(.*)$/i.exec(text);
  if (m) {
    const rest = m[2].split('~');
    const vpa = rest[0] ? cleanVpa(rest[0]) : undefined;
    const tail = rest.slice(1).join(' ');
    const name = squish(tail.replace(/\s*-\s*[A-Z]{3}[A-Za-z0-9]{10,}\s*$/, '').replace(/\s*-\s*$/, '')) || undefined;
    return { ...base, scheme: 'upi', channel: 'UPI', reference: m[1], vpa, name };
  }
  m = /^IMP-(\d+)-([^-]*)-(.*)$/i.exec(text);
  if (m) {
    const rest = m[3].replace(/-?\s*IMPS(?:\s+Transac\w*)?\s*$/i, '');
    const dash = rest.lastIndexOf('-');
    let name = rest;
    let bank: string | undefined;
    if (dash >= 0) {
      name = rest.slice(0, dash);
      bank = repairBankName(rest.slice(dash + 1)) ?? (squish(rest.slice(dash + 1)) || undefined);
    }
    return { ...base, scheme: 'imps', channel: 'IMPS', reference: m[1], name: squish(name) || undefined, bank };
  }
  m = /^NEFTIN\s+(\S+)\s+(.*?)(?:\s+-\s*(.*))?$/i.exec(text);
  if (m) {
    const tail = m[3] ?? '';
    const ifsc = IFSC_ANYWHERE.exec(tail)?.[1];
    const bankText = squish(tail.replace(ifsc ?? '', ''));
    return {
      ...base,
      scheme: 'neft',
      channel: 'NEFT',
      reference: m[1],
      name: squish(m[2]) || undefined,
      bank: repairBankName(bankText) ?? (bankText || undefined),
      ifsc,
    };
  }
  // "NEFT <utr> <Name with initials>-<BANK NAME LIMITED> <IFSC>" (outward NEFT/RTGS/IMPS at several banks)
  m = /^(NEFT|RTGS|IMPS)\s+(?=[^\s-]*\d)([^\s-]+)\s+(.*)$/i.exec(text);
  if (m) {
    const kind = m[1].toUpperCase();
    const split = splitNameBank(m[3]);
    return {
      ...base,
      scheme: kind === 'NEFT' ? 'neft' : kind === 'RTGS' ? 'rtgs' : 'imps',
      channel: kind === 'NEFT' ? 'NEFT' : kind === 'RTGS' ? 'RTGS' : 'IMPS',
      reference: m[2],
      name: split.name,
      bank: split.bank,
      ifsc: split.ifsc,
    };
  }

  // ── ICICI and other slash-delimited layouts ─────────────────────────────────────────────────
  if (/^UPI\//i.test(text)) {
    const parts = text.split('/').map((p) => squish(p));
    const classic = /^\d[\d\s]{8,}$/.test(parts[1] ?? '') && parts.length >= 4 && looksLikeVpa(parts[3] ?? '');
    if (classic) {
      const row = parseUpiSlash(parts, base);
      if (row) return row;
    }
    const n = parseUpiNarration(text);
    if (n.vpa || n.name) return fromNarration(base, 'upi', 'UPI', n);
    return parseUpiSlash(parts, base) ?? fromNarration(base, 'upi', 'UPI', n);
  }
  m = /^MMT\/IMPS\/(\d+)\/(.*)$/i.exec(text);
  if (m) {
    const parts = m[2].split('/').map((p) => squish(p));
    let ifsc: string | undefined;
    let bank: string | undefined;
    if (parts.length && IFSC.test(parts[parts.length - 1].replace(/\s+/g, ''))) {
      ifsc = parts.pop()!.replace(/\s+/g, '');
    } else if (parts.length >= 3) {
      const last = parts[parts.length - 1];
      const repaired = repairBankName(last);
      if (repaired && /bank/i.test(repaired)) {
        bank = repaired;
        parts.pop();
      }
    }
    const name = parts.length >= 2 ? parts[parts.length - 1] : undefined;
    const remark = cleanNote(parts.length >= 2 ? parts.slice(0, -1).join(' ') : parts.join(' '));
    return { ...base, scheme: 'imps', channel: 'IMPS', reference: m[1], name, note: remark, ifsc, bank };
  }
  m = /^(NEFT|RTGS)-([A-Za-z0-9]+)-(.*)$/i.exec(text);
  if (m) {
    const scheme = m[1].toUpperCase() === 'RTGS' ? 'rtgs' : 'neft';
    const utr = /\d{6,}/.exec(m[2])?.[0] ?? m[2];
    const rest = m[3];
    const ifsc = IFSC_ANYWHERE.exec(rest)?.[1];
    const segs = rest.split('-').map((s) => squish(s)).filter(Boolean);
    const name = segs[0]?.replace(/\b\d{6,}\b/g, '').trim() || undefined;
    const note = cleanNote(segs.slice(1).filter((s) => !IFSC.test(s)).join(' '));
    return { ...base, scheme, channel: scheme === 'rtgs' ? 'RTGS' : 'NEFT', reference: utr, name, note, ifsc };
  }
  m = /^ACH\/\s*(.*)$/i.exec(text);
  if (m) {
    const segs = m[1].split('/').map((s) => squish(s)).filter(Boolean);
    return { ...base, scheme: 'ach', channel: 'ACH', name: segs[0], note: cleanNote(segs.slice(1).join(' ')), reference: segs.find((s) => /^\d{6,}$/.test(s)) };
  }
  if (/^(?:N?ACH|ECS|SI|E-?MANDATE|AUTO ?PAY)\b/i.test(text)) return fromNarration(base, 'ach', 'ACH', parseMandateNarration(text));
  m = /^CMS\/\s*(.*)$/i.exec(text);
  if (m) {
    const segs = m[1].split('/').map((s) => squish(s)).filter(Boolean);
    return { ...base, scheme: 'cms', channel: 'CMS', name: segs[0], note: cleanNote(segs.slice(1).join(' ')) };
  }
  m = /^BIL\/INFT\/([^/]*)\/(.*)$/i.exec(text);
  if (m) {
    const segs = m[2].split('/').map((s) => squish(s)).filter(Boolean);
    const name = segs.length >= 2 ? segs[segs.length - 1] : segs[0];
    const note = cleanNote(segs.length >= 2 ? segs.slice(0, -1).join(' ') : undefined);
    return { ...base, scheme: 'bil_transfer', channel: 'INTERNAL', reference: squish(m[1]), name, note };
  }
  m = /^BIL\/(?:[A-Z]+\/)?([^/]*)\/(.*)$/i.exec(text);
  if (m) {
    const segs = m[2].split('/').map((s) => squish(s)).filter(Boolean);
    return { ...base, scheme: 'bil', channel: 'BILLPAY', reference: digitsOnly(m[1]) || undefined, merchantText: segs.join(' ') };
  }
  m = /^INF\/(?:INFT\/)?([^/]*)\/(.*)$/i.exec(text);
  if (m) {
    const segs = m[2].split('/').map((s) => squish(s)).filter(Boolean);
    return { ...base, scheme: 'inf', channel: 'INTERNAL', reference: squish(m[1]), name: segs[segs.length - 1] };
  }
  m = /^CRED\/(.*)$/i.exec(text);
  if (m) {
    const segs = m[1].split('/').map((s) => squish(s)).filter(Boolean);
    const vpa = segs.find((s) => s.includes('@'));
    return { ...base, scheme: 'cred', channel: /^(?:UPI)/i.test(text) ? 'UPI' : 'BILLPAY', name: 'CRED', vpa: vpa ? cleanVpa(vpa) : undefined, bank: segs.length > 1 ? repairBankName(segs[segs.length - 1]) : undefined };
  }
  if (/^(?:VAT|MAT|NFS|ATW|ATD|NWD|EAW|CWDR|AWB)\b|^ATM[/\s-]|\bCASH WDL\b|\bCASH WITHDRAWAL\b/.test(upper)) return { ...base, channel: 'ATM' };
  if (/^(?:VPS|IPS|POS|PCD|ECOM|DCARD|EDC|PUR)\b/.test(upper)) {
    const gw = stripGateway(cleanCardDescriptor(text) || text);
    return { ...base, channel: 'CARD', merchantText: gw.text, ...(gw.gateway ? { gateway: gw.gateway } : {}) };
  }
  if (/^(?:CHQ|CHEQUE|CLG|CLEARING|CTS)\b/.test(upper)) return { ...base, channel: 'CHEQUE' };
  if (/\bINTEREST\b|\bINT\.?\s?PD\b/.test(upper) && !/\bCHARG/.test(upper)) return { ...base, channel: 'INTEREST' };
  if (/\b(?:CHARGES?|FEES?|GST|IGST|CGST|SGST)\b/.test(upper)) return { ...base, channel: 'CHARGE' };
  if (/^(?:TOP|RCHG|RECHARGE)\b/.test(upper)) return { ...base, channel: 'BILLPAY', merchantText: squish(text.replace(/^[A-Za-z]+[/\s-]+/, '')) };
  if (/^(?:BBPS|BILLPAY|IB BILLPAY|BPAY|BILL PAY)\b/i.test(text)) return { ...base, scheme: 'bil', channel: 'BILLPAY', merchantText: squish(text.replace(/^(?:IB )?(?:BBPS|BILLPAY|BPAY|BILL PAY)(?:\s+(?:DR|CR))?[\s/-]+/i, '')) };
  if (/^EBA\b/.test(upper)) return { ...base, channel: 'INTERNAL', merchantText: 'ICICIdirect' };
  const wallet = parseWalletText(text);
  if (wallet) return { ...base, scheme: 'transfer', channel: 'UPI', name: wallet.name };
  if (/^(?:(?:TO|BY)\s+TRANSFER[-\s:/]*)?UPI(?:AR|OUT|IN)?(?![A-Za-z])/i.test(text) || (/@/.test(text) && /\bUPI\b/i.test(text))) {
    return fromNarration(base, 'upi', 'UPI', parseUpiNarration(text));
  }
  const rail = /^(?:(?:TO|BY)\s+TRANSFER[-\s:/]*)?(NEFT|RTGS|IMPS)\b/i.exec(text) ?? /\b(NEFT|RTGS|IMPS)\b/i.exec(text);
  if (rail) {
    const kind = rail[1].toUpperCase();
    const scheme: Scheme = kind === 'NEFT' ? 'neft' : kind === 'RTGS' ? 'rtgs' : 'imps';
    const channel: Channel = kind === 'NEFT' ? 'NEFT' : kind === 'RTGS' ? 'RTGS' : 'IMPS';
    const n = parseTransferNarration(text);
    const structured = text.split(/[-/*:|~]/).length >= 3;
    if (n.name && structured) return fromNarration(base, scheme, channel, n);
    return { ...base, scheme, channel, merchantText: text, ifsc: n.ifsc, bank: n.bank };
  }
  return { ...base, merchantText: text };
}
