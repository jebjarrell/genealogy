import { describe, it, expect } from 'vitest';
import { parseGedcomDate } from '../src/gedcom/date.js';

// These tests are written FIRST (strict TDD). They pin the GEDCOM 5.5.1 DATE
// grammar behavior described in TRD §5.2/§7.2: raw is always preserved, dates
// may be qualified/partial/ranged/double-dated, and `iso` is set only for a
// confident full plain-Gregorian exact date.

describe('parseGedcomDate', () => {
  describe('raw preservation', () => {
    it('always sets raw to the verbatim input (untrimmed in storage)', () => {
      expect(parseGedcomDate('  12 JUN 1840  ').raw).toBe('  12 JUN 1840  ');
      expect(parseGedcomDate('ABT 1798').raw).toBe('ABT 1798');
      expect(parseGedcomDate('').raw).toBe('');
      expect(parseGedcomDate('not a date').raw).toBe('not a date');
    });
  });

  describe('exact full dates', () => {
    it('parses "12 JUN 1840" with day, month, year and iso', () => {
      const d = parseGedcomDate('12 JUN 1840');
      expect(d.qualifier).toBe('exact');
      expect(d.year).toBe(1840);
      expect(d.month).toBe(6);
      expect(d.day).toBe(12);
      expect(d.iso).toBe('1840-06-12');
      expect(d.calendar).toBeUndefined();
    });

    it('is case-insensitive on month abbreviations', () => {
      const d = parseGedcomDate('3 jan 1900');
      expect(d.month).toBe(1);
      expect(d.day).toBe(3);
      expect(d.year).toBe(1900);
      expect(d.iso).toBe('1900-01-03');
    });

    it('zero-pads iso for single-digit month and day', () => {
      const d = parseGedcomDate('5 FEB 950');
      expect(d.iso).toBe('0950-02-05');
    });

    it('parses all twelve month abbreviations', () => {
      const months: Array<[string, number]> = [
        ['JAN', 1],
        ['FEB', 2],
        ['MAR', 3],
        ['APR', 4],
        ['MAY', 5],
        ['JUN', 6],
        ['JUL', 7],
        ['AUG', 8],
        ['SEP', 9],
        ['OCT', 10],
        ['NOV', 11],
        ['DEC', 12],
      ];
      for (const [abbr, num] of months) {
        expect(parseGedcomDate(`1 ${abbr} 2000`).month).toBe(num);
      }
    });
  });

  describe('partial dates (no iso)', () => {
    it('parses year only', () => {
      const d = parseGedcomDate('1840');
      expect(d.qualifier).toBe('exact');
      expect(d.year).toBe(1840);
      expect(d.month).toBeUndefined();
      expect(d.day).toBeUndefined();
      expect(d.iso).toBeUndefined();
    });

    it('parses a leading-zero year', () => {
      const d = parseGedcomDate('0950');
      expect(d.year).toBe(950);
      expect(d.iso).toBeUndefined();
    });

    it('parses month + year only', () => {
      const d = parseGedcomDate('JUN 1840');
      expect(d.qualifier).toBe('exact');
      expect(d.year).toBe(1840);
      expect(d.month).toBe(6);
      expect(d.day).toBeUndefined();
      expect(d.iso).toBeUndefined();
    });
  });

  describe('qualifiers (no iso)', () => {
    it('ABT -> about', () => {
      const d = parseGedcomDate('ABT 1798');
      expect(d.qualifier).toBe('about');
      expect(d.year).toBe(1798);
      expect(d.iso).toBeUndefined();
    });

    it('ABT. (with trailing dot) -> about', () => {
      const d = parseGedcomDate('ABT. 1798');
      expect(d.qualifier).toBe('about');
      expect(d.year).toBe(1798);
    });

    it('BEF -> before', () => {
      const d = parseGedcomDate('BEF 12 JUN 1840');
      expect(d.qualifier).toBe('before');
      expect(d.year).toBe(1840);
      expect(d.month).toBe(6);
      expect(d.day).toBe(12);
      expect(d.iso).toBeUndefined();
    });

    it('AFT -> after', () => {
      const d = parseGedcomDate('AFT 1900');
      expect(d.qualifier).toBe('after');
      expect(d.year).toBe(1900);
      expect(d.iso).toBeUndefined();
    });

    it('EST -> estimated', () => {
      const d = parseGedcomDate('EST 1750');
      expect(d.qualifier).toBe('estimated');
      expect(d.year).toBe(1750);
    });

    it('CAL -> calculated', () => {
      const d = parseGedcomDate('CAL 1812');
      expect(d.qualifier).toBe('calculated');
      expect(d.year).toBe(1812);
    });

    it('is case-insensitive on the qualifier keyword', () => {
      expect(parseGedcomDate('abt 1798').qualifier).toBe('about');
      expect(parseGedcomDate('Bef 1840').qualifier).toBe('before');
    });
  });

  describe('ranges (no iso)', () => {
    it('BET ... AND ... -> range with rangeEnd', () => {
      const d = parseGedcomDate('BET 1 JAN 1900 AND 31 DEC 1905');
      expect(d.qualifier).toBe('range');
      expect(d.year).toBe(1900);
      expect(d.month).toBe(1);
      expect(d.day).toBe(1);
      expect(d.rangeEnd).toEqual({ year: 1905, month: 12, day: 31 });
      expect(d.iso).toBeUndefined();
    });

    it('BET ... AND ... with year-only endpoints', () => {
      const d = parseGedcomDate('BET 1900 AND 1905');
      expect(d.qualifier).toBe('range');
      expect(d.year).toBe(1900);
      expect(d.rangeEnd).toEqual({ year: 1905 });
    });

    it('FROM ... TO ... -> range', () => {
      const d = parseGedcomDate('FROM 1861 TO 1865');
      expect(d.qualifier).toBe('range');
      expect(d.year).toBe(1861);
      expect(d.rangeEnd).toEqual({ year: 1865 });
      expect(d.iso).toBeUndefined();
    });

    it('FROM ... TO ... with full dates', () => {
      const d = parseGedcomDate('FROM 12 JUN 1840 TO 13 JUN 1840');
      expect(d.qualifier).toBe('range');
      expect(d.year).toBe(1840);
      expect(d.month).toBe(6);
      expect(d.day).toBe(12);
      expect(d.rangeEnd).toEqual({ year: 1840, month: 6, day: 13 });
    });

    it('lone FROM -> range with start only, no rangeEnd', () => {
      const d = parseGedcomDate('FROM 1861');
      expect(d.qualifier).toBe('range');
      expect(d.year).toBe(1861);
      expect(d.rangeEnd).toBeUndefined();
      expect(d.iso).toBeUndefined();
    });

    it('lone TO -> range with rangeEnd only', () => {
      const d = parseGedcomDate('TO 1865');
      expect(d.qualifier).toBe('range');
      expect(d.year).toBeUndefined();
      expect(d.month).toBeUndefined();
      expect(d.day).toBeUndefined();
      expect(d.rangeEnd).toEqual({ year: 1865 });
    });
  });

  describe('double-dated years (Old Style/New Style)', () => {
    it('1745/46 -> resolved second year 1746', () => {
      const d = parseGedcomDate('1745/46');
      expect(d.year).toBe(1746);
      expect(d.raw).toBe('1745/46');
    });

    it('1745/1746 -> resolved second year 1746', () => {
      const d = parseGedcomDate('1745/1746');
      expect(d.year).toBe(1746);
    });

    it('double-dated with full date keeps day/month and resolved year', () => {
      const d = parseGedcomDate('12 FEB 1745/46');
      expect(d.day).toBe(12);
      expect(d.month).toBe(2);
      expect(d.year).toBe(1746);
    });

    it('century rollover 1699/00 -> 1700', () => {
      const d = parseGedcomDate('1699/00');
      expect(d.year).toBe(1700);
    });
  });

  describe('calendar escapes', () => {
    it('@#DJULIAN@ sets calendar "julian"', () => {
      const d = parseGedcomDate('@#DJULIAN@ 12 JUN 1840');
      expect(d.calendar).toBe('julian');
      expect(d.year).toBe(1840);
      expect(d.month).toBe(6);
      expect(d.day).toBe(12);
    });

    it('a calendar (non-Gregorian) date does NOT get iso even when full', () => {
      const d = parseGedcomDate('@#DJULIAN@ 12 JUN 1840');
      expect(d.iso).toBeUndefined();
    });

    it('@#DGREGORIAN@ leaves calendar undefined (default) and still gets iso', () => {
      const d = parseGedcomDate('@#DGREGORIAN@ 12 JUN 1840');
      expect(d.calendar).toBeUndefined();
      expect(d.iso).toBe('1840-06-12');
    });

    it('@#DHEBREW@ -> hebrew', () => {
      expect(parseGedcomDate('@#DHEBREW@ 1840').calendar).toBe('hebrew');
    });

    it('@#DFRENCH R@ -> french republican', () => {
      expect(parseGedcomDate('@#DFRENCH R@ 1840').calendar).toBe('french republican');
    });

    it('@#DROMAN@ -> roman', () => {
      expect(parseGedcomDate('@#DROMAN@ 1840').calendar).toBe('roman');
    });

    it('@#DUNKNOWN@ -> unknown calendar', () => {
      expect(parseGedcomDate('@#DUNKNOWN@ 1840').calendar).toBe('unknown');
    });

    it('escape co-occurs with a qualifier', () => {
      const d = parseGedcomDate('@#DJULIAN@ ABT 1840');
      expect(d.qualifier).toBe('about');
      expect(d.calendar).toBe('julian');
      expect(d.year).toBe(1840);
    });

    it('escape inside BET ... AND ... applies to the whole expression', () => {
      const d = parseGedcomDate('@#DJULIAN@ BET 1900 AND 1905');
      expect(d.qualifier).toBe('range');
      expect(d.calendar).toBe('julian');
      expect(d.year).toBe(1900);
      expect(d.rangeEnd).toEqual({ year: 1905 });
    });
  });

  describe('B.C. years', () => {
    it('stores a B.C. year as negative', () => {
      const d = parseGedcomDate('44 B.C.');
      expect(d.year).toBe(-44);
    });

    it('handles BC without dots', () => {
      expect(parseGedcomDate('44 BC').year).toBe(-44);
    });
  });

  describe('unparseable / empty input', () => {
    it('empty string -> unknown with raw preserved', () => {
      const d = parseGedcomDate('');
      expect(d.qualifier).toBe('unknown');
      expect(d.raw).toBe('');
      expect(d.year).toBeUndefined();
      expect(d.month).toBeUndefined();
      expect(d.day).toBeUndefined();
      expect(d.iso).toBeUndefined();
    });

    it('whitespace-only -> unknown', () => {
      const d = parseGedcomDate('   ');
      expect(d.qualifier).toBe('unknown');
      expect(d.raw).toBe('   ');
    });

    it('gibberish with no year -> unknown with raw preserved', () => {
      const d = parseGedcomDate('sometime in the spring');
      expect(d.qualifier).toBe('unknown');
      expect(d.raw).toBe('sometime in the spring');
      expect(d.year).toBeUndefined();
    });

    it('never throws on odd input', () => {
      expect(() => parseGedcomDate('@#D@')).not.toThrow();
      expect(() => parseGedcomDate('BET AND')).not.toThrow();
      expect(() => parseGedcomDate('////')).not.toThrow();
      expect(() => parseGedcomDate('ABT')).not.toThrow();
    });
  });

  describe('iso is withheld unless confident', () => {
    it('no iso for a partial date', () => {
      expect(parseGedcomDate('JUN 1840').iso).toBeUndefined();
      expect(parseGedcomDate('1840').iso).toBeUndefined();
    });

    it('no iso for any qualified date', () => {
      expect(parseGedcomDate('ABT 12 JUN 1840').iso).toBeUndefined();
      expect(parseGedcomDate('BEF 12 JUN 1840').iso).toBeUndefined();
      expect(parseGedcomDate('AFT 12 JUN 1840').iso).toBeUndefined();
      expect(parseGedcomDate('EST 12 JUN 1840').iso).toBeUndefined();
      expect(parseGedcomDate('CAL 12 JUN 1840').iso).toBeUndefined();
    });

    it('no iso for a range', () => {
      expect(parseGedcomDate('BET 1 JAN 1900 AND 31 DEC 1905').iso).toBeUndefined();
    });

    it('no iso for a non-Gregorian calendar', () => {
      expect(parseGedcomDate('@#DJULIAN@ 12 JUN 1840').iso).toBeUndefined();
    });
  });
});
