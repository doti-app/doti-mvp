// @ts-check

/** @typedef {{ id: string, name: string, initials: string }} OperationGroup */
/** @typedef {string[]} WorkflowStep */
/** @typedef {{ id: string, name: string, category: string, description: string, color: string, active?: boolean, steps: WorkflowStep[] }} Workflow */
/** @typedef {{ version: number, groups: OperationGroup[], workflows: Workflow[], clients: any[], projects: any[], deliverables: any[], activity: any[] }} OperationState */

export const OPERATION_COLORS = ['site', 'video', 'social', 'branding', 'copy'];
export const CLIENT_COLORS = ['#ffd400', '#b8e1ff', '#c9f0df', '#e1d2ff', '#ffc9bd', '#d8e0ff', '#ffe8a3', '#cde7e1'];

const DEFAULT_GROUPS = [
  { id: 'g-atendimento', name: 'Atendimento', initials: 'AT' },
  { id: 'g-planejamento', name: 'Planejamento', initials: 'PL' },
  { id: 'g-copy', name: 'Copywriting', initials: 'CO' },
  { id: 'g-design', name: 'Design', initials: 'DE' },
  { id: 'g-coordenacao', name: 'Coordenação', initials: 'CR' },
  { id: 'g-video', name: 'Vídeo', initials: 'VI' },
  { id: 'g-web', name: 'Desenvolvimento Web', initials: 'DW' },
  { id: 'g-branding', name: 'Branding', initials: 'BR' },
  { id: 'g-cliente', name: 'Cliente / Atendimento', initials: 'CL' }
];

const DEFAULT_WORKFLOWS = [
  {
    id: 'wf-site', name: 'Site institucional', category: 'Site', description: 'Sites institucionais e landing pages', color: 'site',
    steps: [
      ['Briefing', 'g-atendimento'], ['Planejamento', 'g-planejamento'], ['Copywriting', 'g-copy'],
      ['Design UI', 'g-design'], ['Aprovação interna', 'g-coordenacao'], ['Aprovação do cliente', 'g-cliente'],
      ['Desenvolvimento', 'g-web'], ['Revisão', 'g-atendimento'], ['Publicação', 'g-web'], ['Concluído', 'g-atendimento']
    ]
  },
  {
    id: 'wf-video', name: 'Produção de vídeo', category: 'Vídeo', description: 'Vídeos institucionais, reels e captação', color: 'video',
    steps: [
      ['Briefing', 'g-atendimento'], ['Roteiro', 'g-copy'], ['Aprovação do roteiro', 'g-coordenacao'],
      ['Captação / Produção', 'g-video'], ['Edição', 'g-video'], ['Revisão interna', 'g-coordenacao'],
      ['Aprovação do cliente', 'g-cliente'], ['Ajustes', 'g-video'], ['Entrega final', 'g-atendimento']
    ]
  },
  {
    id: 'wf-design', name: 'Design para redes', category: 'Design', description: 'Posts, carrosséis e peças de campanha', color: 'social',
    steps: [
      ['Briefing', 'g-atendimento'], ['Criação', 'g-design'], ['Revisão interna', 'g-coordenacao'],
      ['Aprovação do cliente', 'g-cliente'], ['Ajustes', 'g-design'], ['Entrega final', 'g-atendimento']
    ]
  },
  {
    id: 'wf-branding', name: 'Identidade visual', category: 'Branding', description: 'Estratégia, identidade e manual de marca', color: 'branding',
    steps: [
      ['Briefing estratégico', 'g-atendimento'], ['Pesquisa', 'g-planejamento'], ['Conceito', 'g-branding'],
      ['Identidade visual', 'g-design'], ['Manual da marca', 'g-branding'], ['Revisão interna', 'g-coordenacao'],
      ['Apresentação ao cliente', 'g-atendimento'], ['Ajustes', 'g-branding'], ['Entrega final', 'g-atendimento']
    ]
  }
];

/** @returns {OperationState} */
export function createEmptyOperationState() {
  return structuredClone({
    version: 3,
    groups: DEFAULT_GROUPS,
    workflows: DEFAULT_WORKFLOWS,
    clients: [],
    projects: [],
    deliverables: [],
    activity: []
  });
}

/** @param {string} [prefix] */
function defaultId(prefix = 'id') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** @param {string} [prefix] */
export function createDefaultClientWorkspace(prefix = 'client-block') {
  return [
    { id: defaultId(prefix), type: 'heading', content: '' },
    { id: defaultId(prefix), type: 'text', content: '' }
  ];
}

/**
 * Normalizes persisted snapshots at the application boundary, including all
 * historic operation versions accepted by the existing backend.
 * @param {any} value
 * @param {{ createId?: (prefix?: string) => string, now?: () => string }} [options]
 * @returns {OperationState}
 */
export function normalizeOperationState(value, options = {}) {
  const createId = options.createId || defaultId;
  const now = options.now || (() => new Date().toISOString());
  /** @type {OperationState} */
  const data = value && typeof value === 'object' ? value : createEmptyOperationState();
  data.clients ||= [];
  data.projects ||= [];
  data.deliverables ||= [];
  data.activity ||= [];
  data.groups ||= [];
  data.workflows ||= [];

  data.clients.forEach((client, index) => {
    client.color ||= CLIENT_COLORS[index % CLIENT_COLORS.length];
    client.createdAt ||= now();
    client.workspace ||= [];
    if (client.workspaceInitialized !== true) {
      if (!client.workspace.length) {
        client.workspace = [
          { id: createId('client-block'), type: 'heading', content: '' },
          { id: createId('client-block'), type: 'text', content: '' }
        ];
      }
      client.workspaceInitialized = true;
    }
  });

  /** @param {unknown} name */
  const normalizedName = name => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const clientsByName = new Map(data.clients.map(client => [normalizedName(client.name), client]));
  data.projects.forEach(project => {
    let client = data.clients.find(item => item.id === project.clientId);
    if (!client) {
      const clientName = String(project.client || 'Cliente sem nome').trim();
      client = clientsByName.get(normalizedName(clientName));
      if (!client) {
        client = {
          id: createId('client'),
          name: clientName,
          color: CLIENT_COLORS[data.clients.length % CLIENT_COLORS.length],
          logoId: '',
          createdAt: project.createdAt || now()
        };
        data.clients.push(client);
        clientsByName.set(normalizedName(clientName), client);
      }
      project.clientId = client.id;
    }
    project.client = client.name;
  });

  data.workflows.forEach(workflow => {
    workflow.active = workflow.active !== false;
    workflow.steps = (workflow.steps || []).map(([name, groupId, stepId]) => [name, groupId, stepId || createId('ws')]);
  });
  data.deliverables.forEach(deliverable => {
    deliverable.attachments ||= [];
    deliverable.links ||= [];
    deliverable.steps ||= [];
    deliverable.note ??= deliverable.steps[deliverable.stepIndex]?.note || [...deliverable.steps].reverse().find(step => step.note)?.note || '';
    delete deliverable.observations;
    const workflow = data.workflows.find(item => item.id === deliverable.workflowId);
    deliverable.steps.forEach(/** @param {any} step @param {number} index */ (step, index) => {
      if (!step.sourceStepId && workflow) step.sourceStepId = workflow.steps[index]?.[2] || createId('ws');
      if (!step.sourceStepId) step.sourceStepId = '';
    });
  });
  return data;
}

/** @param {Storage} storage @param {string} storageKey */
export function loadLegacyOperationState(storage, storageKey) {
  try {
    const saved = JSON.parse(storage.getItem(storageKey) || 'null');
    if (saved?.version === 3 && Array.isArray(saved.projects) && Array.isArray(saved.workflows)) return normalizeOperationState(saved);
  } catch (_) {
    // Invalid local data falls back to the same empty state as the legacy app.
  }
  return normalizeOperationState(createEmptyOperationState());
}
