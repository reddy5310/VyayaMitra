import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// jsdom gaps used by the UI (no-ops in the node environment).
if (typeof window !== 'undefined') {
  const proto = window.HTMLDialogElement?.prototype;
  if (proto && !proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.show = function show(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
  if (!('ResizeObserver' in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
  }
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
}
