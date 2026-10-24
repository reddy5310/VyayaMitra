/**
 * Universal narration grammars.
 *
 * Indian banks print the same facts (reference, payee, UPI handle, IFSC, bank, note) in dozens of
 * orders and separators ("UPI-NAME-VPA-IFSC-REF-NOTE" at HDFC, "TO TRANSFER-UPI/DR/ref/NAME/BANK/vpa" at
 * SBI, "UPI/P2M/ref/MERCHANT/…" at Axis, "UPI/NAME/ref/NOTE" at Kotak, "UPI/ref/DR/NAME/BANK/vpa" at Bank of
 * Baroda…). Instead of one regex per bank, narrations are split into segments and each segment is
 * classified by its SHAPE — reference, handle, IFSC, bank, rail word, transaction id, name or note — so any
 * ordering parses, including banks that are not listed anywhere.
 */
import { INSTITUTIONS, institutionFromIfsc } from '@/domain/institutions';
import { repairBankName, squish } from './text';

export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const IFSC_ANYWHERE = /\b([A-Z]{4}0[A-Z0-9]{6})\b/;

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export function cleanVpa(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

export const NOTE_NOISE = /^(?:upi|upiintent|na|nil|none|-|payment|payment from ph|upi payment|pay|paid|upi intent|collect|collect request|autopay|mandate)$/i;
const NOTE_PHRASE = /^(?:payment from (?:ph|phonepe)|upi (?:payment|intent|mandate|collect)|collect request)\b/i;
/** Typed remarks start like this; a payee name is usually printed in capitals, a remark in mixed case. */
const NOTE_LEADING = /^(?:payment|paid|pay|sent|received|refund|order|bill|rent|thanks?|dinner|lunch|food|gift|loan|emi|fees?|salary|advance|return|reimbursement|split|for)\b/i;

/** Segments that carry only the rail / direction / mode, never a payee. */
const RAIL_SEGMENT =
  /^(?:UPI(?:AR|OUT|IN|PAY|P2M|P2P)?|NEFT|IMPS|RTGS|ECS|N?ACH|SI|P2A|P2M|P2P|PAY|DR|CR|IN|OUT|TXN|TRANSFER|PAYMENT|INW|INWARD|OW|OUTWARD|MB|IB|MOB|NET|BANKING|NETBANKING|MOBILE BANKING|INTERNET BANKING|NA|NIL|NONE|REF|SUCCESS|COLLECT|AUTOPAY|MANDATE|UPIINTENT|ATM|POS|BULK|FT|FUND TRANSFER|IBFT|ONLINE)(?:[\s-]+(?:DR|CR|D|C|IN|OUT|TXN|TRANSFER|PAYMENT|DEBIT|CREDIT|INWARD|OUTWARD|RET|RETURN))*$/i;

export function looksLikeVpa(s: string): boolean {
  const v = cleanVpa(s);
  // a handle cut before its '@' is a single lower-case token; "MEERA NAIR" is a name, not a handle
  return /^[a-z0-9][a-z0-9._+-]*@[a-z0-9.-]*$/.test(v) || /^[a-z0-9][a-z0-9._-]{5,}$/.test(s.trim());
}

export function collectMasks(text: string): string[] {
  const out: string[] = [];
  const re = /(?:X{2,}|\*{2,}|x{2,})[\s-]?(\d{4})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

export function cleanNote(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let n = squish(raw.replace(/\b\d{5,}\b/g, ' '));
  n = n.replace(/^[\s\-/]+|[\s\-/]+$/g, '');
  if (!n || NOTE_NOISE.test(n) || NOTE_PHRASE.test(n)) return undefined;
  return n;
}

// ─── banks ───────────────────────────────────────────────────────────────────────────────────────

const INSTITUTION_GLUED: Array<{ glued: string; name: string }> = INSTITUTIONS.filter((i) => i.id !== 'OTHER').flatMap((i) => [
  { glued: i.name.toLowerCase().replace(/[^a-z]/g, ''), name: i.name },
  { glued: i.short.toLowerCase().replace(/[^a-z]/g, ''), name: i.name },
]);

/** "SBIN" → State Bank of India; "Kotak Mahindra Bank" → itself; "State Bank Of I" → State Bank of India. */
export function findBank(segment: string): string | undefined {
  const s = squish(segment);
  if (/^[A-Z]{4}$/.test(s)) {
    const byCode = institutionFromIfsc(`${s}0000000`);
    return byCode?.name;
  }
  const glued = s.toLowerCase().replace(/[^a-z]/g, '');
  if (glued.length < 5) return undefined;
  const hasBankWord = /bank|ltd|limited|payments?\b/i.test(s);
  if (hasBankWord || glued.length >= 8) {
    const repaired = repairBankName(s);
    if (repaired) return repaired;
  }
  if (hasBankWord || glued.length >= 8) {
    const hit = INSTITUTION_GLUED.find((i) => i.glued.length >= 5 && (glued === i.glued || (glued.length >= 6 && i.glued.startsWith(glued))));
    if (hit) return hit.name;
  }
  return undefined;
}

export function bankFromIfsc(ifsc: string | undefined): string | undefined {
  return ifsc ? institutionFromIfsc(ifsc)?.name : undefined;
}

// ─── segment classification ─────────────────────────────────────────────────────────────────────

export interface Segments {
  reference?: string;
  vpa?: string;
  ifsc?: string;
  bank?: string;
  name?: string;
  notes: string[];
  mode?: 'merchant' | 'person';
  /** A lower-case token that looks like a handle cut before its '@' ("sunil.varma77-"). */
  handleFragment?: string;
}

/** Split on every separator banks use, then re-join hyphenated handles such as "paytm-24680@ptys". */
export function splitSegments(text: string): string[] {
  const parts = text.split(/([/\-*~|:])/);
  const out: string[] = [];
  let sep = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      sep = parts[i];
      continue;
    }
    const seg = squish(parts[i]);
    const prev = out[out.length - 1];
    // "paytm" + "-" + "24680@ptys" is one handle; "UPI/9876501234@ybl" is a rail word followed by a handle
    if (seg.includes('@') && sep === '-' && prev && /^[A-Za-z]{3,10}$/.test(prev) && !RAIL_SEGMENT.test(prev) && /^\d{3,}[A-Za-z0-9]*@/.test(seg)) {
      out[out.length - 1] = `${prev}-${seg}`;
    } else if (seg) {
      out.push(seg);
    }
  }
  return out;
}

const TXID_LIKE = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{14,}$/;
const UTR_LIKE = /^[A-Z]{4,6}\d{6,}$/;
const NAME_CANDIDATE = /^[A-Za-z][A-Za-z .&'()]{2,}$/;

/** Classify segments by shape. `looseName` also accepts digits inside the payee ("ARWL FIN DIV 23 24"). */
export function classifySegments(segments: readonly string[], opts: { looseName?: boolean } = {}): Segments {
  const out: Segments = { notes: [] };
  for (const seg of segments) {
    const s = squish(seg);
    if (!s) continue;
    const compact = s.replace(/\s+/g, '');
    const m2 = /^P2([AMP])$/i.exec(s);
    if (m2) {
      out.mode = m2[1].toUpperCase() === 'M' ? 'merchant' : 'person';
      continue;
    }
    if (RAIL_SEGMENT.test(s)) continue;
    if (/^\d{9,16}$/.test(compact)) {
      out.reference ??= compact;
      continue;
    }
    if (/^[^@\s]+@/.test(s)) {
      out.vpa ??= cleanVpa(s);
      continue;
    }
    if (IFSC.test(compact.toUpperCase())) {
      out.ifsc ??= compact.toUpperCase();
      continue;
    }
    if (UTR_LIKE.test(compact)) {
      out.reference ??= compact.replace(/^[A-Z]+/, '');
      continue;
    }
    if (TXID_LIKE.test(compact) && !s.includes(' ')) continue;
    if (/^[\dXx*.]+$/.test(compact)) continue;
    const bank = findBank(s);
    if (bank && !(opts.looseName && !out.name && /\b(?:ltd|limited|finance|housing|life|insurance|mutual|amc)\b/i.test(s))) {
      out.bank ??= bank;
      continue;
    }
    if (NOTE_PHRASE.test(s) || NOTE_NOISE.test(s)) continue;
    if (/^[a-z][a-z0-9._-]{3,}$/.test(s) && !out.handleFragment) {
      out.handleFragment = s.replace(/[._-]+$/, '');
      continue;
    }
    const remark = NOTE_LEADING.test(s) && s !== s.toUpperCase();
    const nameShaped = !remark && (opts.looseName ? /[A-Za-z]{3}/.test(s) : NAME_CANDIDATE.test(s));
    if (nameShaped && !out.name) out.name = s;
    else out.notes.push(s);
  }
  return out;
}

// ─── universal parsers ──────────────────────────────────────────────────────────────────────────

export interface Narration {
  reference?: string;
  vpa?: string;
  ifsc?: string;
  bank?: string;
  name?: string;
  note?: string;
  mode?: 'merchant' | 'person';
}

function strip(text: string): string {
  return text.replace(/^(?:TO|BY)\s+TRANSFER[-\s:/]*/i, '').replace(/^(?:DEBIT|CREDIT)\s+(?=UPI|NEFT|IMPS|RTGS)/i, '');
}

function toNarration(c: Segments): Narration {
  const note = cleanNote(c.notes.join(' '));
  return { reference: c.reference, vpa: c.vpa ?? c.handleFragment, ifsc: c.ifsc, bank: c.bank ?? bankFromIfsc(c.ifsc), name: c.name, note, mode: c.mode };
}

/** Any UPI narration: "UPI-NAME-VPA-IFSC-REF-NOTE", "UPI/P2M/ref/MERCHANT/…", "UPI/NAME/ref/NOTE", … */
export function parseUpiNarration(text: string): Narration {
  return toNarration(classifySegments(splitSegments(strip(text))));
}

/** NEFT / IMPS / RTGS in any separator style ("NEFT*IFSC*UTR*NAME", "IMPS-ref-NAME-BANK-XXXX1234-note"). */
export function parseTransferNarration(text: string): Narration {
  return toNarration(classifySegments(splitSegments(strip(text))));
}

/** NACH / ACH / ECS / SI mandates: "ACH D- NAME-ref", "NACH-DR-NAME", "ECS/NAME/ref". */
export function parseMandateNarration(text: string): Narration {
  return toNarration(classifySegments(splitSegments(strip(text)), { looseName: true }));
}

// ─── card descriptors ───────────────────────────────────────────────────────────────────────────

const CARD_PREFIX = /^(?:(?:POS|ECOM|PUR|PCD|DCARD|IPS|VPS|EDC|ECM|DC|CC|SALE|TXN|PURCHASE)(?:[\s/-]+|$))+/i;
const MASKED_CARD = /\b\d{4}[Xx*]{4,}\d{2,4}\b|\b[Xx*]{4,}\d{4}\b|\b\d{6}[Xx*]{4,}\d{4}\b/g;
const COUNTRY_CODES = new Set(['IN', 'US', 'GB', 'SG', 'AE', 'DE', 'NL', 'IE', 'HK', 'CA', 'AU', 'FR', 'JP', 'CH', 'SE', 'LU', 'CY', 'MY', 'TH', 'ID', 'PH', 'LK', 'NP', 'BD', 'QA', 'SA', 'ES', 'IT']);

const CITIES = new Set(
  'mumbai delhi bangalore bengaluru hyderabad chennai kolkata pune ahmedabad surat jaipur lucknow kanpur nagpur indore bhopal visakhapatnam vizag patna vadodara ghaziabad ludhiana agra nashik faridabad meerut rajkot varanasi srinagar aurangabad dhanbad amritsar allahabad prayagraj ranchi howrah coimbatore jabalpur gwalior vijayawada jodhpur madurai raipur kota guwahati chandigarh solapur hubli mysore mysuru tiruchirappalli trichy bareilly moradabad gurgaon gurugram noida thane navi secunderabad thiruvananthapuram trivandrum kochi cochin kozhikode calicut mangalore mangaluru guntur nellore warangal tirupati kurnool rajahmundry kakinada vellore salem erode tirunelveli udaipur dehradun shimla panaji goa london singapore dubai'
    .split(' '),
);

/** Strip POS/ECOM prefixes, masked card numbers, trailing country codes and a trailing city from a card descriptor. */
export function cleanCardDescriptor(text: string): string {
  let s = squish(text.replace(MASKED_CARD, ' '));
  // "MERCHANT NAME, CITY" (Axis and others): keep the merchant, drop the city after the comma
  const comma = s.indexOf(',');
  if (comma > 0 && !/^\s*(?:inc|llc|ltd|pvt|limited|private|co)\b/i.test(s.slice(comma + 1))) s = squish(s.slice(0, comma));
  s = s.replace(CARD_PREFIX, '');
  s = s.replace(/^(?:UPI)[-/]\d{6,}[-/]/i, '');
  const tokens = s.split(' ').filter(Boolean);
  const dropTail = (pred: (t: string) => boolean) => {
    if (tokens.length > 1 && pred(tokens[tokens.length - 1])) tokens.pop();
  };
  dropTail((t) => COUNTRY_CODES.has(t.toUpperCase()));
  dropTail((t) => /^(?:INR|USD|EUR|GBP|SGD|AED)$/i.test(t));
  if (tokens.length > 2 && CITIES.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
  return tokens.join(' ');
}

/** Paytm Payments Bank and some wallets: "Paid to NAME", "Received from NAME". */
export function parseWalletText(text: string): { name: string; outgoing: boolean } | null {
  const m = /^(Paid to|Sent to|Money sent to|Received from|Money received from|Transferred to)\s+(.{2,})$/i.exec(text);
  if (!m) return null;
  return { name: squish(m[2]), outgoing: /^(?:paid|sent|money sent|transferred)/i.test(m[1]) };
}

// ─── payment-gateway prefixes on card descriptors ───────────────────────────────────────────────

const GATEWAYS: Array<[RegExp, string]> = [
  [/^(?:RAZORPAY|RAZ|RZP)\s*\*\s*/i, 'Razorpay'],
  [/^(?:CASHFREE|CAS|CF)\s*\*\s*/i, 'Cashfree'],
  [/^(?:PAYU|PYU|PU)\s*\*\s*/i, 'PayU'],
  [/^(?:CCAVENUE|CCAV)\s*\*\s*/i, 'CCAvenue'],
  [/^(?:BILLDESK|BD)\s*\*\s*/i, 'BillDesk'],
  [/^(?:PAYTM|PTM)\s*\*\s*/i, 'Paytm'],
  [/^(?:EASEBUZZ|EAZ)\s*\*\s*/i, 'Easebuzz'],
  [/^PHONEPE\s*\*\s*/i, 'PhonePe'],
  [/^JUSPAY\s*\*\s*/i, 'Juspay'],
  [/^INSTAMOJO\s*\*\s*/i, 'Instamojo'],
  [/^(?:PAYPAL|PP)\s*\*\s*/i, 'PayPal'],
  [/^PAY\s*\*\s*/i, 'a payment gateway'],
];

/** True when a descriptor starts with a gateway tag such as "RAZ*" or "PAYU*". */
export const GATEWAY_PREFIX = /^(?:(?:IAP|ECOM|POS)\s+)?(?:RAZORPAY|RAZ|RZP|CASHFREE|CAS|CF|PAYU|PYU|PU|CCAVENUE|CCAV|BILLDESK|BD|PAYTM|PTM|EASEBUZZ|EAZ|PHONEPE|JUSPAY|INSTAMOJO|PAYPAL|PP|PAY)\s*\*\s*\S/i;

/** "RAZ*SOME SHOP" → { text: "SOME SHOP", gateway: "Razorpay" }. */
export function stripGateway(text: string): { text: string; gateway?: string } {
  // card networks sometimes prepend a channel tag: "IAP CAS*SHOP" (in-app purchase), "ECOM RAZ*SHOP"
  const s = squish(text).replace(/^(?:IAP|ECOM|POS)\s+(?=[A-Z]{2,9}\s*\*)/i, '');
  for (const [re, name] of GATEWAYS) {
    if (re.test(s)) {
      const rest = squish(s.replace(re, ''));
      if (rest) return { text: rest, gateway: name };
    }
  }
  return { text: s };
}
