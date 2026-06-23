// Families are the GEDCOM FAM intermediary. Kept because family-level facts
// (marriage date/place) live here and because GEDCOM models parent–child
// relationships THROUGH families. The graph derives direct person-to-person
// edges from these (TRD §5.2, §5.3).

export interface Family {
  id: string;
  externalId: string;
  /** 0–2 (usually); parents (HUSB/WIFE). */
  spouseIds: string[];
  childIds: string[];
  marriageEventIds: string[];
  /** True when created by the user (edit layer); never set by the parser. */
  userSupplied?: boolean;
}
