/** Random UUID (browser and Node 19+). */
export function newId(): string {
  return crypto.randomUUID();
}

export function nowTimestamp(): string {
  return new Date().toISOString();
}

/** SHA-256 hex digest of bytes or text (Web Crypto; available in browsers and Node 19+). */
export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
