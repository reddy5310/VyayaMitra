/**
 * Institutions VyayaMitra knows by name. `Institution` ids are open-ended strings: any bank
 * not listed here is still supported (id 'OTHER' or a learned template's own id) — this list only
 * improves detection, labels and counterparty naming (via IFSC prefixes).
 */

export type InstitutionKind =
  | 'bank'
  | 'small_finance_bank'
  | 'payments_bank'
  | 'card_issuer'
  | 'cooperative'
  | 'foreign_bank'
  | 'nbfc'
  | 'wallet';

export interface InstitutionDef {
  id: string;
  name: string;
  /** Short label for chips, e.g. "HDFC". */
  short: string;
  kind: InstitutionKind;
  /** 4-letter IFSC bank code, when the institution has one. */
  ifsc?: string;
  /** Lower-case text markers that identify the institution on a statement (legal name, domain, card brand). */
  markers: string[];
}

export const INSTITUTIONS: readonly InstitutionDef[] = [
  // private banks
  { id: 'HDFC', name: 'HDFC Bank', short: 'HDFC', kind: 'bank', ifsc: 'HDFC', markers: ['hdfc bank', 'hdfcbank.com', 'hdfc bank ltd'] },
  { id: 'ICICI', name: 'ICICI Bank', short: 'ICICI', kind: 'bank', ifsc: 'ICIC', markers: ['icici bank', 'icicibank.com'] },
  { id: 'AXIS', name: 'Axis Bank', short: 'Axis', kind: 'bank', ifsc: 'UTIB', markers: ['axis bank', 'axisbank.com'] },
  { id: 'KOTAK', name: 'Kotak Mahindra Bank', short: 'Kotak', kind: 'bank', ifsc: 'KKBK', markers: ['kotak mahindra bank', 'kotak.com', 'kotak811'] },
  { id: 'INDUSIND', name: 'IndusInd Bank', short: 'IndusInd', kind: 'bank', ifsc: 'INDB', markers: ['indusind bank', 'indusind.com'] },
  { id: 'YES', name: 'Yes Bank', short: 'Yes Bank', kind: 'bank', ifsc: 'YESB', markers: ['yes bank', 'yesbank.in'] },
  { id: 'IDFC', name: 'IDFC FIRST Bank', short: 'IDFC FIRST', kind: 'bank', ifsc: 'IDFB', markers: ['idfc first bank', 'idfcfirstbank.com'] },
  { id: 'FEDERAL', name: 'Federal Bank', short: 'Federal', kind: 'bank', ifsc: 'FDRL', markers: ['federal bank', 'federalbank.co.in'] },
  { id: 'RBL', name: 'RBL Bank', short: 'RBL', kind: 'bank', ifsc: 'RATN', markers: ['rbl bank', 'rblbank.com'] },
  { id: 'BANDHAN', name: 'Bandhan Bank', short: 'Bandhan', kind: 'bank', ifsc: 'BDBL', markers: ['bandhan bank', 'bandhanbank.com'] },
  { id: 'IDBI', name: 'IDBI Bank', short: 'IDBI', kind: 'bank', ifsc: 'IBKL', markers: ['idbi bank', 'idbibank.in'] },
  { id: 'SOUTH_INDIAN', name: 'South Indian Bank', short: 'SIB', kind: 'bank', ifsc: 'SIBL', markers: ['south indian bank', 'southindianbank.com'] },
  { id: 'KARUR_VYSYA', name: 'Karur Vysya Bank', short: 'KVB', kind: 'bank', ifsc: 'KVBL', markers: ['karur vysya bank', 'kvb.co.in'] },
  { id: 'CITY_UNION', name: 'City Union Bank', short: 'CUB', kind: 'bank', ifsc: 'CIUB', markers: ['city union bank', 'cityunionbank.com'] },
  { id: 'KARNATAKA', name: 'Karnataka Bank', short: 'Karnataka Bank', kind: 'bank', ifsc: 'KARB', markers: ['karnataka bank', 'karnatakabank.com'] },
  { id: 'TMB', name: 'Tamilnad Mercantile Bank', short: 'TMB', kind: 'bank', ifsc: 'TMBL', markers: ['tamilnad mercantile bank', 'tmb.in'] },
  { id: 'DCB', name: 'DCB Bank', short: 'DCB', kind: 'bank', ifsc: 'DCBL', markers: ['dcb bank', 'dcbbank.com'] },
  { id: 'CSB', name: 'CSB Bank', short: 'CSB', kind: 'bank', ifsc: 'CSBK', markers: ['csb bank', 'csb.co.in'] },
  { id: 'JK', name: 'J&K Bank', short: 'J&K Bank', kind: 'bank', ifsc: 'JAKA', markers: ['jammu and kashmir bank', 'j&k bank', 'jkbank.com'] },
  { id: 'DHANLAXMI', name: 'Dhanlaxmi Bank', short: 'Dhanlaxmi', kind: 'bank', ifsc: 'DLXB', markers: ['dhanlaxmi bank', 'dhanbank.com'] },
  // public sector banks
  { id: 'SBI', name: 'State Bank of India', short: 'SBI', kind: 'bank', ifsc: 'SBIN', markers: ['state bank of india', 'onlinesbi', 'sbi.co.in', 'भारतीय स्टेट बैंक'] },
  { id: 'BOB', name: 'Bank of Baroda', short: 'BoB', kind: 'bank', ifsc: 'BARB', markers: ['bank of baroda', 'bankofbaroda', 'बैंक ऑफ़ बड़ौदा'] },
  { id: 'PNB', name: 'Punjab National Bank', short: 'PNB', kind: 'bank', ifsc: 'PUNB', markers: ['punjab national bank', 'pnbindia.in'] },
  { id: 'CANARA', name: 'Canara Bank', short: 'Canara', kind: 'bank', ifsc: 'CNRB', markers: ['canara bank', 'canarabank.com'] },
  { id: 'UNION', name: 'Union Bank of India', short: 'Union Bank', kind: 'bank', ifsc: 'UBIN', markers: ['union bank of india', 'unionbankofindia'] },
  { id: 'BOI', name: 'Bank of India', short: 'BOI', kind: 'bank', ifsc: 'BKID', markers: ['bank of india', 'bankofindia.co.in'] },
  { id: 'INDIAN', name: 'Indian Bank', short: 'Indian Bank', kind: 'bank', ifsc: 'IDIB', markers: ['indian bank', 'indianbank.in'] },
  { id: 'CENTRAL', name: 'Central Bank of India', short: 'Central Bank', kind: 'bank', ifsc: 'CBIN', markers: ['central bank of india', 'centralbankofindia'] },
  { id: 'IOB', name: 'Indian Overseas Bank', short: 'IOB', kind: 'bank', ifsc: 'IOBA', markers: ['indian overseas bank', 'iob.in'] },
  { id: 'UCO', name: 'UCO Bank', short: 'UCO', kind: 'bank', ifsc: 'UCBA', markers: ['uco bank', 'ucobank.com'] },
  { id: 'BOM', name: 'Bank of Maharashtra', short: 'Bank of Maharashtra', kind: 'bank', ifsc: 'MAHB', markers: ['bank of maharashtra', 'bankofmaharashtra'] },
  { id: 'PSB', name: 'Punjab & Sind Bank', short: 'P&S Bank', kind: 'bank', ifsc: 'PSIB', markers: ['punjab & sind bank', 'punjab and sind bank', 'psbindia.com'] },
  // small finance banks
  { id: 'AU', name: 'AU Small Finance Bank', short: 'AU Bank', kind: 'small_finance_bank', ifsc: 'AUBL', markers: ['au small finance bank', 'aubank.in'] },
  { id: 'EQUITAS', name: 'Equitas Small Finance Bank', short: 'Equitas', kind: 'small_finance_bank', ifsc: 'ESFB', markers: ['equitas small finance bank', 'equitasbank.com'] },
  { id: 'UJJIVAN', name: 'Ujjivan Small Finance Bank', short: 'Ujjivan', kind: 'small_finance_bank', ifsc: 'UJVN', markers: ['ujjivan small finance bank', 'ujjivansfb.in'] },
  { id: 'JANA', name: 'Jana Small Finance Bank', short: 'Jana', kind: 'small_finance_bank', ifsc: 'JSFB', markers: ['jana small finance bank', 'janabank.com'] },
  { id: 'SURYODAY', name: 'Suryoday Small Finance Bank', short: 'Suryoday', kind: 'small_finance_bank', ifsc: 'SURY', markers: ['suryoday small finance bank', 'suryodaybank.com'] },
  { id: 'ESAF', name: 'ESAF Small Finance Bank', short: 'ESAF', kind: 'small_finance_bank', ifsc: 'ESMF', markers: ['esaf small finance bank', 'esafbank.com'] },
  { id: 'UTKARSH', name: 'Utkarsh Small Finance Bank', short: 'Utkarsh', kind: 'small_finance_bank', ifsc: 'UTKS', markers: ['utkarsh small finance bank', 'utkarsh.bank'] },
  { id: 'SHIVALIK', name: 'Shivalik Small Finance Bank', short: 'Shivalik', kind: 'small_finance_bank', ifsc: 'SMCB', markers: ['shivalik small finance bank', 'shivalikbank.com'] },
  { id: 'NORTH_EAST', name: 'North East Small Finance Bank', short: 'NESFB', kind: 'small_finance_bank', ifsc: 'NESF', markers: ['north east small finance bank', 'nesfb.com'] },
  { id: 'CAPITAL', name: 'Capital Small Finance Bank', short: 'Capital SFB', kind: 'small_finance_bank', ifsc: 'CLBL', markers: ['capital small finance bank', 'capitalbank.co.in'] },
  { id: 'UNITY', name: 'Unity Small Finance Bank', short: 'Unity', kind: 'small_finance_bank', markers: ['unity small finance bank', 'theunitybank.com'] },
  // payments banks
  { id: 'PAYTM_PB', name: 'Paytm Payments Bank', short: 'Paytm Bank', kind: 'payments_bank', ifsc: 'PYTM', markers: ['paytm payments bank'] },
  { id: 'AIRTEL_PB', name: 'Airtel Payments Bank', short: 'Airtel Bank', kind: 'payments_bank', ifsc: 'AIRP', markers: ['airtel payments bank'] },
  { id: 'IPPB', name: 'India Post Payments Bank', short: 'IPPB', kind: 'payments_bank', ifsc: 'IPOS', markers: ['india post payments bank', 'ippbonline.com'] },
  { id: 'FINO_PB', name: 'Fino Payments Bank', short: 'Fino', kind: 'payments_bank', ifsc: 'FINO', markers: ['fino payments bank'] },
  { id: 'JIO_PB', name: 'Jio Payments Bank', short: 'Jio Bank', kind: 'payments_bank', ifsc: 'JIOP', markers: ['jio payments bank'] },
  { id: 'NSDL_PB', name: 'NSDL Payments Bank', short: 'NSDL Bank', kind: 'payments_bank', ifsc: 'NSPB', markers: ['nsdl payments bank', 'nsdlbank.com'] },
  // NBFCs and wallets (cards, EMI cards, prepaid wallets)
  { id: 'BAJAJ_FINSERV', name: 'Bajaj Finserv', short: 'Bajaj Finserv', kind: 'nbfc', markers: ['bajaj finserv', 'bajaj finance limited', 'bajajfinserv.in'] },
  { id: 'PHONEPE_WALLET', name: 'PhonePe Wallet', short: 'PhonePe', kind: 'wallet', markers: ['phonepe wallet', 'phonepe private limited'] },
  { id: 'PAYTM_WALLET', name: 'Paytm Wallet', short: 'Paytm', kind: 'wallet', markers: ['paytm wallet', 'one97 communications'] },
  { id: 'AMAZON_PAY', name: 'Amazon Pay', short: 'Amazon Pay', kind: 'wallet', markers: ['amazon pay balance', 'amazon pay (india)'] },
  // co-operative
  { id: 'SARASWAT', name: 'Saraswat Co-operative Bank', short: 'Saraswat', kind: 'cooperative', ifsc: 'SRCB', markers: ['saraswat co-operative bank', 'saraswatbank.com'] },
  { id: 'COSMOS', name: 'Cosmos Co-operative Bank', short: 'Cosmos', kind: 'cooperative', ifsc: 'COSB', markers: ['cosmos co-operative bank', 'cosmosbank.com'] },
  // foreign banks in India
  { id: 'DBS', name: 'DBS Bank India', short: 'DBS', kind: 'foreign_bank', ifsc: 'DBSS', markers: ['dbs bank india', 'dbs bank', 'digibank'] },
  { id: 'SCB', name: 'Standard Chartered', short: 'StanChart', kind: 'foreign_bank', ifsc: 'SCBL', markers: ['standard chartered', 'sc.com/in'] },
  { id: 'HSBC', name: 'HSBC India', short: 'HSBC', kind: 'foreign_bank', ifsc: 'HSBC', markers: ['hsbc', 'hsbc.co.in'] },
  { id: 'CITI', name: 'Citibank', short: 'Citi', kind: 'foreign_bank', ifsc: 'CITI', markers: ['citibank', 'citi.com'] },
  { id: 'DEUTSCHE', name: 'Deutsche Bank', short: 'Deutsche', kind: 'foreign_bank', ifsc: 'DEUT', markers: ['deutsche bank'] },
  // card issuers without a bank account product
  { id: 'SBI_CARD', name: 'SBI Card', short: 'SBI Card', kind: 'card_issuer', markers: ['sbi card', 'sbicard.com', 'sbi cards and payment services'] },
  { id: 'AMEX', name: 'American Express', short: 'Amex', kind: 'card_issuer', markers: ['american express', 'americanexpress.com'] },
  { id: 'ONECARD', name: 'OneCard', short: 'OneCard', kind: 'card_issuer', markers: ['onecard', 'fpl technologies'] },
  { id: 'BOBCARD', name: 'BOBCARD', short: 'BOBCARD', kind: 'card_issuer', markers: ['bobcard', 'bob financial'] },
  // fallback
  { id: 'OTHER', name: 'Other bank', short: 'Other', kind: 'bank', markers: [] },
];

const BY_ID = new Map(INSTITUTIONS.map((i) => [i.id, i]));
const BY_IFSC = new Map(INSTITUTIONS.filter((i) => i.ifsc).map((i) => [i.ifsc!, i]));

export function institutionById(id: string): InstitutionDef {
  return BY_ID.get(id) ?? { id, name: id === 'OTHER' ? 'Other bank' : id, short: id, kind: 'bank', markers: [] };
}

export function institutionName(id: string): string {
  return institutionById(id).name;
}

/** "HDFC0001234" → HDFC Bank. */
export function institutionFromIfsc(ifsc: string): InstitutionDef | undefined {
  return BY_IFSC.get(ifsc.slice(0, 4).toUpperCase());
}
