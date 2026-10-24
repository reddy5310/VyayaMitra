/**
 * Generic keyword hints (confidence ~0.6). They only run after the brand dictionary and VPA knowledge
 * found nothing, and every phrase is matched on WORD BOUNDARIES — "tea" never matches "steam",
 * "gas" never matches "vegas", "lab" never matches "label".
 *
 * Payment-rail words (UPI, NEFT, IMPS, RTGS, PAYMENT, TRANSFER) are deliberately absent: a rail never
 * tells us what was bought.
 */
import { canon } from './brands';

export interface KeywordRule {
  category: string;
  label: string;
  phrases: string[];
}

const RULES: KeywordRule[] = [
  {
    category: 'food_dining',
    label: 'food keyword',
    phrases: [
      'restaurant', 'restaurants', 'filter coffee', 'cafe', 'cafeteria', 'food', 'foods', 'food court', 'dining', 'eatery', 'bakery', 'bakers', 'baker', 'dhaba', 'canteen', 'mess', 'biryani', 'dosa', 'idli',
      'snacks', 'juice', 'juices', 'beverages', 'tea', 'chai', 'coffee', 'lunch', 'dinner', 'breakfast', 'tiffin', 'tiffins', 'sweets', 'sweet house', 'ice cream', 'icecream', 'pizza', 'burger',
      'bar', 'pub', 'brewery', 'bistro', 'kitchen', 'meals', 'hotel', 'udupi', 'mithai', 'chat bhandar', 'fast food', 'fastfood', 'momos', 'shawarma', 'tandoori', 'grill', 'kebab', 'kabab',
      'irani', 'sandwich', 'bakes', 'cakes', 'cake shop', 'dairy parlour', 'milk bar', 'toddy', 'liquor', 'wines', 'wine shop', 'beer', 'restobar',
    ],
  },
  {
    category: 'groceries',
    label: 'grocery keyword',
    phrases: ['grocery', 'groceries', 'supermarket', 'super market', 'hypermarket', 'vegetables', 'vegetable', 'fruits', 'fruit', 'kirana', 'provision', 'provisions', 'general stores', 'general store', 'milk', 'dairy', 'meat', 'chicken', 'fish', 'mutton', 'organic store', 'fresh'],
  },
  {
    category: 'transport',
    label: 'transport keyword',
    phrases: ['petrol', 'diesel', 'fuel', 'cng', 'filling station', 'petrol bunk', 'petroleum', 'toll', 'toll plaza', 'parking', 'cab', 'cabs', 'taxi', 'auto rickshaw', 'rickshaw', 'car wash', 'tyre', 'tyres', 'garage', 'service center', 'service centre', 'metro', 'bus pass', 'two wheeler', 'bike service', 'car service', 'motors'],
  },
  {
    category: 'healthcare',
    label: 'health keyword',
    phrases: ['pharmacy', 'pharmacies', 'pharma', 'medical', 'medicals', 'medico', 'chemist', 'drug store', 'hospital', 'hospitals', 'clinic', 'clinics', 'doctor', 'dr', 'diagnostic', 'diagnostics', 'lab', 'labs', 'pathology', 'pathlab', 'dental', 'dentist', 'optical', 'opticals', 'optician', 'eye care', 'xray', 'x ray', 'scan', 'mri', 'ct scan', 'health care', 'healthcare', 'nursing home', 'physio', 'physiotherapy', 'ayurvedic', 'ayurveda', 'wellness'],
  },
  {
    category: 'utilities',
    label: 'utility keyword',
    phrases: ['electricity', 'electric bill', 'power bill', 'discom', 'water bill', 'water board', 'water supply', 'gas', 'gas bill', 'lpg', 'cylinder', 'png', 'piped gas', 'dth', 'cable', 'cable tv', 'maintenance', 'society maintenance', 'utility', 'utilities', 'bill payment bbps', 'municipal'],
  },
  {
    category: 'mobile_internet',
    label: 'mobile/internet keyword',
    phrases: ['recharge', 'prepaid', 'postpaid', 'broadband', 'wifi', 'wi fi', 'internet', 'fibernet', 'fiber', 'fibre', 'data pack', 'mobile bill'],
  },
  {
    category: 'entertainment',
    label: 'entertainment keyword',
    phrases: ['cinema', 'cinemas', 'movie', 'movies', 'multiplex', 'theatre', 'theater', 'amusement', 'amusement park', 'water park', 'theme park', 'gaming', 'concert', 'event tickets', 'bowling', 'arcade'],
  },
  {
    category: 'shopping',
    label: 'shopping keyword',
    phrases: ['mobiles', 'mobile shop', 'electronics', 'electricals', 'appliances', 'garments', 'textiles', 'fashions', 'fashion', 'clothing', 'apparel', 'sarees', 'silks', 'boutique', 'jewellery', 'jewellers', 'jewelers', 'jewelry', 'footwear', 'shoes', 'furniture', 'hardware', 'stationery', 'bookstore', 'book store', 'books', 'toys', 'optics', 'fancy', 'readymades', 'trendz'],
  },
  {
    category: 'personal_care',
    label: 'personal care keyword',
    phrases: ['salon', 'saloon', 'parlour', 'parlor', 'beauty', 'spa', 'barber', 'haircut', 'unisex', 'cosmetics', 'makeover'],
  },
  {
    category: 'fitness',
    label: 'fitness keyword',
    phrases: ['gym', 'fitness', 'yoga', 'zumba', 'pilates', 'swimming', 'badminton', 'turf', 'sports club', 'stadium', 'karate', 'taekwondo', 'cricket academy'],
  },
  {
    category: 'education',
    label: 'education keyword',
    phrases: ['school', 'school fee', 'college', 'university', 'tuition', 'tuitions', 'coaching', 'academy', 'institute', 'classes', 'education', 'exam fee', 'examination', 'admission', 'semester', 'playschool', 'preschool', 'daycare', 'kindergarten', 'vidyalaya', 'course fee', 'training institute'],
  },
  {
    category: 'insurance',
    label: 'insurance keyword',
    phrases: ['insurance', 'assurance', 'mediclaim', 'policy premium', 'insurance premium', 'life insurance', 'health insurance', 'motor insurance', 'term plan'],
  },
  {
    category: 'rent_housing',
    label: 'rent/housing keyword',
    phrases: ['rent', 'house rent', 'room rent', 'flat rent', 'pg rent', 'rental', 'landlord', 'hostel', 'hostel fee', 'pg', 'apartment', 'apartments', 'plumber', 'carpenter', 'electrician', 'painter', 'pest control', 'housekeeping', 'maid', 'interiors', 'interior'],
  },
  {
    category: 'travel',
    label: 'travel keyword',
    phrases: ['hotel booking', 'hotels', 'resort', 'resorts', 'lodge', 'lodging', 'homestay', 'guest house', 'airline', 'airlines', 'flight', 'flights', 'air ticket', 'train ticket', 'railway', 'railways', 'bus ticket', 'travels', 'tours', 'tour', 'holiday', 'holidays'],
  },
  {
    category: 'taxes',
    label: 'tax keyword',
    phrases: ['income tax', 'advance tax', 'property tax', 'professional tax', 'road tax', 'gst payment', 'tax payment', 'municipal tax', 'stamp duty'],
  },
  {
    category: 'gifts_donations',
    label: 'donation keyword',
    phrases: ['donation', 'donations', 'charity', 'ngo', 'temple', 'devasthanam', 'church', 'mosque', 'masjid', 'gurudwara', 'gift card', 'gift voucher', 'gift', 'gifts'],
  },
  {
    category: 'subscriptions',
    label: 'subscription keyword',
    phrases: ['subscription', 'membership', 'annual plan', 'monthly plan', 'premium plan', 'pro plan', 'plus plan', 'newspaper', 'magazine'],
  },
];

interface CompiledPhrase {
  phrase: string;
  words: number;
  category: string;
  label: string;
}

/** Longest phrases first so "ct scan" beats "scan" and "hotel booking" beats "hotel". */
const COMPILED: CompiledPhrase[] = RULES.flatMap((r) =>
  r.phrases.map((p) => ({ phrase: canon(p), words: canon(p).split(' ').length, category: r.category, label: r.label })),
).sort((a, b) => b.phrase.length - a.phrase.length);

export interface KeywordHit {
  category: string;
  phrase: string;
  label: string;
  /** True when the match is a cut-off word ("SWEE" → sweets), which is weaker evidence. */
  prefix?: boolean;  /** True for the 3-letter fragments ("KIR") accepted only as the very last word. */
  short?: boolean;
}

/**
 * Cut-off words: statement name fields are truncated at a fixed width, so a last token such as
 * "PARLOU" or "MEDICA" is a prefix of a keyword. Prefixes of at least 4 letters index the FIRST word of every
 * keyword phrase; a prefix that leads to keywords of two categories is ambiguous and ignored.
 */
const PREFIX_INDEX = new Map<string, { category: string; phrase: string; label: string } | null>();
for (const c of COMPILED) {
  const first = c.phrase.split(' ')[0];
  if (first.length < 5) continue;
  for (let n = 4; n < first.length; n++) {
    const prefix = first.slice(0, n);
    if (n / first.length < 0.55) continue; // "text" is not a cut-off "textiles"
    const existing = PREFIX_INDEX.get(prefix);
    if (existing === undefined) PREFIX_INDEX.set(prefix, { category: c.category, phrase: c.phrase, label: c.label });
    else if (existing && existing.category !== c.category) PREFIX_INDEX.set(prefix, null);
  }
}

/** Curated 3-letter fragments that are unambiguous when they are the LAST word ("… KIR" = kirana). */
const SHORT_PREFIX: Record<string, { category: string; phrase: string; label: string }> = {
  kir: { category: 'groceries', phrase: 'kirana', label: 'grocery keyword' },
};

/** Whole-word keyword search over already-canonical text; falls back to a cut-off last word. */
export function findKeyword(canonText: string, opts: { allowPrefix?: boolean } = {}): KeywordHit | null {
  if (!canonText) return null;
  const padded = ` ${canonText} `;
  for (const c of COMPILED) {
    if (padded.includes(` ${c.phrase} `)) return { category: c.category, phrase: c.phrase, label: c.label };
  }
  if (opts.allowPrefix) {
    const tokens = canonText.split(' ');
    const last = tokens[tokens.length - 1];
    if (last.length === 3 && SHORT_PREFIX[last] && tokens.length > 1) {
      const hit = SHORT_PREFIX[last];
      return { category: hit.category, phrase: `${last}… (${hit.phrase})`, label: hit.label, prefix: true, short: true };
    }
    if (last.length >= 4 && /^[a-z]+$/.test(last)) {
      const hit = PREFIX_INDEX.get(last);
      if (hit) return { category: hit.category, phrase: `${last}…${hit.phrase === last ? '' : ` (${hit.phrase})`}`, label: hit.label, prefix: true };
    }
  }
  return null;
}

export const KEYWORD_PHRASE_COUNT = COMPILED.length;
