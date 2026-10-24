/**
 * Whole-word phrase index. Used for the brand dictionary and for the entity tables
 * (investment platforms, lenders, employers…). Longest alias wins; nothing ever matches inside a word.
 */
import { canon } from './brands';

export interface PhraseHit<T> {
  value: T;
  alias: string;
}

interface Indexed<T> {
  value: T;
  alias: string;
  words: string[];
  /** alias without spaces (used for VPA handles, which have no word breaks) */
  compact: string;
}

export class PhraseIndex<T> {
  private readonly byFirst = new Map<string, Indexed<T>[]>();
  private readonly all: Indexed<T>[] = [];

  constructor(entries: ReadonlyArray<{ value: T; aliases: readonly string[] }>) {
    for (const e of entries) {
      for (const raw of e.aliases) {
        const alias = canon(raw);
        if (!alias) continue;
        this.add({ value: e.value, alias, words: alias.split(' '), compact: alias.replace(/ /g, '') });
        // "big basket" should also match the glued "bigbasket" that card statements print.
        const glued = alias.replace(/ /g, '');
        if (glued !== alias && glued.length >= 6) {
          this.add({ value: e.value, alias: glued, words: [glued], compact: glued });
        }
      }
    }
  }

  private add(item: Indexed<T>): void {
    this.all.push(item);
    const list = this.byFirst.get(item.words[0]);
    if (list) list.push(item);
    else this.byFirst.set(item.words[0], [item]);
  }

  /** Search canonical (see `canon`) text. */
  findInText(canonText: string): PhraseHit<T> | null {
    if (!canonText) return null;
    const tokens = canonText.split(' ');
    let best: Indexed<T> | null = null;
    for (let i = 0; i < tokens.length; i++) {
      const candidates = this.byFirst.get(tokens[i]);
      if (!candidates) continue;
      for (const c of candidates) {
        if (best && c.alias.length <= best.alias.length) continue;
        if (i + c.words.length > tokens.length) continue;
        let ok = true;
        for (let k = 1; k < c.words.length; k++) {
          if (tokens[i + k] !== c.words[k]) {
            ok = false;
            break;
          }
        }
        if (ok) best = c;
      }
    }
    return best ? { value: best.value, alias: best.alias } : null;
  }

  /**
   * Glued or wrapped text ("flipkartinternet", "hungerbox"): the alias must equal the whole compact text, or be at
   * least `minLen` letters and cover `coverage` of it. Used only when nothing matched word by word.
   */
  findCompact(compactText: string, opts: { minLen?: number; coverage?: number } = {}): PhraseHit<T> | null {
    const { minLen = 7, coverage = 0.6 } = opts;
    if (compactText.length < 5) return null;
    let best: Indexed<T> | null = null;
    for (const c of this.all) {
      if (c.compact.length < 5 || c.compact.length > compactText.length) continue;
      if (best && c.compact.length <= best.compact.length) continue;
      const whole = c.compact === compactText;
      if (whole || (c.compact.length >= minLen && c.compact.length / compactText.length >= coverage && compactText.includes(c.compact))) best = c;
    }
    return best ? { value: best.value, alias: best.alias } : null;
  }

  /**
   * Search the local part of a UPI handle ("swiggyinstamart.rzp", "apollopharmacyoffline").
   * Short aliases must equal a whole dotted/dashed segment; long aliases (≥ 6 letters) may be contained
   * in the glued handle.
   */
  findInHandle(localPart: string): PhraseHit<T> | null {
    const segments = localPart.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (segments.length === 0) return null;
    const viaText = this.findInText(segments.join(' '));
    const glued = segments.join('');
    let best: Indexed<T> | null = null;
    for (const c of this.all) {
      if (c.compact.length < 6) continue;
      if (best && c.compact.length <= best.compact.length) continue;
      if (glued.includes(c.compact)) best = c;
    }
    if (viaText && (!best || viaText.alias.replace(/ /g, '').length >= best.compact.length)) return viaText;
    return best ? { value: best.value, alias: best.alias } : null;
  }
}
