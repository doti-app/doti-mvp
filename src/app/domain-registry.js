// @ts-check

/**
 * @typedef {{ id: string, mount: () => void | Promise<void>, unmount?: () => void | Promise<void> }} ApplicationDomain
 */

/** @param {ApplicationDomain[]} domains */
export function createDomainRegistry(domains) {
  /** @type {Map<string, ApplicationDomain>} */
  const registered = new Map();
  /** @type {Set<string>} */
  const mounted = new Set();
  domains.forEach(domain => {
    if (registered.has(domain.id)) throw new Error(`Domínio duplicado: ${domain.id}`);
    registered.set(domain.id, domain);
  });

  return {
    /** @param {string} id */
    async mount(id) {
      const domain = registered.get(id);
      if (!domain) throw new Error(`Domínio desconhecido: ${id}`);
      if (mounted.has(id)) return;
      await domain.mount();
      mounted.add(id);
    },
    async mountAll() {
      for (const domain of registered.values()) await this.mount(domain.id);
    },
    async unmountAll() {
      for (const id of [...mounted].reverse()) {
        await registered.get(id)?.unmount?.();
        mounted.delete(id);
      }
    },
    ids: () => [...registered.keys()]
  };
}
