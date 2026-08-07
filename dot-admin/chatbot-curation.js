import {
  downloadOperationFile,
  loadAgencyState,
  registerOperationFilePath,
  removeOperationFile,
  uploadOperationFile,
  waitForOperationContext
} from './operation-store.js?v=6';
import {
  buildReviewPatch,
  filterDayGroupsByDate,
  filterInteractions,
  filterInteractionsByDate,
  generateIntegrationCredentials,
  groupInteractionsByDay,
  normalizeInteraction,
  selectBotInteractions,
  sha256,
  summarizeInteractions,
  summarizePanelMetrics
} from './chatbot-curation-core.mjs?v=6';

const LOCAL_KEY = 'doti-chatbot-curation-local-v2';
const LEGACY_LOCAL_KEY = 'doti-chatbot-curation-local-v1';
const BOT_COLORS = ['#ffd400', '#b8e1ff', '#c9f0df', '#e1d2ff', '#ffc9bd', '#d8e0ff', '#ffe8a3', '#cde7e1'];
const statusLabels = {
  pending: 'Pendente',
  approved: 'Aprovada',
  needs_review: 'Precisa ajustar',
  rejected: 'Descartada'
};
const page = document.getElementById('curadoria-chatbot');
const directory = document.getElementById('botDirectory');
const botCuration = document.getElementById('botCuration');
const botGrid = document.getElementById('botGrid');
const newBotButton = document.getElementById('newBotButton');
const backButton = document.getElementById('backToBotsButton');
const list = document.getElementById('curationList');
const metrics = document.getElementById('curationMetrics');
const search = document.getElementById('curationSearch');
const statusFilter = document.getElementById('curationStatus');
const queueDateFrom = document.getElementById('curationQueueDateFrom');
const queueDateTo = document.getElementById('curationQueueDateTo');
const clearQueueDatesButton = document.getElementById('clearCurationQueueDates');
const integrationButton = document.getElementById('curationIntegrationButton');
const toggleBotStatusButton = document.getElementById('toggleBotStatusButton');
const removeBotButton = document.getElementById('removeBotButton');
const queuePanel = document.getElementById('curationQueuePanel');
const historyPanel = document.getElementById('curationHistoryPanel');
const historyList = document.getElementById('curationLogList');
const historyDateFrom = document.getElementById('curationHistoryDateFrom');
const historyDateTo = document.getElementById('curationHistoryDateTo');
const clearHistoryDatesButton = document.getElementById('clearCurationHistoryDates');
const viewButtons = [...document.querySelectorAll('[data-curation-view]')];
let context;
let bots = [];
let integrations = [];
let interactions = [];
let clients = [];
let selectedBotId = null;
let initialized = false;

function escapeHtml(value) {
  const node = document.createElement('div');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function initials(value) {
  return String(value || 'Bot').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('pt-BR');
}

function localSeed() {
  const now = Date.now();
  const virgulinhaBot = {
    id: 'local-bot-virgulinha', agency_id: 'local-agency', client_id: null,
    name: 'Virgulinha', color: '#ffd400', is_active: true, created_by: 'local-owner'
  };
  const camilinhaBot = {
    id: 'local-bot-camilinha', agency_id: 'local-agency', client_id: 'local-client-camilinha',
    name: 'Camilinha', color: '#7452cc', is_active: true, created_by: 'local-owner'
  };
  const seededIntegrations = [
    { id: 'local-integration-virgulinha', bot_id: virgulinhaBot.id, name: 'Virgulinha Web', source_key: 'virgulinha_demo', is_active: true },
    { id: 'local-integration-camilinha', bot_id: camilinhaBot.id, name: 'Camilinha Web', source_key: 'camilinha_demo', is_active: true }
  ];
  const seededInteractions = [
    {
      id: 'local-chat-1', integration_id: seededIntegrations[0].id, occurred_at: new Date(now - 18 * 60000).toISOString(),
      question: 'Conhece a Crysthian da Vírgula?', answer: 'Eu sou o Virgulinha, assistente virtual da Agência Vírgula. Posso apresentar nossos serviços e ajudar com o primeiro atendimento.',
      channel: 'web', external_user_id: 'user_demo_01', source_url: 'https://www.agenciavirgula.com.br', response_time_ms: 3609, status: 'pending', categories: []
    },
    {
      id: 'local-chat-2', integration_id: seededIntegrations[0].id, occurred_at: new Date(now - 52 * 60000).toISOString(),
      question: 'Estou triste hoje, Virgulinha', answer: 'Poxa, sinto muito que esteja assim. Se quiser, podemos conversar brevemente e depois pensar em como a comunicação da sua marca pode ficar mais leve.',
      channel: 'web', external_user_id: 'user_demo_02', source_url: 'https://www.agenciavirgula.com.br', response_time_ms: 2808, status: 'needs_review', rating: 3, categories: ['tom de voz'], review_notes: 'Resposta empática, mas deve evitar desviar para uma oferta comercial.'
    },
    {
      id: 'local-chat-3', integration_id: seededIntegrations[0].id, occurred_at: new Date(now - 95 * 60000).toISOString(),
      question: 'Você sabe sobre a Copa do Mundo?', answer: 'Sei um pouco, mas meu foco é ajudar com marketing, posicionamento e os serviços da Agência Vírgula.',
      channel: 'web', external_user_id: 'user_demo_03', source_url: 'https://www.agenciavirgula.com.br', response_time_ms: 2957, status: 'approved', rating: 4, categories: ['fora de escopo'], review_notes: 'Boa contenção de escopo.'
    },
    {
      id: 'local-chat-4', integration_id: seededIntegrations[1].id, occurred_at: new Date(now - 31 * 60000).toISOString(),
      question: 'Como posso agendar um atendimento?', answer: 'Posso te ajudar com isso. Informe o melhor dia e período para verificarmos a disponibilidade.',
      channel: 'web', external_user_id: 'user_demo_04', response_time_ms: 4100, status: 'pending', categories: []
    }
  ].map(normalizeInteraction);
  return { bots: [virgulinhaBot, camilinhaBot], integrations: seededIntegrations, interactions: seededInteractions };
}

function readLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (saved?.bots?.length) return saved;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_LOCAL_KEY) || 'null');
    if (legacy?.interactions?.length) {
      const seeded = localSeed();
      const virgulinhaIntegration = legacy.integration
        ? { ...legacy.integration, id: legacy.integration.id || seeded.integrations[0].id, bot_id: seeded.bots[0].id }
        : seeded.integrations[0];
      return {
        bots: seeded.bots,
        integrations: [virgulinhaIntegration, seeded.integrations[1]],
        interactions: [
          ...legacy.interactions.map(row => normalizeInteraction({ ...row, integration_id: virgulinhaIntegration.id })),
          seeded.interactions.find(row => row.integration_id === seeded.integrations[1].id)
        ]
      };
    }
  } catch (_) {}
  return localSeed();
}

function writeLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ bots, integrations, interactions }));
}

function registerBotAvatarPaths() {
  bots.forEach(bot => {
    if (bot.avatar_path) registerOperationFilePath(bot.id, bot.avatar_path);
  });
}

async function hydrateBotAvatars(root = document) {
  const images = [...root.querySelectorAll('img[data-bot-avatar]')];
  await Promise.all(images.map(async image => {
    try {
      const bot = bots.find(item => item.id === image.dataset.botAvatar);
      const file = await downloadOperationFile(image.dataset.botAvatar, bot?.avatar_path);
      if (!file) return;
      const url = URL.createObjectURL(file);
      image.src = url;
      image.hidden = false;
      image.previousElementSibling?.setAttribute('hidden', '');
      image.onload = () => URL.revokeObjectURL(url);
    } catch (_) {}
  }));
}

function selectedBot() {
  return bots.find(bot => bot.id === selectedBotId) || null;
}

function integrationsForBot(botId) {
  return integrations.filter(item => item.bot_id === botId);
}

function interactionsForBot(botId) {
  return selectBotInteractions(interactions, integrations, botId);
}

function clientName(bot) {
  if (!bot?.client_id) return context?.profile?.agency_name || 'Bot interno da agência';
  return clients.find(client => client.id === bot.client_id)?.name || 'Cliente vinculado';
}

async function loadData() {
  botGrid.innerHTML = '<div class="curation-empty">Carregando bots…</div>';
  if (context.localMode) {
    const operation = await loadAgencyState();
    clients = operation.clients || [];
    if (!clients.some(client => client.id === 'local-client-camilinha')) {
      clients.push({ id: 'local-client-camilinha', name: 'Cliente da Camilinha', color: '#7452cc' });
    }
    const local = readLocal();
    bots = local.bots || [];
    integrations = local.integrations || [];
    interactions = (local.interactions || []).filter(Boolean).map(normalizeInteraction);
    registerBotAvatarPaths();
    render();
    return;
  }
  const [operation, botResult, integrationResult, interactionResult] = await Promise.all([
    loadAgencyState(),
    context.supabase.from('chatbots').select('id, agency_id, client_id, name, color, avatar_path, is_active, created_by, created_at, updated_at').order('created_at'),
    context.supabase.from('chatbot_integrations').select('id, agency_id, bot_id, name, source_key, is_active, created_by, created_at, updated_at').order('created_at'),
    context.supabase.from('chatbot_interactions').select('*').order('occurred_at', { ascending: false }).limit(1000)
  ]);
  if (botResult.error) throw botResult.error;
  if (integrationResult.error) throw integrationResult.error;
  if (interactionResult.error) throw interactionResult.error;
  clients = operation.clients || [];
  bots = botResult.data || [];
  integrations = integrationResult.data || [];
  interactions = (interactionResult.data || []).map(normalizeInteraction);
  registerBotAvatarPaths();
  render();
}

function renderDirectory() {
  registerBotAvatarPaths();
  const totalPending = summarizeInteractions(interactions).pending;
  document.getElementById('curationNavCount').textContent = totalPending;
  if (!bots.length) {
    botGrid.innerHTML = '<div class="curation-empty"><span>✦</span><strong>Nenhum bot cadastrado</strong><p>Crie o primeiro bot para configurar a conexão e começar a receber conversas.</p></div>';
    return;
  }
  botGrid.innerHTML = bots.map(bot => {
    const botInteractions = interactionsForBot(bot.id);
    const summary = summarizeInteractions(botInteractions);
    const connected = integrationsForBot(bot.id).some(item => item.is_active);
    const latest = botInteractions[0]?.occurred_at;
    const canEdit = ['owner', 'admin'].includes(context.profile.role);
    return `
      <article class="bot-card-shell" style="--bot-color:${escapeHtml(bot.color || '#ffd400')}">
        <button class="bot-card" type="button" data-open-bot="${escapeHtml(bot.id)}" aria-label="Abrir curadoria de ${escapeHtml(bot.name)}">
          <span class="bot-avatar"><span>${escapeHtml(initials(bot.name))}</span>${bot.avatar_path ? `<img data-bot-avatar="${escapeHtml(bot.id)}" alt="" hidden>` : ''}</span>
          <span class="bot-card-copy">
            <strong>${escapeHtml(bot.name)}</strong>
            <small>${escapeHtml(clientName(bot))}</small>
            <span class="bot-connection ${connected && bot.is_active ? 'active' : 'inactive'}">${!bot.is_active ? 'Desativado' : connected ? 'Ativo' : 'Sem conexão ativa'}</span>
          </span>
          <span class="bot-card-summary"><b>${summary.pending}</b><small>pendentes</small>${latest ? `<time>${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(latest))}</time>` : '<time>Sem conversas</time>'}</span>
          <span class="bot-card-arrow">→</span>
        </button>
        ${canEdit ? `<button class="bot-card-edit" type="button" data-edit-bot="${escapeHtml(bot.id)}" aria-label="Editar ${escapeHtml(bot.name)}" title="Editar bot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Zm9.5-13.5 4 4"></path></svg></button>` : ''}
      </article>`;
  }).join('');
  hydrateBotAvatars(botGrid);
}

function renderCuration() {
  const bot = selectedBot();
  directory.hidden = Boolean(bot);
  botCuration.hidden = !bot;
  if (!bot) return;
  const botInteractions = interactionsForBot(bot.id);
  const integration = integrationsForBot(bot.id)[0] || null;
  const panelSummary = summarizePanelMetrics(botInteractions);
  document.getElementById('curationBotTitle').textContent = `Painel de Controle Doti - ${bot.name}`;
  toggleBotStatusButton.textContent = bot.is_active ? 'Desativar bot' : 'Reativar bot';
  toggleBotStatusButton.classList.toggle('is-inactive', !bot.is_active);
  metrics.innerHTML = `
    <article><span>ATENDIMENTOS</span><strong>${panelSummary.attendances}</strong><small>conversas realizadas</small></article>
    <article><span>USUÁRIOS</span><strong>${panelSummary.users}</strong><small>pessoas atendidas</small></article>
    <article><span>INTERAÇÕES</span><strong>${panelSummary.interactions}</strong><small>mensagens processadas</small></article>
    <article><span>TEMPO MÉDIO</span><strong>${panelSummary.average_ms == null ? '—' : `${(panelSummary.average_ms / 1000).toFixed(1)}s`}</strong><small>por resposta</small></article>`;
  integrationButton.textContent = integration ? 'Configurar conexão' : '+ Conectar n8n';
  renderHistory(botInteractions);
  const queueFrom = queueDateFrom.value;
  const queueTo = queueDateTo.value;
  queueDateFrom.max = queueTo;
  queueDateTo.min = queueFrom;
  clearQueueDatesButton.disabled = !queueFrom && !queueTo;
  const filteredByContent = filterInteractions(botInteractions, { status: statusFilter.value, search: search.value });
  const filtered = filterInteractionsByDate(filteredByContent, { from: queueFrom, to: queueTo });
  if (!filtered.length) {
    const dateFiltered = Boolean(queueFrom || queueTo);
    list.innerHTML = `<div class="curation-empty"><span>✓</span><strong>${dateFiltered ? 'Nenhuma conversa neste período' : 'Nenhuma conversa encontrada'}</strong><p>${dateFiltered ? 'Ajuste as datas ou limpe o período para visualizar toda a fila.' : integration ? 'A fila está em dia ou os filtros não encontraram resultados.' : 'Configure a conexão deste bot para começar a receber conversas.'}</p></div>`;
    return;
  }
  list.innerHTML = filtered.map(row => `
    <article class="curation-card" data-curation-id="${escapeHtml(row.id)}">
      <header>
        <div class="curation-card-state"><span class="curation-status ${row.status}">${statusLabels[row.status]}</span><time><small>Recebida em</small>${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.occurred_at))}</time></div>
        <div class="curation-meta"><span><small>Canal</small><strong>${escapeHtml(row.channel)}</strong></span>${row.response_time_ms == null ? '' : `<span><small>Tempo</small><strong>${(row.response_time_ms / 1000).toFixed(1)}s</strong></span>`}${row.external_user_id ? `<span><small>Usuário</small><strong>${escapeHtml(row.external_user_id)}</strong></span>` : ''}</div>
      </header>
      <div class="curation-dialogue">
        <div><b>PERGUNTA</b><p>${escapeHtml(row.question)}</p></div>
        <div><b>RESPOSTA DE ${escapeHtml(bot.name.toLocaleUpperCase('pt-BR'))}</b><p>${escapeHtml(row.answer)}</p></div>
      </div>
      <footer>
        <div class="curation-tags">${(row.categories || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}${row.rating ? `<span class="rating">${'★'.repeat(row.rating)}${'☆'.repeat(5 - row.rating)}</span>` : ''}</div>
        <button class="outline-btn" type="button" data-review>Revisar resposta →</button>
      </footer>
    </article>`).join('');
}

function setCurationView(view = 'queue') {
  const history = view === 'history';
  queuePanel.hidden = history;
  historyPanel.hidden = !history;
  viewButtons.forEach(button => {
    const active = button.dataset.curationView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (_) {
    return '';
  }
}

function dateFromDayKey(key) {
  return new Date(`${key}T12:00:00-03:00`);
}

function formatDayLabel(key) {
  const date = dateFromDayKey(key);
  const dateLabel = new Intl.DateTimeFormat('pt-BR').format(date);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(date);
  return `<strong>${dateLabel}</strong><small>${escapeHtml(weekday)}</small>`;
}

function capitalizeFirst(value) {
  const text = String(value || '');
  return text ? `${text[0].toLocaleUpperCase('pt-BR')}${text.slice(1)}` : '';
}

function renderHistory(rows) {
  const groups = groupInteractionsByDay(rows);
  const from = historyDateFrom.value;
  const to = historyDateTo.value;
  const filteredGroups = filterDayGroupsByDate(groups, { from, to });
  historyDateFrom.max = to;
  historyDateTo.min = from;
  clearHistoryDatesButton.disabled = !from && !to;
  if (!groups.length) {
    historyList.innerHTML = '<div class="curation-empty"><span>○</span><strong>Nenhum log recebido</strong><p>As conversas aparecerão aqui assim que a conexão enviar a primeira interação.</p></div>';
    return;
  }
  if (!filteredGroups.length) {
    historyList.innerHTML = '<div class="curation-empty"><span>⌕</span><strong>Nenhum log neste período</strong><p>Ajuste as datas ou limpe o filtro para visualizar todo o histórico.</p></div>';
    return;
  }
  historyList.innerHTML = filteredGroups.map(group => `
    <article class="curation-log-row" data-log-day="${group.key}">
      <div class="curation-log-date">${formatDayLabel(group.key)}</div>
      <div><strong>${group.message_count}</strong><span>${group.message_count === 1 ? 'mensagem' : 'mensagens'}</span></div>
      <div class="curation-log-audience">
        <span><strong>${group.user_count}</strong> ${group.user_count === 1 ? 'usuário' : 'usuários'}</span>
        <span><strong>${group.session_count}</strong> ${group.session_count === 1 ? 'sessão' : 'sessões'}</span>
      </div>
      <button class="outline-btn" type="button" data-view-log>Visualizar <span>→</span></button>
    </article>`).join('');
}

function openDayLog(dayKey) {
  const bot = selectedBot();
  if (!bot) return;
  const group = groupInteractionsByDay(interactionsForBot(bot.id)).find(item => item.key === dayKey);
  if (!group) return;
  return showModal(`<div class="curation-log-modal-card">
    <header>
      <div><p class="eyebrow">LOG DE CONVERSA · ${escapeHtml(bot.name.toLocaleUpperCase('pt-BR'))}</p><h2>${escapeHtml(capitalizeFirst(new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(dateFromDayKey(group.key))))}</h2><span>${group.message_count} mensagens · ${group.user_count} usuários · ${group.session_count} sessões</span></div>
      <button type="button" data-close-modal>×</button>
    </header>
    <div class="curation-log-detail-list">
      ${group.interactions.map(row => `
        <article class="curation-log-detail">
          <div class="curation-log-detail-time"><small>Horário</small><time>${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(row.occurred_at))}</time></div>
          <div class="curation-log-message"><b>PERGUNTA</b><p>${escapeHtml(row.question)}</p></div>
          <div class="curation-log-message answer"><b>RESPOSTA DE ${escapeHtml(bot.name.toLocaleUpperCase('pt-BR'))}</b><p>${escapeHtml(row.answer)}</p></div>
          <dl>
            <div><dt>Canal</dt><dd>${escapeHtml(row.channel)}</dd></div>
            <div><dt>Usuário</dt><dd>${escapeHtml(row.external_user_id || 'Não informado')}</dd></div>
            <div><dt>Sessão</dt><dd>${escapeHtml(row.external_session_id || 'Não informada')}</dd></div>
            <div><dt>Tempo</dt><dd>${row.response_time_ms == null ? '—' : `${(row.response_time_ms / 1000).toFixed(1)}s`}</dd></div>
            ${safeHttpUrl(row.source_url) ? `<div class="wide"><dt>Endereço</dt><dd><a href="${escapeHtml(safeHttpUrl(row.source_url))}" target="_blank" rel="noreferrer">${escapeHtml(row.source_url)}</a></dd></div>` : ''}
          </dl>
        </article>`).join('')}
    </div>
    <footer><button type="button" class="outline-btn" data-close-modal>Fechar</button></footer>
  </div>`, 'curation-log-modal');
}

function render() {
  renderDirectory();
  renderCuration();
}

function showModal(content, className = '') {
  const layer = document.createElement('div');
  layer.className = `doti-modal curation-modal ${className}`;
  layer.innerHTML = content;
  document.body.appendChild(layer);
  layer.addEventListener('click', event => {
    if (event.target === layer || event.target.closest('[data-close-modal]')) layer.remove();
  });
  return layer;
}

function openNewBot() {
  if (!['owner', 'admin'].includes(context.profile.role)) return;
  const selectedColor = BOT_COLORS[bots.length % BOT_COLORS.length];
  const clientOptions = [...clients]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`)
    .join('');
  const modal = showModal(`<form>
    <header><div><p class="eyebrow">CONTROLE DE BOTS</p><h2>Novo bot</h2></div><button type="button" data-close-modal>×</button></header>
    <p class="curation-integration-intro">Cadastre o bot primeiro. A conexão com o n8n será configurada dentro da curadoria dele.</p>
    <div class="client-brand-editor bot-brand-editor">
      <div class="client-logo-preview" data-bot-avatar-preview style="--client-color:${selectedColor}"><span>NB</span></div>
      <label class="client-logo-upload">Imagem opcional<input type="file" name="avatar" accept="image/png,image/jpeg,image/webp"><small>PNG, JPG ou WebP · até 10 MB</small></label>
    </div>
    <div class="curation-review-grid">
      <label><span>Nome do bot</span><input name="name" required minlength="2" maxlength="80" placeholder="Ex.: Camilinha"></label>
      <label><span>Cliente</span><select name="client_id"><option value="">Bot interno da agência</option>${clientOptions}</select></label>
    </div>
    <fieldset class="client-color-picker bot-color-picker"><legend>Cor de identificação</legend>${BOT_COLORS.map(color => `<label title="${color}"><input type="radio" name="color" value="${color}" ${color === selectedColor ? 'checked' : ''}><span style="--swatch:${color}"></span></label>`).join('')}</fieldset>
    <div class="curation-modal-status" role="alert"></div>
    <footer><button type="button" class="outline-btn" data-close-modal>Cancelar</button><button type="submit" class="primary-btn">Criar bot</button></footer>
  </form>`);
  const form = modal.querySelector('form');
  const preview = form.querySelector('[data-bot-avatar-preview]');
  const nameInput = form.elements.namedItem('name');
  nameInput.addEventListener('input', () => {
    preview.querySelector('span').textContent = initials(nameInput.value || 'Novo bot');
  });
  form.querySelectorAll('input[name="color"]').forEach(input => input.addEventListener('change', () => {
    preview.style.setProperty('--client-color', input.value);
  }));
  form.elements.namedItem('avatar').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const image = preview.querySelector('img') || preview.appendChild(document.createElement('img'));
    const url = URL.createObjectURL(file);
    image.src = url;
    image.hidden = false;
    preview.querySelector('span').hidden = true;
    image.onload = () => URL.revokeObjectURL(url);
  });
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const status = form.querySelector('.curation-modal-status');
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const avatarFile = form.elements.namedItem('avatar').files[0];
    if (bots.some(bot => bot.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      status.textContent = 'Já existe um bot com esse nome.';
      return;
    }
    if (avatarFile && (!avatarFile.type.startsWith('image/') || avatarFile.size > 10 * 1024 * 1024)) {
      status.textContent = 'Escolha uma imagem PNG, JPG ou WebP de até 10 MB.';
      return;
    }
    button.disabled = true;
    let bot = null;
    let uploadedAvatar = false;
    try {
      const payload = {
        agency_id: context.profile.agency_id,
        client_id: data.get('client_id') || null,
        name,
        color: data.get('color') || '#ffd400',
        is_active: true,
        created_by: context.user.id
      };
      if (context.localMode) {
        bot = { id: crypto.randomUUID(), ...payload, avatar_path: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      } else {
        const result = await context.supabase.from('chatbots').insert(payload).select('id, agency_id, client_id, name, color, avatar_path, is_active, created_by, created_at, updated_at').single();
        if (result.error) throw result.error;
        bot = result.data;
      }
      if (avatarFile) {
        bot.avatar_path = await uploadOperationFile(bot.id, avatarFile);
        uploadedAvatar = true;
        if (!context.localMode) {
          const avatarResult = await context.supabase.from('chatbots').update({ avatar_path: bot.avatar_path }).eq('id', bot.id).select('avatar_path').single();
          if (avatarResult.error) throw avatarResult.error;
          bot.avatar_path = avatarResult.data.avatar_path;
        }
      }
      bots.push(bot);
      if (context.localMode) writeLocal();
      selectedBotId = bot.id;
      modal.remove();
      render();
    } catch (error) {
      if (uploadedAvatar && bot) await removeOperationFile(bot.id).catch(() => {});
      if (!context.localMode && bot) {
        try { await context.supabase.from('chatbots').delete().eq('id', bot.id); } catch (_) {}
      }
      status.textContent = error.message || 'Não foi possível criar o bot.';
      button.disabled = false;
    }
  };
}

function openEditBot(botId) {
  if (!['owner', 'admin'].includes(context.profile.role)) return;
  const bot = bots.find(item => item.id === botId);
  if (!bot) return;
  const clientOptions = [...clients]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map(client => `<option value="${escapeHtml(client.id)}" ${client.id === bot.client_id ? 'selected' : ''}>${escapeHtml(client.name)}</option>`)
    .join('');
  const modal = showModal(`<form>
    <header><div><p class="eyebrow">CONTROLE DE BOTS</p><h2>Editar bot</h2></div><button type="button" data-close-modal>×</button></header>
    <p class="curation-integration-intro">Atualize a identificação do bot. A conexão e as conversas existentes serão preservadas.</p>
    <div class="client-brand-editor bot-brand-editor">
      <div class="client-logo-preview" data-bot-avatar-preview style="--client-color:${escapeHtml(bot.color || '#ffd400')}"><span>${escapeHtml(initials(bot.name))}</span>${bot.avatar_path ? `<img data-bot-avatar="${escapeHtml(bot.id)}" alt="" hidden>` : ''}</div>
      <label class="client-logo-upload">Trocar imagem<input type="file" name="avatar" accept="image/png,image/jpeg,image/webp"><small>PNG, JPG ou WebP · até 10 MB</small></label>
      ${bot.avatar_path ? '<label class="bot-avatar-remove"><input type="checkbox" name="remove_avatar"> Remover imagem atual</label>' : ''}
    </div>
    <div class="curation-review-grid">
      <label><span>Nome do bot</span><input name="name" required minlength="2" maxlength="80" value="${escapeHtml(bot.name)}"></label>
      <label><span>Cliente</span><select name="client_id"><option value="" ${bot.client_id ? '' : 'selected'}>Bot interno da agência</option>${clientOptions}</select></label>
    </div>
    <fieldset class="client-color-picker bot-color-picker"><legend>Cor de identificação</legend>${BOT_COLORS.map(color => `<label title="${color}"><input type="radio" name="color" value="${color}" ${color === bot.color ? 'checked' : ''}><span style="--swatch:${color}"></span></label>`).join('')}</fieldset>
    <div class="curation-modal-status" role="alert"></div>
    <footer><button type="button" class="outline-btn" data-close-modal>Cancelar</button><button type="submit" class="primary-btn">Salvar alterações</button></footer>
  </form>`);
  const form = modal.querySelector('form');
  const preview = form.querySelector('[data-bot-avatar-preview]');
  const nameInput = form.elements.namedItem('name');
  const avatarInput = form.elements.namedItem('avatar');
  const removeAvatarInput = form.elements.namedItem('remove_avatar');
  hydrateBotAvatars(modal);
  nameInput.addEventListener('input', () => {
    preview.querySelector('span').textContent = initials(nameInput.value || 'Bot');
  });
  form.querySelectorAll('input[name="color"]').forEach(input => input.addEventListener('change', () => {
    preview.style.setProperty('--client-color', input.value);
  }));
  avatarInput.addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (removeAvatarInput) removeAvatarInput.checked = false;
    const image = preview.querySelector('img') || preview.appendChild(document.createElement('img'));
    const url = URL.createObjectURL(file);
    image.src = url;
    image.hidden = false;
    preview.querySelector('span').hidden = true;
    image.onload = () => URL.revokeObjectURL(url);
  });
  removeAvatarInput?.addEventListener('change', () => {
    const image = preview.querySelector('img');
    if (removeAvatarInput.checked) {
      avatarInput.value = '';
      if (image) image.hidden = true;
      preview.querySelector('span').hidden = false;
    } else if (image?.src) {
      image.hidden = false;
      preview.querySelector('span').hidden = true;
    }
  });
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const status = form.querySelector('.curation-modal-status');
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const avatarFile = avatarInput.files[0];
    const removeAvatar = Boolean(data.get('remove_avatar'));
    if (bots.some(item => item.id !== bot.id && item.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      status.textContent = 'Já existe um bot com esse nome.';
      return;
    }
    if (avatarFile && (!avatarFile.type.startsWith('image/') || avatarFile.size > 10 * 1024 * 1024)) {
      status.textContent = 'Escolha uma imagem PNG, JPG ou WebP de até 10 MB.';
      return;
    }
    button.disabled = true;
    try {
      let avatarPath = bot.avatar_path || null;
      if (avatarFile) avatarPath = await uploadOperationFile(bot.id, avatarFile);
      const patch = {
        client_id: data.get('client_id') || null,
        name,
        color: data.get('color') || '#ffd400',
        avatar_path: removeAvatar ? null : avatarPath
      };
      if (context.localMode) {
        Object.assign(bot, patch, { updated_at: new Date().toISOString() });
        writeLocal();
      } else {
        const result = await context.supabase.from('chatbots').update(patch).eq('id', bot.id).select('id, agency_id, client_id, name, color, avatar_path, is_active, created_by, created_at, updated_at').single();
        if (result.error) throw result.error;
        Object.assign(bot, result.data);
      }
      if (removeAvatar && !avatarFile) await removeOperationFile(bot.id);
      modal.remove();
      render();
    } catch (error) {
      status.textContent = error.message || 'Não foi possível salvar as alterações.';
      button.disabled = false;
    }
  };
}

async function toggleSelectedBotStatus() {
  if (!['owner', 'admin'].includes(context.profile.role)) return;
  const bot = selectedBot();
  if (!bot) return;
  const nextActive = !bot.is_active;
  if (!nextActive && !confirm(`Deseja desativar o bot ${bot.name}? Ele deixará de receber novas conversas.`)) return;
  toggleBotStatusButton.disabled = true;
  try {
    if (context.localMode) {
      bot.is_active = nextActive;
      bot.updated_at = new Date().toISOString();
      writeLocal();
    } else {
      const result = await context.supabase
        .from('chatbots')
        .update({ is_active: nextActive })
        .eq('id', bot.id)
        .select('id, agency_id, client_id, name, color, avatar_path, is_active, created_by, created_at, updated_at')
        .single();
      if (result.error) throw result.error;
      Object.assign(bot, result.data);
    }
    render();
  } catch (error) {
    alert(error.message || 'Não foi possível alterar o status do bot.');
  } finally {
    toggleBotStatusButton.disabled = false;
  }
}

function openRemoveBot() {
  if (!['owner', 'admin'].includes(context.profile.role)) return;
  const bot = selectedBot();
  if (!bot) return;
  const conversationCount = interactionsForBot(bot.id).length;
  const modal = showModal(`<form>
    <header><div><p class="eyebrow">REMOVER BOT</p><h2>Remover ${escapeHtml(bot.name)}?</h2></div><button type="button" data-close-modal>×</button></header>
    <div class="curation-remove-warning">
      <span>!</span>
      <div><strong>Esta ação não pode ser desfeita.</strong><p>A conexão e ${conversationCount} ${conversationCount === 1 ? 'conversa vinculada será removida' : 'conversas vinculadas serão removidas'} junto com o bot.</p></div>
    </div>
    <div class="curation-modal-status" role="alert"></div>
    <footer><button type="button" class="outline-btn" data-close-modal>Cancelar</button><button type="submit" class="danger-btn">Remover bot</button></footer>
  </form>`);
  modal.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    const status = modal.querySelector('.curation-modal-status');
    button.disabled = true;
    try {
      const botIntegrationIds = new Set(integrationsForBot(bot.id).map(item => item.id));
      if (context.localMode) {
        interactions = interactions.filter(item => !botIntegrationIds.has(item.integration_id));
        integrations = integrations.filter(item => item.bot_id !== bot.id);
        bots = bots.filter(item => item.id !== bot.id);
        writeLocal();
      } else {
        const result = await context.supabase.from('chatbots').delete().eq('id', bot.id).select('id').single();
        if (result.error) throw result.error;
        interactions = interactions.filter(item => !botIntegrationIds.has(item.integration_id));
        integrations = integrations.filter(item => item.bot_id !== bot.id);
        bots = bots.filter(item => item.id !== bot.id);
      }
      if (bot.avatar_path) await removeOperationFile(bot.id).catch(() => {});
      selectedBotId = null;
      modal.remove();
      render();
    } catch (error) {
      status.textContent = error.message || 'Não foi possível remover o bot.';
      button.disabled = false;
    }
  };
}

function openReview(id) {
  const row = interactions.find(item => item.id === id);
  if (!row) return;
  const viewer = context.profile.role === 'viewer';
  const modal = showModal(`<form>
    <header><div><p class="eyebrow">CURADORIA</p><h2>Revisar resposta</h2></div><button type="button" data-close-modal>×</button></header>
    <div class="curation-review-copy"><b>PERGUNTA</b><p>${escapeHtml(row.question)}</p><b>RESPOSTA</b><p>${escapeHtml(row.answer)}</p></div>
    <div class="curation-review-grid">
      <label><span>Decisão</span><select name="status" ${viewer ? 'disabled' : ''}>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${row.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label><span>Qualidade (1 a 5)</span><select name="rating" ${viewer ? 'disabled' : ''}><option value="">Sem nota</option>${[1,2,3,4,5].map(value => `<option value="${value}" ${row.rating === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label class="wide"><span>Tags, separadas por vírgula</span><input name="categories" maxlength="300" value="${escapeHtml((row.categories || []).join(', '))}" ${viewer ? 'disabled' : ''}></label>
      <label class="wide"><span>Comentário interno</span><textarea name="notes" maxlength="5000" rows="4" ${viewer ? 'disabled' : ''}>${escapeHtml(row.review_notes || '')}</textarea></label>
    </div>
    <div class="curation-modal-status" role="alert"></div>
    <footer><button type="button" class="outline-btn" data-close-modal>Fechar</button>${viewer ? '' : '<button type="submit" class="primary-btn">Salvar curadoria</button>'}</footer>
  </form>`);
  modal.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const status = form.querySelector('.curation-modal-status');
    button.disabled = true;
    try {
      const data = new FormData(form);
      const patch = buildReviewPatch({ status: data.get('status'), rating: data.get('rating'), categories: data.get('categories'), notes: data.get('notes') }, context.user.id);
      if (context.localMode) {
        Object.assign(row, patch);
        writeLocal();
      } else {
        const result = await context.supabase.from('chatbot_interactions').update(patch).eq('id', row.id).select('*').single();
        if (result.error) throw result.error;
        Object.assign(row, normalizeInteraction(result.data));
      }
      render();
      modal.remove();
    } catch (error) {
      status.textContent = error.message || 'Não foi possível salvar a curadoria.';
      button.disabled = false;
    }
  };
}

async function copyValue(value, button) {
  await navigator.clipboard.writeText(value);
  const before = button.textContent;
  button.textContent = 'Copiado ✓';
  setTimeout(() => { button.textContent = before; }, 1500);
}

function integrationSnippet() {
  return JSON.stringify({
    event_id: "={{ $json.event_id || $execution.id + '-' + $itemIndex }}",
    occurred_at: "={{ $json.data_hora || $now }}",
    question: "={{ $json.pergunta }}",
    answer: "={{ $json.resposta }}",
    channel: "={{ $json.canal || 'web' }}",
    user_id: "={{ $json.id_usuario }}",
    session_id: "={{ $json.id_atendimento || $json.session_id }}",
    url: "={{ $json.url }}",
    response_time_ms: "={{ $json.tempo_resposta_ms || Math.round(Number(String($json.tempo_resposta || 0).replace(',', '.')) * 1000) }}"
  }, null, 2);
}

function openIntegration() {
  if (!['owner', 'admin'].includes(context.profile.role)) return;
  const bot = selectedBot();
  if (!bot) return;
  let integration = integrationsForBot(bot.id)[0] || null;
  const modal = showModal(`<form>
    <header><div><p class="eyebrow">INTEGRAÇÃO · ${escapeHtml(bot.name.toLocaleUpperCase('pt-BR'))}</p><h2>Conectar o n8n ao Doti</h2></div><button type="button" data-close-modal>×</button></header>
    <p class="curation-integration-intro">Adicione um nó <strong>HTTP Request</strong> depois do Merge. O Google Sheets pode continuar conectado em paralelo enquanto validamos a curadoria.</p>
    <div class="curation-connection-state"></div>
    <div class="curation-modal-status" role="alert"></div>
    <footer><button type="button" class="outline-btn" data-close-modal>Fechar</button><button type="submit" class="primary-btn">${integration ? 'Gerar novo segredo' : 'Criar conexão'}</button></footer>
  </form>`, 'curation-integration-modal');
  const state = modal.querySelector('.curation-connection-state');
  const renderState = secret => {
    if (!integration) {
      state.innerHTML = '<div class="curation-integration-empty"><b>Ainda não há uma conexão configurada.</b><span>Crie as credenciais para receber as próximas interações.</span></div>';
      return;
    }
    const endpoint = `${context.localMode ? 'http://127.0.0.1:54321' : context.supabase.supabaseUrl}/functions/v1/chatbot-ingest`;
    state.innerHTML = `
      <label><span>URL do POST</span><div><code>${escapeHtml(endpoint)}</code><button type="button" data-copy="endpoint">Copiar</button></div></label>
      <label><span>Header x-doti-source-key</span><div><code>${escapeHtml(integration.source_key)}</code><button type="button" data-copy="source">Copiar</button></div></label>
      ${secret ? `<label><span>Header x-doti-webhook-secret · exibido uma vez</span><div><code>${escapeHtml(secret)}</code><button type="button" data-copy="secret">Copiar</button></div></label>
      <label><span>Exemplo de body JSON para o n8n</span><textarea readonly rows="11">${escapeHtml(integrationSnippet())}</textarea></label>` : '<p class="curation-secret-note">O segredo não é armazenado em texto aberto. Gere um novo para configurá-lo no n8n.</p>'}`;
    state.querySelector('[data-copy="endpoint"]')?.addEventListener('click', event => copyValue(endpoint, event.currentTarget));
    state.querySelector('[data-copy="source"]')?.addEventListener('click', event => copyValue(integration.source_key, event.currentTarget));
    state.querySelector('[data-copy="secret"]')?.addEventListener('click', event => copyValue(secret, event.currentTarget));
  };
  renderState();
  modal.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    const status = modal.querySelector('.curation-modal-status');
    button.disabled = true;
    try {
      const credentials = generateIntegrationCredentials();
      const secretHash = await sha256(credentials.secret);
      if (context.localMode) {
        if (integration) {
          Object.assign(integration, { source_key: credentials.sourceKey, is_active: true });
        } else {
          integration = { id: crypto.randomUUID(), bot_id: bot.id, name: `${bot.name} Web`, source_key: credentials.sourceKey, is_active: true };
          integrations.push(integration);
        }
        writeLocal();
      } else if (integration) {
        const result = await context.supabase.from('chatbot_integrations').update({ source_key: credentials.sourceKey, secret_hash: secretHash, is_active: true }).eq('id', integration.id).select('id, agency_id, bot_id, name, source_key, is_active, created_by, created_at, updated_at').single();
        if (result.error) throw result.error;
        Object.assign(integration, result.data);
      } else {
        const result = await context.supabase.from('chatbot_integrations').insert({ agency_id: context.profile.agency_id, bot_id: bot.id, name: `${bot.name} Web`, source_key: credentials.sourceKey, secret_hash: secretHash, created_by: context.user.id }).select('id, agency_id, bot_id, name, source_key, is_active, created_by, created_at, updated_at').single();
        if (result.error) throw result.error;
        integration = result.data;
        integrations.push(integration);
      }
      renderState(credentials.secret);
      render();
      button.textContent = 'Gerar novo segredo';
    } catch (error) {
      status.textContent = error.message || 'Não foi possível criar a conexão.';
    } finally {
      button.disabled = false;
    }
  };
}

async function initialize() {
  if (initialized) return;
  initialized = true;
  try {
    context = await waitForOperationContext();
    const manager = ['owner', 'admin'].includes(context.profile.role);
    newBotButton.hidden = !manager;
    integrationButton.hidden = !manager;
    toggleBotStatusButton.hidden = !manager;
    removeBotButton.hidden = !manager;
    await loadData();
  } catch (error) {
    botGrid.innerHTML = `<div class="curation-empty error"><strong>Não foi possível carregar os bots</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

search.addEventListener('input', renderCuration);
statusFilter.addEventListener('change', renderCuration);
queueDateFrom.addEventListener('change', renderCuration);
queueDateTo.addEventListener('change', renderCuration);
clearQueueDatesButton.addEventListener('click', () => {
  queueDateFrom.value = '';
  queueDateTo.value = '';
  renderCuration();
});
integrationButton.addEventListener('click', openIntegration);
toggleBotStatusButton.addEventListener('click', toggleSelectedBotStatus);
removeBotButton.addEventListener('click', openRemoveBot);
newBotButton.addEventListener('click', openNewBot);
backButton.addEventListener('click', () => {
  selectedBotId = null;
  render();
});
botGrid.addEventListener('click', event => {
  const editButton = event.target.closest('[data-edit-bot]');
  if (editButton) {
    openEditBot(editButton.dataset.editBot);
    return;
  }
  const button = event.target.closest('[data-open-bot]');
  if (!button) return;
  selectedBotId = button.dataset.openBot;
  search.value = '';
  statusFilter.value = 'all';
  queueDateFrom.value = '';
  queueDateTo.value = '';
  historyDateFrom.value = '';
  historyDateTo.value = '';
  setCurationView('queue');
  render();
});
list.addEventListener('click', event => {
  const button = event.target.closest('[data-review]');
  if (button) openReview(button.closest('[data-curation-id]').dataset.curationId);
});
historyList.addEventListener('click', event => {
  const button = event.target.closest('[data-view-log]');
  if (button) openDayLog(button.closest('[data-log-day]').dataset.logDay);
});
viewButtons.forEach(button => button.addEventListener('click', () => {
  setCurationView(button.dataset.curationView);
}));
historyDateFrom.addEventListener('change', renderCuration);
historyDateTo.addEventListener('change', renderCuration);
clearHistoryDatesButton.addEventListener('click', () => {
  historyDateFrom.value = '';
  historyDateTo.value = '';
  renderCuration();
});
document.querySelector('[data-page="curadoria-chatbot"]')?.addEventListener('click', () => {
  if (initialized) {
    selectedBotId = null;
    render();
  } else {
    initialize();
  }
});
window.addEventListener('doti:auth-ready', initialize, { once: true });
if (window.dotiAuthContext) initialize();

export { initialize };
