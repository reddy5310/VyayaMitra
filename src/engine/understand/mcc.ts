/**
 * Issuer-printed merchant categories. Several card issuers print the merchant category (the MCC
 * description) next to each charge: "[Transportation Services]", "Grocery Stores, Supermarkets",
 * "Eating Places Restaurants", "Fuel", "Jewelry Stores"… That is a strong, bank-sourced signal — second only
 * to a specific brand match — so it is mapped onto VyayaMitra's category ids.
 */

interface Rule {
  re: RegExp;
  category: string;
}

/** Order matters: the first matching rule wins, so specific phrases come before broad ones. */
const RULES: Rule[] = [
  { re: /\bpharmac|drug stores?|drugstores?|chemist/, category: 'healthcare' },
  { re: /\bhospital|doctor|physician|dentist|dental|medical|optician|optical|clinic|laborator|health practitioner|ambulance/, category: 'healthcare' },
  { re: /\bgrocery|supermarket|food stores?|dairy|meat provisioner|freezer|convenience stores?|misc(?:ellaneous)? food|candy|produce|wholesale clubs?/, category: 'groceries' },
  { re: /\beating|restaurant|fast food|caterer|drinking places|bars?\b|taverns?|night ?clubs?|bakeries|bakery|coffee|ice cream|food delivery|food court/, category: 'food_dining' },
  { re: /\bfuel|service stations?|petrol|automated fuel|gasoline|lpg|fuel dealers/, category: 'transport' },
  { re: /\btransportation|taxi|limousine|bus lines?|commuter|toll|bridge|parking|railway|passenger rail|ride ?shar|local passenger|auto(?:mobile)? (?:service|repair|parts)|tyre|tire|car wash|motor vehicle|auto dealers?|automotive/, category: 'transport' },
  { re: /\bairlines?|air carriers?|airport|lodging|hotels?|motels?|resorts?|travel agenc|tour|cruise|timeshare|car rental|vacation|campground|railroad tickets?/, category: 'travel' },
  { re: /\butilit|electric|gas (?:service|utilit)|water|sanitary|cable|satellite|municipal services/, category: 'utilities' },
  { re: /\btelecom|telecommunication|cellular|wireless|internet service|telephone|mobile (?:phone )?recharge/, category: 'mobile_internet' },
  { re: /\binsurance|underwriting|assurance/, category: 'insurance' },
  { re: /\beducation|school|college|universit|tuition|correspondence|training|coaching|child care|nursery/, category: 'education' },
  { re: /\bgovernment|tax payment|court costs?|fines?\b|postal services|licen[cs]es?|customs/, category: 'taxes' },
  { re: /\bbeauty|barber|salons?|spas?\b|massage|cosmetic|hair/, category: 'personal_care' },
  { re: /\bhealth clubs?|gym|fitness|athletic|sporting|sports clubs?|recreation(?:al)? (?:sports|facilit)|golf|bowling|swimming/, category: 'fitness' },
  { re: /\bmotion picture|movie|theat|amusement|entertainment|video (?:rental|game)|digital goods|games?\b|music|tickets?\b|event|streaming|media/, category: 'entertainment' },
  { re: /\bcharit|religious|civic|social service|membership organi[sz]ations?|donation|political/, category: 'gifts_donations' },
  { re: /\bsoftware|computer (?:network|programming|services)|information services|data processing|saas|subscription/, category: 'subscriptions' },
  { re: /\breal estate|rent(?:al)? (?:payments?|property)|property management|landlord/, category: 'rent_housing' },
  {
    re: /\bjewel|watches|silverware|department stores?|variety stores?|general merchandise|discount stores?|clothing|apparel|shoe|footwear|furniture|home (?:furnish|suppl)|household appliance|electronics?|computer (?:stores?|software stores?)|book ?stores?|stationery|office supplies|florists?|gift|toys?|hobby|catalog|mail order|direct marketing|misc(?:ellaneous)? (?:general|retail|specialty)|specialty retail|retail|hardware|lumber|building material|paint|department|cosmetic stores?|leather|luggage|pet (?:shops|supplies)|hobby/,
    category: 'shopping',
  },
];

/** Normalise "[Transportation Services]" / "TRANSPORTATION SERVICES" to lower-case words. */
export function normalizeBankCategory(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[[\]()]/g, ' ')
    .replace(/[^a-z0-9&,/ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface BankCategoryHit {
  category: string;
  /** The issuer's wording, tidied for display. */
  text: string;
}

/** Map an issuer-printed merchant category to a category id, or null when it says nothing useful. */
export function categoryFromBankCategory(text: string | undefined): BankCategoryHit | null {
  const norm = normalizeBankCategory(text);
  if (norm.length < 3) return null;
  for (const rule of RULES) {
    if (rule.re.test(norm)) {
      const shown = (text ?? '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
      return { category: rule.category, text: shown };
    }
  }
  return null;
}
