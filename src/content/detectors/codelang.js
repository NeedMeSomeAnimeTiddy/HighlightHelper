/**
 * "Is this code, and if so what language?" — a small scoring heuristic.
 *
 * Only decides whether to offer the code rows and what to tell the model the
 * language probably is. A wrong guess costs a word in a prompt, so this stays
 * cheap and approximate rather than trying to be a real classifier.
 */

/**
 * Any one of these settles it — they essentially do not occur in prose.
 * A ratio over all signals was the first attempt and it under-scored languages
 * with few syntactic markers: a one-line SQL statement hit exactly one signal.
 */
const STRONG_SIGNALS = [
  /^\s*(?:function|def|class|import|from|package|using|#include|module)\b/m,
  /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b[\s\S]*\b(?:FROM|INTO|SET|TABLE|WHERE|VALUES)\b/i,
  /<!DOCTYPE|<\/[a-z][\w-]*>/i,
  /^#!/,                             // shebang
  /=>|->|::|:=|<-/,                  // arrows and scope operators
  /\w+\s*\([^)]*\)\s*\{/,            // a signature followed by a block
  /^\s*(?:public|private|protected)\s+(?:static\s+)?\w/m
];

/** Weaker hints; several together mean code, one alone does not. */
const WEAK_SIGNALS = [
  /[{}();]\s*$/m,                    // a line ending in a brace, paren or semicolon
  /^\s*(?:const|let|var|func|fn|val|type|def|end)\b/m,
  /^\s*(?:if|for|while|switch|match|elif|else)\s*[({:]/m,
  /^\s*(?:\/\/|#|\/\*|--)\s*\S/m,    // comment lines
  /^\s{2,}\S/m,                      // indented block structure
  /^\s*[\w."'[\]-]+\s*[:=]\s*\S/m,   // assignment or key/value
  /\$\w+|@\w+|\w+\.\w+\(/            // sigils and method calls
];

const MIN_WEAK = 3;

const LANGUAGES = [
  ['JavaScript', [/\b(?:const|let)\s+\w+\s*=/, /=>/, /\bfunction\b/, /console\.log/, /\brequire\(/, /\bexport\s+(?:default|const)/]],
  ['TypeScript', [/:\s*(?:string|number|boolean|void|any|unknown)\b/, /\binterface\s+\w+/, /\btype\s+\w+\s*=/, /<[A-Z]\w*>/]],
  ['Python', [/^\s*def\s+\w+\s*\(.*\)\s*:/m, /^\s*from\s+\w+\s+import\b/m, /\bself\b/, /\bprint\(/, /\belif\b/, /^\s*@\w+$/m]],
  ['Java', [/\bpublic\s+(?:static\s+)?(?:class|void|int|String)\b/, /System\.out\.print/, /\bnew\s+[A-Z]\w*\(/, /\bimport\s+java\./]],
  ['C#', [/\busing\s+System\b/, /\bnamespace\s+\w+/, /\bpublic\s+(?:async\s+)?[A-Z]\w*\s+\w+\(/, /\bvar\s+\w+\s*=\s*new\b/]],
  ['C', [/#include\s*<\w+\.h>/, /\bprintf\s*\(/, /\bint\s+main\s*\(/, /\bmalloc\s*\(/]],
  ['C++', [/#include\s*<\w+>/, /\bstd::/, /\bcout\s*<</, /\btemplate\s*</]],
  ['Go', [/\bfunc\s+\w+\s*\(/, /\bpackage\s+main\b/, /:=/, /\bfmt\./, /\bdefer\b/]],
  ['Rust', [/\bfn\s+\w+\s*\(/, /\blet\s+mut\b/, /\bimpl\b/, /->\s*Result</, /\bprintln!/, /\bmatch\b.*\{/]],
  ['Ruby', [/\bdef\s+\w+\s*(?:\(|$)/m, /\bend\s*$/m, /\bputs\b/, /\brequire\s+['"]/, /\bdo\s*\|/]],
  ['PHP', [/<\?php/, /\$\w+\s*=/, /\becho\b/, /->\w+\(/]],
  ['SQL', [/\bSELECT\b[\s\S]*\bFROM\b/i, /\bINSERT\s+INTO\b/i, /\bCREATE\s+TABLE\b/i, /\bJOIN\b.*\bON\b/i]],
  ['HTML', [/<\/?[a-z][\w-]*(?:\s[^>]*)?>/i, /<!DOCTYPE/i]],
  ['CSS', [/^[.#]?[\w-]+\s*\{[^}]*:[^}]*\}/m, /@media\b/, /!important/]],
  ['JSON', [/^\s*[[{][\s\S]*[\]}]\s*$/]],
  ['Shell', [/^#!.*\b(?:ba)?sh\b/m, /\$\{\w+\}/, /\becho\s+["'$]/, /\|\s*(?:grep|awk|sed)\b/]],
  ['YAML', [/^\s*[\w-]+:\s*(?:\||>|$)/m, /^\s*-\s+\w+:/m]]
];

/** True when the selection is plausibly source code. */
export function isCode(text) {
  if (STRONG_SIGNALS.some((re) => re.test(text))) return true;
  return WEAK_SIGNALS.filter((re) => re.test(text)).length >= MIN_WEAK;
}

/** Best-guess language name, or null. */
export function guessLanguage(text) {
  let best = null;
  for (const [name, signals] of LANGUAGES) {
    const score = signals.filter((re) => re.test(text)).length;
    if (score > 0 && (!best || score > best.score)) best = { name, score };
  }
  // TypeScript signals sit on top of JavaScript ones; prefer the specific one.
  if (best?.name === 'JavaScript') {
    const ts = LANGUAGES.find(([n]) => n === 'TypeScript')[1]
      .filter((re) => re.test(text)).length;
    if (ts >= 1) return 'TypeScript';
  }
  return best?.name ?? null;
}
