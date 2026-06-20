import '@testing-library/jest-dom/vitest';

// React Flow relies on ResizeObserver, which jsdom does not implement.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
