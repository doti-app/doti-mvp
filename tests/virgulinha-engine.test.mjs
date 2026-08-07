import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVirgulinhaCommand } from '../src/domains/operation/domain/virgulinha-engine.mjs';

const context = {
  now: new Date(2026, 6, 31),
  clients: [{ id: 'client-petyoo', name: 'PetYoo' }],
  workflows: [{ id: 'workflow-design', name: 'Design para redes' }]
};

test('reconhece uma demanda e preenche catálogo, prazo e nome', () => {
  const result = analyzeVirgulinhaCommand(
    'Crie uma demanda Campanha de inverno para a PetYoo com fluxo Design para redes prazo 15/08/2026',
    context
  );

  assert.deepEqual(result, {
    intent: 'create_project',
    confidence: 1,
    fields: {
      name: 'Campanha de inverno',
      due: '2026-08-15',
      clientId: 'client-petyoo',
      workflowIds: ['workflow-design']
    }
  });
});

test('entende datas relativas sem depender de IA', () => {
  const result = analyzeVirgulinhaCommand('Crie um projeto Site novo para PetYoo amanh\u00e3', context);
  assert.equal(result.fields.due, '2026-08-01');
  assert.equal(
    analyzeVirgulinhaCommand('Monte uma demanda Relat\u00f3rio para PetYoo em 15 dias', context).fields.due,
    '2026-08-15'
  );
});

test('monta um fluxo a partir de etapas separadas por setas', () => {
  const result = analyzeVirgulinhaCommand(
    'Crie um fluxo chamado Gest\u00e3o de tr\u00e1fego, categoria M\u00eddia, com as etapas Briefing > Planejamento > Cria\u00e7\u00e3o > Aprova\u00e7\u00e3o > Entrega',
    context
  );

  assert.equal(result.intent, 'create_workflow');
  assert.equal(result.fields.name, 'Gest\u00e3o de tr\u00e1fego');
  assert.equal(result.fields.category, 'M\u00eddia');
  assert.deepEqual(result.fields.steps, ['Briefing', 'Planejamento', 'Cria\u00e7\u00e3o', 'Aprova\u00e7\u00e3o', 'Entrega']);
});

test('aceita etapas separadas por vírgulas mesmo em minúsculas', () => {
  const result = analyzeVirgulinhaCommand(
    'Monte um fluxo chamado Newsletter, categoria Conte\u00fado, com as etapas briefing, reda\u00e7\u00e3o, revis\u00e3o, envio',
    context
  );
  assert.deepEqual(result.fields.steps, ['briefing', 'reda\u00e7\u00e3o', 'revis\u00e3o', 'envio']);
});

test('não finge entender ações que ainda não são suportadas', () => {
  assert.equal(analyzeVirgulinhaCommand('Reagende todas as tarefas', context).intent, 'unknown');
});
