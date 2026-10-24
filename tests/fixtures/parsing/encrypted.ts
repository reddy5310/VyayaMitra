/**
 * Builds a tiny password-protected PDF (standard security handler, RC4 40-bit, revision 2) so the
 * password paths can be tested against the real pdf.js. The content is invented.
 */
import { createHash } from 'node:crypto';

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6,
  0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function md5(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256).map((_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 255;
    b = (b + s[a]) & 255;
    [s[a], s[b]] = [s[b], s[a]];
    out[k] = data[k] ^ s[(s[a] + s[b]) & 255];
  }
  return out;
}

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function padPassword(pw: string): Uint8Array {
  const raw = enc(pw).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(raw);
  out.set(PAD.subarray(0, 32 - raw.length), raw.length);
  return out;
}

export function buildEncryptedPdf(password: string, text = 'Encrypted statement 100.00'): Uint8Array {
  const id = enc('0123456789abcdef');
  const P = -4; // all permissions
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, P, true);

  const ownerKey = md5(padPassword(password)).subarray(0, 5);
  const O = rc4(ownerKey, padPassword(password));
  const key = md5(padPassword(password), O, pBytes, id).subarray(0, 5);
  const U = rc4(key, PAD);

  const objKey = (n: number) =>
    md5(key, Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 10);

  const content = enc(`BT /F1 12 Tf 50 700 Td (${text}) Tj ET`);
  const encContent = rc4(objKey(4), content);

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array) => {
    chunks.push(b);
    length += b.length;
  };
  const obj = (n: number, body: Uint8Array | string) => {
    offsets[n] = length;
    push(enc(`${n} 0 obj\n`));
    push(typeof body === 'string' ? enc(body) : body);
    push(enc('\nendobj\n'));
  };

  push(enc('%PDF-1.4\n'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  const streamHead = enc(`<< /Length ${encContent.length} >>\nstream\n`);
  const stream = new Uint8Array(streamHead.length + encContent.length + 10);
  stream.set(streamHead);
  stream.set(encContent, streamHead.length);
  stream.set(enc('\nendstream'), streamHead.length + encContent.length);
  obj(4, stream);
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  obj(6, `<< /Filter /Standard /V 1 /R 2 /O <${hex(O)}> /U <${hex(U)}> /P ${P} >>`);

  const xrefAt = length;
  push(enc(`xref\n0 7\n0000000000 65535 f \n`));
  for (let n = 1; n <= 6; n++) push(enc(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`));
  push(enc(`trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${xrefAt}\n%%EOF\n`));

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
