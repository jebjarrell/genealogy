// Minimal ambient declarations for the WHATWG Encoding globals. These are
// available in BOTH browsers and Node without pulling in the DOM or Node type
// libraries — so the core portability constraint (no DOM, no Node-only APIs;
// TRD §3) stays intact at the type level too. Only the surface actually used by
// the adapter is declared.

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
