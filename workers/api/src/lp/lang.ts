// Which language a text is written in. Used to keep a page in the one language it was asked for.

import type { Lang } from "./types.ts";

const EN_WORDS = new Set(
  "the and for with your you are our that this from have has will can into more not their they what when which about as at by of to in is it be or we us how".split(
    " ",
  ),
);
const FR_WORDS = new Set(
  "le la les des une un pour avec votre vous nous sont notre que qui dans sur par est aux du de et en au ce ces à comment plus pas leur leurs elle ils".split(
    " ",
  ),
);

/** Which language a text is written in, by its function words. Null when it is too short to tell. */
export function languageOf(text: string): Lang | null {
  const words = text.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ']+/g) ?? [];
  let en = 0;
  let fr = 0;
  for (const w of words) {
    if (EN_WORDS.has(w)) en++;
    if (FR_WORDS.has(w)) fr++;
  }
  if (en + fr < 2 || en === fr) return null;
  return en > fr ? "en" : "fr";
}
