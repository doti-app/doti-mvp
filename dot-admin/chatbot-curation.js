import { waitForOperationContext } from './operation-store.js?v=4';
import {
  buildReviewPatch,
  filterInteractions,
  generateIntegrationCredentials,
  groupInteractionsByDay,
  normalizeInteraction,
  sha256,
  summarizeInteractions
} from './chatbot-curation-core.mjs';

const LOCAL_KEY = 'doti-chatbot-curation-local-v2';
const statusLabels = {
  pending: 'Pendente',
  approved: 'Aprovada',
  needs_review: 'Precisa ajustar',
  rejected: 'Descartada'
};
const page = document.getElementById('curadoria-chatbot');
const list = document.getElementById('curationList');
const metrics = document.getElementById('curationMetrics');
const search = document.getElementById('curationSearch');
const statusFilter = document.getElementById('curationStatus');
const integrationButton = document.getElementById('curationIntegrationButton');
const queuePanel = document.getElementById('curationQueuePanel');
const historyPanel = document.getElementById('curationHistoryPanel');
const historyList = document.getElementById('curationLogList');
const viewButtons = [...document.querySelectorAll('[data-curation-view]')];
let context;
let interactions = [];
let integration = null;
let initialized = false;

function escapeHtml(value) {
  const node = document.createElement('div');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function localSeed() {
  const now = Date.now();
  return [
    {
      id: 'local-chat-1', occurred_at: new Date(now - 18 * 60000).toISOString(),
      question: 'Conhece a Crysthian da Vírgula?', answer: 'Eu sou o Virgulinha, assistente virtual da Agência Vírgula. Posso apresentar nossos serviços e ajudar com o primeiro atendimento.',
      channel: 'web', external_user_id: 'user_demo_01', external_session_id: 'session_demo_01', source_url: 'https://www.agenciavirgula.com.br', response_time_ms: 3609, status: 'pending', categories: []
    },
    {
      id: 'local-chat-2', occurred_at: new Date(now - 52 * 60000).toISOString(),
      question: 'Estou triste hoje, Virgulinha', answer: 'Poxa, sinto muito que esteja assim. Se quiser, podemos conversar brevemente e depois pensar em como a comunicação da sua marca pode ficar mais leve.',
      channel: 'web', external_user_id: 'user_demo_02', external_session_id: 'session_demo_02', source_url: 'https://www.agenciavirgula.com.br', response_time_ms: 2808, status: 'needs_review', rating: 3, categories: ['tom de voz'], review_notes: 'Resposta empática, mas deve evitar desviar para uma oferta comercial.'
    },
    {
      id: 'local-chat-3', occurred_at: new Date(now - 26 * 60 * 60000).toISOString(),
      question: 'Você sabe sobre a Copa do Mundo?', answer: 'Sei um pouco, mas meu foco é ajudar com marketing, posicionamento e os serviços da Agência Vírgula.',
      channel: 'web', external_user_id: 'user_demo_03', external_session_id: 'session_demo_03', source_url: 'https://www.agenciavirgula.com.br', response_time_ms: 2957, status: 'approved', rating: 4, categories: ['fora de escopo'], review_notes: 'Boa contenção de escopo.'
    }
  ].map(normalizeInteraction);
}

function readLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (saved?.interactions?.length) return saved;
  } catch (_) {}
  return { interactions: localSeed(), integration: null };
}

function writeLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ interactions, integration }));
}

async function loadData() {
  list.innerHTML = '<div class="curation-empty">Carregando conversas…</div>';
  if (context.localMode) {
    const local = readLocal();
    interactions = local.interactions.map(normalizeInteraction);
    integration = local.integration;
    render();
    return;
  }
  const [interactionResult, integrationResult] = await Promise.all([
    context.supabase.from('chatbot_interactions').select('*').order('occurred_at', { ascending: false }).limit(500),
    context.supabase.from('chatbot_integrations').select('id, agency_id, name, source_key, is_active, created_by, created_at, updated_at').order('created_at').limit(1).maybeSingle()
  ]);
  if (interactionResult.error) throw interactionResult.error;
  if (integrationResult.error) throw integrationResult.error;
  interactions = (interactionResult.data || []).map(normalizeInteraction);
  integration = integrationResult.data;
  render();
}

function render() {
  const summary = summarizeInteractions(interactions);
  metrics.innerHTML = `
    <article><span>PENDENTES</span><strong>${summary.pending}</strong><small>aguardando análise</small></article>
    <article><span>APROVADAS</span><strong>${summary.approved}</strong><small>respostas validadas</small></article>
    <article><span>PARA AJUSTAR</span><strong>${summary.needs_review}</strong><small>insumos para o bot</small></article>
    <article><span>TEMPO MÉDIO</span><strong>${summary.average_ms == null ? '—' : `${(summary.average_ms / 1000).toFixed(1)}s`}</strong><small>${summary.total} interações</small></article>`;
  document.getElementById('curationNavCount').textContent = summary.pending;
  integrationButton.textContent = integration ? 'Configurar conexão' : '+ Conectar n8n';
  renderHistory();
  const filtered = filterInteractions(interactions, { status: statusFilter.value, search: search.value });
  if (!filtered.length) {
    list.innerHTML = '<div class="curation-empty"><span>✓</span><strong>Nenhuma conversa encontrada</strong><p>A fila está em dia ou os filtros não encontraram resultados.</p></div>';
    return;
  }
  list.innerHTML = filtered.map(row => `
    <article class="curation-card" data-curation-id="${escapeHtml(row.id)}">
      <header>
        <div><span class="curation-status ${row.status}">${statusLabels[row.status]}</span><time>${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.occurred_at))}</time></div>
        <div class="curation-meta"><span>${escapeHtml(row.channel)}</span>${row.response_time_ms == null ? '' : `<span>${(row.response_time_ms / 1000).toFixed(1)}s</span>`}${row.external_user_id ? `<span>${escapeHtml(row.external_user_id)}</span>` : ''}</div>
      </header>
      <div class="curation-dialogue">
        <div><b>PERGUNTA</b><p>${escapeHtml(row.question)}</p></div>
        <div><b>RESPOSTA DO VIRGULINHA</b><p>${escapeHtml(row.answer)}</p></div>
      </div>
      <footer>
        <div class="curation-tags">${(row.categories || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}${row.rating ? `<span class="rating">${'★'.repeat(row.rating)}${'☆'.repeat(5 - row.rating)}</span>` : ''}</div>
        <button class="outline-btn" type="button" data-review>Revisar resposta →</button>
      </footer>
    </article>`).join('');
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

function renderHistory() {
  const groups = groupInteractionsByDay(interactions);
  if (!groups.length) {
    historyList.innerHTML = '<div class="curation-empty"><span>○</span><strong>Nenhum log recebido</strong><p>As conversas aparecerão aqui assim que o n8n enviar a primeira interação.</p></div>';
    return;
  }
  historyList.innerHTML = groups.map(group => `
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

function openDayLog(dayKey) {
  const group = groupInteractionsByDay(interactions).find(item => item.key === dayKey);
  if (!group) return;
  const modal = showModal(`<div class="curation-log-modal-card">
    <header>
      <div><p class="eyebrow">LOG DE CONVERSA</p><h2>${escapeHtml(capitalizeFirst(new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(dateFromDayKey(group.key))))}</h2><span>${group.message_count} mensagens · ${group.user_count} usuários · ${group.session_count} sessões</span></div>
      <button type="button" data-close-modal>×</button>
    </header>
    <div class="curation-log-detail-list">
      ${group.interactions.map((row, index) => `
        <article class="curation-log-detail">
          <div class="curation-log-detail-number"><span>${String(index + 1).padStart(2, '0')}</span><time>${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(row.occurred_at))}</time></div>
          <div class="curation-log-message"><b>PERGUNTA</b><p>${escapeHtml(row.question)}</p></div>
          <div class="curation-log-message answer"><b>RESPOSTA DO VIRGULINHA</b><p>${escapeHtml(row.answer)}</p></div>
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
  return modal;
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
  const modal = showModal(`<form>
    <header><div><p class="eyebrow">INTEGRAÇÃO</p><h2>Conectar o n8n ao Doti</h2></div><button type="button" data-close-modal>×</button></header>
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
        integration = { id: 'local-integration', name: 'Virgulinha Web', source_key: credentials.sourceKey, is_active: true };
        writeLocal();
      } else if (integration) {
        const result = await context.supabase.from('chatbot_integrations').update({ source_key: credentials.sourceKey, secret_hash: secretHash, is_active: true }).eq('id', integration.id).select('id, agency_id, name, source_key, is_active, created_by, created_at, updated_at').single();
        if (result.error) throw result.error;
        integration = result.data;
      } else {
        const result = await context.supabase.from('chatbot_integrations').insert({ agency_id: context.profile.agency_id, name: 'Virgulinha Web', source_key: credentials.sourceKey, secret_hash: secretHash, created_by: context.user.id }).select('id, agency_id, name, source_key, is_active, created_by, created_at, updated_at').single();
        if (result.error) throw result.error;
        integration = result.data;
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
    integrationButton.hidden = !['owner', 'admin'].includes(context.profile.role);
    await loadData();
  } catch (error) {
    list.innerHTML = `<div class="curation-empty error"><strong>Não foi possível carregar a curadoria</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

search.addEventListener('input', render);
statusFilter.addEventListener('change', render);
integrationButton.addEventListener('click', openIntegration);
list.addEventListener('click', event => {
  const button = event.target.closest('[data-review]');
  if (button) openReview(button.closest('[data-curation-id]').dataset.curationId);
});
historyList.addEventListener('click', event => {
  const button = event.target.closest('[data-view-log]');
  if (button) openDayLog(button.closest('[data-log-day]').dataset.logDay);
});
viewButtons.forEach(button => button.addEventListener('click', () => {
  const history = button.dataset.curationView === 'history';
  queuePanel.hidden = history;
  historyPanel.hidden = !history;
  viewButtons.forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
}));
document.querySelector('[data-page="curadoria-chatbot"]')?.addEventListener('click', initialize);
window.addEventListener('doti:auth-ready', initialize, { once: true });
if (window.dotiAuthContext) initialize();

export { initialize };
