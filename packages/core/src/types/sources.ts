// Source citations (provenance, kept raw). This is the provenance trail;
// it is never normalized away (TRD §5.2, §7.2).

export interface SourceCitation {
  /** Verbatim citation text/pointer as found. */
  raw: string;
  /** xref to a SOUR record when present. */
  sourceId?: string;
  page?: string;
}
