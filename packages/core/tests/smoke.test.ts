import { describe, it, expect } from 'vitest';
import * as core from '../src/index.js';

// Phase 0 acceptance: the public API barrel resolves and loads under Node.
// This is the first, smallest proof of the portability constraint (TRD §3) —
// the core entry point imports with no DOM and no Node-only API available.
describe('@genealogy/core public API barrel', () => {
  it('loads as an ES module under Node', () => {
    expect(typeof core).toBe('object');
  });
});
