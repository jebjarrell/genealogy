import { describe, it, expect, beforeEach } from 'vitest';
import { clearLegacyPersistenceKeys } from './legacyCleanup.js';

describe('clearLegacyPersistenceKeys', () => {
  beforeEach(() => localStorage.clear());

  it('removes the superseded per-file persistence keys', () => {
    localStorage.setItem('genealogy:focal:tree.ged', 'I1');
    localStorage.setItem('genealogy:ops:tree.ged', '[]');
    localStorage.setItem('genealogy:aux:tree.ged', '{}');
    expect(clearLegacyPersistenceKeys()).toBe(3);
    expect(localStorage.getItem('genealogy:ops:tree.ged')).toBeNull();
  });

  it('preserves the geocoding place cache', () => {
    localStorage.setItem('genealogy:placeCache', '{"somewhere":[1,2]}');
    clearLegacyPersistenceKeys();
    expect(localStorage.getItem('genealogy:placeCache')).toBe('{"somewhere":[1,2]}');
  });

  it('preserves UI layout preferences', () => {
    localStorage.setItem('ui:leftOpen', '0');
    clearLegacyPersistenceKeys();
    expect(localStorage.getItem('ui:leftOpen')).toBe('0');
  });

  it('is safe to run twice', () => {
    localStorage.setItem('genealogy:ops:a.ged', '[]');
    expect(clearLegacyPersistenceKeys()).toBe(1);
    expect(clearLegacyPersistenceKeys()).toBe(0);
  });
});
