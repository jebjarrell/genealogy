// Lineage-society rule definitions (handoff §5a). The rules are encoded as a
// config OBJECT, not scattered logic, so a second society could be added later
// by defining another `SocietyRules` — but only SAR is built now (the checklist
// engine reads these fields; it hard-codes nothing society-specific).

export type ProofStatus =
  | 'sourced-by-document'
  | 'proven-by-record-copy'
  | 'unproven';

export interface SocietyRules {
  /** Stable id, e.g. 'sar'. */
  id: string;
  /** Full name. */
  name: string;
  /** Short form used in citations, e.g. 'SAR'. */
  abbreviation: string;
  /** Qualifying-service window, inclusive years (Revolutionary War). */
  serviceWindow: { startYear: number; endYear: number };
  /**
   * Record copies (prior approved applications) APPROVED ON/AFTER this year
   * count as full proof; earlier ones are insufficient alone. (SAR: 1985.)
   */
  recordCopyCutoffYear: number;
  /** Note shown for pre-cutoff record copies. */
  recordCopyCutoffNote: string;
  /** Societies whose approved applications are accepted as record copies. */
  recordCopySocieties: readonly ('SAR' | 'DAR')[];
  /** Label for the patriot's qualifying-service checklist item. */
  serviceItemLabel: string;
  /**
   * Whether the lineage stops at the patriot (no proof required above them).
   * Always true for SAR — the patriot is the last generation.
   */
  lineageStopsAtPatriot: true;
  /** Informational: document categories that satisfy a link by document. */
  acceptableDocuments: readonly string[];
}

/**
 * Sons of the American Revolution. Verified rules as of this build (handoff §5a):
 * three-state per-link proof; record copies from SAR or DAR approved on/after
 * 1 Jan 1985 are full proof and may span multiple consecutive generations; the
 * tie-in that carries data is the national number + patriot name (NOT DAR
 * ancestor numbers nor SAR "P" numbers); service is proven separately.
 */
export const SAR_RULES: SocietyRules = {
  id: 'sar',
  name: 'Sons of the American Revolution',
  abbreviation: 'SAR',
  serviceWindow: { startYear: 1775, endYear: 1783 },
  recordCopyCutoffYear: 1985,
  recordCopyCutoffNote:
    'Approved before 1 Jan 1985 — not sufficient alone; additional documentation may be required.',
  recordCopySocieties: ['SAR', 'DAR'],
  serviceItemLabel: 'Patriot Revolutionary War service (1775–1783)',
  lineageStopsAtPatriot: true,
  acceptableDocuments: [
    'Birth/baptismal certificate',
    'Marriage record',
    'Death certificate',
    'Will / probate naming children',
    'Census record',
    'Church record',
    'Family Bible',
    'Pension record stating relationship',
    'Published genealogy',
  ],
};

/** Registry of built societies. Only SAR is implemented (the seam is here). */
export const SOCIETY_RULES: Readonly<Record<string, SocietyRules>> = {
  sar: SAR_RULES,
};
