import type { PersonName } from '../types/names.js';
import type { Sex } from '../types/persons.js';

/**
 * Trim a string and collapse every run of internal whitespace to a single
 * space. Used for the display-oriented `given`, `surname`, and `full` fields;
 * the verbatim `raw` is never passed through this.
 */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Parse a GEDCOM 5.5.1 personal NAME value (TRD §5.2/§7.2).
 *
 * Personal names use slashes to delimit the surname:
 * `"Given names /Surname/ optional-suffix"`. The portion before the first
 * slash is the given name; the portion between the first pair of slashes is
 * the surname; anything after the closing slash is a suffix folded into the
 * display form. A name with no slashes (e.g. "Madonna") has no surname.
 *
 * `raw` is always preserved verbatim and the function never throws.
 */
export function parsePersonName(raw: string, isPrimary: boolean): PersonName {
  const firstSlash = raw.indexOf('/');

  // No surname delimiter: the whole value is a given/display name.
  if (firstSlash === -1) {
    const collapsed = collapseWhitespace(raw);
    return {
      raw,
      given: collapsed === '' ? undefined : collapsed,
      surname: undefined,
      full: collapsed,
      isPrimary,
    };
  }

  const secondSlash = raw.indexOf('/', firstSlash + 1);

  const givenPart = collapseWhitespace(raw.slice(0, firstSlash));

  // If there is no closing slash, treat everything after the first slash as
  // the surname region so we still recover a usable name defensively.
  const surnamePart =
    secondSlash === -1
      ? collapseWhitespace(raw.slice(firstSlash + 1))
      : collapseWhitespace(raw.slice(firstSlash + 1, secondSlash));

  const suffixPart =
    secondSlash === -1 ? '' : collapseWhitespace(raw.slice(secondSlash + 1));

  const given = givenPart === '' ? undefined : givenPart;
  const surname = surnamePart === '' ? undefined : surnamePart;

  const pieces: string[] = [];
  if (given !== undefined) pieces.push(given);
  if (surname !== undefined) pieces.push(surname);
  if (suffixPart !== '') pieces.push(suffixPart);
  const full = pieces.join(' ');

  return {
    raw,
    given,
    surname,
    full,
    isPrimary,
  };
}

/**
 * Parse a GEDCOM SEX value into the canonical {@link Sex} union.
 *
 * `M`/`m` → `'male'`, `F`/`f` → `'female'`. Everything else — including the
 * GEDCOM `U` (undetermined), other letters, empty, null, and undefined —
 * maps to `'unknown'`. The input is trimmed before comparison.
 */
export function parseSex(raw: string | null | undefined): Sex {
  if (raw === null || raw === undefined) {
    return 'unknown';
  }
  switch (raw.trim().toUpperCase()) {
    case 'M':
      return 'male';
    case 'F':
      return 'female';
    default:
      return 'unknown';
  }
}
