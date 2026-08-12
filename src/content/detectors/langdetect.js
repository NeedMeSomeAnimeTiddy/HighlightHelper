/**
 * A deliberately small language guesser.
 *
 * This never decides *what* to translate into — it only decides how prominent
 * the Translate tab should be. Getting it wrong costs a tab ordering, not an
 * API call, so a script check plus stopword counting is plenty.
 */

const SCRIPTS = [
  [/[぀-ゟ゠-ヿ]/, 'ja'],
  [/[가-힯ᄀ-ᇿ]/, 'ko'],
  [/[一-鿿]/, 'zh'],
  [/[Ѐ-ӿ]/, 'ru'],
  [/[֐-׿]/, 'he'],
  [/[؀-ۿݐ-ݿ]/, 'ar'],
  [/[Ͱ-Ͽ]/, 'el'],
  [/[ऀ-ॿ]/, 'hi'],
  [/[ঀ-৿]/, 'bn'],
  [/[฀-๿]/, 'th']
];

const STOPWORDS = {
  // "a" and "i" belong here — leaving them out let Portuguese, which does list
  // "a", win on any English text with a stray article in it.
  en: ('the of and to a in that is it for on with as was be this are at by not from have but you ' +
    'an or if we they their has had will can all one about there what when which would i he she').split(' '),
  es: 'el la los las de que y en un una para con no por como se su al lo pero más este'.split(' '),
  fr: 'le la les des du de et est dans pour que qui pas une avec sur au ce il ne plus'.split(' '),
  de: 'der die das und ist nicht ein eine für mit auf den dem des zu von sich auch als'.split(' '),
  it: 'il lo la di che e per non una con del sono più come nel alla dei anche questo'.split(' '),
  pt: 'o a os as de que e em um uma para com não por mais como do da se mas'.split(' '),
  nl: 'de het een en van is dat niet op voor met zijn aan als er ook maar door'.split(' '),
  sv: 'och att det som en är på för med av den till inte har om men var'.split(' '),
  pl: 'nie jest się w na do że i z jak co tylko przez oraz jego przy'.split(' '),
  tr: 'bir ve bu için ile de da çok daha olarak ama gibi kadar sonra'.split(' '),
  id: 'yang dan di ke dari untuk tidak ini itu dengan pada adalah akan atau'.split(' '),
  vi: 'của và là các có được trong người một những cho không'.split(' '),
  ro: 'și este în de la nu cu pentru care se din pe mai'.split(' ')
};

const DIACRITICS = [
  [/[ñ]|¿|¡/i, 'es'],
  [/[àâçèêëîïôùûœ]/i, 'fr'],
  [/[äöüß]/i, 'de'],
  [/[ãõ]/i, 'pt'],
  [/[ąćęłńóśźż]/i, 'pl'],
  [/[åäö]/i, 'sv'],
  [/[ığşİ]/, 'tr'],
  [/[ăâîșț]/i, 'ro'],
  [/[àèìòù]/i, 'it']
];

/**
 * Returns { lang, confidence } where confidence is 0..1.
 * `lang` may be null when there's nothing to go on.
 */
export function detectLanguage(text) {
  if (!text) return { lang: null, confidence: 0 };

  for (const [re, lang] of SCRIPTS) {
    if (re.test(text)) return { lang, confidence: 0.95 };
  }

  const words = text.toLowerCase().match(/[\p{L}']+/gu) || [];
  if (words.length < 3) {
    // Too short for stopwords — a diacritic is the only real signal.
    for (const [re, lang] of DIACRITICS) {
      if (re.test(text)) return { lang, confidence: 0.4 };
    }
    return { lang: null, confidence: 0 };
  }

  const scores = {};
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    let hits = 0;
    for (const w of words) if (set.has(w)) hits++;
    scores[lang] = hits / words.length;
  }

  for (const [re, lang] of DIACRITICS) {
    if (re.test(text)) scores[lang] = (scores[lang] || 0) + 0.12;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;

  if (topScore < 0.08) return { lang: null, confidence: 0 };

  // Confidence rises with the gap between first and second place.
  const confidence = Math.min(0.9, topScore * 2 + (topScore - runnerUp));
  return { lang: topLang, confidence };
}

/** Normalises "en-GB" / "zh-TW" to the base tag for comparison. */
export function baseTag(code) {
  return String(code || '').split('-')[0].toLowerCase();
}
