import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperationFiles } from '../src/domains/operation/domain/files.js';
import { recordActivity } from '../src/domains/operation/domain/commands.js';
import { createOperationPersistence } from '../src/domains/operation/domain/persistence.js';
import { canMoveDeliverableToStep, effectiveDeadline, isClientActionStep, macroStatus, overdueDeadline } from '../src/domains/operation/domain/selectors.js';
import { createEmptyOperationState, normalizeOperationState } from '../src/domains/operation/domain/state.js';

test('normaliza snapshots legados sem perder a referência do cliente ou as etapas', () => {
  let id = 0;
  const state = normalizeOperationState({
    version: 3,
    groups: [],
    workflows: [{ id: 'wf', name: 'Fluxo', category: 'Conteúdo', description: '', color: 'social', steps: [['Briefing', 'g']] }],
    clients: [],
    projects: [{ id: 'p-1', client: 'Cliente antigo', createdAt: '2026-08-01T00:00:00.000Z' }],
    deliverables: [{ id: 'd-1', workflowId: 'wf', stepIndex: 0, steps: [{ name: 'Briefing', groupId: 'g' }] }],
    activity: []
  }, { createId: prefix => `${prefix}-${++id}`, now: () => '2026-08-02T00:00:00.000Z' });

  assert.equal(state.clients.length, 1);
  assert.equal(state.projects[0].clientId, 'client-1');
  assert.equal(state.projects[0].client, 'Cliente antigo');
  assert.equal(state.workflows[0].steps[0][2], 'ws-2');
  assert.equal(state.deliverables[0].steps[0].sourceStepId, 'ws-2');
  assert.equal(state.deliverables[0].attachments.length, 0);
});

test('cria estados vazios independentes e registra atividades com limite', () => {
  const first = createEmptyOperationState();
  const second = createEmptyOperationState();
  first.groups[0].name = 'Alterado';
  assert.equal(second.groups[0].name, 'Atendimento');

  first.activity = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
  recordActivity(first, 'Criado', 'Novo projeto', () => 'new', () => '2026-08-06T12:00:00.000Z');
  assert.equal(first.activity.length, 50);
  assert.deepEqual(first.activity[0], { id: 'new', action: 'Criado', detail: 'Novo projeto', at: '2026-08-06T12:00:00.000Z' });
});

test('calcula prazo, atraso e macrostatus a partir do estado do entregável', () => {
  const deliverable = {
    status: 'active', stepIndex: 1, projectId: 'p', due: '',
    steps: [
      { name: 'Briefing', groupId: 'g', due: '2026-08-02' },
      { name: 'Aprovação do cliente', groupId: 'g-cliente', due: '2026-08-04' }
    ]
  };
  assert.deepEqual(effectiveDeadline(deliverable, () => ({ due: '2026-08-20' })), {
    due: '2026-08-04', source: 'step', label: 'Aprovação do cliente'
  });
  assert.equal(macroStatus(deliverable), 'approval');
  assert.deepEqual(overdueDeadline({ due: '2026-08-20' }, deliverable, new Date('2026-08-06T12:00:00.000Z')), {
    kind: 'step', due: '2026-08-04', label: 'Aprovação do cliente'
  });
});

test('identifica o grupo do cliente pela marcação explícita e normaliza o legado', () => {
  const state = normalizeOperationState({
    version: 3,
    groups: [
      { id: 'grupo-legado', name: 'Cliente / Atendimento', initials: 'CL' },
      { id: 'outro', name: 'Cliente VIP', initials: 'CV', isClientGroup: true }
    ],
    workflows: [], clients: [], projects: [], deliverables: [], activity: []
  });

  assert.equal(state.groups.filter(group => group.isClientGroup).length, 1);
  assert.equal(state.groups.find(group => group.id === 'outro').isClientGroup, true);
  assert.equal(isClientActionStep({ groupId: 'outro' }, state.groups), true);
  assert.equal(isClientActionStep({ groupId: 'grupo-legado' }, state.groups), false);

  const legacy = normalizeOperationState({
    version: 3,
    groups: [{ id: 'antigo', name: 'Cliente / Atendimento', initials: 'CL' }],
    workflows: [], clients: [], projects: [], deliverables: [], activity: []
  });
  assert.equal(legacy.groups[0].isClientGroup, true);
});

test('permite reposicionar a demanda sem pular a aprovação do cliente', () => {
  const groups = [
    { id: 'atendimento', isClientGroup: false },
    { id: 'cliente', isClientGroup: true },
    { id: 'design', isClientGroup: false }
  ];
  const deliverable = {
    stepIndex: 1,
    steps: [
      { name: 'Briefing', groupId: 'atendimento' },
      { name: 'Criação', groupId: 'design' },
      { name: 'Aprovação do cliente', groupId: 'cliente' },
      { name: 'Entrega', groupId: 'atendimento' }
    ]
  };
  assert.equal(canMoveDeliverableToStep(deliverable, 0, groups), true);
  assert.equal(canMoveDeliverableToStep(deliverable, 2, groups), false);
  assert.equal(canMoveDeliverableToStep(deliverable, 3, groups), false);

  deliverable.stepIndex = 3;
  assert.equal(canMoveDeliverableToStep(deliverable, 1, groups), true);
  assert.equal(canMoveDeliverableToStep(deliverable, 2, groups), false);
});

test('serializa persistência e descarta alterações pendentes após um erro', async () => {
  const writes = [];
  const failures = [];
  const persistence = createOperationPersistence({
    async write(snapshot, revision) {
      writes.push([snapshot.id, revision]);
      return revision + 1;
    },
    onError(error) { failures.push(error); }
  });
  assert.deepEqual(await Promise.all([
    persistence.enqueue({ id: 'first' }, 0),
    persistence.enqueue({ id: 'second' }, 1)
  ]), [true, true]);
  assert.deepEqual(writes, [['first', 0], ['second', 1]]);

  const failing = createOperationPersistence({
    async write() { throw new Error('conflito'); },
    onError(error) { failures.push(error); }
  });
  const first = failing.enqueue({ id: 'bad' }, 2);
  const second = failing.enqueue({ id: 'discarded' }, 3);
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(failures.length, 1);
});

test('encaminha anexos ao armazenamento correto conforme a operação é carregada', async () => {
  let ready = false;
  const calls = [];
  const files = createOperationFiles({
    isReady: () => ready,
    readLegacy: async id => `legacy:${id}`,
    upload: async id => calls.push(`upload:${id}`),
    download: async id => `remote:${id}`,
    remove: async id => calls.push(`remove:${id}`)
  });
  assert.equal(await files.download('a'), 'legacy:a');
  await assert.rejects(files.upload('a', {}), /ainda não foi carregada/);
  ready = true;
  assert.equal(await files.download('a'), 'remote:a');
  await files.upload('a', {});
  await files.remove('a');
  assert.deepEqual(calls, ['upload:a', 'remove:a']);
});
