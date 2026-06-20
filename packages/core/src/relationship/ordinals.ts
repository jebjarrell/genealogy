// Small pure ordinal / counting helpers used by relationship description
// (TRD §9). No DOM, no Node APIs — plain string math only.

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th", 11 -> "11th", 21 -> "21st". */
export function ordinal(n: number): string {
  const tens = Math.abs(n) % 100;
  // 11, 12, 13 are always "th" regardless of the last digit.
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (Math.abs(n) % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const ORDINAL_WORDS: readonly string[] = [
  'zeroth',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
  'twentieth',
];

/** 1 -> "first" … 20 -> "twentieth"; beyond the table, falls back to ordinal(n). */
export function ordinalWord(n: number): string {
  const word = ORDINAL_WORDS[n];
  return word ?? ordinal(n);
}

const COUNT_WORDS: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** 1 -> "once", 2 -> "twice", 3 -> "three times", 4 -> "four times", … */
export function removalWord(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  const word = COUNT_WORDS[n];
  return `${word ?? String(n)} times`;
}

/**
 * 0 -> "", 1 -> "great-", 2 -> "2nd great-", 3 -> "3rd great-", …
 * (Uses ordinal() for greats >= 2.)
 */
export function greatPrefix(greats: number): string {
  if (greats <= 0) return '';
  if (greats === 1) return 'great-';
  return `${ordinal(greats)} great-`;
}
