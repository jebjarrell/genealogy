/**
 * The global `fetch`, bound to the global object.
 *
 * Storing native `fetch` as an object property and calling it as a method
 * (`this.fetchImpl = fetch; this.fetchImpl(url)`) invokes it with `this` set to
 * that object, which browsers reject with "TypeError: Illegal invocation" —
 * native `fetch` must run with `this === window`/`globalThis`. Binding here
 * fixes that. (Injected fetches in tests are plain functions and are unaffected,
 * which is why this bug hides from unit tests that always inject `fetch`.)
 */
export function globalFetch(): typeof fetch {
  const f = globalThis.fetch;
  if (typeof f !== 'function') {
    throw new Error('global fetch is unavailable; pass fetchImpl explicitly');
  }
  return f.bind(globalThis);
}
