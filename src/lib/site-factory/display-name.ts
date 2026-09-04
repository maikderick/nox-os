/**
 * How a business name is *set*, as opposed to what it is.
 *
 * Imported registries store what the owner typed into a map listing, and a
 * great many of those are shouted: "ZEN COMIDA JAPONESA". Publishing that
 * verbatim gives every such client a site whose wordmark, headline and footer
 * are in caps — the loudest possible reading of a name nobody chose to shout.
 *
 * This is presentation only. The confirmed fact is never rewritten: the brief
 * keeps the string somebody read and confirmed, and every publishing surface
 * asks this module how to set it — through {@link publicBusinessName}, so the
 * page, the `<title>`, the exported snapshot and the agent's prompt cannot
 * disagree about what the business is called. Anything the operator typed with
 * even one lowercase letter is left exactly as written, because then the
 * casing *is* the name.
 */

import type { SiteBrief } from "./brief-schema";

const PT = "pt-BR";

/** Words Portuguese leaves lowercase inside a name. */
const CONNECTIVES = new Set(["de", "da", "do", "das", "dos", "e"]);

const LETTER = /\p{L}/u;
const LETTERS = /\p{L}/gu;
const LOWERCASE = /\p{Ll}/u;
const NON_LETTER = /[^\p{L}]/gu;

/**
 * Everything that starts a new word inside a name.
 *
 * Whitespace is not the only joiner a business name uses: "LAVA-RÁPIDO",
 * "CAFÉ&CIA", "D'ITÁLIA" and "S/A" all carry a second word that has to be
 * capitalised in its own right. Splitting on whitespace alone left them as
 * "Lava-rápido", "Café&cia", "D'itália" and "S/a". The group is captured so
 * the separators — and the original spacing — survive the round trip.
 */
const WORD_SEPARATORS = /([\s\-–—/&'’]+)/;

// `y` is deliberately absent. It is a vowel in "Yara" but a consonant in every
// initialism that uses it, and including it made "XYZ" parse as a pronounceable
// syllable (→ "Xyz") while "SKY" did not (→ "SKY"). Leaving it out makes both
// read as acronyms, which is what a shouted three-letter token nearly always is.
const VOWEL_CLASS = "aeiouáàâãéêíóôõúü";

/**
 * A short token that reads as one syllable.
 *
 * Length alone cannot separate an initialism from a word: "GM", "CTA" and
 * "ZEN" are all at most three letters, and only the last is a word. What
 * separates them is whether the letters can be *said* — an optional opening
 * consonant, a vowel, an optional closing consonant. "ZEN" and "SÃO" fit;
 * "CTA" (two consonants before the vowel) and "GM" (no vowel at all) do not,
 * so they keep the caps the owner typed.
 */
const SYLLABLE = new RegExp(
  `^[^${VOWEL_CLASS}]?[${VOWEL_CLASS}]+[^${VOWEL_CLASS}]?$`,
  "i",
);

const ACRONYM_MAX_LETTERS = 3;

/**
 * The floor below which casing carries no signal.
 *
 * A two- or three-letter name in caps ("GM", "JJ") is far more likely an
 * initialism than a shout, so nothing under four letters is touched at all.
 */
const SHOUT_MIN_LETTERS = 4;

function titleCaseToken(token: string, isFirst: boolean): string {
  const letters = token.replace(NON_LETTER, "");
  if (letters.length === 0) return token;

  const lower = token.toLocaleLowerCase(PT);

  // The first word is capitalised even when it is a connective: "DA CASA" is
  // read as a name beginning with "Da", not as a fragment.
  if (!isFirst && CONNECTIVES.has(letters.toLocaleLowerCase(PT))) return lower;

  if (letters.length <= ACRONYM_MAX_LETTERS && !SYLLABLE.test(letters)) return token;

  // Replaces the first letter, not the first character, so a token that opens
  // with punctuation ("(padaria") still capitalises the word.
  return lower.replace(LETTER, (character) => character.toLocaleUpperCase(PT));
}

/**
 * The name as the site should set it.
 *
 * Returns the input untouched unless the name is shouting: at least four
 * letters and not one of them lowercase.
 */
export function displayBusinessName(name: string): string {
  const letterCount = (name.match(LETTERS) ?? []).length;
  if (letterCount < SHOUT_MIN_LETTERS) return name;
  if (LOWERCASE.test(name)) return name;

  let seenWord = false;
  return name
    .split(WORD_SEPARATORS)
    .map((token) => {
      if (!LETTER.test(token)) return token;
      const cased = titleCaseToken(token, !seenWord);
      seenWord = true;
      return cased;
    })
    .join("");
}

/**
 * The one name every publishing surface prints.
 *
 * The renderer, the exported snapshot, the agent's prompt and the public
 * page's `<title>` all read the business name through here. Applying the
 * re-casing in only one of them is how a page ended up showing
 * "Zen Comida Japonesa" in its body and "ZEN COMIDA JAPONESA" in its tab.
 */
export function publicBusinessName(brief: SiteBrief): string {
  return displayBusinessName(brief.businessName.value);
}

/** True when a name would be re-set by {@link displayBusinessName}. */
export function isShoutingName(name: string): boolean {
  return displayBusinessName(name) !== name;
}
