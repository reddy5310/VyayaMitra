/**
 * Text clean-up for statement descriptions: wrap-artifact repair, merchant-name normalisation,
 * title-casing and the canonical merchantKey.
 */
import { BRANDS, canon } from './brands';
import { BANK_NAMES } from './entities';

export function squish(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ─── vocabulary used to decide whether a joined fragment is a real word ──────────────────────────

const EXTRA_WORDS = `
india indian pharmacy pharmacies pharma medical medicals medico hospital hospitals clinic nagar nagaran colony hills hill road street layout phase sector circle junction centre center
bakery bakers baker sweets sweet house foods food mart stores store supermarket super market general kirana traders trading enterprises enterprise agencies agency industries
mobiles mobile electronics electricals electrical communications services service solutions technologies technology software systems infotech digital online retail
restaurant restaurants cafe coffee tea chai juice juices tiffin tiffins biryani meals mess canteen dhaba hotel hotels lodge resort resorts residency palace grand royal
sri shri smt kumar kumari reddy rao naidu raju sai ram krishna lakshmi laxmi venkata venkatesh ganesh shiva durga saraswathi
fashion fashions garments textiles silks sarees jewellers jewellery jewelers boutique opticals optical optician dental clinic diagnostic diagnostics labs lab wellness
petrol fuel diesel gas agency motors motor auto automobiles tyres tyre garage service
beauty salon parlour unisex gym fitness yoga academy institute school college classes coaching tuition
general fancy gift gifts toys books stationery xerox copiers printers computers
telecom network broadband fibernet cable vision tv
enterprises corporation company limited private pvt ltd llp
chicken mutton fish fruits vegetables milk dairy ice cream cake cakes pizza burger
the and of for
`
  .split(/\s+/)
  .filter(Boolean);

const KNOWN = new Set<string>(EXTRA_WORDS);
for (const b of BRANDS) {
  for (const a of b.aliases) for (const w of a.split(' ')) if (/^[a-z]{3,}$/.test(w)) KNOWN.add(w);
}

const SMALL_WORDS = new Set(['of', 'and', 'the', 'in', 'at', 'for', 'to', 'by', 'de', 'la', 'on', 'via', 'ph']);

function isKnown(word: string): boolean {
  return KNOWN.has(word.toLowerCase());
}

/** Words that must stay upper-case in display names. */
const ACRONYMS = new Set(
  'ccd kfc lic hdfc icici sbi axis pvr inox bpcl hpcl iocl irctc apsrtc tsrtc ksrtc msrtc gsrtc bmtc dtc act bsnl mrf ceat dmart igl mgl png lpg emi atm upi neft imps rtgs ach nach fd rd ppf nps sip mf amc nse bse cams ttd oyo ibis mtr tvs hp hpc ola ikea gst tds epfo kims aiims nimhans cmc srl llp pvt ltd ii iii iv it hr bbq dth tv pg mi ok ai llc usa uk'
    .split(' '),
);

/** "NAGAR" → "Nagar", "KFC" stays "KFC", consonant-only short tokens ("HPC") stay upper. */
export function titleCase(text: string): string {
  return squish(text)
    .split(' ')
    .map((tok) => {
      if (!tok) return tok;
      if (/^[^a-z]*[0-9]/i.test(tok) && !/[a-z]/i.test(tok)) return tok;
      const bare = tok.replace(/[^A-Za-z]/g, '');
      const lower = bare.toLowerCase();
      if (ACRONYMS.has(lower)) return tok.toUpperCase();
      if (bare.length >= 2 && bare.length <= 4 && !/[aeiouy]/i.test(bare) && bare === bare.toUpperCase()) return tok.toUpperCase();
      if (tok.includes('&')) return tok.toUpperCase();
      return tok
        .toLowerCase()
        .replace(/(^|[-/.'(])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
    })
    .join(' ');
}

// ─── wrap-artifact repair ────────────────────────────────────────────────────────────────────────

/**
 * Statements wrap or justify text mid-word: "Amazon I ndia", "ASTER PH ARMACY", "RAMALAXM I NAGAR".
 * Fragments are joined only when the joined form is a known word/brand, or when a single letter is
 * stranded after an unknown word ("RAMALAXM" + "I"). Real initials ("P K BAKERS") are left alone.
 */
export function repairFragments(text: string): string {
  const tokens = squish(text).split(' ').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (next && /^[A-Za-z]+$/.test(t) && /^[A-Za-z]+$/.test(next)) {
      const joined = t + next;
      const joinable = isKnown(joined) && (!isKnown(t) || !isKnown(next) || t.length <= 2 || next.length <= 2);
      if (joinable) {
        out.push(joined);
        i++;
        continue;
      }
    }
    // mixed-case wrap: "Kalya ni" / "V ishwa" — a Capitalised piece followed by an unknown lower-case piece
    if (
      next &&
      /^[A-Z][a-z]*$/.test(t) &&
      /^[a-z]{2,}$/.test(next) &&
      !isKnown(t) &&
      !isKnown(next) &&
      t.length + next.length >= 5 &&
      !SMALL_WORDS.has(next) &&
      /^[A-Z]/.test(tokens[i + 2] ?? '')
    ) {
      out.push(t + next);
      i++;
      continue;
    }
    // A stranded single letter is a wrap artifact only when more text follows it; a FINAL letter is the
    // visible part of a name cut at the column width ("TIFFIN C" = "Tiffin Centre"), so it is never glued on.
    if (
      i < tokens.length - 1 &&
      out.length > 0 &&
      /^[A-Za-z]$/.test(t) &&
      /^[A-Za-z]{4,}$/.test(out[out.length - 1]) &&
      !isKnown(out[out.length - 1])
    ) {
      out[out.length - 1] += t;
      continue;
    }
    out.push(t);
  }
  return out.join(' ');
}

/** Map a possibly truncated bank fragment ("State Bank Of I", "HDF C BANK LTD") to a bank name. */
export function repairBankName(fragment: string): string | undefined {
  const glued = fragment.toLowerCase().replace(/[^a-z]/g, '');
  if (glued.length < 3) return undefined;
  const stripped = glued.replace(/(ltd|limited)$/, '');
  let best: string | undefined;
  let bestLen = 0;
  for (const bank of BANK_NAMES) {
    const g = bank.toLowerCase().replace(/[^a-z]/g, '');
    if (g.startsWith(stripped) || stripped.startsWith(g)) {
      const overlap = Math.min(g.length, stripped.length);
      if (overlap > bestLen && overlap >= 3) {
        best = bank;
        bestLen = overlap;
      }
    }
  }
  if (!best && stripped.endsWith('bank')) return titleCase(squish(fragment.replace(/\b(ltd|limited)\b/gi, '')));
  return best;
}

// ─── merchant name clean-up ──────────────────────────────────────────────────────────────────────

const LEGAL_SUFFIX = /\s+(?:(?:pvt|private)\.?\s+(?:ltd|limited)\.?|pvt\.?|private|ltd\.?|limited|llp|corp\.?|corporation|co\.?|opc)$/i;
const CHANNEL_PREFIX = /^(?:upi|imps|neft|rtgs|ach|nach|ecs|pos|ecom|vps|ips|mmt|bil|cms|inf|pcd|atm)(?=[\s/\-~:]|$)[\s/\-~:]*/i;

function looksLikeReference(tok: string): boolean {
  if (/^\d{6,}$/.test(tok)) return true;
  if (/^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{10,}$/.test(tok)) return true;
  return /^(?:AXL|YBL|IBL|HDF|ICI|PPPL|YJP|UTIB|SBIN)[A-Za-z0-9]{8,}$/.test(tok);
}

/** "FlipkartInternetPvtLtd" → "Flipkart Internet Pvt Ltd" (PascalCase only: "iPhone", "sRide" and "YouTube"-style brands are matched compactly). */
function splitPascalCase(tok: string): string {
  return /^[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+$/.test(tok) ? tok.replace(/([a-z0-9])([A-Z])/g, '$1 $2') : tok;
}

/** Corporate words glued to the end of a compact name, stripped before compact brand matching. */
const GLUED_SUFFIX = /(?:privatelimited|pvtltd|limited|ltd|inc|llp|corporation|corp|technologies|technology|services|solutions)$/;

export function stripGluedSuffix(compact: string): string {
  let s = compact;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(GLUED_SUFFIX, '');
    if (next === s || next.length < 5) break;
    s = next;
  }
  return s;
}

/** Clean a raw merchant fragment into a readable name (still in original letter case). */
export function cleanMerchantText(raw: string): string {
  let s = squish(raw.replace(/[~|]/g, ' '));
  s = s.replace(CHANNEL_PREFIX, '');
  s = s.replace(/^\d{6,}[\s/~-]+/, '');
  // "Pay Hive 356 - Ref No: [" : reference markers and brackets are never part of a merchant name
  s = s.replace(/\s*[-–]?\s*\bRef(?:erence)?\.?\s*(?:No|Number|#)\.?\s*[:#]?.*$/i, '');
  s = squish(s.replace(/[[\]{}]/g, ' '));
  // trailing txn ids such as "-AXLab12…" / "-YBL…"
  s = s.replace(/\s*-\s*(?:AXL|YBL|IBL|HDF|ICI|PPPL|YJP)[A-Za-z0-9]*$/i, '');
  // country code printed by card networks ("AMAZON INDIA IN"): drop it before repairing so "T IN" is not read as "TIN"
  s = s.replace(/\s*\*+\s*$/, '');
  s = s.replace(/\s+IND?$/i, (m, offset: number) => (s.slice(0, offset).includes(' ') || offset > 3 ? '' : m));
  s = s.split(' ').map(splitPascalCase).join(' ');
  s = repairFragments(s);
  let tokens = s.split(' ').filter((t) => t && !looksLikeReference(t));
  // phone numbers and bare digits are not part of a merchant name
  tokens = tokens.filter((t) => !/^\+?\d{8,}$/.test(t));
  if (tokens.length > 1 && /^www$/i.test(tokens[0])) tokens.shift();
  if (tokens.length > 1 && /^com$/i.test(tokens[tokens.length - 1])) tokens.pop();
  // country code printed by card networks: "AMAZON INDIA IN"
  if (tokens.length > 1 && /^ind?$/i.test(tokens[tokens.length - 1])) tokens.pop();
  s = tokens.join(' ');
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEGAL_SUFFIX, '').replace(/[\s\-,.:;]+$/g, '');
    if (next === s || !next) break;
    s = next;
  }
  s = s.replace(/^[\s\-,.:;]+/, '').replace(/[\s\-,.:;]+$/, '');
  return squish(s);
}

/**
 * Canonical merchant key from a display name or raw fragment:
 * lower-case alphanumerics separated by single spaces, stable across banks and statements.
 * "Amazon I ndia IN" → "amazon india".
 */
export function normalizeMerchantKey(text: string): string {
  let s = text ?? '';
  const at = s.indexOf('@');
  if (at > 0 && !/\s/.test(s.slice(0, at))) s = s.slice(0, at);
  return dropTruncatedTail(dropStoreNumber(canon(cleanMerchantText(s))));
}

/** A trailing branch / store number ("pay hive 356") is noise in the key; the display name keeps it. */
function dropStoreNumber(key: string): string {
  const tokens = key.split(' ');
  if (tokens.length >= 3 && /^\d{1,4}$/.test(tokens[tokens.length - 1]) && /[a-z]{3}/.test(tokens[tokens.length - 2])) return tokens.slice(0, -1).join(' ');
  return key;
}

/** Short words that are real words/abbreviations, never a cut-off tail. */
const TAIL_KEEP = new Set(['in', 'of', 'to', 'and', 'the', 'by', 'de', 'la', 'on', 'at', 'ok', 'pg', 'tv', 'it', 'hr', 'cc', 'ac', 'bk', 'pa', 'ma', 'my', 'we', 'go', 'ya', 'hi', 'no', 'so', 'do', 'me', 'be', 'us', 'up', 'if', 'is', 'as', 'an', 'am']);

/**
 * Statement name fields are cut at a fixed width, so a trailing 1–2 letter token is usually the start of
 * the next word ("tiffin c"). It stays in the display name but is dropped from the key so the same merchant
 * keeps one key whether the statement cut it early or late.
 */
export function dropTruncatedTail(key: string): string {
  const tokens = key.split(' ').filter(Boolean);
  if (tokens.length < 2) return key;
  const last = tokens[tokens.length - 1];
  const prev = tokens[tokens.length - 2];
  if (prev === 'and' || prev.length < 3) return key;
  if (!/^[a-z]+$/.test(last)) return key;
  const fragment = last.length === 1 || (last.length === 2 && /[aeiou]/.test(last) && !TAIL_KEEP.has(last) && !isKnown(last) && !ACRONYMS.has(last));
  return fragment ? tokens.slice(0, -1).join(' ') : key;
}
