/**
 * The decision pipeline behind `understand()`.
 *
 * KIND, in order of precedence:
 *   user rule → structural text (interest, fees, cash, card bill, EMI, salary, dividends, investments)
 *   → own-account transfer → account-type semantics (credit cards) → refund/reversal keywords
 *   → merchant vs person → unknown.
 * CATEGORY, in order of precedence:
 *   user rule → brand dictionary (longest alias) → VPA-handle brand → generic whole-word keyword
 *   → learned model → kind default → uncategorized (source "none").
 *
 * Confidence is calibrated, and kept separate from categorySource:
 *   user rule 0.98 · brand 0.90 · VPA handle 0.85 · structural kind ≈ 0.80–0.85 · generic keyword 0.60
 *   · learned = probability × 0.90 · person-to-person 0.60 · refund by text 0.75 · none 0.
 * A decision is flagged for review when confidence < 0.6, the kind is unknown, a spending kind has no
 * category, or a p2p_out reaches the user's review threshold.
 */
import { BUILTIN_CATEGORIES, KIND_DEFAULT_CATEGORY, UNCATEGORIZED, categoryName } from '@/domain/categories';
import { SPENDING_KINDS } from '@/domain/kinds';
import type { Account, CategorySource, Channel, Counterparty, CounterpartyType, Direction, KindSource, TxnKind } from '@/domain/types';
import { formatINR } from '@/lib/money';
import { BRANDS, canon, type Brand } from './brands';
import { ENTITY_INDEX, type Entity } from './entities';
import type { UnderstandContext, UnderstandInput, Understanding } from './index';
import { findKeyword, type KeywordHit } from './keywords';
import { categoryFromBankCategory } from './mcc';
import { recall, rank, handleKey, MIN_PROBABILITY } from './learned';
import { findOwnByHandle, findOwnByMask, findOwnByName, type OwnHit } from './ownership';
import { parseDescription, type ParsedDescription } from './parse';
import { PhraseIndex } from './phrases';
import { selectRules, type RuleDecision } from './rules';
import { isFamilyRemark, SIGNALS } from './signals';
import { calibrateConfidence } from './selftrain';
import { cleanMerchantText, normalizeMerchantKey, squish, stripGluedSuffix, titleCase } from './text';
import { classifyVpa, nameFromHandle, splitVpa, type VpaInfo } from './vpa';

const BRAND_INDEX = new PhraseIndex<Brand>(BRANDS.map((b) => ({ value: b, aliases: b.aliases })));

interface BrandHit {
  brand: Brand;
  alias: string;
  via: 'text' | 'vpa';
}

/** Everything the decision steps need, computed once. */
interface Env {
  input: UnderstandInput;
  ctx: UnderstandContext;
  parsed: ParsedDescription;
  isCredit: boolean;
  isCard: boolean;
  /** UPI rows are free-text-poor: structural regexes (fees, EMI…) do not run on them. */
  lowRail: boolean;
  /** UPI / IMPS / NEFT / RTGS / internal transfers: a named payee or payer. */
  transferLike: boolean;
  vpaInfo?: VpaInfo;
  brand?: BrandHit;
  entity?: Entity;
  own?: OwnHit;
  /** Payee/merchant fragment cleaned for display. */
  nameText: string;
  companyLike: boolean;
  businessLike: boolean;
  keyword?: KeywordHit;
  noteKeyword?: KeywordHit;
  /** Text searched by the structural regexes. */
  struct: string;
}

interface Decision {
  kind: TxnKind;
  src: KindSource;
  conf: number;
  reasons: string[];
  cpType: CounterpartyType;
  /** Fixed category implied by the structural rule (e.g. salary). */
  category?: string;
  catSrc?: CategorySource;
  /** Display label used when there is no usable payee name. */
  label?: string;
  /** Always use `label` as the merchant (ATM, interest…). */
  forceLabel?: boolean;
  channel?: Channel;
  review?: string;
}

const ALL_CATEGORY_GROUPS = new Map(BUILTIN_CATEGORIES.map((c) => [c.id, c.group]));

function isSpendCategory(id: string, ctx: UnderstandContext): boolean {
  const custom = ctx.customCategories?.find((c) => c.id === id);
  const group = custom?.group ?? ALL_CATEGORY_GROUPS.get(id);
  if (!group) return true; // unknown id → treat as a user-defined spending category
  if (id === 'received_from_people') return false;
  return ['essentials', 'lifestyle', 'people', 'commitments', 'fees', 'cash'].includes(group);
}

function categoryGroup(id: string, ctx: UnderstandContext): string | undefined {
  return ctx.customCategories?.find((c) => c.id === id)?.group ?? ALL_CATEGORY_GROUPS.get(id);
}

function uniqueAccounts(accounts: readonly Account[]): Account[] {
  const seen = new Set<string>();
  const out: Account[] = [];
  for (const a of accounts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

const MERCHANT_SCHEMES = new Set(['card_plain', 'card_upi', 'bil']);
/** Rows whose text is a payee name or free narration, where compact brand matching would only add noise. */
const MERCHANT_COMPACT_SKIP = new Set(['upi', 'imps', 'neft', 'rtgs', 'transfer', 'bil_transfer', 'inf', 'ach', 'cms', 'cred']);

// ─── environment ─────────────────────────────────────────────────────────────────────────────────

function buildEnv(input: UnderstandInput, ctx: UnderstandContext): Env {
  const parsed = parseDescription(input.description, ctx.account.type);
  const isCard = ctx.account.type === 'credit_card';
  const isCredit = input.direction === 'credit';
  const lowRail = parsed.scheme === 'upi' || parsed.scheme === 'card_upi' || parsed.scheme === 'transfer';
  const transferLike = ['upi', 'imps', 'neft', 'rtgs', 'bil_transfer', 'inf', 'transfer'].includes(parsed.scheme);
  const vpaInfo = parsed.vpa ? classifyVpa(parsed.vpa) : undefined;
  const local = parsed.vpa ? splitVpa(parsed.vpa).local : '';

  const fields = [parsed.name, parsed.merchantText, parsed.note].filter((x): x is string => !!x).join(' ');
  const fieldCanon = canon(cleanMerchantText(fields) || fields);

  // entity (investment platform, lender, employer, government)
  const entity =
    ENTITY_INDEX.findInText(canon(fields))?.value ?? (local ? ENTITY_INDEX.findInHandle(local)?.value : undefined);

  // brand: text hit vs VPA-handle hit; the longer alias wins, text wins ties
  let textHit = BRAND_INDEX.findInText(fieldCanon);
  if (textHit && vpaInfo?.cls === 'person' && transferLike && textHit.alias.length < 5) textHit = null;
  // glued or wrapped names ("FlipkartInternetPvtLtd", "HungerBo x"): match on the compact text as a last resort
  if (!textHit && !entity && !MERCHANT_COMPACT_SKIP.has(parsed.scheme) && !(vpaInfo?.cls === 'person' && transferLike)) {
    const compact = stripGluedSuffix(fieldCanon.replace(/ /g, ''));
    const glued = BRAND_INDEX.findCompact(compact);
    if (glued) textHit = glued;
  }
  const vpaHit = local ? BRAND_INDEX.findInHandle(local) : null;
  let brand: BrandHit | undefined;
  if (textHit && (!vpaHit || textHit.alias.length >= vpaHit.alias.length)) brand = { brand: textHit.value, alias: textHit.alias, via: 'text' };
  else if (vpaHit) brand = { brand: vpaHit.value, alias: vpaHit.alias, via: 'vpa' };

  const allOwn = uniqueAccounts([...ctx.ownAccounts, ctx.account]);
  let own: OwnHit | undefined;
  if (!isCard && (transferLike || parsed.scheme === 'ach') && parsed.name) own = findOwnByName(parsed.name, allOwn);
  if (!own && parsed.maskedAccounts.length) own = findOwnByMask(parsed.maskedAccounts, allOwn, ctx.account.id);
  if (!own && vpaInfo?.cls === 'person' && !vpaInfo.phone && !isCard) own = findOwnByHandle(local, allOwn);

  const rawName = parsed.name ?? parsed.merchantText ?? '';
  const personName = !!parsed.name && transferLike && vpaInfo?.cls !== 'merchant' && parsed.mode !== 'merchant' && !brand && !SIGNALS.companyName.test(rawName.toUpperCase());
  const nameText = personName ? squish(rawName) : cleanMerchantText(rawName);
  const nameUpper = rawName.toUpperCase();
  const companyLike = SIGNALS.companyName.test(nameUpper);
  const businessLike = SIGNALS.businessName.test(nameUpper);

  const strongMerchant = !!brand || vpaInfo?.cls === 'merchant' || parsed.mode === 'merchant' || companyLike || businessLike || MERCHANT_SCHEMES.has(parsed.scheme);
  const personEvidence = transferLike && !strongMerchant;
  const kwText = personEvidence ? '' : canon(nameText || parsed.merchantText || '');
  const keyword = kwText ? findKeyword(kwText, { allowPrefix: true }) ?? undefined : undefined;
  const noteKeyword = parsed.note ? findKeyword(canon(parsed.note)) ?? undefined : undefined;

  const struct = transferLike ? `${parsed.name ?? ''} ${parsed.note ?? ''} ${parsed.merchantText ?? ''}`.toUpperCase() : parsed.upper;

  return { input, ctx, parsed, isCredit, isCard, lowRail, transferLike, vpaInfo, brand, entity, own, nameText, companyLike, businessLike, keyword, noteKeyword, struct };
}

// ─── kind ────────────────────────────────────────────────────────────────────────────────────────

function vpaMerchantReason(env: Env, verb: 'to' | 'from'): string {
  const v = env.vpaInfo;
  if (!v || v.cls !== 'merchant') return `UPI payment ${verb} a merchant`;
  if (v.source === 'qr') return `UPI payment ${verb} a merchant QR (${v.label})`;
  if (v.source === 'gateway') return `UPI payment ${verb} a merchant through an online payment gateway`;
  if (v.source === 'store') return `UPI payment ${verb} a store handle`;
  return `UPI payment ${verb} a business-like handle`;
}

function looksLikePersonName(name: string): boolean {
  const upper = name.toUpperCase();
  if (!/^[A-Z]+(?: [A-Z.]+){1,3}$/.test(upper) || SIGNALS.businessName.test(upper) || SIGNALS.companyName.test(upper)) return false;
  return !findKeyword(canon(name));
}

function cardReasons(env: Env, base: string): string[] {
  const out = [base];
  const { currency, emi } = env.parsed;
  if (emi) out.push('Converted to EMI at checkout');
  if (currency) out.push(`International card payment (${currency})`, 'A forex markup fee may apply');
  if (env.parsed.gateway) out.push(`Paid through ${env.parsed.gateway}`);
  return out;
}

const SOFTWARE_HINT = /\b(?:INC|LLC|LTD|LIMITED|GMBH|PTE|CORP|SAAS|CLOUD|SOFTWARE|APP)\b|\bAI\b|\.(?:COM|IO|AI|APP|DEV|CO)\b/;

function dividendLabel(env: Env): string {
  const words = (env.parsed.name ?? '')
    .split(/[\s\-_]+/)
    .filter((w) => w && !/^(?:FIN|FINAL|INT|INTERIM|DIV|DIVIDEND|FY|\d+)$/i.test(w) && !/DIV|\d/i.test(w) && !/^(?:LTD|LIMITED)$/i.test(w));
  return words.length ? `${titleCase(words.join(' '))} dividend` : 'Dividend';
}

function decideKind(env: Env): Decision {
  const { parsed, isCredit, isCard, lowRail, struct, entity, own, vpaInfo, brand } = env;
  const debit = !isCredit;
  const U = lowRail ? '' : struct;
  const scheme = parsed.scheme;
  const nameForReason = env.nameText || parsed.vpa || 'this payee';

  // 1. interest earned
  if (isCredit && !isCard && (parsed.channel === 'INTEREST' || SIGNALS.interestCredit.test(U)) && !lowRail) {
    return { kind: 'interest', src: 'rule', conf: 0.85, cpType: 'bank', reasons: ['Interest credited by the bank'], label: 'Bank interest', forceLabel: true, channel: 'INTEREST' };
  }

  // 2. card: excess credit balance sent back to the bank account
  if (isCard && debit && SIGNALS.cardRefundTransfer.test(parsed.upper)) {
    return { kind: 'self_transfer', src: 'rule', conf: 0.85, cpType: 'own_account', reasons: ['Card credit balance refunded to your own bank account'], label: 'Card balance refund to bank', forceLabel: true, channel: 'INTERNAL' };
  }

  // 3. fees and charges (debits); fee waivers/reversals (credits)
  if (!lowRail && SIGNALS.fee.test(U) && !(entity && entity.role === 'investment')) {
    if (debit) {
      return { kind: 'fee', src: 'rule', conf: 0.85, cpType: 'bank', reasons: ['Bank or card charge (fee, GST or finance charge)'], label: isCard ? 'Card charges' : 'Bank charges', forceLabel: true, channel: 'CHARGE' };
    }
    if (SIGNALS.feeWaiver.test(U)) {
      return { kind: 'refund', src: 'rule', conf: 0.75, cpType: 'bank', reasons: ['Charge waived or reversed'], category: 'fees_charges', catSrc: 'builtin_rule', label: 'Charges reversed', forceLabel: true, channel: 'CHARGE' };
    }
  }
  if (isCard && debit && SIGNALS.cardInterest.test(parsed.upper)) {
    return { kind: 'fee', src: 'rule', conf: 0.85, cpType: 'bank', reasons: ['Interest charged on the card'], label: 'Interest charged', forceLabel: true, channel: 'CHARGE' };
  }
  if (!lowRail && debit && SIGNALS.interestDebit.test(U)) {
    return { kind: 'fee', src: 'rule', conf: 0.85, cpType: 'bank', reasons: ['Interest charged'], label: 'Interest charged', forceLabel: true, channel: 'CHARGE' };
  }

  // 4. cash
  if (debit && (parsed.channel === 'ATM' || (!lowRail && SIGNALS.cashWithdrawal.test(U)))) {
    return { kind: 'cash_withdrawal', src: 'rule', conf: 0.85, cpType: 'bank', reasons: ['ATM or cash withdrawal'], label: 'ATM cash withdrawal', forceLabel: true, channel: 'ATM' };
  }
  if (isCredit && !isCard && !lowRail && SIGNALS.cashDeposit.test(U)) {
    return { kind: 'unknown', src: 'heuristic', conf: 0.4, cpType: 'bank', reasons: ['Cash deposit — the source of the cash is not printed'], label: 'Cash deposit', forceLabel: true, review: 'Cash deposit: confirm whether it is income or your own money' };
  }

  // reward / EDGE points lines are informational: never a merchant
  if (isCard && SIGNALS.rewardLine.test(parsed.upper) && !brand) {
    return debit
      ? { kind: 'unknown', src: 'heuristic', conf: 0.3, cpType: 'bank', reasons: ['Reward points line, not a purchase'], label: 'Reward points', forceLabel: true, review: 'Reward points line: confirm whether it is a real charge' }
      : { kind: 'refund', src: 'rule', conf: 0.7, cpType: 'bank', reasons: ['Reward points redeemed against the card'], label: 'Reward points', forceLabel: true };
  }

  // 5. credit-card bill payments
  const credLocal = parsed.vpa ? splitVpa(parsed.vpa).local : '';
  if (debit && !isCard && (scheme === 'cred' || /^cred(?:club|\.club)/.test(credLocal) || /\bDREAMPLUG\b|\bCRED ?CLUB\b/.test(parsed.upper))) {
    return { kind: 'card_payment', src: 'rule', conf: 0.85, cpType: 'merchant', reasons: ['Credit-card bill paid via CRED'], label: 'CRED', forceLabel: true };
  }
  if (debit && !isCard && !lowRail && SIGNALS.cardPaymentBankDebit.test(U)) {
    return { kind: 'card_payment', src: 'rule', conf: 0.8, cpType: 'bank', reasons: ['Looks like a credit-card bill payment'], label: 'Credit card bill payment', forceLabel: true };
  }
  if (isCard && isCredit && SIGNALS.cardPaymentCardCredit.test(parsed.upper)) {
    return { kind: 'card_payment', src: 'rule', conf: 0.85, cpType: 'bank', reasons: ['Payment received on the credit card'], label: 'Card bill payment', forceLabel: true };
  }

  // 6. loans
  if (entity && (entity.role === 'lender' || entity.role === 'paylater')) {
    if (debit) {
      return { kind: 'loan_payment', src: 'rule', conf: 0.8, cpType: 'lender', reasons: [entity.role === 'paylater' ? `Repayment to ${entity.name} (pay-later)` : `Payment to lender ${entity.name}`] };
    }
    if (!SIGNALS.refundWord.test(parsed.upper)) {
      return { kind: 'loan_disbursal', src: 'heuristic', conf: 0.5, cpType: 'lender', reasons: [`Credit from lender ${entity.name}`], review: 'Credit from a lender: loan proceeds or a refund?' };
    }
  }
  if (!lowRail && debit && !isCard && SIGNALS.loan.test(U)) {
    return { kind: 'loan_payment', src: 'rule', conf: 0.8, cpType: 'lender', reasons: ['Loan EMI / repayment'], label: 'Loan EMI' };
  }
  if (!lowRail && isCredit && !isCard && SIGNALS.loanDisbursal.test(U)) {
    return { kind: 'loan_disbursal', src: 'rule', conf: 0.8, cpType: 'lender', reasons: ['Loan amount credited'], label: 'Loan disbursal' };
  }

  // 7. income (credits)
  if (isCredit && !isCard && scheme !== 'upi') {
    if (SIGNALS.taxRefund.test(U)) {
      return { kind: 'income', src: 'rule', conf: 0.8, cpType: 'government', reasons: ['Income-tax refund'], category: 'other_income', catSrc: 'builtin_rule', label: 'Income-tax refund', forceLabel: true };
    }
    if (SIGNALS.salary.test(U)) {
      return { kind: 'income', src: 'rule', conf: 0.85, cpType: 'employer', reasons: ['Salary / payroll credit'], category: 'salary', catSrc: 'builtin_rule', label: 'Salary' };
    }
    if (entity?.role === 'employer' && ['neft', 'imps', 'rtgs', 'ach', 'plain'].includes(scheme)) {
      return { kind: 'income', src: 'rule', conf: 0.7, cpType: 'employer', reasons: [`Credit from employer ${entity.name}`], category: 'salary', catSrc: 'builtin_rule' };
    }
    if (SIGNALS.bonus.test(U)) {
      return { kind: 'income', src: 'rule', conf: 0.8, cpType: 'employer', reasons: ['Bonus / incentive credit'], category: 'salary', catSrc: 'builtin_rule' };
    }
    if (SIGNALS.reimbursement.test(U)) {
      return { kind: 'income', src: 'rule', conf: 0.75, cpType: 'employer', reasons: ['Reimbursement credit'], category: 'other_income', catSrc: 'builtin_rule' };
    }
    if (SIGNALS.dividend.test(U) && !(entity?.role === 'investment')) {
      return { kind: 'income', src: 'rule', conf: 0.8, cpType: 'merchant', reasons: ['Dividend credit'], category: 'other_income', catSrc: 'builtin_rule', label: dividendLabel(env), forceLabel: true };
    }
  }

  // IPO applications: the UPI mandate block / ASBA is money set aside for shares, not a purchase from the brand in the handle
  if (/\b(?:IPO|ASBA)\b/.test(parsed.upper) || /^ipo(?:[._-]|\d|$)|[._-]ipo(?:[._-]|\d|$)/.test(credLocal)) {
    return debit
      ? { kind: 'investment', src: 'rule', conf: 0.85, cpType: 'investment_platform', reasons: ['IPO application (UPI mandate block / ASBA)'], label: 'IPO application', forceLabel: true }
      : { kind: 'investment_return', src: 'rule', conf: 0.8, cpType: 'investment_platform', reasons: ['IPO mandate released or refunded'], label: 'IPO application', forceLabel: true };
  }

  // 8. investments
  if (entity?.role === 'investment') {
    if (debit) {
      return { kind: 'investment', src: 'rule', conf: 0.85, cpType: 'investment_platform', reasons: [`Payment to ${entity.name}, an investment platform`] };
    }
    return { kind: 'investment_return', src: 'rule', conf: 0.85, cpType: 'investment_platform', reasons: [`Credit from ${entity.name}: investment withdrawal / redemption`] };
  }
  if (entity?.name === 'EPFO' && isCredit) {
    return { kind: 'investment_return', src: 'rule', conf: 0.7, cpType: 'government', reasons: ['Provident-fund withdrawal'] };
  }
  if (!lowRail && !isCard) {
    if (debit && SIGNALS.investDebit.test(U)) {
      return { kind: 'investment', src: 'rule', conf: 0.8, cpType: 'investment_platform', reasons: ['SIP / mutual fund / deposit investment keyword'], label: 'Investment' };
    }
    if (isCredit && SIGNALS.investCredit.test(U)) {
      return { kind: 'investment_return', src: 'rule', conf: 0.75, cpType: 'investment_platform', reasons: ['Investment redemption / maturity keyword'], label: 'Investment withdrawal' };
    }
  }

  // 9. between the user's own accounts
  if (own) {
    return {
      kind: 'self_transfer',
      src: 'heuristic',
      conf: own.how === 'handle' || own.how === 'initials' ? 0.75 : 0.85,
      cpType: 'own_account',
      reasons: [
        own.how === 'name'
          ? `Counterparty name matches the holder of ${own.account.name}`
          : own.how === 'handle'
            ? `UPI handle spells your own name (${own.account.holderName ?? 'account holder'})`
            : own.how === 'initials'
              ? `Name matches the holder of ${own.account.name} by initials`
              : `Account number ending ${own.account.mask ?? ''} is one of your accounts`,
      ],
      review:
        own.how === 'handle'
          ? 'The UPI handle resembles your own name: confirm this is your account'
          : own.how === 'initials'
            ? 'The name only matches your initials: confirm this is your own account'
            : undefined,
      label: own.how === 'mask' ? own.account.name : 'Own account transfer',
      forceLabel: true,
      channel: parsed.channel === 'OTHER' ? 'INTERNAL' : undefined,
    };
  }

  // 10. credit-card account semantics
  if (isCard) {
    if (debit) {
      return { kind: 'expense', src: 'rule', conf: 0.85, cpType: 'merchant', reasons: cardReasons(env, 'Purchase on a credit card') };
    }
    if (SIGNALS.cashbackWord.test(parsed.upper)) {
      return { kind: 'refund', src: 'rule', conf: 0.75, cpType: 'merchant', reasons: ['Cashback / reward credit on a credit card'] };
    }
    return { kind: 'refund', src: 'heuristic', conf: 0.7, cpType: 'merchant', reasons: cardReasons(env, 'Credit on a credit card from a merchant: refund or reversal') };
  }

  // 11. refund / reversal keywords on a credit
  if (isCredit && (SIGNALS.refundWord.test(`${parsed.upper}`) || SIGNALS.reversalWord.test(`${parsed.upper}`)) ) {
    const reversal = SIGNALS.reversalWord.test(parsed.upper);
    return {
      kind: 'refund',
      src: 'rule',
      conf: 0.75,
      cpType: vpaInfo?.cls === 'person' && !brand ? 'person' : 'merchant',
      reasons: [reversal ? 'Credit looks like a reversal of an earlier debit' : 'Credit marked as a refund / cashback'],
    };
  }

  // ACH credits are company payouts (dividends, payroll, claims), never a retail refund
  if (scheme === 'ach' && isCredit && !SIGNALS.refundWord.test(parsed.upper)) {
    return { kind: 'income', src: 'heuristic', conf: 0.6, cpType: 'employer', reasons: ['ACH credit from a company (usually a dividend or payroll)'], category: 'other_income', catSrc: 'kind_default' };
  }

  // 12. merchant vs person
  const merchantEvidence = brand || vpaInfo?.cls === 'merchant' || parsed.mode === 'merchant' || env.companyLike || env.businessLike || (env.keyword && !env.keyword.prefix) || MERCHANT_SCHEMES.has(scheme) || parsed.channel === 'CARD' || parsed.channel === 'BILLPAY';
  if (merchantEvidence) {
    const cpType: CounterpartyType = entity ? entity.type : 'merchant';
    if (debit) {
      const why: string[] = [];
      if (brand) why.push(brand.via === 'vpa' ? `UPI payment to ${brand.brand.name} (known handle)` : `Payment to ${brand.brand.name}`);
      else if (vpaInfo?.cls === 'merchant') why.push(vpaMerchantReason(env, 'to'));
      else if (parsed.mode === 'merchant') why.push('UPI merchant payment (P2M)');
      else if (env.companyLike || env.businessLike) why.push(`${titleCase(nameForReason)} reads like a business`);
      else if (parsed.channel === 'CARD') why.push('Card purchase');
      else if (parsed.channel === 'BILLPAY') why.push('Bill payment');
      else why.push('Purchase from a merchant');
      return { kind: 'expense', src: 'rule', conf: 0.8, cpType, reasons: why };
    }
    // credit from a merchant / company
    if (env.companyLike && ['neft', 'imps', 'rtgs', 'ach', 'plain'].includes(scheme)) {
      return { kind: 'income', src: 'heuristic', conf: 0.6, cpType: 'employer', reasons: [`Credit from a company (${nameForReason})`], category: 'other_income', catSrc: 'kind_default', review: 'Credit from a company: confirm it is income' };
    }
    return { kind: 'refund', src: 'heuristic', conf: 0.55, cpType, reasons: [vpaInfo?.cls === 'merchant' ? vpaMerchantReason(env, 'from') : 'Credit from a merchant'], review: 'Credit from a merchant: refund or other income?' };
  }

  const hasPayee = !!(parsed.name || parsed.vpa);
  if (env.transferLike && hasPayee) {
    const who = vpaInfo?.phone ? 'a mobile number' : vpaInfo ? 'a personal UPI handle' : 'a named person';
    if (debit) return { kind: 'p2p_out', src: 'heuristic', conf: 0.6, cpType: 'person', reasons: [`Sent to ${who}`] };
    return { kind: 'p2p_in', src: 'heuristic', conf: 0.6, cpType: 'person', reasons: [`Received from ${who}`] };
  }

  return { kind: 'unknown', src: 'heuristic', conf: 0, cpType: 'unknown', reasons: ['Could not recognise this transaction'] };
}

// ─── merchant name ───────────────────────────────────────────────────────────────────────────────

/** Phone numbers never appear in a display name: "upi-9876501234" / "9876501234" → "Contact ••1234". */
function maskPhoneLabel(r: { display: string; key: string }): { display: string; key: string } {
  const m = /^(?:upi[-\s]*)?\+?(?:91)?([6-9]\d{9})$/i.exec(r.display.trim());
  return m ? { display: `Contact ••${m[1].slice(-4)}`, key: m[1] } : r;
}

function resolveMerchant(env: Env, d: Decision): { display: string; key: string } {
  return maskPhoneLabel(resolveMerchantRaw(env, d));
}

function resolveMerchantRaw(env: Env, d: Decision): { display: string; key: string } {
  const { parsed, entity, brand, vpaInfo } = env;
  const fromLabel = (label: string) => ({ display: label, key: canon(label) });
  if (d.forceLabel && d.label) return fromLabel(d.label);
  if (entity && entity.role !== 'employer') return fromLabel(entity.name);
  if (brand) return fromLabel(brand.brand.name);
  if (entity) return fromLabel(entity.name);

  const cleaned = env.nameText;
  const isPersonish = d.cpType === 'person' || d.cpType === 'own_account';
  const merchantVpa = vpaInfo?.cls === 'merchant';
  // Shop QR codes: the printed name is the owner's (cut-off, or differs per bank) and ICICI prints none at
  // all, so the handle is the only stable identity. Rules and learning therefore key on the handle.
  const handleKeyed = merchantVpa && vpaInfo.source === 'qr' && parsed.vpa ? canon(splitVpa(parsed.vpa).local) : undefined;
  if (cleaned && !(merchantVpa && cleaned.replace(/[^A-Za-z]/g, '').length < 4)) {
    const display = titleCase(cleaned);
    return { display, key: handleKeyed ?? (isPersonish ? canon(display) : normalizeMerchantKey(display)) };
  }
  if (parsed.vpa) {
    const { local } = splitVpa(parsed.vpa);
    if (vpaInfo?.phone) {
      const digits = local.replace(/\D/g, '').slice(-10);
      return { display: `Contact ••${digits.slice(-4)}`, key: digits };
    }
    if (merchantVpa && vpaInfo.source === 'qr') return { display: `${vpaInfo.label} merchant`, key: canon(local) };
    const fromHandle = nameFromHandle(parsed.vpa);
    if (fromHandle) return { display: fromHandle, key: merchantVpa ? normalizeMerchantKey(fromHandle) : canon(fromHandle) };
    if (!local) return { display: 'Unknown', key: '' };
    return { display: merchantVpa ? 'UPI merchant' : local, key: canon(local) };
  }
  if (d.label) return fromLabel(d.label);
  const fallback = cleanMerchantText(parsed.text).split(' ').slice(0, 4).join(' ');
  const display = titleCase(fallback);
  if (!display) return { display: 'Unknown', key: '' };
  return { display, key: normalizeMerchantKey(display) };
}

// ─── category ────────────────────────────────────────────────────────────────────────────────────

interface CategoryDecision {
  id: string;
  src: CategorySource;
  /** confidence of this category decision, 0..1 */
  conf: number;
  reason?: string;
}

function learnedFeatures(env: Env, merchantKey: string) {
  return { text: env.parsed.text, merchantKey, vpa: env.parsed.vpa, amount: env.input.amount, direction: env.input.direction };
}

function chooseSpendCategory(env: Env, kind: TxnKind, merchantKey: string): CategoryDecision {
  const { brand, parsed, ctx } = env;
  const isP2p = kind === 'p2p_out';
  const usable = (category: string) => isSpendCategory(category, ctx) && (kind !== 'refund' || category !== 'refunds');

  if (!isP2p && brand) {
    const via = brand.via === 'vpa' ? 'handle' : 'merchant';
    return {
      id: brand.brand.category,
      src: 'builtin_rule',
      conf: brand.via === 'text' ? 0.9 : 0.85,
      reason: `Matched "${brand.brand.name}" (${via}) → ${categoryName(brand.brand.category)}`,
    };
  }
  if (!isP2p && env.entity?.role === 'government') {
    return { id: 'taxes', src: 'builtin_rule', conf: 0.85, reason: `Government payment (${env.entity.name}) → Taxes` };
  }

  // exact memory of the user's own earlier choice for this handle / merchant outranks generic keywords
  const remembered = recall(ctx.learned, merchantKey, parsed.vpa);
  if (remembered && usable(remembered.category)) {
    return {
      id: remembered.category,
      src: 'learned',
      conf: Math.round(remembered.probability * 0.9 * 1000) / 1000,
      reason: `You categorised this ${handleKey(parsed.vpa) && !/^\d{10}$/.test(handleKey(parsed.vpa) ?? '') ? 'UPI handle' : 'merchant'} before → ${categoryName(remembered.category, ctx.customCategories)}`,
    };
  }

  // the issuer's own merchant category (MCC text) is strong, bank-sourced evidence; a brand match already won above
  const issuer = isP2p ? null : categoryFromBankCategory(env.input.bankCategory);
  if (issuer && usable(issuer.category)) {
    return { id: issuer.category, src: 'builtin_rule', conf: 0.85, reason: `Your card issuer files this under "${issuer.text}" → ${categoryName(issuer.category, ctx.customCategories)}` };
  }

  const statistical = rank(ctx.learned, learnedFeatures(env, merchantKey))[0];
  if (isP2p) {
    if (isFamilyRemark(parsed.note)) return { id: 'family_support', src: 'builtin_rule', conf: 0.7, reason: `Remark "${parsed.note}" → Family support` };
    if (env.noteKeyword) {
      return { id: env.noteKeyword.category, src: 'builtin_rule', conf: 0.6, reason: `Remark "${env.noteKeyword.phrase}" → ${categoryName(env.noteKeyword.category)}` };
    }
  } else if (env.keyword) {
    const kw = env.keyword;
    if (!kw.prefix) {
      return { id: kw.category, src: 'builtin_rule', conf: 0.6, reason: `Keyword "${kw.phrase}" → ${categoryName(kw.category)}` };
    }
    // a cut-off word is weaker evidence; it only clears the review bar when the learned model agrees
    const baseConf = kw.short ? 0.5 : 0.55;
    const agrees = statistical && statistical.category === kw.category && statistical.probability >= 0.5;
    return {
      id: kw.category,
      src: 'builtin_rule',
      conf: agrees ? baseConf + 0.1 : baseConf,
      reason: `Cut-off name "${kw.phrase}" looks like a ${categoryName(kw.category)} word${agrees ? ' (your history agrees)' : ''}`,
    };
  }

  // foreign-currency charge from a company-looking name: most likely a software / online subscription (suggestion only)
  if (!isP2p && parsed.currency && SOFTWARE_HINT.test(parsed.upper) && usable('subscriptions') && !(statistical && statistical.probability >= MIN_PROBABILITY)) {
    return { id: 'subscriptions', src: 'builtin_rule', conf: 0.55, reason: `Foreign-currency charge (${parsed.currency}) from an online company → Subscriptions (a guess)` };
  }

  if (statistical && statistical.probability >= MIN_PROBABILITY && usable(statistical.category)) {
    return {
      id: statistical.category,
      src: 'learned',
      conf: Math.round(statistical.probability * 0.9 * 1000) / 1000,
      reason: `Learned from your earlier choices → ${categoryName(statistical.category, ctx.customCategories)} (${Math.round(statistical.probability * 100)}% sure)`,
    };
  }

  if (isP2p) return { id: 'sent_to_people', src: 'kind_default', conf: 0.6 };
  if (kind === 'refund') return { id: KIND_DEFAULT_CATEGORY.refund, src: 'kind_default', conf: 0.7 };
  return { id: UNCATEGORIZED, src: 'none', conf: 0, reason: 'No category rule matched' };
}

/** When a rule sets a category but not a kind, align a conflicting kind with the category's meaning. */
function kindFromCategory(kind: TxnKind, category: string, direction: Direction, ctx: UnderstandContext): TxnKind {
  const group = categoryGroup(category, ctx);
  if (!group) {
    return direction === 'debit' && (kind === 'unknown' || kind === 'p2p_out') ? 'expense' : kind;
  }
  if (category === 'investments') return direction === 'debit' ? 'investment' : 'investment_return';
  if (category === 'salary' || category === 'other_income') return direction === 'credit' ? 'income' : kind;
  if (category === 'interest_income') return direction === 'credit' ? 'interest' : kind;
  if (category === 'loan_emi') return direction === 'debit' ? 'loan_payment' : kind;
  if (category === 'cash') return direction === 'debit' ? 'cash_withdrawal' : kind;
  if (category === 'fees_charges') return direction === 'debit' ? 'fee' : kind;
  if (category === 'self_transfer') return 'self_transfer';
  if (category === 'card_payment') return 'card_payment';
  if (category === 'refunds') return direction === 'credit' ? 'refund' : kind;
  if (category === 'sent_to_people' || category === 'family_support') return direction === 'debit' ? 'p2p_out' : kind;
  if (category === 'received_from_people') return direction === 'credit' ? 'p2p_in' : kind;
  if (isSpendCategory(category, ctx) && direction === 'debit' && (kind === 'unknown' || kind === 'p2p_out' || kind === 'p2p_in')) return 'expense';
  return kind;
}

// ─── main ────────────────────────────────────────────────────────────────────────────────────────

export function understandTransaction(input: UnderstandInput, ctx: UnderstandContext): Understanding {
  const env = buildEnv(input, ctx);
  const { parsed } = env;
  const decision = decideKind(env);
  const merchant0 = resolveMerchant(env, decision);

  const counterparty: Counterparty = { type: decision.cpType };
  const cpName = decision.cpType === 'own_account' ? undefined : merchant0.display;
  if (cpName) counterparty.name = cpName;
  else if (decision.cpType === 'own_account' && env.nameText) counterparty.name = titleCase(env.nameText);
  if (parsed.vpa) counterparty.vpa = parsed.vpa;
  if (parsed.bank) counterparty.bank = parsed.bank;
  if (parsed.ifsc) counterparty.ifsc = parsed.ifsc;
  if (parsed.maskedAccounts[0]) counterparty.accountMask = parsed.maskedAccounts[0];

  // ── user rules ──────────────────────────────────────────────────────────────────────────────
  const rule: RuleDecision = selectRules(ctx.rules, {
    accountId: ctx.account.id,
    direction: input.direction,
    merchantKey: merchant0.key,
    counterparty,
    rawDescription: input.description,
  });

  let kind = decision.kind;
  let kindSource: KindSource = decision.src;
  let kindConf = decision.conf;
  const reasons = [...decision.reasons];

  if (rule.kind) {
    kind = rule.kind.value;
    kindSource = 'user_rule';
    kindConf = 0.98;
    reasons.unshift(`Your rule sets this to "${kind}"`);
  } else if (rule.category && !rule.kind) {
    const aligned = kindFromCategory(kind, rule.category.value, input.direction, ctx);
    if (aligned !== kind) {
      kind = aligned;
      kindSource = 'user_rule';
      kindConf = 0.98;
    }
  }

  const merchantDisplay = rule.merchant ? rule.merchant.value : merchant0.display;
  if (rule.merchant) counterparty.name = merchantDisplay;

  // ── category ────────────────────────────────────────────────────────────────────────────────
  let category: CategoryDecision;
  const spendish = SPENDING_KINDS.has(kind);
  if (rule.category) {
    category = { id: rule.category.value, src: 'user_rule', conf: 0.98, reason: `Your rule → ${categoryName(rule.category.value, ctx.customCategories)}` };
  } else if (spendish) {
    category =
      decision.kind === kind && decision.category
        ? { id: decision.category, src: decision.catSrc ?? 'builtin_rule', conf: kindConf }
        : chooseSpendCategory(env, kind, merchant0.key);
  } else if (decision.kind === kind && decision.category) {
    category = { id: decision.category, src: decision.catSrc ?? 'builtin_rule', conf: kindConf };
  } else {
    category = { id: KIND_DEFAULT_CATEGORY[kind], src: 'kind_default', conf: kindConf };
  }
  if (category.reason) reasons.push(category.reason);

  // ── confidence ──────────────────────────────────────────────────────────────────────────────
  let confidence: number;
  if (rule.kind || rule.category) confidence = 0.98;
  else if (spendish && kind !== 'p2p_out') confidence = kind === 'refund' ? Math.min(kindConf, category.conf || kindConf) : category.conf;
  else if (kind === 'p2p_out') confidence = Math.min(kindConf, category.conf || kindConf);
  else confidence = kindConf;
  if (kind === 'unknown') confidence = Math.min(confidence, decision.kind === 'unknown' ? decision.conf : 0.4);
  confidence = Math.round(confidence * 1000) / 1000;

  // ── calibration from the user's past corrections ────────────────────────────────────────────
  let calibrationNote: string | undefined;
  if (ctx.calibration && !(rule.kind || rule.category)) {
    const calibrated = calibrateConfidence(ctx.calibration, category.src, category.id, confidence);
    confidence = calibrated.confidence;
    calibrationNote = calibrated.note;
  }

  // ── review ──────────────────────────────────────────────────────────────────────────────────
  const reviewReasons: string[] = [];
  const decidedByUser = !!(rule.kind || rule.category);
  if (!decidedByUser) {
    if (confidence < 0.6) reviewReasons.push(`Low confidence (${Math.round(confidence * 100)}%)`);
    if (kind === 'unknown') reviewReasons.push('Could not tell what this transaction is');
    if (SPENDING_KINDS.has(kind) && category.id === UNCATEGORIZED) reviewReasons.push('No category matched');
    if (kind === 'p2p_out' && input.amount >= ctx.p2pReviewThreshold) {
      reviewReasons.push(`Large transfer to a person (${formatINR(input.amount, { whole: true })}): confirm what it was for`);
    }
    if (decision.review && decision.kind === kind) reviewReasons.push(decision.review);
  }

  if (!decidedByUser && env.parsed.gateway && !env.brand && !env.entity && looksLikePersonName(env.nameText)) {
    reviewReasons.push(`Paid through ${env.parsed.gateway} to a name that looks like a person: confirm what it was for`);
  }

  // ── channel ─────────────────────────────────────────────────────────────────────────────────
  let channel: Channel = decision.channel ?? parsed.channel;
  if (channel === 'OTHER') {
    if (kind === 'interest') channel = 'INTEREST';
    else if (kind === 'fee') channel = 'CHARGE';
    else if (kind === 'cash_withdrawal') channel = 'ATM';
    else if (env.isCard) channel = 'CARD';
  }

  const out: Understanding = {
    channel,
    counterparty,
    merchant: merchantDisplay,
    merchantKey: merchant0.key,
    kind,
    kindSource,
    category: category.id,
    categorySource: category.src,
    confidence,
    reasons: [...new Set(calibrationNote ? [...reasons, calibrationNote] : reasons)],
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
  const reference = parsed.reference ?? input.reference;
  if (reference) out.reference = reference;
  return out;
}
