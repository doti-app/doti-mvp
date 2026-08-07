// @ts-check

import { curationDomain } from '../domains/curation/index.js';
import { createDomainRegistry } from './domain-registry.js';
import { operationDomain } from '../domains/operation/index.js';
import { whatsappDomain } from '../domains/whatsapp/index.js';

export function createApplication() {
  const domains = createDomainRegistry([operationDomain, curationDomain, whatsappDomain]);
  return {
    async start() {
      await domains.mountAll();
    },
    stop() {
      return domains.unmountAll();
    },
    domains
  };
}
