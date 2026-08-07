import assert from 'node:assert/strict';
import test from 'node:test';

import { createDomainRegistry } from '../core/domain-registry.js';

test('monta cada domínio somente uma vez e desmonta em ordem reversa', async () => {
  const events = [];
  const registry = createDomainRegistry([
    { id: 'operation', mount: () => events.push('mount:operation'), unmount: () => events.push('unmount:operation') },
    { id: 'whatsapp', mount: () => events.push('mount:whatsapp'), unmount: () => events.push('unmount:whatsapp') }
  ]);
  await registry.mountAll();
  await registry.mount('operation');
  await registry.unmountAll();
  assert.deepEqual(events, [
    'mount:operation', 'mount:whatsapp', 'unmount:whatsapp', 'unmount:operation'
  ]);
});
