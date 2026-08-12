/** Currencies offered as the "convert into" target in options. */
export const CURRENCIES = [
  ['USD', 'US Dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'British Pound'],
  ['JPY', 'Japanese Yen'],
  ['CNY', 'Chinese Yuan'],
  ['CHF', 'Swiss Franc'],
  ['CAD', 'Canadian Dollar'],
  ['AUD', 'Australian Dollar'],
  ['NZD', 'New Zealand Dollar'],
  ['SEK', 'Swedish Krona'],
  ['NOK', 'Norwegian Krone'],
  ['DKK', 'Danish Krone'],
  ['PLN', 'Polish Zloty'],
  ['CZK', 'Czech Koruna'],
  ['HUF', 'Hungarian Forint'],
  ['RON', 'Romanian Leu'],
  ['TRY', 'Turkish Lira'],
  ['RUB', 'Russian Ruble'],
  ['UAH', 'Ukrainian Hryvnia'],
  ['INR', 'Indian Rupee'],
  ['PKR', 'Pakistani Rupee'],
  ['BDT', 'Bangladeshi Taka'],
  ['LKR', 'Sri Lankan Rupee'],
  ['SGD', 'Singapore Dollar'],
  ['HKD', 'Hong Kong Dollar'],
  ['TWD', 'Taiwan Dollar'],
  ['KRW', 'South Korean Won'],
  ['THB', 'Thai Baht'],
  ['VND', 'Vietnamese Dong'],
  ['IDR', 'Indonesian Rupiah'],
  ['MYR', 'Malaysian Ringgit'],
  ['PHP', 'Philippine Peso'],
  ['ILS', 'Israeli Shekel'],
  ['AED', 'UAE Dirham'],
  ['SAR', 'Saudi Riyal'],
  ['QAR', 'Qatari Riyal'],
  ['EGP', 'Egyptian Pound'],
  ['ZAR', 'South African Rand'],
  ['NGN', 'Nigerian Naira'],
  ['KES', 'Kenyan Shilling'],
  ['GHS', 'Ghanaian Cedi'],
  ['MAD', 'Moroccan Dirham'],
  ['BRL', 'Brazilian Real'],
  ['MXN', 'Mexican Peso'],
  ['ARS', 'Argentine Peso'],
  ['CLP', 'Chilean Peso'],
  ['COP', 'Colombian Peso'],
  ['PEN', 'Peruvian Sol'],
  ['ISK', 'Icelandic Krona'],
  ['BGN', 'Bulgarian Lev'],
  ['HRK', 'Croatian Kuna'],
  ['RSD', 'Serbian Dinar'],
  ['KZT', 'Kazakhstani Tenge'],
  ['BTC', 'Bitcoin']
];

const NAMES = new Map(CURRENCIES);

export function currencyName(code) {
  return NAMES.get(code) || code;
}

/** Every ISO code we're willing to recognise inside selected text. */
export const CURRENCY_CODES = new Set(CURRENCIES.map(([c]) => c));

/**
 * Symbol -> ISO code. Longest keys must be tested first when scanning text,
 * so that "CA$" doesn't get read as a bare "$".
 */
export const CURRENCY_SYMBOLS = {
  'US$': 'USD',
  'C$': 'CAD',
  'CA$': 'CAD',
  'CAD$': 'CAD',
  'A$': 'AUD',
  'AU$': 'AUD',
  'NZ$': 'NZD',
  'HK$': 'HKD',
  'S$': 'SGD',
  'NT$': 'TWD',
  'R$': 'BRL',
  'MX$': 'MXN',
  'RM': 'MYR',
  'Rp': 'IDR',
  '₫': 'VND',
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₽': 'RUB',
  '₩': 'KRW',
  '₺': 'TRY',
  '₴': 'UAH',
  '₪': 'ILS',
  '฿': 'THB',
  '₱': 'PHP',
  '₦': 'NGN',
  '₡': 'CRC',
  '₸': 'KZT',
  'zł': 'PLN',
  'Kč': 'CZK',
  'Ft': 'HUF',
  '﷼': 'SAR',
  '₿': 'BTC'
};

/** Preferred display symbol for a code (falls back to the code itself). */
export const DISPLAY_SYMBOL = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹', RUB: '₽',
  KRW: '₩', TRY: '₺', UAH: '₴', ILS: '₪', THB: '฿', PHP: '₱', NGN: '₦',
  VND: '₫', BRL: 'R$', CAD: 'CA$', AUD: 'A$', NZD: 'NZ$', HKD: 'HK$',
  SGD: 'S$', TWD: 'NT$', MXN: 'MX$', BTC: '₿'
};
