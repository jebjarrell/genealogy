import { describe, it, expect } from 'vitest';
import { sanitizeProjectName, uniqueProjectName } from './projectName.js';

describe('sanitizeProjectName', () => {
  it('strips a .ged/.gedcom extension', () => {
    expect(sanitizeProjectName('jarrell-tree.ged')).toBe('jarrell-tree');
    expect(sanitizeProjectName('jarrell-tree.GEDCOM')).toBe('jarrell-tree');
  });

  it('removes characters illegal in Windows directory names', () => {
    expect(sanitizeProjectName('M*A*S*H.ged')).toBe('M A S H');
    expect(sanitizeProjectName('a/b\\c:d?e"f<g>h|i')).toBe('a b c d e f g h i');
  });

  it('collapses whitespace and trims trailing dots and spaces', () => {
    expect(sanitizeProjectName('  spaced   out  ')).toBe('spaced out');
    expect(sanitizeProjectName('trailing...')).toBe('trailing');
  });

  it('defuses Windows reserved device names, with or without extension', () => {
    expect(sanitizeProjectName('CON.ged')).toBe('CON (project)');
    expect(sanitizeProjectName('nul')).toBe('nul (project)');
    expect(sanitizeProjectName('COM4.txt')).toBe('COM4.txt (project)');
  });

  it('caps length at 100 characters', () => {
    expect(sanitizeProjectName('x'.repeat(250))).toHaveLength(100);
  });

  it('does not leave a trailing dot when truncation lands on one', () => {
    const result = sanitizeProjectName('x'.repeat(99) + '.' + 'y'.repeat(50));
    expect(result).toHaveLength(99);
    expect(result.endsWith('.')).toBe(false);
  });

  it('falls back to Untitled when nothing usable remains', () => {
    expect(sanitizeProjectName('')).toBe('Untitled');
    expect(sanitizeProjectName('///')).toBe('Untitled');
    expect(sanitizeProjectName('.ged')).toBe('Untitled');
  });
});

describe('uniqueProjectName', () => {
  it('returns the base name when it is free', () => {
    expect(uniqueProjectName('tree', [])).toBe('tree');
  });

  it('appends an incrementing suffix when taken', () => {
    expect(uniqueProjectName('tree', ['tree'])).toBe('tree (2)');
    expect(uniqueProjectName('tree', ['tree', 'tree (2)'])).toBe('tree (3)');
  });

  it('compares case-insensitively, since Windows folders are', () => {
    expect(uniqueProjectName('Tree', ['tree'])).toBe('Tree (2)');
  });
});
