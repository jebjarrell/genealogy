import { describe, it, expect } from 'vitest';
import { parsePersonName, parseSex } from '../src/gedcom/name.js';

describe('parsePersonName', () => {
  it('parses given and surname from the canonical "John /Whitaker/" form', () => {
    const name = parsePersonName('John /Whitaker/', true);
    expect(name.given).toBe('John');
    expect(name.surname).toBe('Whitaker');
    expect(name.full).toBe('John Whitaker');
    expect(name.raw).toBe('John /Whitaker/');
    expect(name.isPrimary).toBe(true);
  });

  it('includes a suffix after the closing slash in the display form', () => {
    const name = parsePersonName('Mary Anne /Smith/ Jr', false);
    expect(name.given).toBe('Mary Anne');
    expect(name.surname).toBe('Smith');
    expect(name.full).toBe('Mary Anne Smith Jr');
    expect(name.raw).toBe('Mary Anne /Smith/ Jr');
    expect(name.isPrimary).toBe(false);
  });

  it('handles a single given name with no surname', () => {
    const name = parsePersonName('Madonna', true);
    expect(name.given).toBe('Madonna');
    expect(name.surname).toBeUndefined();
    expect(name.full).toBe('Madonna');
    expect(name.raw).toBe('Madonna');
  });

  it('handles a name with only a surname', () => {
    const name = parsePersonName('/Smith/', true);
    expect(name.given).toBeUndefined();
    expect(name.surname).toBe('Smith');
    expect(name.full).toBe('Smith');
    expect(name.raw).toBe('/Smith/');
  });

  it('preserves Unicode characters and accents unchanged', () => {
    const name = parsePersonName('José /Müller/', true);
    expect(name.given).toBe('José');
    expect(name.surname).toBe('Müller');
    expect(name.full).toBe('José Müller');
    expect(name.raw).toBe('José /Müller/');
  });

  it('collapses extra and leading/trailing whitespace in given, surname, and full', () => {
    const name = parsePersonName('  John   Quincy   /  Adams  /  Sr  ', true);
    expect(name.given).toBe('John Quincy');
    expect(name.surname).toBe('Adams');
    expect(name.full).toBe('John Quincy Adams Sr');
  });

  it('collapses whitespace in a no-slash name for the display form', () => {
    const name = parsePersonName('  Cher   ', true);
    expect(name.given).toBe('Cher');
    expect(name.surname).toBeUndefined();
    expect(name.full).toBe('Cher');
    expect(name.raw).toBe('  Cher   ');
  });

  it('treats an empty string defensively', () => {
    const name = parsePersonName('', true);
    expect(name.raw).toBe('');
    expect(name.full).toBe('');
    expect(name.given).toBeUndefined();
    expect(name.surname).toBeUndefined();
    expect(name.isPrimary).toBe(true);
  });

  it('treats a whitespace-only string defensively', () => {
    const name = parsePersonName('   ', false);
    expect(name.raw).toBe('   ');
    expect(name.full).toBe('');
    expect(name.given).toBeUndefined();
    expect(name.surname).toBeUndefined();
    expect(name.isPrimary).toBe(false);
  });

  it('leaves surname undefined when the slashes are empty', () => {
    const name = parsePersonName('John //', true);
    expect(name.given).toBe('John');
    expect(name.surname).toBeUndefined();
    expect(name.full).toBe('John');
  });

  it('propagates isPrimary true and false', () => {
    expect(parsePersonName('John /Whitaker/', true).isPrimary).toBe(true);
    expect(parsePersonName('John /Whitaker/', false).isPrimary).toBe(false);
  });

  it('always preserves raw verbatim', () => {
    const raw = '  Weird /  Raw / Input  ';
    expect(parsePersonName(raw, true).raw).toBe(raw);
  });
});

describe('parseSex', () => {
  it('maps M to male', () => {
    expect(parseSex('M')).toBe('male');
  });

  it('maps F to female', () => {
    expect(parseSex('F')).toBe('female');
  });

  it('accepts lowercase m and f', () => {
    expect(parseSex('m')).toBe('male');
    expect(parseSex('f')).toBe('female');
  });

  it('trims surrounding whitespace before comparing', () => {
    expect(parseSex('  M  ')).toBe('male');
    expect(parseSex(' f ')).toBe('female');
  });

  it('maps U to unknown', () => {
    expect(parseSex('U')).toBe('unknown');
  });

  it('maps the empty string to unknown', () => {
    expect(parseSex('')).toBe('unknown');
  });

  it('maps null to unknown', () => {
    expect(parseSex(null)).toBe('unknown');
  });

  it('maps undefined to unknown', () => {
    expect(parseSex(undefined)).toBe('unknown');
  });

  it('maps any other letter to unknown', () => {
    expect(parseSex('X')).toBe('unknown');
  });
});
