/** Languages offered in options and in the "Translate to…" context menu. */
export const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['sv', 'Swedish'],
  ['nb', 'Norwegian'],
  ['da', 'Danish'],
  ['fi', 'Finnish'],
  ['pl', 'Polish'],
  ['cs', 'Czech'],
  ['ro', 'Romanian'],
  ['hu', 'Hungarian'],
  ['el', 'Greek'],
  ['tr', 'Turkish'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['ar', 'Arabic'],
  ['he', 'Hebrew'],
  ['fa', 'Persian'],
  ['hi', 'Hindi'],
  ['bn', 'Bengali'],
  ['ur', 'Urdu'],
  ['th', 'Thai'],
  ['vi', 'Vietnamese'],
  ['id', 'Indonesian'],
  ['ms', 'Malay'],
  ['tl', 'Filipino'],
  ['sw', 'Swahili'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese (Simplified)'],
  ['zh-TW', 'Chinese (Traditional)']
];

/** Shorter list used for the right-click submenu so it stays usable. */
export const CONTEXT_MENU_LANGUAGES = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl',
  'ru', 'uk', 'ar', 'hi', 'ja', 'ko', 'zh', 'tr'
];

const NAMES = new Map(LANGUAGES);

export function languageName(code) {
  return NAMES.get(code) || code;
}
