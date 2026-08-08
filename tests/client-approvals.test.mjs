import assert from 'node:assert/strict';
import test from 'node:test';

import { createApprovalStore } from '../src/domains/approvals/infrastructure/approval-store.js';

const STORAGE_KEY = 'doti-agency-live-v4';

function memoryStorage(initialState) {
  const values = new Map([[STORAGE_KEY, JSON.stringify(initialState)]]);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
}

function operationFixture() {
  return {
    version: 3,
    revision: 0,
    groups: [
      { id: 'g-producao', name: 'Produção', initials: 'PR' },
      { id: 'g-aprovacao', name: 'Representante do cliente', initials: 'CL', isClientGroup: true }
    ],
    clients: [
      { id: 'cliente-a', name: 'Cliente A' },
      { id: 'cliente-b', name: 'Cliente B' }
    ],
    projects: [
      { id: 'projeto-a', clientId: 'cliente-a', name: 'Projeto A', due: '2026-08-20' },
      { id: 'projeto-b', clientId: 'cliente-b', name: 'Projeto B', due: '2026-08-22' }
    ],
    deliverables: [
      {
        id: 'entrega-a', projectId: 'projeto-a', name: 'Peça A', category: 'Design', color: 'social',
        status: 'active', stepIndex: 1, note: '', links: [], attachments: [], approvalDecisions: [],
        steps: [
          { id: 'etapa-a-producao', name: 'Produção', groupId: 'g-producao', tasks: [] },
          { id: 'etapa-a-aprovacao', name: 'Validação', groupId: 'g-aprovacao', due: '2026-08-15', tasks: [] },
          { id: 'etapa-a-entrega', name: 'Entrega', groupId: 'g-producao', tasks: [] }
        ]
      },
      {
        id: 'entrega-b', projectId: 'projeto-b', name: 'Peça B', category: 'Design', color: 'social',
        status: 'active', stepIndex: 1, note: '', links: [], attachments: [], approvalDecisions: [],
        steps: [
          { id: 'etapa-b-producao', name: 'Produção', groupId: 'g-producao', tasks: [] },
          { id: 'etapa-b-aprovacao', name: 'Validação', groupId: 'g-aprovacao', tasks: [] }
        ]
      }
    ]
  };
}

function localAuth(role, clientId = null) {
  return {
    localMode: true,
    profile: { role, client_id: clientId, full_name: role === 'client' ? 'Ana Cliente' : 'Pessoa Interna' }
  };
}

test('cliente recebe somente aprovações próprias e aprovação avança a etapa atual', async t => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = memoryStorage(operationFixture());
  t.after(() => { globalThis.localStorage = previousStorage; });

  const store = createApprovalStore(localAuth('client', 'cliente-a'));
  const queue = await store.load();
  assert.equal(queue.canDecide, true);
  assert.deepEqual(queue.items.map(item => item.deliverableId), ['entrega-a']);

  await store.decide({
    deliverableId: 'entrega-a', stepId: 'etapa-a-aprovacao', decision: 'approved', comment: ''
  });
  const persisted = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
  assert.equal(persisted.deliverables[0].stepIndex, 2);
  assert.equal(persisted.deliverables[0].approvalDecisions[0].decision, 'approved');
  await assert.rejects(
    store.decide({ deliverableId: 'entrega-b', stepId: 'etapa-b-aprovacao', decision: 'approved', comment: '' }),
    /não pertence ao seu cliente/
  );
});

test('reprovação exige comentário, retorna uma etapa e cria a tarefa de ajustes', async t => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = memoryStorage(operationFixture());
  t.after(() => { globalThis.localStorage = previousStorage; });

  const store = createApprovalStore(localAuth('client', 'cliente-a'));
  await assert.rejects(
    store.decide({ deliverableId: 'entrega-a', stepId: 'etapa-a-aprovacao', decision: 'rejected', comment: '  ' }),
    /Explique os ajustes necessários/
  );
  await store.decide({
    deliverableId: 'entrega-a', stepId: 'etapa-a-aprovacao', decision: 'rejected', comment: 'Ajustar contraste'
  });

  const persisted = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
  const deliverable = persisted.deliverables[0];
  assert.equal(deliverable.stepIndex, 0);
  assert.equal(deliverable.approvalDecisions[0].decision, 'rejected');
  assert.equal(deliverable.approvalDecisions[0].comment, 'Ajustar contraste');
  assert.equal(deliverable.steps[0].tasks[0].title, 'Aplicar ajustes solicitados na aprovação');
});

test('member acompanha a fila, mas não registra decisões', async t => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = memoryStorage(operationFixture());
  t.after(() => { globalThis.localStorage = previousStorage; });

  const store = createApprovalStore(localAuth('member'));
  const queue = await store.load();
  assert.equal(queue.items.length, 2);
  assert.equal(queue.canDecide, false);
  await assert.rejects(
    store.decide({ deliverableId: 'entrega-a', stepId: 'etapa-a-aprovacao', decision: 'approved', comment: '' }),
    /não tem permissão/
  );
});
