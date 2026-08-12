/**
 * Read aloud, via the browser's own speech synthesis.
 *
 * No network, no key, no permission, and an accessibility feature the whole
 * category ignores — PopClip has shipped "Say" since the beginning and none of
 * the browser extensions bothered.
 *
 * It also does the dictionary's pronunciation, which is why that tool needs no
 * second API: the browser can already say the word.
 */

const MAX_CHARS = 32000;

export function canSpeak() {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance === 'function';
}

/**
 * Picks a voice for the language, falling back to the browser's default.
 *
 * `getVoices()` is famously empty on the first call in Chrome — the list
 * arrives asynchronously — so a miss here is normal and simply means the
 * default voice speaks. Not worth an event listener and a promise for a
 * best-effort accent.
 */
function voiceFor(lang) {
  if (!lang) return null;
  const base = String(lang).split('-')[0].toLowerCase();
  const voices = speechSynthesis.getVoices() || [];
  return voices.find((v) => v.lang?.toLowerCase().startsWith(base)) || null;
}

/**
 * Speaks the text, cancelling anything already being spoken.
 *
 * Cancelling first is the whole interaction: pressing the button again on a
 * long passage means "stop that and do this", never "queue a second reading
 * behind the first". Returns false when the browser can't do it at all.
 */
export function speak(text, lang) {
  if (!canSpeak()) return false;

  const body = String(text || '').slice(0, MAX_CHARS).trim();
  if (!body) return false;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(body);
  const voice = voiceFor(lang);
  if (voice) utterance.voice = voice;
  if (lang) utterance.lang = lang;

  speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel();
}

export function isSpeaking() {
  return canSpeak() && speechSynthesis.speaking;
}
