import {
  attachKnownFilePaths,
  canonicalizeLegacyState,
  downloadOperationFile,
  importLegacyAgencyState,
  legacyCounts,
  legacyFingerprint,
  loadAgencyState,
  removeOperationFile,
  removeStoragePaths,
  saveAgencyState,
  subscribeToAgencyChanges,
  uploadLegacyFiles,
  uploadOperationFile,
  waitForOperationContext
} from '/dot-admin/operation-store.js?v=4';

const STORAGE_KEY = 'doti-agency-live-v3';
const SIDEBAR_STORAGE_KEY = 'doti-sidebar-collapsed';
const pages = [...document.querySelectorAll('.page')];
const navItems = [...document.querySelectorAll('.nav-item[data-page]')];
const toast = document.getElementById('toast');
const ATTACHMENT_DB_NAME = 'doti-attachments-v1';
const ATTACHMENT_STORE_NAME = 'files';
const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
let attachmentDbPromise;

const COLORS = ['site', 'video', 'social', 'branding', 'copy'];
const CLIENT_COLORS = ['#ffd400', '#b8e1ff', '#c9f0df', '#e1d2ff', '#ffc9bd', '#d8e0ff', '#ffe8a3', '#cde7e1'];
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

const EMPTY_STATE = {
  version: 3,
  groups: DEFAULT_GROUPS,
  workflows: DEFAULT_WORKFLOWS,
  clients: [],
  projects: [],
  deliverables: [],
  activity: []
};

let state = normalizeWorkflowStepIds(structuredClone(EMPTY_STATE));
const legacySnapshotExists = Boolean(localStorage.getItem(STORAGE_KEY));
let legacyState = loadLegacyState();
let operationRevision = 0;
let queuedRevision = 0;
let operationReady = false;
let migrationPending = false;
let persistQueue = [];
let persistRunning = false;
let persistEpoch = 0;
let realtimeRefreshPending = false;
let ignoreRealtimeUntil = 0;
let unsubscribeRealtime;
let demandView = 'board';
let flowView = 'models';
let selectedClientWorkspaceId = null;
let calendarCursor = new Date();
calendarCursor.setDate(1);
let selectedCalendarDate = localDateKey(new Date());

function loadLegacyState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.version === 3 && Array.isArray(saved.projects) && Array.isArray(saved.workflows)) return normalizeWorkflowStepIds(saved);
  } catch (_) {}
  return normalizeWorkflowStepIds(JSON.parse(JSON.stringify(EMPTY_STATE)));
}
function normalizeWorkflowStepIds(data) {
  data.clients ||= [];
  data.clients.forEach((client, index) => {
    client.color ||= CLIENT_COLORS[index % CLIENT_COLORS.length];
    client.createdAt ||= new Date().toISOString();
    client.workspace ||= [];
    if (client.workspaceInitialized !== true) {
      if (!client.workspace.length) client.workspace = createDefaultClientWorkspace();
      client.workspaceInitialized = true;
    }
  });
  const clientsByName = new Map(data.clients.map(client => [normalize(client.name), client]));
  data.projects.forEach(project => {
    let client = data.clients.find(item => item.id === project.clientId);
    if (!client) {
      const clientName = String(project.client || 'Cliente sem nome').trim();
      client = clientsByName.get(normalize(clientName));
      if (!client) {
        client = {
          id: uid('client'),
          name: clientName,
          color: CLIENT_COLORS[data.clients.length % CLIENT_COLORS.length],
          logoId: '',
          createdAt: project.createdAt || new Date().toISOString()
        };
        data.clients.push(client);
        clientsByName.set(normalize(clientName), client);
      }
      project.clientId = client.id;
    }
    project.client = client.name;
  });
  data.workflows.forEach(workflow => {
    workflow.active = workflow.active !== false;
    workflow.steps = workflow.steps.map(([name, groupId, stepId]) => [name, groupId, stepId || uid('ws')]);
  });
  data.deliverables.forEach(deliverable => {
    deliverable.attachments ||= [];
    deliverable.links ||= [];
    deliverable.note ??= deliverable.steps[deliverable.stepIndex]?.note || [...deliverable.steps].reverse().find(step => step.note)?.note || '';
    delete deliverable.observations;
    const workflow = data.workflows.find(item => item.id === deliverable.workflowId);
    deliverable.steps.forEach((step, index) => {
      if (!step.sourceStepId && workflow) step.sourceStepId = workflow.steps[index]?.[2] || uid('ws');
      if (!step.sourceStepId) step.sourceStepId = '';
    });
  });
  return data;
}
function createDefaultClientWorkspace() {
  return [
    { id: uid('client-block'), type: 'heading', content: '' },
    { id: uid('client-block'), type: 'text', content: '' }
  ];
}
function openAttachmentDb() {
  if (attachmentDbPromise) return attachmentDbPromise;
  attachmentDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(ATTACHMENT_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(ATTACHMENT_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return attachmentDbPromise;
}
async function getLegacyAttachmentFile(id) {
  const db = await openAttachmentDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(ATTACHMENT_STORE_NAME).objectStore(ATTACHMENT_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function deleteStoredAttachments(deliverables) {
  deliverables.flatMap(item => item.attachments || []).forEach(attachment => {
    deleteAttachmentFile(attachment.id).catch(() => {});
  });
}
async function storeAttachmentFile(id, file) {
  if (!operationReady) throw new Error('A operação ainda não foi carregada.');
  return uploadOperationFile(id, file);
}
async function getAttachmentFile(id) {
  if (!operationReady) return getLegacyAttachmentFile(id);
  return downloadOperationFile(id);
}
async function deleteAttachmentFile(id) {
  if (!operationReady) throw new Error('A operação ainda não foi migrada.');
  return removeOperationFile(id);
}
function saveState() {
  renderAll();
  if (!operationReady) {
    if (migrationPending) {
      state = normalizeWorkflowStepIds(structuredClone(legacyState));
      renderAll();
      notify('Importação necessária', 'Confirme a migração antes de alterar a cópia oficial.', '!');
    }
    return Promise.resolve();
  }
  const snapshot = attachKnownFilePaths(structuredClone(state));
  const expectedRevision = queuedRevision;
  const epoch = persistEpoch;
  queuedRevision += 1;
  const completion = new Promise(resolve => {
    persistQueue.push({ snapshot, expectedRevision, epoch, resolve });
  });
  flushPersistQueue();
  return completion;
}
async function flushPersistQueue() {
  if (persistRunning) return;
  persistRunning = true;
  try {
    while (persistQueue.length) {
      const entry = persistQueue.shift();
      if (entry.epoch !== persistEpoch) {
        entry.resolve(false);
        continue;
      }
      try {
        operationRevision = await saveAgencyState(entry.snapshot, entry.expectedRevision);
        queuedRevision = Math.max(queuedRevision, operationRevision);
        ignoreRealtimeUntil = Date.now() + 1200;
        entry.resolve(true);
      } catch (error) {
        persistEpoch += 1;
        persistQueue.splice(0).forEach(pending => pending.resolve(false));
        realtimeRefreshPending = false;
        await handlePersistenceError(error);
        queuedRevision = operationRevision;
        entry.resolve(false);
        break;
      }
    }
  } finally {
    persistRunning = false;
    if (realtimeRefreshPending && !persistQueue.length && !document.querySelector('.doti-modal, .attachment-preview-layer')) {
      refreshOperationFromServer();
    }
  }
}
function uid(prefix) {
  return crypto.randomUUID();
}
function logActivity(action, detail) {
  state.activity.unshift({ id: uid('a'), action, detail, at: new Date().toISOString() });
  state.activity = state.activity.slice(0, 50);
}
function notify(title, message, icon = '✓') {
  const isAttention = icon === '!';
  toast.querySelector(':scope > span').textContent = icon;
  toast.querySelector('strong').textContent = title;
  toast.querySelector('p').textContent = message;
  toast.setAttribute('role', isAttention ? 'alert' : 'status');
  toast.setAttribute('aria-live', isAttention ? 'assertive' : 'polite');
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}
function showPage(id) {
  if (!document.getElementById(id)) id = 'dashboard';
  pages.forEach(page => page.classList.toggle('active', page.id === id));
  navItems.forEach(item => item.classList.toggle('active', item.dataset.page === id));
  history.replaceState(null, '', id === 'dashboard' ? location.pathname : `#${id}`);
  if (id === 'dashboard') renderDashboard();
  if (id === 'demandas') renderDemands();
  if (id === 'fluxos') renderWorkflows();
  if (id === 'clientes') renderClients();
}

function renderAll() {
  renderDashboard();
  renderDemands();
  renderWorkflows();
  renderClients();
  document.getElementById('demandNavCount').textContent = state.deliverables.filter(item => item.status !== 'done').length;
  document.getElementById('workflowNavCount').textContent = state.workflows.length;
  document.getElementById('clientNavCount').textContent = state.clients.length;
}

function workflowById(id) {
  return state.workflows.find(workflow => workflow.id === id);
}
function projectById(id) {
  return state.projects.find(project => project.id === id);
}
function clientById(id) {
  return state.clients.find(client => client.id === id);
}
function clientForProject(project) {
  return clientById(project?.clientId) || state.clients.find(client => normalize(client.name) === normalize(project?.client));
}
function groupById(id) {
  return state.groups.find(group => group.id === id) || { name: 'Sem grupo', initials: '—' };
}
function currentStep(deliverable) {
  return deliverable.steps[deliverable.stepIndex] || deliverable.steps.at(-1);
}
function stepDeadlinesFromCurrent(deliverable) {
  return deliverable.steps
    .map((step, index) => ({ step, index, due: step.due || '' }))
    .filter(item => item.index >= deliverable.stepIndex && item.due);
}
function nextStepDeadline(deliverable) {
  const deadlines = stepDeadlinesFromCurrent(deliverable);
  const currentDeadline = deadlines.find(item => item.index === deliverable.stepIndex);
  if (currentDeadline) return currentDeadline;
  return deadlines.sort((a, b) => a.due.localeCompare(b.due))[0] || null;
}
function effectiveDeadline(deliverable) {
  const milestone = nextStepDeadline(deliverable);
  if (milestone) return { due: milestone.due, source: 'step', label: milestone.step.name };
  const project = projectById(deliverable.projectId);
  const generalDue = deliverable.due || project?.due || '';
  return generalDue ? { due: generalDue, source: 'project', label: 'Prazo geral' } : null;
}
function compareDeliverablesByDate(a, b) {
  const deadlineA = effectiveDeadline(a);
  const deadlineB = effectiveDeadline(b);
  if (deadlineA && deadlineB && deadlineA.due !== deadlineB.due) return deadlineA.due.localeCompare(deadlineB.due);
  if (deadlineA && !deadlineB) return -1;
  if (!deadlineA && deadlineB) return 1;
  return String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id));
}
function compareProjectsByDate(a, b) {
  const deliverablesA = state.deliverables.filter(item => item.projectId === a.id).sort(compareDeliverablesByDate);
  const deliverablesB = state.deliverables.filter(item => item.projectId === b.id).sort(compareDeliverablesByDate);
  const dueA = deliverablesA[0] ? effectiveDeadline(deliverablesA[0])?.due : a.due;
  const dueB = deliverablesB[0] ? effectiveDeadline(deliverablesB[0])?.due : b.due;
  if (dueA && dueB && dueA !== dueB) return dueA.localeCompare(dueB);
  if (dueA && !dueB) return -1;
  if (!dueA && dueB) return 1;
  return String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id));
}
function dateIsPast(value) {
  return Boolean(value) && new Date(`${value}T23:59:59`) < new Date();
}
function overdueDeadline(project, deliverable) {
  if (deliverable.status === 'done') return null;
  const overdueStep = stepDeadlinesFromCurrent(deliverable).find(item => dateIsPast(item.due));
  if (overdueStep) return { kind: 'step', due: overdueStep.due, label: overdueStep.step.name };
  const overallDue = deliverable.due || project?.due;
  return dateIsPast(overallDue) ? { kind: 'project', due: overallDue, label: 'Prazo do entregável' } : null;
}
function macroStatus(deliverable) {
  if (deliverable.status === 'done') return 'done';
  const step = currentStep(deliverable);
  if (/aprovação|apresentação|revisão interna/i.test(step.name) || step.groupId === 'g-cliente' || step.groupId === 'g-coordenacao') return 'approval';
  if (deliverable.stepIndex <= 1) return 'planning';
  return 'production';
}
function isOverdue(project, deliverable) {
  return Boolean(overdueDeadline(project, deliverable));
}

function renderDashboard() {
  const today = new Date();
  document.getElementById('todayLabel').textContent = today.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase();
  const active = state.deliverables.filter(item => item.status !== 'done');
  const approvals = active.filter(item => macroStatus(item) === 'approval');
  const overdue = active.map(item => ({
    item,
    deadline: overdueDeadline(projectById(item.projectId), item)
  })).filter(entry => entry.deadline);
  const completed = state.deliverables.filter(item => item.status === 'done');
  document.getElementById('dashboardHeadline').textContent = active.length
    ? `${active.length} ${active.length === 1 ? 'entregável está em andamento' : 'entregáveis estão em andamento'}.`
    : 'Nenhuma demanda cadastrada. Crie seu primeiro projeto para começar.';
  document.getElementById('dashboardMetrics').innerHTML = [
    ['□', state.projects.length, 'Projetos', 'yellow'],
    ['↝', active.length, 'Em andamento', 'blue'],
    ['◷', approvals.length, 'Em aprovação', 'violet'],
    ['✓', completed.length, 'Concluídos', 'green']
  ].map(([icon, value, label, color]) => `<article><span class="metric-icon ${color}">${icon}</span><div><small>${label}</small><strong>${value}</strong><em>${metricHint(label, value)}</em></div></article>`).join('');

  const attention = [
    ...overdue.map(({ item, deadline }) => ({ item, type: 'Atrasado', className: 'danger', detail: `${deadline.label} · ${formatDate(deadline.due)}` })),
    ...approvals.filter(item => !overdue.some(entry => entry.item.id === item.id)).map(item => ({ item, type: 'Aprovação', className: 'warning', detail: currentStep(item).name }))
  ];
  document.getElementById('attentionSubtitle').textContent = attention.length ? `${attention.length} ${attention.length === 1 ? 'item encontrado' : 'itens encontrados'}` : 'Nenhuma pendência no momento';
  document.getElementById('attentionList').innerHTML = attention.length
    ? attention.slice(0, 6).map(entry => {
      const project = projectById(entry.item.projectId);
      return `<button class="attention-row" data-open-deliverable="${entry.item.id}"><i class="${entry.className}"></i><div><strong>${escapeHtml(entry.item.name)}</strong><small>${escapeHtml(project?.client || '')} · ${escapeHtml(entry.detail)}</small></div><span>${entry.type} →</span></button>`;
    }).join('')
    : emptyBlock('Tudo em ordem', state.projects.length ? 'Não há prazos vencidos nem aprovações pendentes.' : 'As pendências aparecerão aqui quando você iniciar um projeto.', '✓');

  const recent = [...state.projects].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);
  document.getElementById('recentProjects').innerHTML = recent.length
    ? recent.map(renderProjectRow).join('')
    : emptyBlock('Nenhum projeto ainda', 'Crie um projeto e acompanhe o progresso por aqui.', '□', '<button class="primary-btn" data-create-project>Criar primeiro projeto</button>');
  bindDynamicActions();
  hydrateClientLogos(document.getElementById('recentProjects'));
}
function metricHint(label, value) {
  if (!value) return 'Nenhum registro';
  if (label === 'Projetos') return value === 1 ? '1 projeto cadastrado' : `${value} projetos cadastrados`;
  return 'Atualizado agora';
}

async function hydrateClientLogos(root = document) {
  const images = [...root.querySelectorAll('img[data-client-logo]')];
  await Promise.all(images.map(async image => {
    try {
      const file = await getAttachmentFile(image.dataset.clientLogo);
      if (!file) return;
      const url = URL.createObjectURL(file);
      image.src = url;
      image.hidden = false;
      image.previousElementSibling?.setAttribute('hidden', '');
      image.onload = () => URL.revokeObjectURL(url);
    } catch (_) {}
  }));
}
function renderClients() {
  const searchElement = document.getElementById('clientSearch');
  if (!searchElement) return;
  const pageTitle = document.querySelector('.clients-page-title');
  const directory = document.getElementById('clientDirectory');
  const workspace = document.getElementById('clientWorkspace');
  const selectedClient = clientById(selectedClientWorkspaceId);
  if (selectedClient) {
    pageTitle.hidden = true;
    directory.hidden = true;
    workspace.hidden = false;
    renderClientWorkspace(selectedClient);
    return;
  }
  pageTitle.hidden = false;
  directory.hidden = false;
  workspace.hidden = true;
  const search = normalize(searchElement.value);
  const clients = state.clients
    .filter(client => !search || normalize(client.name).includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const activeClients = state.clients.filter(client => state.projects.some(project => project.clientId === client.id)).length;
  document.getElementById('clientSummary').innerHTML = `
    <article><strong>${state.clients.length}</strong><span>clientes cadastrados</span></article>
    <article><strong>${activeClients}</strong><span>com projetos</span></article>
    <article><strong>${state.projects.length}</strong><span>projetos na carteira</span></article>`;
  document.getElementById('clientGrid').innerHTML = clients.length
    ? clients.map(client => {
      const projects = state.projects.filter(project => project.clientId === client.id);
      const active = projects.flatMap(project => state.deliverables.filter(item => item.projectId === project.id && item.status !== 'done')).length;
      return `<article class="client-card" data-open-client-workspace="${client.id}">
        <div class="client-card-logo" style="--client-color:${escapeAttr(client.color)}"><span>${escapeHtml(initials(client.name))}</span>${client.logoId ? `<img data-client-logo="${client.logoId}" alt="" hidden>` : ''}</div>
        <div class="client-card-copy"><strong>${escapeHtml(client.name)}</strong><small>${projects.length} ${projects.length === 1 ? 'projeto' : 'projetos'} · ${active} ${active === 1 ? 'demanda ativa' : 'demandas ativas'}</small><span>Abrir dossiê →</span></div>
        <button type="button" data-edit-client="${client.id}" aria-label="Editar ${escapeAttr(client.name)}">Editar</button>
      </article>`;
    }).join('')
    : `<div class="client-empty">${emptyBlock(search ? 'Nenhum cliente encontrado' : 'Cadastre seu primeiro cliente', search ? 'Tente outro termo de busca.' : 'Adicione nome, cor e uma logo opcional para organizar sua carteira.', '◇', search ? '' : '<button class="primary-btn" data-create-client>+ Novo cliente</button>')}</div>`;
  document.querySelectorAll('[data-open-client-workspace]').forEach(card => card.onclick = event => {
    if (event.target.closest('[data-edit-client]')) return;
    selectedClientWorkspaceId = card.dataset.openClientWorkspace;
    renderClients();
  });
  document.querySelectorAll('[data-edit-client]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    openClientModal(button.dataset.editClient);
  });
  document.querySelectorAll('[data-create-client]').forEach(button => button.onclick = () => openClientModal());
  hydrateClientLogos(document.getElementById('clientGrid'));
}
function renderClientWorkspaceBlock(block) {
  const controls = `<div class="workspace-block-controls"><span title="Arraste para mover">⠿</span><button type="button" data-delete-workspace-block="${block.id}" aria-label="Excluir bloco">×</button></div>`;
  if (block.type === 'heading') return `<article class="workspace-block" draggable="true" data-workspace-block="${block.id}">${controls}<div class="workspace-heading" contenteditable="true" data-workspace-content data-placeholder="Título">${escapeHtml(block.content || '')}</div></article>`;
  if (block.type === 'callout') return `<article class="workspace-block workspace-callout" draggable="true" data-workspace-block="${block.id}">${controls}<span>!</span><div contenteditable="true" data-workspace-content data-placeholder="Informação importante">${escapeHtml(block.content || '')}</div></article>`;
  if (block.type === 'divider') return `<article class="workspace-block workspace-divider" draggable="true" data-workspace-block="${block.id}">${controls}<hr></article>`;
  if (block.type === 'colors') {
    const colors = block.colors?.length ? block.colors : ['#111111', '#ffd400', '#ffffff'];
    return `<article class="workspace-block workspace-brand-block" draggable="true" data-workspace-block="${block.id}">${controls}<header><strong>Paleta de cores</strong><small>Identidade visual</small></header><div class="workspace-colors">${colors.map((color, index) => `<label><input type="color" value="${escapeAttr(color)}" data-workspace-color="${index}"><span style="--workspace-color:${escapeAttr(color)}"></span><small>${escapeHtml(color.toUpperCase())}</small></label>`).join('')}</div></article>`;
  }
  if (block.type === 'typography') return `<article class="workspace-block workspace-brand-block" draggable="true" data-workspace-block="${block.id}">${controls}<header><strong>Tipografia</strong><small>Fontes recomendadas</small></header><div class="workspace-typography"><label>Fonte de títulos<input value="${escapeAttr(block.headingFont || '')}" data-workspace-font="headingFont" placeholder="Ex.: DM Sans Bold"></label><label>Fonte de textos<input value="${escapeAttr(block.bodyFont || '')}" data-workspace-font="bodyFont" placeholder="Ex.: Inter Regular"></label></div></article>`;
  if (block.type === 'image') return `<article class="workspace-block workspace-file-block" draggable="true" data-workspace-block="${block.id}">${controls}<button type="button" data-preview-workspace-file="${block.id}"><img data-workspace-image="${block.fileId}" alt="${escapeAttr(block.name)}"><span>Visualizar imagem</span></button><small>${escapeHtml(block.name)}</small></article>`;
  if (block.type === 'pdf') return `<article class="workspace-block workspace-file-block workspace-pdf-block" draggable="true" data-workspace-block="${block.id}">${controls}<button type="button" data-preview-workspace-file="${block.id}"><b>PDF</b><div><strong>${escapeHtml(block.name)}</strong><small>${formatFileSize(block.size || 0)} · clicar para visualizar</small></div></button></article>`;
  return `<article class="workspace-block" draggable="true" data-workspace-block="${block.id}">${controls}<div class="workspace-text" contenteditable="true" data-workspace-content data-placeholder="Escreva algo…">${linkifyObservationText(block.content || '')}</div></article>`;
}
async function hydrateWorkspaceImages(root) {
  await Promise.all([...root.querySelectorAll('img[data-workspace-image]')].map(async image => {
    try {
      const file = await getAttachmentFile(image.dataset.workspaceImage);
      if (!file) return;
      const url = URL.createObjectURL(file);
      image.src = url;
      image.onload = () => URL.revokeObjectURL(url);
    } catch (_) {}
  }));
}
function renderClientWorkspace(client) {
  const workspace = document.getElementById('clientWorkspace');
  client.workspace ||= [];
  workspace.innerHTML = `
    <header class="client-workspace-header">
      <button type="button" data-close-client-workspace>← Clientes</button>
      <div class="client-workspace-identity"><div class="client-card-logo" style="--client-color:${escapeAttr(client.color)}"><span>${escapeHtml(initials(client.name))}</span>${client.logoId ? `<img data-client-logo="${client.logoId}" alt="" hidden>` : ''}</div><div><span>DOSSIÊ DO CLIENTE</span><h1>${escapeHtml(client.name)}</h1><p>Identidade, referências, decisões e materiais em um só lugar.</p></div></div>
      <button type="button" class="outline-btn" data-edit-workspace-client>Editar cliente</button>
    </header>
    <div class="workspace-add-bar">
      <span>Adicionar bloco</span>
      <button type="button" data-add-workspace="text">Texto</button>
      <button type="button" data-add-workspace="heading">Título</button>
      <button type="button" data-add-workspace="callout">Destaque</button>
      <button type="button" data-add-workspace="colors">Cores</button>
      <button type="button" data-add-workspace="typography">Tipografia</button>
      <button type="button" data-add-workspace="divider">Divisor</button>
      <label>Imagem ou PDF<input type="file" data-add-workspace-file accept="image/*,application/pdf,.pdf"></label>
    </div>
    <div class="workspace-canvas ${client.workspace.length ? '' : 'empty'}" data-workspace-canvas>
      ${client.workspace.length ? client.workspace.map(renderClientWorkspaceBlock).join('') : '<div class="workspace-empty"><span>＋</span><h2>Uma página em branco para este cliente</h2><p>Use os blocos acima para registrar identidade visual, tipografia, textos, imagens, PDFs e referências.</p></div>'}
    </div>`;
  workspace.querySelector('[data-close-client-workspace]').onclick = () => { selectedClientWorkspaceId = null; renderClients(); };
  workspace.querySelector('[data-edit-workspace-client]').onclick = () => openClientModal(client.id);
  workspace.querySelectorAll('[data-add-workspace]').forEach(button => button.onclick = () => {
    const type = button.dataset.addWorkspace;
    const block = { id: uid('client-block'), type, content: '' };
    if (type === 'colors') block.colors = [client.color, '#111111', '#ffffff'];
    client.workspace.push(block);
    saveState();
  });
  workspace.querySelector('[data-add-workspace-file]').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if ((!isImage && !isPdf) || file.size > MAX_ATTACHMENT_SIZE) return notify('Arquivo não permitido', 'Use uma imagem ou PDF de até 100 MB.', '!');
    const fileId = uid('client-file');
    try {
      await storeAttachmentFile(fileId, file);
      client.workspace.push({ id: uid('client-block'), type: isImage ? 'image' : 'pdf', fileId, name: file.name, size: file.size, mimeType: file.type });
      saveState();
      notify('Material adicionado', `${file.name} foi incluído no dossiê.`);
    } catch (_) {
      notify('Não foi possível salvar', 'Tente usar outro arquivo.', '!');
    }
  };
  workspace.querySelectorAll('[data-workspace-content]').forEach(editor => {
    const blockElement = editor.closest('[data-workspace-block]');
    const block = client.workspace.find(item => item.id === blockElement.dataset.workspaceBlock);
    editor.oninput = () => { block.content = editor.innerText.replace(/\u00a0/g, ' '); };
    editor.onblur = () => { block.content = editor.innerText.trim(); saveState(); };
    editor.onpointerdown = event => {
      const link = event.target.closest('a');
      if (link) { event.preventDefault(); window.open(link.href, '_blank', 'noopener,noreferrer'); }
    };
  });
  workspace.querySelectorAll('[data-workspace-color]').forEach(input => input.onchange = () => {
    const block = client.workspace.find(item => item.id === input.closest('[data-workspace-block]').dataset.workspaceBlock);
    block.colors[Number(input.dataset.workspaceColor)] = input.value;
    saveState();
  });
  workspace.querySelectorAll('[data-workspace-font]').forEach(input => input.onchange = () => {
    const block = client.workspace.find(item => item.id === input.closest('[data-workspace-block]').dataset.workspaceBlock);
    block[input.dataset.workspaceFont] = input.value.trim();
    saveState();
  });
  workspace.querySelectorAll('[data-delete-workspace-block]').forEach(button => button.onclick = () => {
    const blockId = button.closest('[data-workspace-block]').dataset.workspaceBlock;
    const block = client.workspace.find(item => item.id === blockId);
    if (block?.fileId) deleteAttachmentFile(block.fileId).catch(() => {});
    client.workspace = client.workspace.filter(item => item.id !== blockId);
    saveState();
  });
  workspace.querySelectorAll('[data-preview-workspace-file]').forEach(button => button.onclick = () => {
    const block = client.workspace.find(item => item.id === button.dataset.previewWorkspaceFile);
    if (block) openAttachmentPreview({ id: block.fileId, name: block.name, size: block.size, type: block.mimeType || (block.type === 'image' ? 'image/*' : 'application/pdf') });
  });
  bindWorkspaceReorder(client, workspace);
  hydrateClientLogos(workspace);
  hydrateWorkspaceImages(workspace);
}
function bindWorkspaceReorder(client, workspace) {
  const canvas = workspace.querySelector('[data-workspace-canvas]');
  let dragged = null;
  canvas.querySelectorAll('[data-workspace-block]').forEach(block => {
    block.ondragstart = event => {
      if (event.target.closest('input,button,[contenteditable]')) return event.preventDefault();
      dragged = block;
      block.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
    };
    block.ondragover = event => {
      if (!dragged || dragged === block) return;
      event.preventDefault();
      const box = block.getBoundingClientRect();
      canvas.insertBefore(dragged, event.clientY > box.top + box.height / 2 ? block.nextSibling : block);
    };
    block.ondragend = () => {
      block.classList.remove('dragging');
      if (!dragged) return;
      const order = [...canvas.querySelectorAll('[data-workspace-block]')].map(item => item.dataset.workspaceBlock);
      const byId = new Map(client.workspace.map(item => [item.id, item]));
      client.workspace = order.map(id => byId.get(id)).filter(Boolean);
      dragged = null;
      saveState();
    };
  });
}
function openClientModal(clientId = null) {
  const client = clientId ? clientById(clientId) : null;
  const selectedColor = client?.color || CLIENT_COLORS[state.clients.length % CLIENT_COLORS.length];
  openModal(client ? 'Editar cliente' : 'Novo cliente', `
    <div class="client-brand-editor">
      <div class="client-logo-preview" data-client-logo-preview style="--client-color:${escapeAttr(selectedColor)}"><span>${escapeHtml(initials(client?.name || 'Novo cliente'))}</span>${client?.logoId ? `<img data-client-logo="${client.logoId}" alt="" hidden>` : ''}</div>
      <label class="client-logo-upload">Logo opcional<input type="file" name="logo" accept="image/*"><small>PNG, JPG ou WebP · até 10 MB</small></label>
    </div>
    <label>Nome do cliente<input name="name" required maxlength="80" value="${escapeAttr(client?.name || '')}" placeholder="Ex.: Regularize AI"></label>
    <fieldset class="client-color-picker"><legend>Cor de identificação</legend>${CLIENT_COLORS.map(color => `<label title="${color}"><input type="radio" name="color" value="${color}" ${color === selectedColor ? 'checked' : ''}><span style="--swatch:${color}"></span></label>`).join('')}</fieldset>
  `, form => {
    const name = field(form, 'name').trim();
    const duplicate = state.clients.some(item => item.id !== client?.id && normalize(item.name) === normalize(name));
    if (duplicate) {
      notify('Cliente já cadastrado', 'Use outro nome ou edite o cliente existente.', '!');
      return false;
    }
    const logoFile = form.elements.namedItem('logo').files[0];
    if (logoFile && (!logoFile.type.startsWith('image/') || logoFile.size > 10 * 1024 * 1024)) {
      notify('Logo inválida', 'Escolha uma imagem de até 10 MB.', '!');
      return false;
    }
    const target = client || { id: uid('client'), createdAt: new Date().toISOString(), logoId: '', workspace: createDefaultClientWorkspace(), workspaceInitialized: true };
    const finalize = () => {
      target.name = name;
      target.color = field(form, 'color');
      if (!client) state.clients.push(target);
      state.projects.filter(project => project.clientId === target.id).forEach(project => { project.client = name; });
      logActivity(client ? 'Cliente atualizado' : 'Cliente criado', name);
      saveState();
      showPage('clientes');
      notify(client ? 'Cliente atualizado' : 'Cliente criado', `${name} está disponível nos filtros e projetos.`);
    };
    if (logoFile) {
      const logoId = target.logoId || uid('client-logo');
      storeAttachmentFile(logoId, logoFile).then(() => {
        target.logoId = logoId;
        finalize();
      }).catch(() => notify('Não foi possível salvar a logo', 'Tente usar outra imagem.', '!'));
    } else {
      finalize();
    }
    return true;
  }, client ? 'Salvar alterações' : 'Adicionar cliente', form => {
    const preview = form.querySelector('[data-client-logo-preview]');
    const nameInput = form.elements.namedItem('name');
    if (client) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'client-delete-btn';
      deleteButton.dataset.deleteClient = '';
      deleteButton.setAttribute('aria-label', `Excluir ${client.name}`);
      deleteButton.title = 'Excluir cliente';
      deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"></path></svg>';
      form.querySelector(':scope > footer').prepend(deleteButton);
    }
    nameInput.oninput = () => {
      const initialsElement = preview.querySelector('span');
      initialsElement.textContent = initials(nameInput.value || 'Novo cliente');
    };
    form.querySelectorAll('input[name="color"]').forEach(input => input.onchange = () => preview.style.setProperty('--client-color', input.value));
    form.elements.namedItem('logo').onchange = event => {
      const file = event.target.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      const image = preview.querySelector('img') || preview.appendChild(document.createElement('img'));
      const url = URL.createObjectURL(file);
      image.src = url;
      image.hidden = false;
      preview.querySelector('span').hidden = true;
      image.onload = () => URL.revokeObjectURL(url);
    };
    if (client?.logoId) hydrateClientLogos(form);
    form.querySelector('[data-delete-client]')?.addEventListener('click', () => {
      const projects = state.projects.filter(project => project.clientId === client.id);
      if (projects.length) return notify('Cliente em uso', `Existem ${projects.length} ${projects.length === 1 ? 'projeto vinculado' : 'projetos vinculados'} a este cliente.`, '!');
      confirmAction('Excluir cliente?', `${client.name} será removido da carteira.`, () => {
        if (client.logoId) deleteAttachmentFile(client.logoId).catch(() => {});
        (client.workspace || []).filter(block => block.fileId).forEach(block => deleteAttachmentFile(block.fileId).catch(() => {}));
        state.clients = state.clients.filter(item => item.id !== client.id);
        selectedClientWorkspaceId = null;
        logActivity('Cliente excluído', client.name);
        saveState();
        closeModal();
        notify('Cliente excluído', `${client.name} foi removido.`);
      });
    });
  });
}

function renderDemands() {
  const groupFilterElement = document.getElementById('groupFilter');
  const clientFilterElement = document.getElementById('clientFilter');
  const selectedGroup = state.groups.some(group => group.id === groupFilterElement.value) ? groupFilterElement.value : 'all';
  const selectedClient = state.clients.some(client => client.id === clientFilterElement.value) ? clientFilterElement.value : 'all';
  groupFilterElement.innerHTML = `<option value="all">Todos os grupos</option>${state.groups.map(group => `<option value="${group.id}">${escapeHtml(group.name)}</option>`).join('')}`;
  groupFilterElement.value = selectedGroup;
  clientFilterElement.innerHTML = `<option value="all">Todos os clientes</option>${[...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(client => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join('')}`;
  clientFilterElement.value = selectedClient;
  const counts = { planning: 0, production: 0, approval: 0, done: 0 };
  state.deliverables.forEach(item => counts[macroStatus(item)]++);
  document.getElementById('operationSummary').innerHTML = [
    [state.projects.length, 'projetos'], [state.deliverables.length, 'entregáveis'],
    [counts.approval, 'em aprovação'], [counts.done, 'concluídos']
  ].map(([value, label], index) => `<article><span class="summary-icon ${['yellow-bg', 'blue-bg', 'violet-bg', 'mint-bg'][index]}">${['□', '◇', '◷', '✓'][index]}</span><div><strong>${value}</strong><small>${label}</small></div></article>`).join('');

  const search = normalize(document.getElementById('demandSearch').value);
  const filter = document.getElementById('statusFilter').value;
  const groupFilter = groupFilterElement.value;
  const clientFilter = clientFilterElement.value;
  const visible = state.deliverables.filter(item => {
    const project = projectById(item.projectId);
    const haystack = normalize(`${item.name} ${project?.name || ''} ${project?.client || ''}`);
    const belongsToGroup = groupFilter === 'all' || currentStep(item).groupId === groupFilter;
    const belongsToClient = clientFilter === 'all' || project?.clientId === clientFilter;
    return (!search || haystack.includes(search)) && (filter === 'all' || macroStatus(item) === filter) && belongsToGroup && belongsToClient;
  }).sort(compareDeliverablesByDate);
  const columns = [
    ['planning', 'Entrada', 'gray'], ['production', 'Em produção', 'blue'],
    ['approval', 'Em aprovação', 'violet'], ['done', 'Concluído', 'green']
  ];
  document.getElementById('deliverablesBoard').innerHTML = state.deliverables.length
    ? columns.map(([key, label, color]) => {
      const items = visible.filter(item => macroStatus(item) === key);
      return `<div class="column"><header><span class="dot ${color}"></span><strong>${label}</strong><b>${items.length}</b></header><div class="column-tasks">${items.length ? items.map(renderDeliverableCard).join('') : '<div class="empty-column">Nenhum item</div>'}</div></div>`;
    }).join('')
    : `<div class="full-empty">${emptyBlock('Sua operação está vazia', 'Crie um projeto, selecione os fluxos contratados e o Doti montará os entregáveis e etapas automaticamente.', '□', '<button class="primary-btn" data-create-project>+ Criar primeiro projeto</button>')}</div>`;

  const visibleProjectIds = new Set(visible.map(item => item.projectId));
  const hasActiveFilters = search || filter !== 'all' || groupFilter !== 'all' || clientFilter !== 'all';
  const projectList = (hasActiveFilters ? state.projects.filter(project => visibleProjectIds.has(project.id)) : [...state.projects]).sort(compareProjectsByDate);
  document.getElementById('projectsView').innerHTML = projectList.length
    ? projectList.map(renderProjectRow).join('')
    : emptyBlock('Nenhum projeto encontrado', state.projects.length ? 'Ajuste a busca ou os filtros.' : 'Crie seu primeiro projeto para começar.', '□', state.projects.length ? '' : '<button class="primary-btn" data-create-project>+ Criar projeto</button>');
  renderCalendar(projectList);
  document.getElementById('deliverablesBoard').hidden = demandView !== 'board';
  document.getElementById('projectsView').hidden = demandView !== 'projects';
  document.getElementById('calendarView').hidden = demandView !== 'calendar';
  bindDynamicActions();
  hydrateClientLogos(document.getElementById('projectsView'));
}

function renderCalendar(projectList) {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const weekCount = Math.ceil((firstWeekday + daysInMonth) / 7);
  const cellCount = weekCount * 7;
  const monthLabel = calendarCursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const todayKey = localDateKey(new Date());
  const projectsByDate = new Map();
  projectList.forEach(project => {
    if (!project.due) return;
    if (!projectsByDate.has(project.due)) projectsByDate.set(project.due, []);
    projectsByDate.get(project.due).push(project);
  });
  projectsByDate.forEach(projects => projects.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));

  const cells = [];
  for (let index = 0; index < cellCount; index += 1) {
    const relativeDay = index - firstWeekday + 1;
    let cellYear = year;
    let cellMonth = month;
    let day = relativeDay;
    let outside = false;
    if (relativeDay < 1) {
      cellMonth = month - 1;
      if (cellMonth < 0) { cellMonth = 11; cellYear -= 1; }
      day = previousMonthDays + relativeDay;
      outside = true;
    } else if (relativeDay > daysInMonth) {
      cellMonth = month + 1;
      if (cellMonth > 11) { cellMonth = 0; cellYear += 1; }
      day = relativeDay - daysInMonth;
      outside = true;
    }
    const dateKey = `${cellYear}-${String(cellMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const projects = projectsByDate.get(dateKey) || [];
    cells.push(`<button class="calendar-day ${outside ? 'outside' : ''} ${dateKey === todayKey ? 'today' : ''} ${dateKey === selectedCalendarDate ? 'selected' : ''}" data-calendar-date="${dateKey}" aria-label="${day} de ${monthLabel}${projects.length ? `, ${projects.length} ${projects.length === 1 ? 'tarefa' : 'tarefas'}` : ''}">
      <span class="calendar-day-number">${day}</span>
      ${projects.length ? `<small>${projects.length} ${projects.length === 1 ? 'tarefa' : 'tarefas'}</small>` : ''}
    </button>`);
  }

  const projectsThisMonth = projectList.filter(project => {
    if (!project.due) return false;
    const [dueYear, dueMonth] = project.due.split('-').map(Number);
    return dueYear === year && dueMonth === month + 1;
  }).length;
  const selectedProjects = projectsByDate.get(selectedCalendarDate) || [];
  const selectedDate = new Date(`${selectedCalendarDate}T12:00:00`);
  const selectedDateLabel = selectedDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  document.getElementById('calendarView').innerHTML = `
    <div class="calendar-header">
      <button class="calendar-arrow" data-calendar-prev aria-label="Mês anterior">‹</button>
      <div><span class="eyebrow">ENTREGAS FINAIS</span><h2>${escapeHtml(monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1))}</h2><p>${projectsThisMonth} ${projectsThisMonth === 1 ? 'tarefa final no mês' : 'tarefas finais no mês'}</p></div>
      <button class="calendar-arrow" data-calendar-next aria-label="Próximo mês">›</button>
    </div>
    <div class="calendar-scroll">
      <div class="calendar-weekdays">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(dayName => `<span>${dayName}</span>`).join('')}</div>
      <div class="calendar-grid" style="--calendar-weeks:${weekCount}">${cells.join('')}</div>
    </div>
    <div class="calendar-selected-header"><div><span>${escapeHtml(selectedDateLabel)}</span><strong>${selectedProjects.length} ${selectedProjects.length === 1 ? 'tarefa final' : 'tarefas finais'}</strong></div><button class="outline-btn" data-calendar-today>Ir para hoje</button></div>
    <div class="calendar-selected-list">${selectedProjects.length ? selectedProjects.map(project => renderCalendarEvent(project)).join('') : '<div class="calendar-no-tasks"><span>✓</span><div><strong>Nenhuma entrega final</strong><p>Não há projetos com prazo final para este dia.</p></div></div>'}</div>`;
}

function renderCalendarEvent(project) {
  const deliverables = state.deliverables.filter(item => item.projectId === project.id);
  const complete = deliverables.length > 0 && deliverables.every(item => item.status === 'done');
  const late = !complete && dateIsPast(project.due);
  const status = complete ? 'done' : late ? 'late' : 'active';
  const deliverableCount = deliverables.length;
  return `<button class="calendar-task-detail ${status}" data-open-project="${project.id}">
    <span class="calendar-task-icon">□</span>
    <div class="calendar-task-copy">
      <span class="calendar-task-label">PROJETO</span>
      <strong>${escapeHtml(project.name)}</strong>
      <p><b>${escapeHtml(project.client)}</b><i></i>${deliverableCount} ${deliverableCount === 1 ? 'entregável' : 'entregáveis'}</p>
      <small><em>${complete ? 'Concluído' : late ? 'Atrasado' : 'Em andamento'}</em><span>Entrega final: ${formatDate(project.due)}</span></small>
    </div>
    <b>→</b>
  </button>`;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function renderDeliverableCard(deliverable) {
  const project = projectById(deliverable.projectId);
  const step = currentStep(deliverable);
  const group = groupById(step.groupId);
  const progress = deliverable.status === 'done' ? 100 : Math.round(deliverable.stepIndex / deliverable.steps.length * 100);
  const overdue = overdueDeadline(project, deliverable);
  const milestone = nextStepDeadline(deliverable);
  return `<article class="task deliverable-card ${deliverable.status === 'done' ? 'muted' : ''}" tabindex="0" data-open-deliverable="${deliverable.id}">
    <div><span class="tag ${deliverable.color}">${escapeHtml(deliverable.category)}</span>${overdue ? `<span class="overdue-pill">${overdue.kind === 'step' ? 'Etapa atrasada' : 'Atrasado'}</span>` : '<button class="task-menu" aria-label="Abrir">›</button>'}</div>
    <h3>${escapeHtml(deliverable.name)}</h3><p>${escapeHtml(project?.client || '')} · ${escapeHtml(project?.name || '')}</p>
    <div class="current-stage"><small>ETAPA ATUAL</small><strong>${escapeHtml(step.name)}</strong>${step.due ? `<span class="${dateIsPast(step.due) && deliverable.status !== 'done' ? 'late' : ''}">◷ ${formatDate(step.due)}</span>` : ''}</div>
    <div class="progress"><i style="width:${progress}%"></i></div><small>${progress}% concluído</small>
    <footer><span class="avatar small group-avatar">${escapeHtml(group.initials)}</span><span class="owner-name">${escapeHtml(group.name)}</span><time class="${milestone ? 'milestone-time' : ''}" title="${milestone ? `Próximo prazo: ${milestone.step.name}` : 'Prazo geral'}">${milestone ? `◷ ${escapeHtml(milestone.step.name)} · ${formatDate(milestone.due)}` : formatDate(deliverable.due || project?.due)}</time></footer>
  </article>`;
}

function renderProjectRow(project) {
  const deliverables = state.deliverables.filter(item => item.projectId === project.id);
  const client = clientForProject(project);
  const completed = deliverables.filter(item => item.status === 'done').length;
  const progress = deliverables.length ? Math.round(completed / deliverables.length * 100) : 0;
  return `<article class="project-row" data-open-project="${project.id}">
    <div class="project-client" style="--client-color:${escapeAttr(client?.color || '#fff0a3')}"><span>${initials(project.client)}</span>${client?.logoId ? `<img data-client-logo="${client.logoId}" alt="" hidden>` : ''}</div>
    <div class="project-main"><small>${escapeHtml(project.client)}</small><strong>${escapeHtml(project.name)}</strong><span>${deliverables.length} ${deliverables.length === 1 ? 'entregável' : 'entregáveis'} · prazo ${formatDate(project.due)}</span></div>
    <div class="project-services">${deliverables.map(item => `<span class="tag ${item.color}">${escapeHtml(item.category)}</span>`).join('')}</div>
    <div class="project-progress"><span><i style="width:${progress}%"></i></span><b>${progress}%</b></div>
  </article>`;
}

function openProjectModal(projectId = null) {
  const project = projectId ? projectById(projectId) : null;
  if (project) return openProjectDetail(project);
  if (!state.clients.length) {
    showPage('clientes');
    notify('Cadastre um cliente primeiro', 'Todo projeto precisa estar vinculado a um cliente.', '!');
    return;
  }
  const activeWorkflows = state.workflows.filter(workflow => workflow.active !== false);
  if (!activeWorkflows.length) {
    showPage('fluxos');
    return notify(state.workflows.length ? 'Ative um fluxo primeiro' : 'Crie um fluxo primeiro', state.workflows.length ? 'Um projeto precisa de pelo menos um fluxo ativo.' : 'Um projeto precisa de pelo menos um modelo de fluxo.');
  }
  const options = activeWorkflows.map(workflow => `
    <label class="service-option"><input type="checkbox" name="workflows" value="${workflow.id}"><span class="service-check">✓</span><span class="service-icon ${workflow.color}">↝</span><span><strong>${escapeHtml(workflow.name)}</strong><small>${workflow.steps.length} etapas · ${escapeHtml(workflow.category)}</small></span></label>`).join('');
  const clientOptions = [...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(client => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join('');
  openModal('Novo projeto', `
    <div class="form-grid"><label>Cliente<select name="clientId" required><option value="">Selecione um cliente</option>${clientOptions}</select></label><label>Projeto<input name="name" required maxlength="100" placeholder="Ex.: Campanha de lançamento"></label></div>
    <label>Prazo do projeto<input type="date" name="due" required><small>Esta data será aplicada automaticamente à última etapa de cada entregável.</small></label>
    <fieldset class="service-picker"><legend>Fluxos contratados</legend>${options}</fieldset>
    <p class="form-hint">Cada fluxo selecionado criará um entregável independente com todas as etapas configuradas.</p>
  `, form => {
    const selected = [...form.querySelectorAll('input[name="workflows"]:checked')].map(input => input.value);
    if (!selected.length) return false;
    const projectIdNew = uid('p');
    const now = new Date().toISOString();
    const selectedClient = clientById(field(form, 'clientId'));
    if (!selectedClient) return false;
    const newProject = { id: projectIdNew, clientId: selectedClient.id, client: selectedClient.name, name: field(form, 'name').trim(), due: field(form, 'due'), createdAt: now, updatedAt: now };
    state.projects.unshift(newProject);
    selected.forEach(workflowId => {
      const workflow = workflowById(workflowId);
      const instantiatedSteps = workflow.steps.map(([name, groupId, sourceStepId], index) => ({
        id: uid(`s${index}`), sourceStepId, name, groupId, due: '', tasks: [], note: ''
      }));
      instantiatedSteps.at(-1).due = newProject.due;
      state.deliverables.unshift({
        id: uid('d'), projectId: projectIdNew, workflowId, name: workflow.name, category: workflow.category,
        color: workflow.color, due: '', status: 'active', stepIndex: 0, createdAt: now,
        steps: instantiatedSteps, attachments: [], links: [], note: ''
      });
    });
    logActivity('Projeto criado', `${newProject.name} · ${newProject.client}`);
    saveState();
    showPage('demandas');
    notify('Projeto criado', `${selected.length} ${selected.length === 1 ? 'entregável foi criado' : 'entregáveis foram criados'}.`);
    return true;
  }, 'Criar projeto', form => {
    const submit = form.querySelector('[type="submit"]');
    const validate = () => submit.disabled = !form.querySelector('input[name="workflows"]:checked');
    form.querySelectorAll('input[name="workflows"]').forEach(input => input.addEventListener('change', validate));
    validate();
  });
}

function openProjectDetail(project) {
  const deliverables = state.deliverables.filter(item => item.projectId === project.id);
  const clientOptions = [...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(client => `<option value="${client.id}" ${client.id === project.clientId ? 'selected' : ''}>${escapeHtml(client.name)}</option>`).join('');
  openModal(`Projeto: ${project.name}`, `
    <div class="form-grid"><label>Cliente<select name="clientId" required>${clientOptions}</select></label><label>Nome do projeto<input name="name" required value="${escapeAttr(project.name)}"></label></div>
    <label>Prazo<input type="date" name="due" required value="${escapeAttr(project.due)}"><small>Ao alterar, as etapas finais ainda sincronizadas serão atualizadas.</small></label>
    <div class="modal-section-title">ENTREGÁVEIS</div>
    <div class="project-deliverables">${deliverables.map(item => `<button type="button" data-jump-deliverable="${item.id}"><span class="tag ${item.color}">${escapeHtml(item.category)}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(currentStep(item).name)}</small><b>→</b></button>`).join('')}</div>
    <button type="button" class="danger-link" data-delete-project="${project.id}">Excluir projeto e entregáveis</button>
  `, form => {
    const previousProjectDue = project.due;
    const selectedClient = clientById(field(form, 'clientId'));
    if (!selectedClient) return false;
    project.clientId = selectedClient.id;
    project.client = selectedClient.name;
    project.name = field(form, 'name').trim();
    project.due = field(form, 'due');
    project.updatedAt = new Date().toISOString();
    deliverables.forEach(item => {
      const finalStep = item.steps.at(-1);
      if (finalStep && (!finalStep.due || finalStep.due === previousProjectDue)) finalStep.due = project.due;
    });
    logActivity('Projeto atualizado', project.name);
    saveState();
    notify('Projeto atualizado', 'As alterações foram salvas.');
    return true;
  }, 'Salvar alterações', form => {
    form.querySelectorAll('[data-jump-deliverable]').forEach(button => button.onclick = () => { closeModal(); openDeliverable(button.dataset.jumpDeliverable); });
    form.querySelector('[data-delete-project]').onclick = () => confirmAction('Excluir projeto?', 'Todos os entregáveis, etapas e tarefas deste projeto serão removidos.', () => {
      deleteStoredAttachments(state.deliverables.filter(item => item.projectId === project.id));
      state.projects = state.projects.filter(item => item.id !== project.id);
      state.deliverables = state.deliverables.filter(item => item.projectId !== project.id);
      logActivity('Projeto excluído', project.name);
      saveState(); closeModal(); notify('Projeto excluído', 'Os dados do projeto foram removidos.');
    });
  });
}

function attachmentIcon(attachment) {
  if (attachment.type?.startsWith('image/')) return 'IMG';
  if (attachment.type?.startsWith('video/')) return '▶';
  return 'PDF';
}
function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
function isAcceptedAttachment(file) {
  return file.type.startsWith('image/') || file.type.startsWith('video/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
function renderDeliverableAttachments(deliverable) {
  const attachments = deliverable.attachments || [];
  return `<section class="deliverable-attachments">
    <div class="attachment-heading"><div><span class="modal-section-title">ANEXOS DO ENTREGÁVEL</span><small>Os arquivos acompanham o trabalho em todas as etapas.</small></div><b>${attachments.length}</b></div>
    ${attachments.length ? `<div class="attachment-list">${attachments.map(attachment => `<article class="attachment-item" data-preview-attachment="${attachment.id}" role="button" tabindex="0" draggable="true" aria-label="Visualizar ${escapeAttr(attachment.name)}. Segure e arraste para reordenar.">
      <span class="attachment-icon">${attachmentIcon(attachment)}</span>
      <div><strong title="${escapeAttr(attachment.name)}">${escapeHtml(attachment.name)}</strong><small>${formatFileSize(attachment.size)} · enviado em ${escapeHtml(attachment.stepName || 'Etapa anterior')}</small></div>
      <button type="button" data-rename-attachment="${attachment.id}" aria-label="Renomear ${escapeAttr(attachment.name)}" title="Renomear anexo">✎</button>
      <button type="button" data-download-attachment="${attachment.id}" aria-label="Baixar ${escapeAttr(attachment.name)}" title="Baixar anexo">↓</button>
      <button type="button" data-delete-attachment="${attachment.id}" aria-label="Remover ${escapeAttr(attachment.name)}" title="Remover anexo">×</button>
    </article>`).join('')}</div>` : '<p class="attachment-empty">Nenhum arquivo anexado até o momento.</p>'}
    <label class="attachment-upload"><input type="file" accept="image/*,application/pdf,video/*,.pdf" multiple><span>＋</span><div><strong>Anexar arquivos</strong><small>Imagens, PDF ou vídeos · até 100 MB por arquivo</small></div></label>
  </section>`;
}

function extractObservationLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi) || [];
  return [...new Set(matches.map(link => link.replace(/[.,;:!?)}\]]+$/g, '')))]
    .map(label => {
      const href = /^https?:\/\//i.test(label) ? label : `https://${label}`;
      return { label, href, name: observationLinkName(href) };
    });
}
function linkifyObservationText(text) {
  const source = String(text || '');
  const pattern = /(?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi;
  let html = '';
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(source))) {
    const raw = match[0];
    const label = raw.replace(/[.,;:!?)}\]]+$/g, '');
    const trailing = raw.slice(label.length);
    const href = /^https?:\/\//i.test(label) ? label : `https://${label}`;
    html += escapeHtml(source.slice(lastIndex, match.index));
    html += `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" contenteditable="false">${escapeHtml(label)}</a>${escapeHtml(trailing)}`;
    lastIndex = match.index + raw.length;
  }
  return html + escapeHtml(source.slice(lastIndex));
}
function observationLinkName(href) {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === 'docs.google.com') {
      if (path.includes('/document/')) return 'Documento no Google Docs';
      if (path.includes('/spreadsheets/')) return 'Planilha no Google Sheets';
      if (path.includes('/presentation/')) return 'Apresentação no Google Slides';
      if (path.includes('/forms/')) return 'Formulário no Google Forms';
      return 'Arquivo no Google Docs';
    }
    if (host === 'drive.google.com') return path.includes('/folders/') ? 'Pasta no Google Drive' : 'Arquivo no Google Drive';
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'Vídeo do YouTube';
    if (host.endsWith('figma.com')) return 'Arquivo no Figma';
    if (host.endsWith('canva.com')) return 'Design no Canva';
    if (host.endsWith('notion.so') || host.endsWith('notion.site')) return 'Página no Notion';
    if (host.endsWith('instagram.com')) return path.includes('/reel/') ? 'Reel do Instagram' : 'Publicação no Instagram';
    if (host.endsWith('linkedin.com')) return 'Conteúdo no LinkedIn';
    if (host.endsWith('dropbox.com')) return 'Arquivo no Dropbox';
    if (host.endsWith('vimeo.com')) return 'Vídeo do Vimeo';
    if (/\.pdf$/i.test(path)) return 'Documento PDF';
    return `Link de ${host}`;
  } catch (_) {
    return 'Link externo';
  }
}
function observationLinkKey(href) {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}${url.hash}`.toLowerCase();
  } catch (_) {
    return String(href).toLowerCase();
  }
}
function syncDeliverableObservation(deliverable, text, step) {
  deliverable.note = String(text || '').trim();
}
function syncDeliverableLinks(deliverable, text, step) {
  syncDeliverableObservation(deliverable, text, step);
  deliverable.links ||= [];
  const existing = new Set(deliverable.links.map(link => observationLinkKey(link.href)));
  extractObservationLinks(text).forEach(link => {
    const key = observationLinkKey(link.href);
    if (existing.has(key)) return;
    deliverable.links.push({
      id: uid('link'),
      href: link.href,
      label: link.label,
      name: link.name,
      stepIndex: deliverable.stepIndex,
      stepName: step.name,
      createdAt: new Date().toISOString()
    });
    existing.add(key);
  });
}
function observationLinksForDisplay(text, savedLinks = []) {
  const links = [...savedLinks];
  const existing = new Set(links.map(link => observationLinkKey(link.href)));
  extractObservationLinks(text).forEach(link => {
    const key = observationLinkKey(link.href);
    if (!existing.has(key)) links.push(link);
    existing.add(key);
  });
  return links;
}
function renderObservationLinks(text, savedLinks = []) {
  const links = observationLinksForDisplay(text, savedLinks);
  return links.length ? `<div class="observation-link-list"><span>LINKS DO ENTREGÁVEL</span>${links.map(link => `<a href="${escapeAttr(link.href)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(link.label)}"><b>↗</b><span><strong>${escapeHtml(link.name || observationLinkName(link.href))}</strong><small>${escapeHtml(link.label || link.href)}${link.stepName ? ` · adicionado em ${escapeHtml(link.stepName)}` : ''}</small></span></a>`).join('')}</div>` : '';
}
async function openAttachmentPreview(attachment) {
  try {
    const file = await getAttachmentFile(attachment.id);
    if (!file) return notify('Arquivo indisponível', 'Este anexo não está salvo neste navegador.', '!');
    const url = URL.createObjectURL(file);
    const layer = document.createElement('div');
    layer.className = 'attachment-preview-layer';
    layer.innerHTML = `<section class="attachment-preview">
      <header><div><small>VISUALIZAÇÃO DO ANEXO</small><strong>${escapeHtml(attachment.name)}</strong></div><button type="button" data-close-preview aria-label="Fechar visualização">×</button></header>
      <div class="attachment-preview-content"></div>
      <footer><span>${formatFileSize(attachment.size)}</span><a href="${url}" download="${escapeAttr(attachment.name)}">↓ Baixar arquivo</a></footer>
    </section>`;
    const content = layer.querySelector('.attachment-preview-content');
    let media;
    if (attachment.type?.startsWith('image/')) {
      media = document.createElement('img');
      media.alt = attachment.name;
    } else if (attachment.type?.startsWith('video/')) {
      media = document.createElement('video');
      media.controls = true;
      media.preload = 'metadata';
    } else {
      media = document.createElement('iframe');
      media.title = `Visualização de ${attachment.name}`;
    }
    media.src = url;
    content.appendChild(media);
    const close = () => {
      media.pause?.();
      URL.revokeObjectURL(url);
      layer.remove();
    };
    layer.querySelector('[data-close-preview]').onclick = close;
    layer.onclick = event => { if (event.target === layer) close(); };
    document.body.appendChild(layer);
    layer.querySelector('[data-close-preview]').focus();
  } catch (_) {
    notify('Arquivo indisponível', 'Não foi possível visualizar este anexo.', '!');
  }
}
function attachmentNameParts(name) {
  const extensionIndex = name.lastIndexOf('.');
  if (extensionIndex <= 0) return { base: name, extension: '' };
  return { base: name.slice(0, extensionIndex), extension: name.slice(extensionIndex) };
}
function openAttachmentRenameDialog(deliverable, attachment, project, step, deliverableForm) {
  const currentModal = document.querySelector('.doti-modal');
  if (!currentModal) return;
  const { base, extension } = attachmentNameParts(attachment.name);
  const layer = document.createElement('div');
  layer.className = 'confirm-layer';
  layer.innerHTML = `<div class="rename-attachment-dialog">
    <h3>Renomear arquivo</h3>
    <p>A extensão será mantida para preservar o formato original.</p>
    <label>Novo nome<div class="rename-file-control"><input maxlength="120" value="${escapeAttr(base)}"><span>${escapeHtml(extension)}</span></div><small>Use um nome que facilite encontrar este anexo depois.</small></label>
    <footer><button type="button" class="outline-btn" data-cancel>Cancelar</button><button type="button" class="primary-btn" data-confirm>Salvar nome</button></footer>
  </div>`;
  currentModal.appendChild(layer);
  const input = layer.querySelector('input');
  layer.querySelector('[data-cancel]').onclick = () => layer.remove();
  layer.querySelector('[data-confirm]').onclick = () => {
    const nextBase = input.value.trim().replace(/[\\/:*?"<>|]/g, '-');
    if (!nextBase) {
      input.classList.add('invalid');
      input.focus();
      return;
    }
    const previousName = attachment.name;
    attachment.name = `${nextBase}${extension}`;
    step.note = field(deliverableForm, 'note').trim();
    syncDeliverableLinks(deliverable, step.note, step);
    project.updatedAt = new Date().toISOString();
    logActivity('Anexo renomeado', `${previousName} → ${attachment.name}`);
    saveState();
    closeModal();
    openDeliverable(deliverable.id);
    notify('Arquivo renomeado', attachment.name);
  };
  input.oninput = () => input.classList.remove('invalid');
  input.onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      layer.querySelector('[data-confirm]').click();
    }
  };
  input.focus();
  input.select();
}

function openDeliverable(id) {
  const deliverable = state.deliverables.find(item => item.id === id);
  if (!deliverable) return;
  const project = projectById(deliverable.projectId);
  const step = currentStep(deliverable);
  const group = groupById(step.groupId);
  const allTasksDone = step.tasks.length === 0 || step.tasks.every(task => task.done);
  const milestone = nextStepDeadline(deliverable);
  const isApprovalStep = deliverable.status !== 'done' && deliverable.stepIndex > 0 && macroStatus(deliverable) === 'approval';
  openModal(deliverable.name, `
    <div class="deliverable-context"><span class="tag ${deliverable.color}">${escapeHtml(deliverable.category)}</span><strong>${escapeHtml(project.client)}</strong><span>${escapeHtml(project.name)}</span></div>
    <div class="stage-focus"><small>ETAPA ATUAL · ${deliverable.stepIndex + 1} DE ${deliverable.steps.length}</small><h3>${escapeHtml(step.name)}</h3><p>Responsável: <strong>${escapeHtml(group.name)}</strong>${step.due ? ` · Prazo: <strong>${formatDate(step.due)}</strong>` : ''}</p></div>
    <div class="task-manager">
      <div class="modal-section-title">TAREFAS DESTA ETAPA</div>
      <div class="step-tasks">${step.tasks.length ? step.tasks.map(task => `<label class="check-task"><input type="checkbox" data-task-id="${task.id}" ${task.done ? 'checked' : ''}><span></span><b>${escapeHtml(task.title)}</b><button type="button" data-delete-task="${task.id}" aria-label="Excluir tarefa">×</button></label>`).join('') : '<p class="inline-empty">Nenhuma tarefa adicionada. Você pode avançar a etapa ou detalhar o trabalho abaixo.</p>'}</div>
      <div class="add-task-row"><input id="newTaskTitle" maxlength="120" placeholder="Adicionar tarefa específica"><button type="button" class="outline-btn" id="addTaskButton">Adicionar</button></div>
    </div>
    <label class="stage-observation-field"><span>Observações do entregável</span><div class="observation-editor" data-note-editor contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Briefing, links, decisões ou orientações">${linkifyObservationText(deliverable.note || '')}</div><textarea name="note" hidden>${escapeHtml(deliverable.note || '')}</textarea></label>
    <div class="observation-links" data-observation-links ${observationLinksForDisplay(deliverable.note, deliverable.links).length ? '' : 'hidden'}>${renderObservationLinks(deliverable.note, deliverable.links)}</div>
    ${renderDeliverableAttachments(deliverable)}
    <div class="schedule-head"><div><span class="modal-section-title">CRONOGRAMA DAS ETAPAS</span><small>Datas opcionais — preencha somente os marcos que precisar</small></div>${milestone ? `<b>Próximo: ${escapeHtml(milestone.step.name)} · ${formatDate(milestone.due)}</b>` : '<b>Nenhuma data definida</b>'}</div>
    <div class="step-timeline compact-timeline">${deliverable.steps.map((item, index) => `<div class="step-line ${index < deliverable.stepIndex ? 'complete' : index === deliverable.stepIndex ? 'active' : ''} ${item.due && dateIsPast(item.due) && index >= deliverable.stepIndex && deliverable.status !== 'done' ? 'late-step' : ''}"><i>${index < deliverable.stepIndex ? '✓' : index + 1}</i><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(groupById(item.groupId).name)}</small></div><label class="step-date-control"><span>${item.due ? 'Prazo' : 'Sem data'}</span><input type="date" data-step-date="${item.id}" value="${escapeAttr(item.due || '')}" aria-label="Prazo de ${escapeAttr(item.name)}"></label></div>`).join('')}</div>
    <div class="deliverable-secondary-actions"><button type="button" data-edit-deliverable>Editar entregável</button><button type="button" class="danger-link" data-delete-deliverable>Excluir entregável</button></div>
  `, form => {
    step.note = field(form, 'note').trim();
    syncDeliverableLinks(deliverable, step.note, step);
    if (deliverable.status === 'done') {
      saveState();
      notify('Observação salva', 'As informações do entregável foram atualizadas.');
      return true;
    }
    if (!allTasksDone && step.tasks.some(task => !task.done)) {
      notify('Há tarefas pendentes', 'Conclua todas as tarefas antes de avançar.', '!');
      return false;
    }
    if (deliverable.stepIndex < deliverable.steps.length - 1) {
      deliverable.stepIndex += 1;
      deliverable.status = 'active';
      project.updatedAt = new Date().toISOString();
      logActivity('Etapa concluída', `${deliverable.name} → ${currentStep(deliverable).name}`);
      saveState();
      notify('Etapa concluída', `Agora em ${currentStep(deliverable).name}.`);
    } else {
      deliverable.status = 'done';
      project.updatedAt = new Date().toISOString();
      logActivity('Entregável concluído', deliverable.name);
      saveState();
      notify('Entregável concluído', `${deliverable.name} foi finalizado.`);
    }
    return true;
  }, deliverable.status === 'done' ? 'Salvar observação' : isApprovalStep ? 'Aprovar e avançar' : deliverable.stepIndex === deliverable.steps.length - 1 ? 'Concluir entregável' : 'Concluir etapa e avançar', form => {
    if (isApprovalStep) {
      const rejectButton = document.createElement('button');
      rejectButton.type = 'button';
      rejectButton.className = 'reject-step-btn';
      rejectButton.textContent = 'Recusar e devolver';
      form.querySelector(':scope > footer').insertBefore(rejectButton, form.querySelector(':scope > footer .primary-btn'));
      rejectButton.onclick = () => openRejectionDialog(deliverable, project, step, form);
    }
    const noteInput = form.elements.namedItem('note');
    const noteEditor = form.querySelector('[data-note-editor]');
    const observationLinks = form.querySelector('[data-observation-links]');
    const updateObservationValue = () => {
      noteInput.value = noteEditor.innerText.replace(/\u00a0/g, ' ');
      const linksHtml = renderObservationLinks(noteInput.value, deliverable.links);
      observationLinks.innerHTML = linksHtml;
      observationLinks.hidden = !linksHtml;
    };
    noteEditor.addEventListener('input', updateObservationValue);
    noteEditor.addEventListener('blur', () => {
      updateObservationValue();
      noteEditor.innerHTML = linkifyObservationText(noteInput.value);
    });
    noteEditor.addEventListener('paste', event => {
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    });
    noteEditor.addEventListener('pointerdown', event => {
      const link = event.target.closest('a');
      if (!link) return;
      event.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
    });
    const attachmentZone = form.querySelector('.deliverable-attachments');
    const attachmentInput = attachmentZone.querySelector('.attachment-upload input[type="file"]');
    const uploadAttachments = async files => {
      let uploaded = 0;
      for (const file of files) {
        if (!isAcceptedAttachment(file)) {
          notify('Formato não permitido', `${file.name} não é uma imagem, PDF ou vídeo.`, '!');
          continue;
        }
        if (file.size > MAX_ATTACHMENT_SIZE) {
          notify('Arquivo muito grande', `${file.name} ultrapassa o limite de 100 MB.`, '!');
          continue;
        }
        try {
          const attachmentId = uid('att');
          await storeAttachmentFile(attachmentId, file);
          deliverable.attachments.push({
            id: attachmentId,
            name: file.name,
            type: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream'),
            size: file.size,
            createdAt: new Date().toISOString(),
            stepIndex: deliverable.stepIndex,
            stepName: step.name
          });
          uploaded += 1;
        } catch (_) {
          notify('Não foi possível anexar', `O navegador não conseguiu salvar ${file.name}.`, '!');
        }
      }
      attachmentInput.value = '';
      if (!uploaded) return;
      step.note = field(form, 'note').trim();
      syncDeliverableLinks(deliverable, step.note, step);
      project.updatedAt = new Date().toISOString();
      logActivity('Arquivos anexados', `${uploaded} ${uploaded === 1 ? 'arquivo' : 'arquivos'} · ${deliverable.name}`);
      saveState();
      closeModal();
      openDeliverable(id);
      notify('Anexos adicionados', `${uploaded} ${uploaded === 1 ? 'arquivo acompanha' : 'arquivos acompanham'} o entregável.`);
    };
    attachmentInput.onchange = () => uploadAttachments([...attachmentInput.files]);
    const hasExternalFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
    attachmentZone.ondragenter = event => {
      if (!hasExternalFiles(event)) return;
      event.preventDefault();
      attachmentZone.classList.add('receiving-files');
    };
    attachmentZone.ondragover = event => {
      if (!hasExternalFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      attachmentZone.classList.add('receiving-files');
    };
    attachmentZone.ondragleave = event => {
      if (!attachmentZone.contains(event.relatedTarget)) attachmentZone.classList.remove('receiving-files');
    };
    attachmentZone.ondrop = event => {
      if (!hasExternalFiles(event)) return;
      event.preventDefault();
      attachmentZone.classList.remove('receiving-files');
      uploadAttachments([...event.dataTransfer.files]);
    };
    const attachmentList = form.querySelector('.attachment-list');
    let draggedAttachmentItem = null;
    let attachmentWasDragged = false;
    const saveAttachmentOrder = () => {
      if (!attachmentList) return;
      const ids = [...attachmentList.querySelectorAll('[data-preview-attachment]')].map(item => item.dataset.previewAttachment);
      const currentIds = deliverable.attachments.map(item => item.id);
      if (ids.join('|') === currentIds.join('|')) return;
      const attachmentsById = new Map(deliverable.attachments.map(item => [item.id, item]));
      deliverable.attachments = ids.map(attachmentId => attachmentsById.get(attachmentId)).filter(Boolean);
      project.updatedAt = new Date().toISOString();
      logActivity('Anexos reordenados', deliverable.name);
      saveState();
      notify('Ordem atualizada', 'A nova ordem dos anexos foi salva.');
    };
    form.querySelectorAll('[data-preview-attachment]').forEach(item => {
      const preview = event => {
        if (event.target.closest('button') || attachmentWasDragged) return;
        const attachment = deliverable.attachments.find(entry => entry.id === item.dataset.previewAttachment);
        if (attachment) openAttachmentPreview(attachment);
      };
      item.onclick = preview;
      item.onkeydown = event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
          event.preventDefault();
          preview(event);
        }
      };
      item.ondragstart = event => {
        if (event.target.closest('button')) {
          event.preventDefault();
          return;
        }
        draggedAttachmentItem = item;
        attachmentWasDragged = true;
        item.classList.add('dragging');
        attachmentList?.classList.add('reordering');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.dataset.previewAttachment);
      };
      item.ondragover = event => {
        if (!draggedAttachmentItem || draggedAttachmentItem === item) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const box = item.getBoundingClientRect();
        const insertAfter = event.clientY > box.top + box.height / 2;
        attachmentList.insertBefore(draggedAttachmentItem, insertAfter ? item.nextSibling : item);
      };
      item.ondrop = event => {
        if (!draggedAttachmentItem) return;
        event.preventDefault();
        saveAttachmentOrder();
      };
      item.ondragend = () => {
        item.classList.remove('dragging');
        attachmentList?.classList.remove('reordering');
        draggedAttachmentItem = null;
        saveAttachmentOrder();
        setTimeout(() => { attachmentWasDragged = false; }, 0);
      };
    });
    form.querySelectorAll('[data-rename-attachment]').forEach(button => button.onclick = () => {
      const attachment = deliverable.attachments.find(item => item.id === button.dataset.renameAttachment);
      if (attachment) openAttachmentRenameDialog(deliverable, attachment, project, step, form);
    });
    form.querySelectorAll('[data-download-attachment]').forEach(button => button.onclick = async () => {
      const attachment = deliverable.attachments.find(item => item.id === button.dataset.downloadAttachment);
      if (!attachment) return;
      try {
        const file = await getAttachmentFile(attachment.id);
        if (!file) return notify('Arquivo indisponível', 'Este anexo não está salvo neste navegador.', '!');
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (_) {
        notify('Arquivo indisponível', 'Não foi possível abrir este anexo.', '!');
      }
    });
    form.querySelectorAll('[data-delete-attachment]').forEach(button => button.onclick = () => {
      const attachment = deliverable.attachments.find(item => item.id === button.dataset.deleteAttachment);
      if (!attachment) return;
      confirmAction('Remover anexo?', `${attachment.name} será removido de todas as etapas deste entregável.`, async () => {
        try {
          await deleteAttachmentFile(attachment.id);
          deliverable.attachments = deliverable.attachments.filter(item => item.id !== attachment.id);
          step.note = field(form, 'note').trim();
          syncDeliverableLinks(deliverable, step.note, step);
          project.updatedAt = new Date().toISOString();
          logActivity('Anexo removido', `${attachment.name} · ${deliverable.name}`);
          saveState();
          closeModal();
          openDeliverable(id);
          notify('Anexo removido', `${attachment.name} não acompanha mais o entregável.`);
        } catch (_) {
          notify('Não foi possível remover', 'Tente novamente.', '!');
        }
      });
    });
    form.querySelectorAll('[data-step-date]').forEach(input => input.onchange = () => {
      const targetStep = deliverable.steps.find(item => item.id === input.dataset.stepDate);
      const previous = targetStep.due || '';
      targetStep.due = input.value;
      project.updatedAt = new Date().toISOString();
      logActivity(input.value ? 'Prazo de etapa definido' : 'Prazo de etapa removido', `${targetStep.name}${input.value ? ` · ${formatDate(input.value)}` : ''}`);
      saveState();
      notify(input.value ? 'Prazo salvo' : 'Prazo removido', input.value ? `${targetStep.name} deve ficar pronto em ${formatDate(input.value)}.` : `${targetStep.name} voltou a ficar sem data.`);
      if (previous !== input.value) {
        closeModal();
        openDeliverable(id);
      }
    });
    form.querySelectorAll('[data-task-id]').forEach(input => input.onchange = () => {
      const task = step.tasks.find(item => item.id === input.dataset.taskId);
      task.done = input.checked;
      logActivity(input.checked ? 'Tarefa concluída' : 'Tarefa reaberta', task.title);
      saveState();
      closeModal(); openDeliverable(id);
    });
    form.querySelectorAll('[data-delete-task]').forEach(button => button.onclick = () => {
      step.tasks = step.tasks.filter(task => task.id !== button.dataset.deleteTask);
      saveState(); closeModal(); openDeliverable(id);
    });
    const addTask = () => {
      const input = form.querySelector('#newTaskTitle');
      const title = input.value.trim();
      if (!title) return input.focus();
      step.tasks.push({ id: uid('t'), title, done: false });
      logActivity('Tarefa criada', `${title} · ${deliverable.name}`);
      saveState(); closeModal(); openDeliverable(id);
    };
    form.querySelector('#addTaskButton').onclick = addTask;
    form.querySelector('#newTaskTitle').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); addTask(); } };
    form.querySelector('[data-edit-deliverable]').onclick = () => openEditDeliverable(deliverable);
    form.querySelector('[data-delete-deliverable]').onclick = () => confirmAction('Excluir entregável?', 'As etapas e tarefas deste entregável serão removidas.', () => {
      deleteStoredAttachments([deliverable]);
      state.deliverables = state.deliverables.filter(item => item.id !== deliverable.id);
      const remains = state.deliverables.some(item => item.projectId === project.id);
      if (!remains) state.projects = state.projects.filter(item => item.id !== project.id);
      logActivity('Entregável excluído', deliverable.name);
      saveState(); closeModal(); notify('Entregável excluído', 'O item foi removido da operação.');
    });
  });
}

function openEditDeliverable(deliverable) {
  openModal('Editar entregável', `
    <label>Nome<input name="name" required maxlength="120" value="${escapeAttr(deliverable.name)}"></label>
    <label>Prazo específico<input type="date" name="due" value="${escapeAttr(deliverable.due || '')}"></label>
    <p class="form-hint">Se o prazo específico ficar vazio, será usado o prazo do projeto.</p>
  `, form => {
    deliverable.name = field(form, 'name').trim();
    deliverable.due = field(form, 'due');
    logActivity('Entregável atualizado', deliverable.name);
    saveState(); notify('Entregável atualizado', 'As alterações foram salvas.');
    return true;
  }, 'Salvar');
}

function renderWorkflows() {
  const usedGroups = new Set([
    ...state.workflows.flatMap(workflow => workflow.steps.map(step => step[1])),
    ...state.deliverables.flatMap(deliverable => deliverable.steps.map(step => step.groupId))
  ]);
  document.getElementById('workflowStats').innerHTML = [
    [state.workflows.filter(workflow => workflow.active !== false).length, 'modelos ativos'], [state.groups.length, 'grupos disponíveis'],
    [state.workflows.reduce((sum, flow) => sum + flow.steps.length, 0), 'etapas configuradas']
  ].map(([value, label]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join('');

  document.getElementById('workflowGrid').innerHTML = state.workflows.length
    ? state.workflows.map(workflow => {
      const isActive = workflow.active !== false;
      return `
      <article class="workflow-card ${isActive ? '' : 'workflow-card-disabled'}" ${isActive ? `data-edit-workflow="${workflow.id}"` : ''} aria-disabled="${!isActive}">
        <header><span class="workflow-icon ${workflow.color}">↝</span><button type="button" class="workflow-status-toggle ${isActive ? 'active' : 'inactive'}" data-toggle-workflow="${workflow.id}" data-tooltip="${isActive ? 'Clique para desativar' : 'Clique para ativar'}" aria-label="${isActive ? `Desativar ${escapeAttr(workflow.name)}` : `Ativar ${escapeAttr(workflow.name)}`}">${isActive ? 'Ativo' : 'Desativado'}</button></header>
        <h2>${escapeHtml(workflow.name)}</h2><p>${escapeHtml(workflow.description || 'Sem descrição')}</p>
        <div class="workflow-meta"><span><b>${workflow.steps.length}</b> etapas</span><span><b>${new Set(workflow.steps.map(step => step[1])).size}</b> grupos</span></div>
        <div class="flow-preview">${workflow.steps.slice(0, 4).map(([name], index) => `<span>${escapeHtml(name)}</span>${index < Math.min(workflow.steps.length, 4) - 1 ? '<i>›</i>' : ''}`).join('')}${workflow.steps.length > 4 ? `<em>+${workflow.steps.length - 4}</em>` : ''}</div>
        <footer><span>${isActive ? 'Editar modelo' : 'Fluxo indisponível'}</span><button class="view-flow" ${isActive ? '' : 'disabled'}>${isActive ? 'Abrir →' : 'Desativado'}</button></footer>
      </article>`;
    }).join('')
    : `<div class="full-empty">${emptyBlock('Nenhum fluxo configurado', 'Crie um modelo com as etapas usadas pela sua agência.', '↝', '<button class="primary-btn" data-create-workflow>+ Criar fluxo</button>')}</div>`;

  document.getElementById('groupsPanel').innerHTML = `
    <div class="groups-intro"><div><h2>Grupos responsáveis</h2><p>Os grupos são atribuídos às etapas dos fluxos.</p></div><button class="outline-btn" data-create-group>+ Novo grupo</button></div>
    <div class="group-grid">${state.groups.map(group => {
      const useCount = state.workflows.reduce((sum, workflow) => sum + workflow.steps.filter(step => step[1] === group.id).length, 0);
      return `<article class="group-card"><span class="avatar">${escapeHtml(group.initials)}</span><div><strong>${escapeHtml(group.name)}</strong><small>${useCount} ${useCount === 1 ? 'etapa vinculada' : 'etapas vinculadas'}</small></div><button data-delete-group="${group.id}" title="${usedGroups.has(group.id) ? 'Reatribuir etapas e excluir' : 'Excluir grupo'}" aria-label="Excluir ${escapeAttr(group.name)}">×</button></article>`;
    }).join('')}</div>`;
  document.getElementById('workflowGrid').hidden = flowView !== 'models';
  document.getElementById('groupsPanel').hidden = flowView !== 'groups';
  bindDynamicActions();
}

function workflowGroupOptions(selectedId) {
  return state.groups.map(group => `<option value="${group.id}" ${group.id === selectedId ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('');
}

function workflowStepRow(name = '', groupId = '', stepId = '') {
  const fallbackGroup = state.groups.find(group => normalize(group.name) === 'atendimento') || state.groups[0];
  const selectedGroup = groupId || fallbackGroup?.id || '';
  return `<div class="workflow-step-row" data-workflow-step-row data-workflow-step-id="${escapeAttr(stepId || uid('ws'))}" draggable="true" title="Clique e segure o card para mover">
    <span class="workflow-drag-handle" title="Card arrastável" aria-hidden="true">⋮⋮</span>
    <span class="workflow-step-number"></span>
    <label><span>Nome da etapa</span><input data-workflow-step-name required maxlength="80" value="${escapeAttr(name)}" placeholder="Ex.: Briefing"></label>
    <label><span>Grupo responsável</span><select data-workflow-step-group required>${workflowGroupOptions(selectedGroup)}</select></label>
    <div class="workflow-step-actions">
      <button type="button" data-step-action="up" title="Mover para cima" aria-label="Mover etapa para cima">↑</button>
      <button type="button" data-step-action="down" title="Mover para baixo" aria-label="Mover etapa para baixo">↓</button>
      <button type="button" data-step-action="remove" class="remove" title="Remover etapa" aria-label="Remover etapa">×</button>
    </div>
  </div>`;
}

function refreshWorkflowStepRows(form) {
  const rows = [...form.querySelectorAll('[data-workflow-step-row]')];
  rows.forEach((row, index) => {
    row.querySelector('.workflow-step-number').textContent = index + 1;
    row.querySelector('[data-step-action="up"]').disabled = index === 0;
    row.querySelector('[data-step-action="down"]').disabled = index === rows.length - 1;
    row.querySelector('[data-step-action="remove"]').disabled = rows.length <= 2;
  });
}

function openWorkflowModal(workflowId = null) {
  const workflow = workflowId ? workflowById(workflowId) : null;
  const fallbackGroupId = (state.groups.find(group => normalize(group.name) === 'atendimento') || state.groups[0])?.id || '';
  const initialSteps = workflow?.steps?.length ? workflow.steps : [['', fallbackGroupId], ['', fallbackGroupId]];
  openModal(workflow ? 'Editar fluxo' : 'Novo fluxo', `
    <div class="form-grid"><label>Nome do fluxo<input name="name" required maxlength="100" value="${escapeAttr(workflow?.name || '')}" placeholder="Ex.: Gestão de tráfego"></label><label>Categoria<input name="category" required maxlength="40" value="${escapeAttr(workflow?.category || '')}" placeholder="Ex.: Mídia"></label></div>
    <label>Descrição<input name="description" maxlength="160" value="${escapeAttr(workflow?.description || '')}" placeholder="Quando este fluxo deve ser usado"></label>
    <div class="workflow-builder">
      <div class="workflow-builder-head">
        <div class="workflow-builder-copy"><strong>Etapas do fluxo</strong><span>Escreva cada etapa e escolha um grupo já cadastrado.</span></div>
        <div class="workflow-builder-tools">
          <button type="button" class="workflow-preview-toggle" data-workflow-preview-toggle aria-expanded="false" title="Visualizar estrutura do fluxo" aria-label="Visualizar estrutura do fluxo">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.8"></circle></svg>
          </button>
          <b data-workflow-step-count>${initialSteps.length} etapas</b>
        </div>
      </div>
      <section class="workflow-visual-preview" data-workflow-visual-preview hidden>
        <header><div><strong>Estrutura do fluxo</strong><span>Prévia da sequência configurada</span></div><em>Somente visualização</em></header>
        <div class="workflow-visual-track" data-workflow-visual-track></div>
      </section>
      <div class="workflow-step-list" data-workflow-step-list>${initialSteps.map(([name, groupId, stepId]) => workflowStepRow(name, groupId, stepId)).join('')}</div>
      <button type="button" class="add-workflow-step" data-add-workflow-step>+ Adicionar etapa</button>
    </div>
    <p class="form-hint">Use as setas para ajustar a ordem. O fluxo precisa ter pelo menos duas etapas.</p>
    ${workflow ? `<button type="button" class="danger-link" data-delete-workflow="${workflow.id}">Excluir este fluxo</button>` : ''}
  `, form => {
    const stepRows = [...form.querySelectorAll('[data-workflow-step-row]')];
    if (stepRows.length < 2) return notify('Revise as etapas', 'Informe pelo menos duas etapas.'), false;
    const steps = stepRows.map(row => [
      row.querySelector('[data-workflow-step-name]').value.trim(),
      row.querySelector('[data-workflow-step-group]').value,
      row.dataset.workflowStepId
    ]);
    if (steps.some(([name]) => !name)) return notify('Revise as etapas', 'Todas as etapas precisam de um nome.'), false;
    const data = {
      id: workflow?.id || uid('wf'), name: field(form, 'name').trim(), category: field(form, 'category').trim(),
      description: field(form, 'description').trim(), color: workflow?.color || COLORS[state.workflows.length % COLORS.length],
      active: workflow?.active !== false,
      steps
    };
    let syncedDeliverables = 0;
    if (workflow) {
      Object.assign(workflow, data);
      syncedDeliverables = syncActiveDeliverablesWithWorkflow(workflow);
    } else {
      state.workflows.push(data);
    }
    logActivity(workflow ? 'Fluxo atualizado' : 'Fluxo criado', data.name);
    saveState();
    const syncMessage = syncedDeliverables ? ` ${syncedDeliverables} ${syncedDeliverables === 1 ? 'entregável ativo foi atualizado' : 'entregáveis ativos foram atualizados'}.` : '';
    notify(workflow ? 'Fluxo e projetos atualizados' : 'Fluxo criado', `${data.steps.length} etapas configuradas.${syncMessage}`);
    return true;
  }, workflow ? 'Salvar alterações' : 'Criar fluxo', form => {
    const stepList = form.querySelector('[data-workflow-step-list]');
    const preview = form.querySelector('[data-workflow-visual-preview]');
    const previewTrack = form.querySelector('[data-workflow-visual-track]');
    const previewToggle = form.querySelector('[data-workflow-preview-toggle]');
    const renderWorkflowPreview = () => {
      const rows = [...form.querySelectorAll('[data-workflow-step-row]')];
      previewTrack.innerHTML = rows.map((row, index) => {
        const name = row.querySelector('[data-workflow-step-name]').value.trim() || 'Etapa sem nome';
        const groupSelect = row.querySelector('[data-workflow-step-group]');
        const groupName = groupSelect.options[groupSelect.selectedIndex]?.text || 'Sem grupo';
        return `${index ? '<span class="workflow-visual-arrow" aria-hidden="true">→</span>' : ''}
          <article class="workflow-visual-card">
            <small>ETAPA ${index + 1}</small>
            <strong>${escapeHtml(name)}</strong>
            <span>${escapeHtml(groupName)}</span>
          </article>`;
      }).join('');
    };
    const updateBuilder = () => {
      refreshWorkflowStepRows(form);
      const count = form.querySelectorAll('[data-workflow-step-row]').length;
      form.querySelector('[data-workflow-step-count]').textContent = `${count} ${count === 1 ? 'etapa' : 'etapas'}`;
      if (!preview.hidden) renderWorkflowPreview();
    };
    previewToggle.onclick = () => {
      preview.hidden = !preview.hidden;
      previewToggle.classList.toggle('active', !preview.hidden);
      previewToggle.setAttribute('aria-expanded', String(!preview.hidden));
      previewToggle.setAttribute('aria-label', preview.hidden ? 'Visualizar estrutura do fluxo' : 'Ocultar estrutura do fluxo');
      previewToggle.title = preview.hidden ? 'Visualizar estrutura do fluxo' : 'Ocultar estrutura do fluxo';
      if (!preview.hidden) renderWorkflowPreview();
    };
    stepList.addEventListener('input', () => {
      if (!preview.hidden) renderWorkflowPreview();
    });
    stepList.addEventListener('change', () => {
      if (!preview.hidden) renderWorkflowPreview();
    });
    form.querySelector('[data-add-workflow-step]').onclick = () => {
      stepList.insertAdjacentHTML('beforeend', workflowStepRow('', fallbackGroupId));
      updateBuilder();
      stepList.lastElementChild.querySelector('[data-workflow-step-name]').focus();
    };
    stepList.onclick = event => {
      const button = event.target.closest('[data-step-action]');
      if (!button) return;
      const row = button.closest('[data-workflow-step-row]');
      if (button.dataset.stepAction === 'up' && row.previousElementSibling) row.previousElementSibling.before(row);
      if (button.dataset.stepAction === 'down' && row.nextElementSibling) row.nextElementSibling.after(row);
      if (button.dataset.stepAction === 'remove' && stepList.children.length > 2) row.remove();
      updateBuilder();
    };
    let draggedStepRow = null;
    const moveStepRowWithAnimation = moveRow => {
      const rows = [...stepList.querySelectorAll('[data-workflow-step-row]')];
      const previousPositions = new Map(rows.map(row => [row, row.getBoundingClientRect().top]));
      moveRow();
      rows.forEach(row => {
        if (row === draggedStepRow) return;
        const previousTop = previousPositions.get(row);
        const currentTop = row.getBoundingClientRect().top;
        const distance = previousTop - currentTop;
        if (!distance) return;
        row.animate(
          [{ transform: `translateY(${distance}px)` }, { transform: 'translateY(0)' }],
          { duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
      });
    };
    stepList.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-workflow-step-row]');
      if (!row || event.target.closest('input, select, button')) return event.preventDefault();
      draggedStepRow = row;
      draggedStepRow.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedStepRow.dataset.workflowStepId);
    });
    stepList.addEventListener('dragover', event => {
      if (!draggedStepRow) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const targetRow = event.target.closest('[data-workflow-step-row]');
      if (!targetRow || targetRow === draggedStepRow) return;
      const bounds = targetRow.getBoundingClientRect();
      const insertBefore = event.clientY < bounds.top + bounds.height / 2;
      stepList.querySelectorAll('.drop-before,.drop-after').forEach(row => row.classList.remove('drop-before', 'drop-after'));
      targetRow.classList.add(insertBefore ? 'drop-before' : 'drop-after');
      const alreadyPositioned = insertBefore
        ? targetRow.previousElementSibling === draggedStepRow
        : targetRow.nextElementSibling === draggedStepRow;
      if (alreadyPositioned) return;
      moveStepRowWithAnimation(() => {
        if (insertBefore) targetRow.before(draggedStepRow);
        else targetRow.after(draggedStepRow);
      });
      updateBuilder();
    });
    stepList.addEventListener('drop', event => {
      if (!draggedStepRow) return;
      event.preventDefault();
      updateBuilder();
    });
    stepList.addEventListener('dragend', () => {
      draggedStepRow?.classList.remove('dragging');
      stepList.querySelectorAll('.drop-before,.drop-after').forEach(row => row.classList.remove('drop-before', 'drop-after'));
      draggedStepRow = null;
      updateBuilder();
    });
    updateBuilder();
    form.querySelector('[data-delete-workflow]')?.addEventListener('click', () => {
      const inUse = state.deliverables.some(item => item.workflowId === workflow.id && item.status !== 'done');
      if (inUse) return notify('Fluxo em uso', 'Conclua ou exclua os entregáveis ativos antes de remover este fluxo.');
      confirmAction('Excluir fluxo?', 'Novos projetos não poderão mais selecionar este modelo.', () => {
        state.workflows = state.workflows.filter(item => item.id !== workflow.id);
        logActivity('Fluxo excluído', workflow.name);
        saveState(); closeModal(); notify('Fluxo excluído', 'O modelo foi removido.');
      });
    });
  });
}

function syncActiveDeliverablesWithWorkflow(workflow) {
  const deliverables = state.deliverables.filter(item => item.workflowId === workflow.id && item.status !== 'done');
  const newStepIds = new Set(workflow.steps.map(step => step[2]));
  deliverables.forEach(deliverable => {
    const oldSteps = deliverable.steps;
    const currentSourceStepId = oldSteps[deliverable.stepIndex]?.sourceStepId;
    const existingBySource = new Map(oldSteps.map(step => [step.sourceStepId, step]));
    const removedSteps = oldSteps.filter(step => !newStepIds.has(step.sourceStepId));
    const syncedSteps = workflow.steps.map(([name, groupId, sourceStepId], index) => {
      const existing = existingBySource.get(sourceStepId);
      return existing
        ? { ...existing, sourceStepId, name, groupId }
        : { id: uid(`s${index}`), sourceStepId, name, groupId, due: '', tasks: [], note: '' };
    });

    removedSteps.forEach(removedStep => {
      if (!syncedSteps.length) return;
      const oldIndex = oldSteps.indexOf(removedStep);
      const target = syncedSteps[Math.min(oldIndex, syncedSteps.length - 1)];
      const existingTaskIds = new Set(target.tasks.map(task => task.id));
      target.tasks.push(...removedStep.tasks.filter(task => !existingTaskIds.has(task.id)));
      if (removedStep.note) target.note = [target.note, `[Migrado de ${removedStep.name}] ${removedStep.note}`].filter(Boolean).join('\n');
      if (!target.due && removedStep.due) target.due = removedStep.due;
    });

    let nextCurrentIndex = syncedSteps.findIndex(step => step.sourceStepId === currentSourceStepId);
    if (nextCurrentIndex < 0) nextCurrentIndex = Math.min(deliverable.stepIndex, syncedSteps.length - 1);
    deliverable.steps = syncedSteps;
    deliverable.stepIndex = Math.max(0, nextCurrentIndex);
    const project = projectById(deliverable.projectId);
    if (project) project.updatedAt = new Date().toISOString();
  });
  return deliverables.length;
}

function openGroupModal() {
  openModal('Novo grupo', `
    <label>Nome do grupo<input name="name" required maxlength="60" placeholder="Ex.: Mídia paga"></label>
    <label>Sigla<input name="initials" required maxlength="3" placeholder="Ex.: MP"></label>
  `, form => {
    const name = field(form, 'name').trim();
    if (state.groups.some(group => normalize(group.name) === normalize(name))) {
      notify('Grupo já existe', 'Use outro nome para o grupo.');
      return false;
    }
    state.groups.push({ id: uid('g'), name, initials: field(form, 'initials').trim().toUpperCase() });
    logActivity('Grupo criado', name);
    saveState(); flowView = 'groups'; renderWorkflows(); notify('Grupo criado', `${name} já pode ser usado nos fluxos.`);
    return true;
  }, 'Criar grupo');
}

function openGroupRemoval(groupId) {
  const group = groupById(groupId);
  if (!group?.id) return;
  if (state.groups.length <= 1) return notify('Grupo obrigatório', 'Mantenha pelo menos um grupo para atribuir às etapas.');
  const workflowUses = state.workflows.reduce((sum, workflow) => sum + workflow.steps.filter(step => step[1] === groupId).length, 0);
  const deliverableUses = state.deliverables.reduce((sum, deliverable) => sum + deliverable.steps.filter(step => step.groupId === groupId).length, 0);
  const totalUses = workflowUses + deliverableUses;
  const replacementOptions = state.groups.filter(item => item.id !== groupId)
    .map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');

  openModal(`Excluir grupo: ${group.name}`, totalUses ? `
    <div class="removal-warning"><span>!</span><div><strong>Este grupo está em uso</strong><p>${workflowUses} ${workflowUses === 1 ? 'etapa de modelo' : 'etapas de modelos'} e ${deliverableUses} ${deliverableUses === 1 ? 'etapa de demanda' : 'etapas de demandas'} estão vinculadas a ${escapeHtml(group.name)}.</p></div></div>
    <label>Transferir todas as responsabilidades para<select name="replacement" required>${replacementOptions}</select></label>
    <p class="form-hint">O Doti atualizará os fluxos e as demandas existentes antes de excluir o grupo.</p>
  ` : `
    <div class="removal-warning safe"><span>✓</span><div><strong>Grupo sem vínculos</strong><p>${escapeHtml(group.name)} não está sendo usado por nenhuma etapa e pode ser excluído.</p></div></div>
  `, form => {
    if (totalUses) {
      const replacementId = field(form, 'replacement');
      state.workflows.forEach(workflow => {
        workflow.steps = workflow.steps.map(([name, assignedGroupId, stepId]) => [name, assignedGroupId === groupId ? replacementId : assignedGroupId, stepId]);
      });
      state.deliverables.forEach(deliverable => {
        deliverable.steps.forEach(step => { if (step.groupId === groupId) step.groupId = replacementId; });
      });
      const replacement = groupById(replacementId);
      logActivity('Grupo reatribuído e excluído', `${group.name} → ${replacement.name}`);
    } else {
      logActivity('Grupo excluído', group.name);
    }
    state.groups = state.groups.filter(item => item.id !== groupId);
    saveState();
    flowView = 'groups';
    renderWorkflows();
    notify('Grupo excluído', totalUses ? 'As etapas foram reatribuídas com sucesso.' : 'O grupo foi removido.');
    return true;
  }, totalUses ? 'Reatribuir e excluir' : 'Excluir grupo');
}

function bindDynamicActions() {
  document.querySelectorAll('[data-create-project]').forEach(button => button.onclick = () => openProjectModal());
  document.querySelectorAll('[data-open-deliverable]').forEach(element => {
    element.onclick = event => { event.stopPropagation(); openDeliverable(element.dataset.openDeliverable); };
    element.onkeydown = event => { if (event.key === 'Enter') openDeliverable(element.dataset.openDeliverable); };
  });
  document.querySelectorAll('[data-open-project]').forEach(element => element.onclick = () => openProjectModal(element.dataset.openProject));
  document.querySelectorAll('[data-calendar-prev]').forEach(button => button.onclick = () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    selectedCalendarDate = localDateKey(calendarCursor);
    renderDemands();
  });
  document.querySelectorAll('[data-calendar-next]').forEach(button => button.onclick = () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    selectedCalendarDate = localDateKey(calendarCursor);
    renderDemands();
  });
  document.querySelectorAll('[data-calendar-today]').forEach(button => button.onclick = () => {
    calendarCursor = new Date();
    calendarCursor.setDate(1);
    selectedCalendarDate = localDateKey(new Date());
    renderDemands();
  });
  document.querySelectorAll('[data-calendar-date]').forEach(button => button.onclick = () => {
    selectedCalendarDate = button.dataset.calendarDate;
    const [year, month] = selectedCalendarDate.split('-').map(Number);
    if (year !== calendarCursor.getFullYear() || month - 1 !== calendarCursor.getMonth()) calendarCursor = new Date(year, month - 1, 1);
    renderDemands();
  });
  document.querySelectorAll('[data-toggle-workflow]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    const workflow = workflowById(button.dataset.toggleWorkflow);
    if (!workflow) return;
    workflow.active = workflow.active === false;
    logActivity(workflow.active ? 'Fluxo ativado' : 'Fluxo desativado', workflow.name);
    saveState();
    notify(workflow.active ? 'Fluxo ativado' : 'Fluxo desativado', workflow.active
      ? 'O modelo voltou a ficar disponível para novos projetos.'
      : 'O modelo não poderá ser aberto nem usado em novos projetos.');
  });
  document.querySelectorAll('[data-edit-workflow]').forEach(element => element.onclick = () => openWorkflowModal(element.dataset.editWorkflow));
  document.querySelectorAll('[data-create-workflow]').forEach(button => button.onclick = () => openWorkflowModal());
  document.querySelectorAll('[data-create-group]').forEach(button => button.onclick = openGroupModal);
  document.querySelectorAll('[data-delete-group]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    openGroupRemoval(button.dataset.deleteGroup);
  });
}

function openModal(title, body, onSubmit, submitLabel = 'Salvar', afterOpen) {
  closeModal();
  const modal = document.createElement('div');
  modal.className = 'doti-modal';
  modal.innerHTML = `<form><header><h2>${escapeHtml(title)}</h2><button type="button" class="modal-close">×</button></header><div class="modal-body">${body}</div><footer><button type="button" class="cancel">Cancelar</button><button type="submit" class="primary-btn">${escapeHtml(submitLabel)}</button></footer></form>`;
  document.body.appendChild(modal);
  const form = modal.querySelector('form');
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.querySelector('.cancel').onclick = closeModal;
  modal.onclick = event => { if (event.target === modal) closeModal(); };
  form.onsubmit = event => {
    event.preventDefault();
    const shouldClose = onSubmit(form);
    if (shouldClose !== false) closeModal();
  };
  afterOpen?.(form);
  form.querySelector('input:not([type="checkbox"])')?.focus();
}
function closeModal() {
  document.querySelector('.doti-modal')?.remove();
  if (realtimeRefreshPending && operationReady && !persistRunning && !persistQueue.length) {
    refreshOperationFromServer();
  }
}
async function refreshOperationFromServer() {
  realtimeRefreshPending = false;
  try {
    applyLoadedState(await loadAgencyState());
  } catch (_) {
    notify('Não foi possível sincronizar', 'Tente novamente em instantes.', '!');
  }
}
function confirmAction(title, message, action) {
  const currentModal = document.querySelector('.doti-modal');
  const confirm = document.createElement('div');
  confirm.className = 'confirm-layer';
  confirm.innerHTML = `<div><span class="confirm-icon">!</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><footer><button class="outline-btn" data-cancel>Cancelar</button><button class="danger-btn" data-confirm>Confirmar exclusão</button></footer></div>`;
  (currentModal || document.body).appendChild(confirm);
  confirm.querySelector('[data-cancel]').onclick = () => confirm.remove();
  confirm.querySelector('[data-confirm]').onclick = () => { confirm.remove(); action(); };
}

function openRejectionDialog(deliverable, project, approvalStep, deliverableForm) {
  const currentModal = document.querySelector('.doti-modal');
  if (!currentModal || deliverable.stepIndex < 1) return;
  const returnableSteps = deliverable.steps.slice(0, deliverable.stepIndex);
  const reviewer = groupById(approvalStep.groupId);
  const layer = document.createElement('div');
  layer.className = 'confirm-layer';
  layer.innerHTML = `<div class="rejection-dialog">
    <span class="confirm-icon">!</span>
    <h3>Recusar e devolver?</h3>
    <p>Escolha para qual etapa o entregável deve voltar e explique o que precisa ser ajustado.</p>
    <label>Etapa de retorno<select name="returnStep">${returnableSteps.map((item, index) => `<option value="${index}" ${index === returnableSteps.length - 1 ? 'selected' : ''}>${escapeHtml(item.name)} — ${escapeHtml(groupById(item.groupId).name)}</option>`).join('')}</select></label>
    <label>Motivo da recusa<textarea maxlength="500" rows="4" placeholder="Descreva os ajustes necessários"></textarea><small>Obrigatório para orientar a próxima pessoa responsável.</small></label>
    <footer><button type="button" class="outline-btn" data-cancel>Cancelar</button><button type="button" class="reject-confirm-btn" data-confirm>Devolver para ajustes</button></footer>
  </div>`;
  currentModal.appendChild(layer);
  const textarea = layer.querySelector('textarea');
  const returnStepSelect = layer.querySelector('select[name="returnStep"]');
  layer.querySelector('[data-cancel]').onclick = () => layer.remove();
  layer.querySelector('[data-confirm]').onclick = () => {
    const reason = textarea.value.trim();
    if (!reason) {
      textarea.classList.add('invalid');
      textarea.focus();
      return;
    }
    const returnIndex = Number(returnStepSelect.value);
    const returnedStep = deliverable.steps[returnIndex];
    if (!returnedStep || returnIndex >= deliverable.stepIndex) return;
    approvalStep.note = field(deliverableForm, 'note').trim();
    syncDeliverableLinks(deliverable, approvalStep.note, approvalStep);
    const dateLabel = new Date().toLocaleDateString('pt-BR');
    const feedback = `Ajustes solicitados em ${dateLabel} por ${reviewer.name}:\n${reason}`;
    deliverable.note = [deliverable.note, feedback].filter(Boolean).join('\n\n');
    returnedStep.note = deliverable.note;
    returnedStep.tasks.push({ id: uid('t'), title: 'Aplicar ajustes solicitados na aprovação', done: false });
    deliverable.stepIndex = returnIndex;
    deliverable.status = 'active';
    project.updatedAt = new Date().toISOString();
    logActivity('Ajustes solicitados', `${deliverable.name} → ${returnedStep.name}: ${reason}`);
    saveState();
    closeModal();
    notify('Etapa devolvida', `O entregável voltou para ${returnedStep.name}.`, '!');
  };
  textarea.oninput = () => textarea.classList.remove('invalid');
  textarea.focus();
}

function exportBackup() {
  const backup = attachKnownFilePaths(structuredClone(state));
  backup.version = 4;
  backup.exportedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `doti-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  notify('Backup exportado', 'Guarde o arquivo em um local seguro.');
}
function importBackup(file) {
  if (!['owner', 'admin'].includes(window.dotiAuthContext?.profile?.role)) {
    notify('Acesso restrito', 'Somente proprietário ou administrador pode restaurar um backup.', '!');
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(reader.result);
      if (![3, 4].includes(imported?.version) || !Array.isArray(imported.projects) || !Array.isArray(imported.workflows)) throw new Error('invalid');
      const normalized = normalizeWorkflowStepIds(imported);
      state = imported.version === 3 ? canonicalizeLegacyState(normalized).state : normalized;
      operationRevision = await saveAgencyState(state, operationRevision);
      queuedRevision = operationRevision;
      ignoreRealtimeUntil = Date.now() + 1200;
      renderAll();
      notify('Backup restaurado', 'Os dados importados já estão disponíveis para a agência.');
    } catch (error) {
      notify(
        error.message === 'invalid' ? 'Arquivo inválido' : 'Não foi possível importar',
        error.message === 'invalid'
          ? 'Selecione um backup das versões 3 ou 4 do Doti.'
          : 'Os dados compartilhados não foram alterados.',
        '!'
      );
    }
  };
  reader.readAsText(file);
}

async function handlePersistenceError(error) {
  console.error('Doti operation save failed', error);
  notify(
    error?.code === '40001' ? 'Alterações mais recentes encontradas' : 'Não foi possível salvar',
    error?.code === '40001'
      ? 'Outra pessoa atualizou a operação. Recarregamos a versão compartilhada.'
      : 'A alteração não foi confirmada pelo servidor e a versão compartilhada será restaurada.',
    '!'
  );
  try {
    const loaded = await loadAgencyState();
    applyLoadedState(loaded);
  } catch (_) {
    document.documentElement.classList.add('operation-error');
  }
}

function applyLoadedState(loaded) {
  operationRevision = Number(loaded.revision || 0);
  if (!persistRunning && !persistQueue.length) queuedRevision = operationRevision;
  state = normalizeWorkflowStepIds({
    version: 4,
    groups: loaded.groups || [],
    workflows: loaded.workflows || [],
    clients: loaded.clients || [],
    projects: loaded.projects || [],
    deliverables: loaded.deliverables || [],
    activity: loaded.activity || []
  });
  attachKnownFilePaths(state);
  renderAll();
  showPage(location.hash.slice(1) || 'dashboard');
}

function legacyHasOperation(data) {
  return legacySnapshotExists || Boolean(
    data?.clients?.length
    || data?.projects?.length
    || data?.deliverables?.length
    || data?.activity?.length
    || (data?.workflows || []).some(workflow => !String(workflow.id).startsWith('wf-'))
  );
}

function showLegacyMigration(profile) {
  migrationPending = true;
  state = normalizeWorkflowStepIds(structuredClone(legacyState));
  renderAll();
  const counts = legacyCounts(state);
  const modal = document.createElement('div');
  modal.className = 'doti-modal migration-modal';
  modal.innerHTML = `
    <div class="migration-card">
      <header><div><span class="eyebrow">MIGRAÇÃO SEGURA</span><h2>Levar esta operação para o espaço compartilhado</h2></div></header>
      <p>Este navegador será usado como a cópia oficial da agência. Depois da confirmação, outras cópias locais não poderão substituir estes dados.</p>
      <div class="migration-counts">
        <article><strong>${counts.clients}</strong><span>clientes</span></article>
        <article><strong>${counts.projects}</strong><span>projetos</span></article>
        <article><strong>${counts.deliverables}</strong><span>entregáveis</span></article>
        <article><strong>${counts.tasks}</strong><span>tarefas</span></article>
        <article><strong>${counts.files}</strong><span>arquivos</span></article>
      </div>
      <div class="migration-status" role="status" aria-live="polite"></div>
      <footer><button type="button" class="outline-btn" data-migrate-later>Fazer depois</button><button type="button" class="primary-btn" data-migrate>Confirmar e migrar</button></footer>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('[data-migrate-later]').onclick = () => {
    modal.remove();
    notify('Migração pendente', 'A operação está disponível para revisão, mas alterações não serão salvas até a confirmação.', '!');
  };
  modal.querySelector('[data-migrate]').onclick = async () => {
    const button = modal.querySelector('[data-migrate]');
    const later = modal.querySelector('[data-migrate-later]');
    const status = modal.querySelector('.migration-status');
    button.disabled = true;
    later.disabled = true;
    status.textContent = 'Preparando dados e verificando arquivos…';
    let uploadedPaths = [];
    try {
      const fingerprint = await legacyFingerprint(legacyState);
      const canonical = canonicalizeLegacyState(normalizeWorkflowStepIds(structuredClone(legacyState)));
      status.textContent = 'Enviando logos, imagens, PDFs, vídeos e anexos…';
      const upload = await uploadLegacyFiles(
        canonical.state,
        canonical.fileIdMap,
        getLegacyAttachmentFile,
        fingerprint
      );
      uploadedPaths = upload.uploadedPaths;
      status.textContent = 'Gravando a operação compartilhada…';
      operationRevision = await importLegacyAgencyState(canonical.state, fingerprint, counts, 0);
      queuedRevision = operationRevision;
      const loaded = await loadAgencyState();
      operationReady = true;
      migrationPending = false;
      applyLoadedState(loaded);
      bindRealtime(profile.agency_id);
      document.querySelector('.storage-note span').textContent = 'Dados protegidos e compartilhados';
      modal.remove();
      notify(
        'Migração concluída',
        upload.missing.length
          ? `${upload.missing.length} arquivo(s) ausente(s) foram ignorados; os demais dados já estão compartilhados.`
          : 'A equipe já pode continuar de qualquer dispositivo.'
      );
    } catch (error) {
      if (uploadedPaths.length) await removeStoragePaths(uploadedPaths).catch(() => {});
      button.disabled = false;
      later.disabled = false;
      status.textContent = error?.message || 'A migração não foi concluída.';
      status.classList.add('error');
    }
  };
}

function bindRealtime(agencyId) {
  unsubscribeRealtime?.();
  unsubscribeRealtime = subscribeToAgencyChanges(agencyId, async () => {
    if (!operationReady || Date.now() < ignoreRealtimeUntil) return;
    if (persistRunning || persistQueue.length) {
      realtimeRefreshPending = true;
      return;
    }
    if (document.querySelector('.doti-modal, .attachment-preview-layer')) {
      realtimeRefreshPending = true;
      notify('Atualização disponível', 'Outra pessoa alterou a operação. A tela será atualizada ao fechar a janela.');
      return;
    }
    try {
      applyLoadedState(await loadAgencyState());
    } catch (_) {
      notify('Não foi possível sincronizar', 'Tente novamente em instantes.', '!');
    }
  });
}

function applyOperationRole(profile) {
  document.body.classList.toggle('member-access', profile.role === 'member');
  document.body.classList.toggle('viewer-access', profile.role === 'viewer');
}

async function initializeOperation() {
  try {
    const { profile } = await waitForOperationContext();
    applyOperationRole(profile);
    const loaded = await loadAgencyState();
    operationRevision = Number(loaded.revision || 0);
    queuedRevision = operationRevision;

    if (!loaded.initialized) {
      if (profile.role === 'owner' && legacyHasOperation(legacyState)) {
        showLegacyMigration(profile);
        return;
      }
      if (!['owner', 'admin'].includes(profile.role)) {
        throw new Error('A operação precisa ser inicializada por um proprietário ou administrador.');
      }
      const defaults = canonicalizeLegacyState(normalizeWorkflowStepIds(structuredClone(EMPTY_STATE))).state;
      operationRevision = await saveAgencyState(defaults, 0);
      queuedRevision = operationRevision;
    }

    applyLoadedState(await loadAgencyState());
    operationReady = true;
    bindRealtime(profile.agency_id);
    document.querySelector('.storage-note span').textContent = 'Dados protegidos e compartilhados';
  } catch (error) {
    console.error('Doti operation bootstrap failed', error);
    document.documentElement.classList.add('operation-error');
    notify('Não foi possível carregar a operação', 'Verifique a conexão e tente recarregar a página.', '!');
  } finally {
    document.documentElement.classList.remove('operation-pending');
  }
}

function emptyBlock(title, message, icon, action = '') {
  return `<div class="empty-state"><span>${icon}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>${action}</div>`;
}
function field(form, name) {
  return form.elements.namedItem(name)?.value || '';
}
function formatDate(value) {
  if (!value) return 'Sem prazo';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}
function initials(value) {
  return String(value).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '—';
}
function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function escapeAttr(value) {
  return escapeHtml(value);
}

navItems.forEach(item => item.onclick = () => {
  if (item.dataset.page === 'clientes') selectedClientWorkspaceId = null;
  showPage(item.dataset.page);
});
const sidebarToggle = document.getElementById('sidebarToggle');
function setSidebarCollapsed(collapsed) {
  document.querySelector('.app-shell').classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', collapsed ? 'Expandir menu lateral' : 'Minimizar menu lateral');
  sidebarToggle.title = collapsed ? 'Expandir menu lateral' : 'Minimizar menu lateral';
  localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
}
sidebarToggle.onclick = () => setSidebarCollapsed(!document.querySelector('.app-shell').classList.contains('sidebar-collapsed'));
setSidebarCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');
document.querySelectorAll('[data-page-target]').forEach(button => button.onclick = event => { event.preventDefault(); showPage(button.dataset.pageTarget); });
document.getElementById('topNewProject').onclick = () => openProjectModal();
document.getElementById('dashboardNewProject').onclick = () => openProjectModal();
document.getElementById('newDemand').onclick = () => openProjectModal();
document.getElementById('newWorkflow').onclick = () => openWorkflowModal();
document.getElementById('newClient').onclick = () => openClientModal();
document.getElementById('exportData').onclick = exportBackup;
document.getElementById('importData').onclick = () => document.getElementById('importFile').click();
document.getElementById('importFile').onchange = event => { if (event.target.files[0]) importBackup(event.target.files[0]); event.target.value = ''; };
document.getElementById('demandSearch').oninput = renderDemands;
document.getElementById('statusFilter').onchange = renderDemands;
document.getElementById('groupFilter').onchange = renderDemands;
document.getElementById('clientFilter').onchange = renderDemands;
document.getElementById('clientSearch').oninput = renderClients;
document.getElementById('globalSearch').oninput = event => {
  document.getElementById('demandSearch').value = event.target.value;
  if (event.target.value.trim().length >= 2) showPage('demandas');
  renderDemands();
};
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => {
  demandView = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button));
  renderDemands();
});
document.querySelectorAll('[data-flow-view]').forEach(button => button.onclick = () => {
  flowView = button.dataset.flowView;
  document.querySelectorAll('[data-flow-view]').forEach(item => item.classList.toggle('active', item === button));
  renderWorkflows();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const preview = document.querySelector('.attachment-preview-layer');
  if (preview) return preview.querySelector('[data-close-preview]').click();
  const confirmation = document.querySelector('.confirm-layer');
  if (confirmation) return confirmation.remove();
  closeModal();
});

initializeOperation();
