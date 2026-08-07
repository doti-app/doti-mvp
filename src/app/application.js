// @ts-check

import { createCurationDomain } from '../domains/curation/index.js';
import { createOperationDomain } from '../domains/operation/index.js';
import { createProfileDomain } from '../domains/profile/index.js';
import { createTeamDomain } from '../domains/team/index.js';
import { createWhatsappDomain } from '../domains/whatsapp/index.js';
import { createProtectedSession } from '../shared/auth/session.js';
import { createNotifier } from '../shared/ui/notifier.js';
import { createDomainRegistry } from './domain-registry.js';
import { createNavigation } from './navigation.js';

/** @param {{ document?: Document }} [options] */
export function createApplication(options = {}) {
  const document = options.document || globalThis.document;
  const session = createProtectedSession();
  const events = new EventTarget();
  const navigation = createNavigation(document);
  const notify = createNotifier(document);
  let domains = null;

  return {
    async start() {
      const auth = await session.start();
      if (!auth) return;
      const dependencies = { auth, document, events, navigation, notify };
      domains = createDomainRegistry([
        createOperationDomain(dependencies),
        createCurationDomain(dependencies),
        createWhatsappDomain(dependencies),
        createTeamDomain(dependencies),
        createProfileDomain(dependencies)
      ]);
      await domains.mountAll();
    },
    async stop() {
      await domains?.unmountAll();
      session.stop();
    },
    get domains() {
      return domains;
    }
  };
}
