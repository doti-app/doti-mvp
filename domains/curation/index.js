// @ts-check

let mounted = false;

export const curationDomain = {
  id: 'curation',
  async mount() {
    if (mounted) return;
    const entrypoint = '../../dot-admin/chatbot-curation.js?v=9';
    await import(entrypoint);
    mounted = true;
  },
  unmount() {
    // Curation is stateful and is retained while navigating between pages.
  }
};
