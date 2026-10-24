/**
 * Built-in Indian merchant dictionary: public brand names only.
 *
 * Each entry is `Display Name|alias|alias…`. Aliases are matched as WHOLE WORDS / PHRASES (never as
 * substrings), and the longest matching alias wins, so "swiggy instamart" (groceries) beats
 * "swiggy" (food) and "steam" can never be confused with "tea".
 *
 * Fixes over the legacy list: EMI is not rent; LIC appears once (insurance); generic words
 * (shop, store, mart, auto, game, central, more, max, lifestyle) are NOT brand aliases — they live
 * in keywords.ts as low-confidence generic hints that never beat a brand.
 */

export interface Brand {
  /** Display name, e.g. "Swiggy Instamart". */
  name: string;
  category: string;
  /** Canonical aliases (lower-case alphanumeric words separated by single spaces). */
  aliases: string[];
}

/** Lower-case, '&' → 'and', every other non-alphanumeric run → single space. */
export function canon(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

import { RAW_MORE } from './brands_more';

const RAW: Record<string, string[]> = {
  food_dining: [
    // aggregators & delivery
    'Swiggy|swiggy food|bundl technologies|swiggy limited|swiggy order',
    'Zomato|zomato order|zomato online|zomato ltd|zomato limited|zomato media',
    'Eatsure|eat sure|rebel foods', 'Faasos', 'Behrouz Biryani|behrouz', 'Oven Story Pizza|oven story', 'Box8', 'Freshmenu|fresh menu',
    'Lunchbox|lunch box', 'Magicpin|magic pin', 'Dineout|dine out', 'Eazydiner|eazy diner', 'Uber Eats', 'District by Zomato|zomato district',
    // QSR chains
    "McDonald's|mcdonalds|mcdonald|mc donalds|hardcastle restaurants",
    'KFC|kfc india|yum restaurants|devyani international', 'Pizza Hut|pizzahut', "Domino's|dominos|dominos pizza|jubilant foodworks",
    'Burger King|burgerking', 'Subway|subway india', 'Taco Bell|tacobell', "Wendy's|wendys", 'Popeyes|popeyes louisiana', "Papa John's|papa johns",
    'Mojo Pizza', "La Pino'z|la pinoz", 'Burger Singh', 'Wow Momo|wow momos', 'Momo Mia', 'Biryani By Kilo|biryani by kilo', 'Biryani Blues',
    'Lazeez', "Nando's|nandos", 'Barbeque Nation|bbq nation|bbqnation', 'Absolute Barbecues|absolute barbecue', 'Chicking|chicking',
    // cafes & dessert
    'Starbucks|starbucks coffee|tata starbucks', 'Cafe Coffee Day|ccd|coffee day', 'Barista|barista coffee', 'Costa Coffee|costa coffee',
    'Chaayos', 'Chai Point|chaipoint', 'Chai Sutta Bar|chai sutta', 'Tea Trails', 'Third Wave Coffee|third wave', 'Blue Tokai|blue tokai coffee',
    'Theobroma', 'Keventers', 'Baskin Robbins|baskin robbin', 'Natural Ice Cream|naturals ice cream', 'Cream Stone|creamstone', 'Haagen Dazs',
    'Amul Ice Cream|amul parlour', 'Mad Over Donuts', 'Krispy Kreme', 'Dunkin|dunkin donuts', 'Tim Hortons', 'Hatti Kaapi', "Glen's Bakehouse|glens bakehouse",
    'Cakezone', 'Monginis', 'Karachi Bakery', 'Ibaco', 'Hangyo Ice Creams|hangyo', 'Giani Ice Cream|giani',
    // restaurant brands
    "Haldiram's|haldirams|haldiram", 'Bikanervala', 'Saravana Bhavan|sarvana bhavan|saravanaa bhavan', 'Adyar Ananda Bhavan|a2b|adyar ananda',
    'Paradise Biryani|paradise food court|paradise restaurant', 'Bawarchi|bawarchi restaurant', 'Anjappar', 'Punjabi By Nature',
    'Hard Rock Cafe', 'TGI Fridays|tgi friday', "Chili's|chilis", 'Mainland China', 'Sigree', 'Pista House', 'Shah Ghouse|shah gouse',
    'Mehfil Restaurant', 'Meghana Foods', "Ohri's|ohris", 'Chutneys', 'Kritunga', 'Rameshwaram Cafe', 'Vidyarthi Bhavan', 'MTR Foods|mtr|mavalli tiffin',
    'Sagar Ratna', 'Copper Chimney', 'Cream Centre', 'Biryani Zone', 'Rolls Mania', 'Kaati Zone', 'Sweet Magic', 'Bengal Sweet', "Nathu's Sweets|nathus sweets",
    'Bikaji', 'Kakatiya', 'Dindigul Thalappakatti|thalappakatti', 'Hotel Saravana', 'Social Offline',
  ],
  groceries: [
    'Swiggy Instamart|instamart|swiggy insta mart', 'Blinkit|grofers|blink commerce', 'Zepto|zepto marketplace|kiranakart', 'BigBasket|big basket|innovative retail concepts',
    'BB Daily|bigbasket daily', 'JioMart|jio mart', 'Dunzo|dunzo daily', 'Amazon Fresh', 'Amazon Now', 'Flipkart Minutes|flipkart grocery', 'Milkbasket|milk basket',
    'Country Delight|countrydelight', 'Licious', 'FreshToHome|fresh to home', 'Meatigo', 'Otipy', 'Pluckk', 'Kisankonnect', 'Supr Daily|suprdaily', 'Handpickd',
    'Hyperpure|zomato hyperpure', 'DMart|d mart|avenue supermarts|dmart ready|d mart ready', 'Ratnadeep|ratnadeep supermarket|ratnadeep super market',
    'Reliance Fresh', 'Reliance Smart|reliance smart point', 'More Supermarket|more megastore|more retail|aditya birla retail', 'Spar Hypermarket|spar hyper',
    "Spencer's|spencers|spencer s retail", "Nature's Basket|natures basket", 'Star Bazaar|star bazar', 'Hypercity', 'Big Bazaar|bigbazaar', 'Easyday|easy day',
    'Heritage Fresh|heritage foods', 'Nilgiris|nilgiri s', 'Foodhall', 'Le Marche', 'Modern Bazaar', 'Lulu Hypermarket|lulu hyper market', 'Carrefour',
    'Vijetha Supermarket|vijetha super market|vijetha', 'Metro Cash and Carry|metro cash carry|metro wholesale', 'Vishal Mega Mart|vishal megamart',
    'Smart Bazaar', 'Mother Dairy', 'Amul|amul dairy|amul milk|gcmmf', 'Nandini Milk|nandini dairy|kmf', 'Aavin', 'Vijaya Dairy|vijaya milk', 'Milky Mist',
    'Hatsun Agro|hatsun|arun icecreams', 'Namdhari Fresh', 'Swiggy Minis',
  ],
  transport: [
    'Uber|uber india|uber india systems|uber trip|uber ride', 'Ola Cabs|ola|ani technologies|olacabs|ola ride|ola money', 'Ola Electric|ola electric mobility',
    'Rapido|roppen transportation', 'Namma Yatri', 'BluSmart|blu smart|blusmart mobility', 'inDrive|indrive', 'Meru Cabs|meru cab', 'Yulu', 'Vogo',
    'Zoomcar|zoom car', 'Revv', 'Drivezy', 'Quick Ride|quickride', 'Savaari',
    'FASTag|fastag|fast tag|netc|netc fastag|npci netc|nhai', 'Paytm FASTag|paytm fastag', 'Park Plus|parkplus', 'ParkMate',
    'Indian Oil|iocl|indianoil|indian oil corporation|indianoil xtrapremium|indian oil petrol|ioc', 'HP Petrol|hpcl|hp petrol|hindustan petroleum|hp pay|hp petrol pump|hindustan petroleum corporation',
    'Bharat Petroleum|bpcl|bpcl petrol|bharatpetroleum|bharat petro|pure for sure', 'Shell Petrol|shell petrol|shell fuel|shell india', 'Nayara Energy|nayara',
    'Reliance BP|jio bp|reliance petroleum|reliance petrol', 'Essar Oil|essar petrol',
    'Namma Metro|bmrcl|bangalore metro', 'Delhi Metro|dmrc', 'Hyderabad Metro|l and t metro|hmrl|l and t metro rail', 'Chennai Metro|cmrl', 'Mumbai Metro',
    'Kolkata Metro', 'BMTC|bmtc bus', 'BEST Bus|best undertaking|best mumbai', 'DTC Bus|delhi transport corporation', 'MTC Chennai',
    'Maruti Suzuki Service|maruti suzuki|maruti service', 'Hyundai Service|hyundai motor', 'Tata Motors Service|tata motors', 'Mahindra First Choice',
    'Royal Enfield|royal enfield service', 'Bajaj Auto|bajaj auto service', 'TVS Motor|tvs motor company|tvs service', 'Hero MotoCorp|hero motocorp', 'Honda Cars|honda motorcycle',
    'MRF Tyres|mrf', 'CEAT Tyres|ceat', 'Apollo Tyres', 'JK Tyre|jk tyres', 'Bridgestone', 'Michelin', 'Goodyear', 'Cars24|cars 24', 'Spinny', 'CarDekho|car dekho',
  ],
  travel: [
    'IRCTC|irctc web|irctc ticket|irctc ecatering|indian railway catering|irctcweb|irctc rail|irctc tourism', 'redBus|redbus|red bus', 'AbhiBus|abhibus',
    'APSRTC|apsrtc', 'TSRTC|tsrtc|tgsrtc', 'KSRTC|ksrtc', 'MSRTC|msrtc', 'GSRTC|gsrtc', 'RSRTC|rsrtc', 'UPSRTC|upsrtc', 'SRS Travels|srs travels', 'VRL Travels|vrl travels',
    'Orange Tours and Travels|orange tours|orange travels|kallada', 'Intrcity SmartBus|intrcity', 'Zingbus', 'FlixBus|flixbus',
    'MakeMyTrip|make my trip|mmt travel|makemytrip india', 'Goibibo', 'Yatra|yatra online|yatra com', 'Cleartrip|clear trip', 'EaseMyTrip|easemytrip|ease my trip',
    'ixigo|le travenues', 'Skyscanner', 'Expedia', 'Booking.com|booking com|bookingcom', 'Agoda', 'Airbnb|air bnb', 'Thomas Cook', 'SOTC', 'Club Mahindra',
    'IndiGo|interglobe aviation|indigo airlines|indigo', 'SpiceJet|spice jet', 'Air India|air india express|airindia', 'Vistara|tata sia', 'Akasa Air|akasa',
    'AirAsia|air asia', 'Emirates|emirates airline', 'Qatar Airways', 'Etihad', 'Singapore Airlines', 'Lufthansa', 'British Airways', 'Thai Airways',
    'OYO Rooms|oyo|oyo rooms|oravel stays', 'Treebo|treebo hotels', 'FabHotels|fab hotels', 'Zostel', 'Hostelworld',
    'Taj Hotels|tajhotels|indian hotels company|vivanta|ginger hotels|taj mahal palace', 'Oberoi Hotels|oberoi hotels|oberoi', 'ITC Hotels|itc welcomhotel|welcomhotel',
    'Marriott|jw marriott|courtyard by marriott|fairfield by marriott', 'Hyatt|hyatt regency', 'Hilton|hilton garden', 'Radisson', 'Novotel', 'Ibis Hotel|ibis',
    'Holiday Inn', 'Lemon Tree Hotels|lemon tree', 'Sterling Holidays', 'The Leela|leela palace', 'VFS Global|vfs global|bls international', 'Passport Seva|passport seva',
    'Thrillophilia',
  ],
  healthcare: [
    'MedPlus|medplus health|medplus mart|medplus pharmacy', 'Apollo Pharmacy|apollo pharmacies|apollopharmacy|apollo pharma', 'Netmeds|netmeds marketplace',
    'Tata 1mg|1mg|1mg technologies|onemg', 'PharmEasy|pharm easy|api holdings', 'Wellness Forever', 'Medlife', 'Frank Ross', 'Generic Aadhaar|generic aadhar|jan aushadhi|janaushadhi',
    'Truemeds', 'Dawaa Dost', 'Aster Pharmacy|aster pharma', 'Apollo Hospitals|apollo hospital|apollo clinic|apollo health|apollo diagnostics|apollo spectra|apollo cradle',
    'Fortis Healthcare|fortis hospital|fortis', 'Max Healthcare|max hospital|max super speciality', 'Manipal Hospitals|manipal hospital',
    'Narayana Health|narayana hrudayalaya|narayana hospital', 'Aster Hospitals|aster hospital|aster medcity|aster cmi|aster rv|aster dm healthcare',
    'Yashoda Hospitals|yashoda hospital|yashoda', 'CARE Hospitals|care hospital|global hospitals', 'KIMS Hospitals|kims|kims hospital|krishna institute of medical sciences',
    'Cloudnine|cloud nine hospital', 'Motherhood Hospitals|motherhood hospital', 'Rainbow Hospitals|rainbow hospital|rainbow children', 'Lilavati Hospital|lilavati',
    'Kokilaben Hospital|kokilaben', 'Medanta', 'AIIMS', 'NIMHANS', 'CMC Vellore', 'Tata Memorial', 'Sankara Nethralaya', 'LV Prasad Eye Institute|lv prasad',
    'Vasan Eye Care', "Dr Agarwal's Eye Hospital|agarwal eye|dr agarwals", 'Practo|practo technologies', 'Lybrate', 'DocsApp', 'MFine', 'Pristyn Care|pristyn',
    'Thyrocare', 'SRL Diagnostics|srl', 'Dr Lal PathLabs|lal pathlabs|dr lal path labs|lalpathlabs|dr lal pathlabs', 'Metropolis Healthcare|metropolis',
    'Healthians', 'Redcliffe Labs|redcliffe', 'Orange Health', 'Vijaya Diagnostic|vijaya diagnostics', 'Neuberg', 'Agilus Diagnostics|agilus',
  ],
  utilities: [
    'BESCOM|bangalore electricity', 'TSSPDCL|tgspdcl', 'TSNPDCL|tgnpdcl', 'APSPDCL', 'APEPDCL', 'APCPDCL', 'MSEDCL|mahavitaran', 'BSES|bses rajdhani|bses yamuna',
    'Tata Power|tata power delhi', 'Adani Electricity|adani electricity mumbai', 'Torrent Power', 'CESC', 'WBSEDCL', 'UPPCL', 'JVVNL', 'TANGEDCO|tneb', 'KSEB',
    'PGVCL', 'DGVCL', 'UGVCL', 'MGVCL', 'HESCOM', 'MESCOM', 'GESCOM', 'CESCOM', 'NPCL', 'DHBVN', 'UHBVN', 'PSPCL', 'CSPDCL',
    'Mahanagar Gas|mgl', 'Indraprastha Gas|igl', 'Adani Total Gas|adani gas|atgl', 'GAIL Gas', 'Gujarat Gas', 'Bhagyanagar Gas|bgl', 'Think Gas', 'Sabarmati Gas', 'Green Gas',
    'Indane Gas|indane|indian oil lpg', 'HP Gas|hpgas', 'Bharat Gas|bharatgas', 'BWSSB', 'HMWSSB|hyderabad water', 'Delhi Jal Board|djb',
    'Tata Play|tata sky|tatasky|tataplay', 'Dish TV|dishtv', 'D2H|videocon d2h', 'Sun Direct|sundirect', 'Airtel Digital TV|airtel dth', 'Hathway Cable',
    'ACT Fibernet Cable', 'Urban Company Services',
  ],
  mobile_internet: [
    'Airtel|bharti airtel|airtel prepaid|airtel postpaid|airtel payments|airtel thanks', 'Jio|reliance jio|jio prepaid|jio postpaid|jiofiber|jio fiber|jio recharge|jio platforms',
    'Vi Mobile|vodafone idea|vodafone|vi prepaid|vi postpaid|vi recharge|idea cellular', 'BSNL|bharat sanchar nigam|bsnl broadband|mtnl',
    'ACT Fibernet|act broadband|atria convergence', 'Hathway|hathway broadband', 'Tikona', 'Excitel|excitel broadband|excitel com', 'Spectra|spectranet',
    'You Broadband|youbroadband', 'GTPL', 'Airtel Xstream|xstream fiber', 'Alliance Broadband', 'Truecaller',
  ],
  entertainment: [
    'Netflix|netflix india|netflix com', 'Amazon Prime|prime video|amazon prime video|amzn prime|primevideo|amazon prime membership', 'Disney+ Hotstar|hotstar|disney hotstar|disney plus hotstar|disney plus|jiohotstar|jio hotstar',
    'Spotify|spotify india', 'Gaana', 'JioSaavn|saavn', 'Apple Music', 'YouTube Premium|youtube music|youtube|google youtube|youtubepremium', 'ZEE5|zee 5', 'SonyLIV|sony liv',
    'Voot', 'ALTBalaji|alt balaji', 'MX Player', 'Eros Now', 'MUBI', 'Lionsgate Play', 'Aha Video|ahavideo', 'Sun NXT|sunnxt', 'Hoichoi', 'JioCinema|jio cinema',
    'Audible', 'Kuku FM|kukufm', 'Pocket FM|pocketfm', 'Storytel',
    'PVR INOX|pvr|pvr cinemas|pvr inox|pvr ltd|inox|inox leisure|inox movies', 'Cinepolis', 'Carnival Cinemas', 'Miraj Cinemas', 'Asian Cinemas',
    'BookMyShow|book my show|bigtree entertainment|bigtree|big tree entertainment', 'Paytm Movies|paytm insider',
    'Steam|steam games|steamgames|steampowered|steam purchase|valve corporation', 'PlayStation|sony playstation|psn|sony interactive', 'Xbox|microsoft xbox', 'Nintendo',
    'Epic Games', 'Riot Games', 'Garena|free fire', 'PUBG', 'BGMI|krafton', 'Google Play|googleplay|play store|playstore|google play store|google play apps', 'App Store|apple app store|itunes',
    'Dream11|dream 11|dream sports', 'MPL|mobile premier league', 'Games24x7|my11circle|rummycircle', 'Junglee Games|junglee', 'WinZO', 'Ludo King|gametion', 'Zupee',
    'Wonderla', 'Imagica', 'Essel World|water kingdom', 'VGP Universal Kingdom|vgp', 'Ramoji Film City|ramoji', 'Kidzania', 'Smaaash|timezone',
  ],
  subscriptions: [
    'LinkedIn Premium|linkedin|linkedin corporation', 'Notion|notion labs', 'Figma', 'Canva', 'Dropbox',
    'Google One|google storage|google workspace|google gsuite|gsuite', 'Google Pay Services|googlepay|google india digital', 'Apple Services|icloud|apple icloud|appleservices|apple bill|apple com bill',
    'Microsoft 365|office 365|microsoft office|microsoft|msft|microsoft subscription|microsoft store', 'Adobe|adobe creative cloud|creative cloud|adobe systems',
    'Zoom|zoom video|zoom us', 'Slack', 'Grammarly', 'ChatGPT|chatgpt|openai|open ai', 'Claude AI|anthropic', 'GitHub', 'JetBrains', 'Atlassian|jira', 'Cursor AI|cursor ai|anysphere',
    'Midjourney', 'Perplexity', 'Amazon Web Services|aws|aws proserve|amazon aws', 'Google Cloud|gcp', 'DigitalOcean|digital ocean', 'Namecheap', 'GoDaddy|go daddy',
    'Hostinger', 'Vercel', 'Cloudflare', 'Heroku', 'NordVPN|nord vpn', 'ExpressVPN|express vpn', 'Proton|proton ag|protonmail|proton mail', 'Bitwarden', '1Password',
    'Evernote', 'Todoist', 'Trello', 'Asana', 'Zapier', 'The Hindu|hindu newspaper|kasturi and sons', 'Times of India|toi|toi plus|times internet',
    'Economic Times|et prime|et epaper', 'Hindustan Times|ht media', 'Indian Express', 'Mint Premium|livemint', 'Business Standard', 'Eenadu', 'Deccan Chronicle',
    'Substack', 'Patreon', 'Duolingo', 'Headspace', 'Kindle Unlimited', 'Tinder', 'Shaadi.com|shaadi com|shaadi|jeevansathi|bharatmatrimony|bharat matrimony',
    'Naukri|naukri com|info edge', 'Snapchat',
  ],
  shopping: [
    'Amazon|amazon in|amazon india|amazon pay|amazon seller services|amazon retail india|amazon pay india|amazon pay ecom|amzn|amazon shopping|amazonpay|amazon payments|amazon pay in',
    'Flipkart|flipkart internet|flipkart payments|flipkart india|flipkart pay|flipkart marketplace|ekart', 'Myntra|myntra designs|myntra jabong', 'Ajio|reliance ajio|ajio com',
    'Meesho|fashnear', 'Snapdeal', 'Tata CLiQ|tata cliq|tatacliq', 'Shopsy', 'FirstCry|first cry|brainbees', 'Hopscotch',
    'Lenskart|lenskart solutions', 'Titan Eye Plus|titan eye', 'Titan|titan company|titan watches|fastrack', 'Zara|zara india|inditex', 'H&M|h and m|hennes', 'Uniqlo', 'Forever 21',
    'Marks and Spencer|marks spencer', 'Pantaloons|pantaloon', 'Westside|trent limited', 'Shoppers Stop|shopperstop', 'Max Fashion|max retail', 'Reliance Trends',
    'FBB|big bazaar fashion', 'Brand Factory', 'Bata|bata india', 'Metro Shoes|mochi', 'Liberty Shoes', 'Woodland|aero group', 'Clarks', 'Crocs', 'Puma|puma sports',
    'Nike|nike india', 'Adidas|adidas india', 'Reebok', 'Skechers', 'ASICS', 'Decathlon|decathlon sports|decathlon sports india', 'Sports Station', "Levi's|levis|levi strauss",
    'Allen Solly', 'Van Heusen', 'Louis Philippe', 'Peter England', 'Raymond|raymonds', 'Fabindia|fab india', 'W for Woman|biba|global desi|aurelia', 'Libas', 'Jockey',
    'Croma|infiniti retail', 'Reliance Digital|jio digital life', 'Vijay Sales', 'Sangeetha Mobiles|sangeetha', 'Poorvika', 'Big C Mobiles|big c', 'Lot Mobiles',
    'Apple Store|apple india|apple retail', 'Samsung|samsung india', 'OnePlus', 'Xiaomi|mi store|mi com', 'Realme', 'boAt|boat lifestyle|imagine marketing', 'GoNoise|gonoise', 'Dell|dell india',
    'HP World|hp india', 'Lenovo', 'Asus', 'IKEA', 'Urban Ladder|urbanladder', 'Pepperfry', 'HomeTown', 'Home Centre', 'Nilkamal', 'Godrej Interio', 'Wakefit',
    'Sleepwell|sleepwell sheela', 'The Sleep Company|sleep company', 'Durian', 'Hamleys', 'Crossword|crossword bookstores', 'Sapna Book House|sapna books',
    'Archies', 'Ferns N Petals|fnp', 'IGP', 'Winni', 'Interflora', 'Bakingo',
    'Tanishq|tanishq jewellery', 'Kalyan Jewellers|kalyan', 'Malabar Gold and Diamonds|malabar gold', 'Joyalukkas|joy alukkas', 'PC Jeweller|pcj', 'GRT Jewellers|grt',
    'Khazana Jewellery|khazana', 'CaratLane|carat lane', 'Bluestone', 'Senco Gold|senco', 'OLX', 'Quikr', 'IndiaMART|indiamart', 'Udaan', 'Moglix', 'Cloudtail', 'Tata Neu|tata digital',
  ],
  personal_care: [
    'Nykaa|nykaa fashion|fsn e commerce|nykaa e retail', 'Purplle', 'Sugar Cosmetics|sugar cosmetics', 'Mamaearth|honasa|the derma co',
    'Urban Company|urbanclap|urban clap', 'Lakme Salon|lakme', 'Naturals Salon|naturals', 'Green Trends', 'Jawed Habib', 'Toni and Guy|toni guy', 'Looks Salon', 'Enrich Salon',
    'Bombay Shaving Company|bombay shaving', 'Beardo', 'The Man Company|man company', 'Forest Essentials', 'Kama Ayurveda', 'The Body Shop|body shop', 'Bath and Body Works',
    'Plum Goodness|plum', 'Minimalist|be minimalist', 'WOW Skin Science',
  ],
  fitness: [
    'Cult.fit|cult fit|cultfit|cure fit|curefit', "Gold's Gym|golds gym|gold gym", 'Anytime Fitness', 'CrossFit', 'Snap Fitness', 'Fitness First', 'Talwalkars', 'F45',
    'HealthifyMe', 'Fittr', 'Playo|play o', 'Hudle',
  ],
  education: [
    'Udemy', 'Coursera', 'LinkedIn Learning', 'Skillshare', 'MasterClass', 'Unacademy', "BYJU'S|byjus|byju s|think and learn", 'Vedantu', 'Toppr', 'Doubtnut',
    'Physics Wallah|physicswallah', 'Great Learning|greatlearning', 'upGrad', 'Simplilearn', 'Edureka', 'Scaler|interviewbit', 'Coding Ninjas', 'Codecademy', 'LeetCode',
    'HackerRank', 'Pluralsight', 'edX', 'Khan Academy', 'NPTEL', 'Aakash Institute|aakash', 'Allen Career Institute|allen career|allen kota', 'FIITJEE',
    'Narayana Educational|narayana junior|narayana iit', 'Sri Chaitanya|sri chaitanya educational', 'Career Launcher', 'Internshala', 'British Council',
    'Pearson VUE|pearson vue', 'Prometric',
  ],
  insurance: [
    'LIC|lic of india|life insurance corporation|lic premium|licindia|lic policy', 'HDFC Life|hdfclife|hdfc standard life', 'ICICI Prudential Life|icici prudential life|icici pru life|iprulife|icici prulife',
    'SBI Life|sbilife', 'Max Life|max life insurance|axis max life', 'Bajaj Allianz|bajajallianz|bajaj allianz life|bajaj allianz general', 'Tata AIA|tata aig|tata aia life',
    'Kotak Life|kotak mahindra life|kotak life insurance', 'Aditya Birla Sun Life Insurance|birla sun life insurance|absli', 'PNB MetLife|metlife', 'Reliance Nippon Life|nippon life india',
    'Canara HSBC Life|canara hsbc', 'Star Health|star health and allied|star health insurance', 'Care Health Insurance|care health|religare health', 'Niva Bupa|max bupa',
    'Aditya Birla Health|abhi', 'ManipalCigna|manipal cigna', 'Digit Insurance|go digit|godigit|digit general', 'Acko|acko general|acko insurance',
    'PolicyBazaar|policy bazaar|pb fintech|policybazaar insurance', 'Coverfox', 'InsuranceDekho|insurance dekho', 'Turtlemint', 'ICICI Lombard|icicilombard|icici lombard general',
    'HDFC ERGO|hdfcergo|hdfc ergo general', 'New India Assurance|new india assurance co', 'United India Insurance|united india', 'National Insurance|national insurance co',
    'Oriental Insurance', 'SBI General|sbi general insurance', 'Royal Sundaram', 'Cholamandalam MS|chola ms', 'Future Generali|generali central', 'IFFCO Tokio', 'Liberty General', 'Zuno',
  ],
  rent_housing: [
    'NoBroker|no broker|nobroker rent|nobroker pay|nobroker technologies', 'Magicbricks', '99acres', 'Housing.com|housing com', 'Nestaway', 'Colive', 'Stanza Living|stanza',
    'Zolo Stays|zolo', 'RentenPe', 'Red Giraffe', 'Square Yards|squareyards', 'Livspace', 'HomeLane|home lane',
  ],
  taxes: [
    'Income Tax Department|income tax|income tax dept|itdtax|itd tax|cbdt|tin nsdl|nsdl tin|advance tax|self assessment tax|income tax payment|incometax|incometaxindia|oltas',
    'GST Payment|gstn|gst challan|gst portal|gst pmt|goods and services tax', 'Property Tax|property tax payment|municipal tax|house tax',
    'Professional Tax', 'Road Tax|vehicle tax|parivahan|motor vehicle tax', 'Stamp Duty|registration charges|sub registrar|igrs|stamps and registration',
  ],
  gifts_donations: [
    'GiveIndia|give india', 'Ketto', 'Milaap', 'ImpactGuru', 'Goonj', 'Akshaya Patra', 'Smile Foundation', 'HelpAge India|helpage', 'PM CARES|pmcares|pm cares fund',
    'TTD|tirumala|tirumala tirupati devasthanams|ttd seva', 'Siddhivinayak', 'Shirdi Sai Sansthan|shirdi sai', 'Vaishno Devi Shrine Board|vaishno devi', 'ISKCON|hare krishna',
  ],
};

export const BRANDS: Brand[] = [];
{
  const seen = new Map<string, Brand>();
  for (const [category, entries] of [...Object.entries(RAW), ...Object.entries(RAW_MORE)]) {
    for (const entry of entries) {
      const [name, ...aliasesRaw] = entry.split('|');
      const aliases = new Set<string>([canon(name)]);
      for (const a of aliasesRaw) {
        const c = canon(a);
        if (c) aliases.add(c);
      }
      const existing = seen.get(canon(name));
      if (existing) {
        for (const a of aliases) if (!existing.aliases.includes(a)) existing.aliases.push(a);
        continue;
      }
      const brand: Brand = { name, category, aliases: [...aliases].filter(Boolean) };
      seen.set(canon(name), brand);
      BRANDS.push(brand);
    }
  }
}

/** Size of the built-in dictionary: brands and the aliases that match them. */
export const DICTIONARY_SIZE = {
  brands: BRANDS.length,
  aliases: BRANDS.reduce((n, b) => n + b.aliases.length, 0),
};
