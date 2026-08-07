// @ts-check

let mounted = false;

export const operationDomain = {
  id: 'operation',
  async mount() {
    if (mounted) return;
    await import('./runtime.js');
    mounted = true;
  },
  unmount() {
    // The operation shell owns the page for the full document lifetime.
  }
};
