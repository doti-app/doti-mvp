// @ts-check

let mounted = false;

export const whatsappDomain = {
  id: 'whatsapp',
  async mount() {
    if (mounted) return;
    const entrypoint = '../../dot-admin/whatsapp-admin.js?v=3';
    await import(entrypoint);
    mounted = true;
  },
  unmount() {
    // The existing polling lifecycle remains active for the authenticated shell.
  }
};
