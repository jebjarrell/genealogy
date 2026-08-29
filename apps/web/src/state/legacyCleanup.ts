// One-time removal of the per-file localStorage persistence that the session
// store replaces. Those op-logs are unreachable by design: the GEDCOM bytes they
// were built against were never stored, so there is no base model to replay them
// over. Dropping them is deliberate (spec, Decision 5).
//
// Deliberately narrow: `genealogy:placeCache` belongs to geo/resolver.ts and
// holds resolved geocoding lookups worth keeping, and `ui:*` holds panel layout.

const LEGACY_PREFIXES = ['genealogy:focal:', 'genealogy:ops:', 'genealogy:aux:'];

/** Returns the number of keys removed. */
export function clearLegacyPersistenceKeys(): number {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && LEGACY_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
    return doomed.length;
  } catch {
    return 0;
  }
}
