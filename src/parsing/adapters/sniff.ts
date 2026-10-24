/** Content sniffing for adapter inputs. Extensions are hints only: banks mislabel files constantly. */

const latin1 = new TextDecoder('latin1');

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

export function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

export const isZip = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
/** OLE2 / Compound File: legacy .xls, but also .doc and encrypted OOXML. */
export const isOle = (b: Uint8Array) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
export const isPdf = (b: Uint8Array) => startsWith(b, [0x25, 0x50, 0x44, 0x46]);

/** Latin-1 view of the leading bytes, lower-cased (cheap, never throws). */
export function headText(bytes: Uint8Array, max = 65536): string {
  return latin1.decode(bytes.subarray(0, Math.min(bytes.length, max))).toLowerCase();
}

/** True if the UTF-16LE spelling of `s` occurs in the bytes (OLE directory entry names are UTF-16). */
export function containsUtf16(bytes: Uint8Array, s: string): boolean {
  const pat = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) pat[i * 2] = s.charCodeAt(i);
  const first = pat[0];
  outer: for (let i = 0; i <= bytes.length - pat.length; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < pat.length; j++) if (bytes[i + j] !== pat[j]) continue outer;
    return true;
  }
  return false;
}

/** Strip a UTF-8/UTF-16 BOM and leading whitespace, for "does it start with <" checks. */
export function leadingNonSpace(text: string): string {
  return text.replace(/^(?:\uFEFF|\u00ef\u00bb\u00bf|\s)+/, '');
}
