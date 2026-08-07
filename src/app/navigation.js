// @ts-check

/** @param {Document} document */
export function createNavigation(document) {
  const listeners = new Set();
  return {
    /** @param {string} page */
    go(page) {
      const trigger = document.querySelector(`[data-page="${CSS.escape(page)}"]`);
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      listeners.forEach(listener => listener(page));
    },
    /** @param {(page: string) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
