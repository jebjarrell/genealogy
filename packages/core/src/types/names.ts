export interface PersonName {
  /** Verbatim NAME value, e.g. "John /Whitaker/". Never dropped. */
  raw: string;
  given?: string;
  surname?: string;
  /** Display form. */
  full: string;
  /** The first NAME is primary; others are variants. */
  isPrimary: boolean;
}
