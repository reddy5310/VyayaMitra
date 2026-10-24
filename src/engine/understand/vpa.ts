/**
 * UPI handle (VPA) intelligence: is it a shop/brand or a person?
 * Handles printed on statements are often truncated ("myntra2.payu@hd", "sunitaverma"), so every
 * rule works on the local part and tolerates a missing/short domain.
 */
import { titleCase } from './text';

export interface VpaInfo {
  local: string;
  domain: string;
  cls: 'merchant' | 'person';
  /** True when the local part is a mobile number. */
  phone: boolean;
  /** How the merchant was recognised; only meaningful when cls === 'merchant'. */
  source: 'qr' | 'gateway' | 'store' | 'business' | 'none';
  /** Network/brand label for QR handles, e.g. "PhonePe". */
  label: string;
}

export function splitVpa(vpa: string): { local: string; domain: string } {
  const v = vpa.trim().toLowerCase().replace(/\s+/g, '');
  const at = v.indexOf('@');
  return at < 0 ? { local: v, domain: '' } : { local: v.slice(0, at), domain: v.slice(at + 1) };
}

const GATEWAY = /(?:^|[._-])(?:payu|razorpay|rzp|cashfree|cf|billdesk|bd|ccavenue|instamojo|juspay|easebuzz|pinelabs|mswipe|ezetap|worldline|airpay|payzapp|paynimo|tpsl|paytmpg|getepay|pgpay|upipay|pg)(?:[._-]|\d|$)|^(?:razorpay|rzp|payu|cashfree|billdesk|ccavenue|juspay|easebuzz)/;
const BUSINESS_WORD =
  /pharmacy|pharma|medical|medicals|traders|trading|enterprises|enterprise|foods|hotel|restaurant|bakery|bakers|mobiles|supermarket|kirana|stores?|sweets|cafe|salon|garments|textiles|electronics|hospital|clinic|school|college|travels|petrol|fuel|motors|agencies|services|solutions|technologies|infotech|hardware|stationery|optical|jewellers|jewellery|fashion|boutique|dairy|tiffin|biryani|bazaar|offline|ecom/;

const HANDLE_NOISE = new Set(['cf', 'payu', 'rzp', 'razorpay', 'bd', 'billdesk', 'pg', 'upi', 'offline', 'online', 'ecom', 'pos', 'qr', 'pay', 'vpa', 'biz', 'bizsbiz', 'sbiz']);

export function isPhoneNumber(local: string): boolean {
  return /^(?:\+?91)?[6-9]\d{9}$/.test(local);
}

export function classifyVpa(vpa: string): VpaInfo {
  const { local, domain } = splitVpa(vpa);
  const base = { local, domain, phone: false };
  const qr = (label: string): VpaInfo => ({ ...base, cls: 'merchant', source: 'qr', label });
  const other = (source: VpaInfo['source'], label: string): VpaInfo => ({ ...base, cls: 'merchant', source, label });

  if (isPhoneNumber(local)) return { ...base, cls: 'person', phone: true, source: 'none', label: 'mobile number' };

  if (/^paytmqr/.test(local) || /^paytm[-.]/.test(local) || /^(?:ptys|ptybl|ptyes|pty|pthdfc|ptsbi|ptaxis)/.test(domain)) return qr('Paytm');
  if (/^q\d{6,}$/.test(local)) return qr('PhonePe');
  if (/^bharatpe/.test(local) || /^fbpe/.test(domain)) return qr('BharatPe');
  if (/^gpay-\d+$/.test(local) || /^okbizaxis/.test(domain) || /^okbiz/.test(domain)) return qr('Google Pay for Business');
  if (/^bajajpay/.test(local)) return qr('Bajaj Pay');
  if (/^yespay|yespay\.biz|^yesbank\.in/.test(local)) return qr('YesPay');
  if (/^mab\.|^mswipe|^ezetap|^ibkpos|^hdfcbankpos|^sbipos|^posaxis/.test(local)) return qr('card machine');
  if (GATEWAY.test(local)) return other('gateway', 'payment gateway');
  if (/offline/.test(local) || /(?:^|[._-])(?:pos|store|ecom)(?:[._-]|\d|$)/.test(local)) return other('store', 'store');
  if (BUSINESS_WORD.test(local) && local.replace(/[^a-z]/g, '').length >= 8) return other('business', 'business');
  return { ...base, cls: 'person', source: 'none', label: 'personal handle' };
}

/** Readable name from a name-like handle: "k.suresh17-2" → "K Suresh"; phone handles → undefined. */
export function nameFromHandle(vpa: string): string | undefined {
  const { local } = splitVpa(vpa);
  if (!local || isPhoneNumber(local)) return undefined;
  const words = local
    .replace(/\d+/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w && !HANDLE_NOISE.has(w));
  if (words.length === 0) return undefined;
  // random ids such as "qz71k8pw2" carry no name
  if (words.join('').length < 3) return undefined;
  if (/^[a-z]{1,2}\d/.test(local) && /\d.*[a-z]/.test(local) && words.join('').length < 6) return undefined;
  return titleCase(words.join(' '));
}
