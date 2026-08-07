import {
  buildCampaignResultsCsv,
  parseCsv,
  prepareCsvRecipients,
  preparePastedRecipients,
  renderTemplatePreview,
  requiredTemplateParams,
  templateBody
} from '../domain/campaign-utils.mjs';

/** @param {{ auth: any, document?: Document }} dependencies */
export function createWhatsappDomain({ auth, document: documentRef = globalThis.document }) {
const document = documentRef;

const connectionSection = document.getElementById('whatsappConnection');
const setupCard = document.getElementById('whatsappSetupCard');
const setupTitle = document.getElementById('whatsappSetupTitle');
const form = document.getElementById('whatsappCredentialsForm');
const formStatus = document.getElementById('whatsappFormStatus');
const notice = document.getElementById('whatsappNotice');
const replaceButton = document.getElementById('replaceWhatsappCredentials');
const cancelButton = document.getElementById('cancelWhatsappCredentials');
const testButton = document.getElementById('testWhatsappConnection');
const syncButton = document.getElementById('syncWhatsappTemplates');
const templateList = document.getElementById('whatsappTemplateList');
const navStatus = document.getElementById('whatsappNavStatus');
const newCampaignButton = document.getElementById('newWhatsappCampaign');
const campaignList = document.getElementById('whatsappCampaignList');
const campaignFilter = document.getElementById('whatsappCampaignFilter');
const campaignModal = document.getElementById('whatsappCampaignModal');
const campaignForm = document.getElementById('whatsappCampaignForm');
const wizardStatus = document.getElementById('whatsappWizardStatus');
const wizardBack = document.getElementById('whatsappWizardBack');
const wizardNext = document.getElementById('whatsappWizardNext');
const campaignNameInput = document.getElementById('whatsappCampaignName');
const templatePicker = document.getElementById('whatsappTemplatePicker');
const campaignCsvInput = document.getElementById('whatsappCampaignCsv');
const campaignPasteInput = document.getElementById('whatsappCampaignPaste');
const mappingList = document.getElementById('whatsappMappingList');
const resultsPanel = document.getElementById('whatsappResultsPanel');
const resultsBody = document.getElementById('whatsappResultsBody');
const recipientStatusFilter = document.getElementById('whatsappRecipientStatusFilter');

const connectionIdInput = document.getElementById('whatsappConnectionId');
const wabaInput = document.getElementById('whatsappWabaInput');
const phoneInput = document.getElementById('whatsappPhoneInput');
const tokenInput = document.getElementById('whatsappTokenInput');

let authContext;
let currentConnection;
let rollout = { release_stage: 'disabled', sending_enabled: false };
let templates = [];
let campaigns = [];
let recipientCounts = new Map();
let wizard = {};
let selectedCampaignId = null;
let campaignRecipients = [];
let refreshTimer = null;

const CAMPAIGN_GROUPS = {
  draft: ['draft'],
  processing: ['scheduled', 'queued', 'running'],
  completed: ['completed'],
  failed: ['failed', 'cancelled']
};

const CAMPAIGN_STATUS = {
  draft: ['Rascunho', 'draft'],
  scheduled: ['Agendada', 'processing'],
  queued: ['Na fila', 'processing'],
  running: ['Processando', 'processing'],
  completed: ['Concluída', 'completed'],
  cancelled: ['Cancelada', 'failed'],
  failed: ['Com falha', 'failed']
};

const STATUS_LABELS = {
  active: 'Conectada',
  attention: 'Requer atenção',
  disconnected: 'Desconectada'
};

const RECIPIENT_STATUS = {
  pending: ['Pendente', 'pending'],
  queued: ['Pendente', 'pending'],
  accepted: ['Aceito', 'accepted'],
  sent: ['Enviado', 'sent'],
  delivered: ['Entregue', 'delivered'],
  read: ['Lido', 'read'],
  failed: ['Falhou', 'failed'],
  skipped: ['Falhou', 'failed']
};

const CATEGORY_LABELS = {
  authentication: 'Autenticação',
  marketing: 'Marketing',
  utility: 'Utilidade'
};

function setNotice(message = '', attention = false) {
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle('error', attention);
}

function setFormStatus(message = '', attention = false) {
  formStatus.textContent = message;
  formStatus.classList.toggle('error', attention);
}

function formatDate(value) {
  if (!value) return 'Ainda não realizada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function bodyPreview(template) {
  const body = (template.components || []).find(
    component => String(component?.type || '').toLowerCase() === 'body'
  );
  return String(body?.text || 'Template sem texto de prévia.');
}

function renderTemplates() {
  document.getElementById('whatsappTemplateCount').textContent = String(templates.length);
  templateList.replaceChildren();
  if (!templates.length) {
    const empty = document.createElement('div');
    empty.className = 'whatsapp-template-empty';
    const strong = document.createElement('strong');
    strong.textContent = 'Nenhum template aprovado';
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Quando a Meta aprovar um modelo, sincronize novamente para disponibilizá-lo na DOTI.';
    empty.append(strong, paragraph);
    templateList.appendChild(empty);
    return;
  }

  templates.forEach(template => {
    const card = document.createElement('article');
    card.className = 'whatsapp-template-card';
    const header = document.createElement('header');
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = template.name;
    const language = document.createElement('span');
    language.textContent = template.language;
    identity.append(name, language);
    const category = document.createElement('b');
    category.textContent = CATEGORY_LABELS[template.category] || template.category;
    header.append(identity, category);

    const preview = document.createElement('p');
    preview.textContent = bodyPreview(template);
    const footer = document.createElement('footer');
    const parameters = Array.isArray(template.parameters) ? template.parameters : [];
    const parameterCount = document.createElement('span');
    parameterCount.textContent = parameters.length
      ? `${parameters.length} ${parameters.length === 1 ? 'parâmetro' : 'parâmetros'}`
      : 'Sem parâmetros';
    const synced = document.createElement('time');
    synced.dateTime = template.synced_at || '';
    synced.textContent = `Sincronizado ${formatDate(template.synced_at)}`;
    footer.append(parameterCount, synced);
    card.append(header, preview, footer);
    templateList.appendChild(card);
  });
}

function campaignGroup(status) {
  return Object.entries(CAMPAIGN_GROUPS).find(([, statuses]) => statuses.includes(status))?.[0] || 'failed';
}

function renderCampaigns() {
  Object.entries(CAMPAIGN_GROUPS).forEach(([group, statuses]) => {
    const count = campaigns.filter(campaign => statuses.includes(campaign.status)).length;
    const target = document.getElementById(`whatsapp${group[0].toUpperCase()}${group.slice(1)}Count`);
    if (target) target.textContent = String(count);
  });
  const filter = campaignFilter.value;
  const visible = campaigns.filter(campaign => filter === 'all' || campaignGroup(campaign.status) === filter);
  campaignList.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'whatsapp-campaign-empty';
    empty.textContent = campaigns.length
      ? 'Nenhuma campanha corresponde a este filtro.'
      : 'Nenhuma campanha criada. Comece preparando um disparo guiado.';
    campaignList.appendChild(empty);
    return;
  }
  visible.forEach(campaign => {
    const row = document.createElement('article');
    row.className = 'whatsapp-campaign-row';
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = campaign.name;
    const created = document.createElement('span');
    created.textContent = `Criada ${formatDate(campaign.created_at)}`;
    identity.append(name, created);
    const template = templates.find(item => item.id === campaign.template_id);
    const templateInfo = document.createElement('div');
    const templateName = document.createElement('strong');
    templateName.textContent = template?.name || 'Template indisponível';
    const language = document.createElement('span');
    language.textContent = template?.language || '—';
    templateInfo.append(templateName, language);
    const recipientCount = document.createElement('span');
    const count = recipientCounts.get(campaign.id) || 0;
    const processed = Number(campaign.successful_count || 0) + Number(campaign.failed_count || 0);
    recipientCount.textContent = campaign.status === 'draft'
      ? `${count} ${count === 1 ? 'contato' : 'contatos'}`
      : `${processed}/${count} processados`;
    const badge = document.createElement('b');
    const [statusLabel, statusGroup] = CAMPAIGN_STATUS[campaign.status] || ['Status desconhecido', 'failed'];
    badge.textContent = statusLabel;
    badge.dataset.status = statusGroup;
    const updated = document.createElement('time');
    updated.dateTime = campaign.updated_at || '';
    updated.textContent = formatDate(campaign.updated_at);
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'whatsapp-campaign-details';
    details.textContent = 'Ver resultados';
    details.addEventListener('click', () => loadCampaignRecipients(campaign.id));
    row.append(identity, templateInfo, recipientCount, badge, updated, details);
    campaignList.appendChild(row);
  });
}

async function loadCampaigns() {
  const { data, error } = await authContext.supabase
    .from('meta_campaigns')
    .select('id,connection_id,template_id,name,status,failure_reason,total_count,pending_count,successful_count,accepted_count,sent_count,delivered_count,read_count,failed_count,created_at,updated_at')
    .eq('agency_id', authContext.profile.agency_id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  campaigns = data || [];
  recipientCounts = new Map(campaigns.map(campaign => [campaign.id, Number(campaign.total_count || 0)]));
  if (campaigns.some(campaign => campaign.status === 'draft' && !campaign.total_count)) {
    const { data: recipients, error: recipientError } = await authContext.supabase
      .from('meta_campaign_recipients')
      .select('campaign_id')
      .eq('agency_id', authContext.profile.agency_id)
      .in('campaign_id', campaigns.map(campaign => campaign.id));
    if (recipientError) throw recipientError;
    const draftIds = new Set(campaigns.filter(campaign => campaign.status === 'draft').map(campaign => campaign.id));
    (recipients || []).forEach(recipient => {
      if (draftIds.has(recipient.campaign_id)) {
        recipientCounts.set(recipient.campaign_id, (recipientCounts.get(recipient.campaign_id) || 0) + 1);
      }
    });
  }
  renderCampaigns();
}

function recipientStatusGroup(status) {
  return RECIPIENT_STATUS[status]?.[1] || 'failed';
}

function visibleCampaignRecipients() {
  const filter = recipientStatusFilter.value;
  return campaignRecipients.filter(recipient => filter === 'all' || recipientStatusGroup(recipient.status) === filter);
}

function renderCampaignResults() {
  const campaign = campaigns.find(item => item.id === selectedCampaignId);
  if (!campaign) {
    resultsPanel.hidden = true;
    selectedCampaignId = null;
    return;
  }
  resultsPanel.hidden = false;
  document.getElementById('whatsappResultsTitle').textContent = campaign.name;
  document.getElementById('whatsappResultsUpdated').textContent = `Última atualização ${formatDate(campaign.updated_at)} · total ${campaign.total_count || campaignRecipients.length}`;
  const metrics = { pending: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  campaignRecipients.forEach(recipient => { metrics[recipientStatusGroup(recipient.status)] += 1; });
  Object.entries(metrics).forEach(([status, count]) => {
    const target = document.getElementById(`whatsappMetric${status[0].toUpperCase()}${status.slice(1)}`);
    if (target) target.textContent = String(count);
  });

  const visible = visibleCampaignRecipients();
  resultsBody.replaceChildren();
  visible.forEach(recipient => {
    const row = document.createElement('tr');
    const phone = document.createElement('td');
    phone.textContent = recipient.phone_e164;
    const statusCell = document.createElement('td');
    const badge = document.createElement('span');
    const [label, group] = RECIPIENT_STATUS[recipient.status] || ['Desconhecido', 'failed'];
    badge.className = 'whatsapp-recipient-status';
    badge.dataset.status = group;
    badge.textContent = label;
    statusCell.appendChild(badge);
    const attempts = document.createElement('td');
    attempts.textContent = `${recipient.attempt_count || 0}/3`;
    const wamid = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = recipient.meta_message_id || '—';
    code.title = recipient.meta_message_id || '';
    wamid.appendChild(code);
    const updated = document.createElement('td');
    updated.textContent = formatDate(recipient.updated_at);
    const error = document.createElement('td');
    error.textContent = recipient.error_message
      ? `${recipient.error_code ? `${recipient.error_code}: ` : ''}${recipient.error_message}`
      : '—';
    row.append(phone, statusCell, attempts, wamid, updated, error);
    resultsBody.appendChild(row);
  });
  document.getElementById('whatsappResultsEmpty').hidden = visible.length > 0;
}

async function loadCampaignRecipients(campaignId, silent = false) {
  if (!campaigns.some(campaign => campaign.id === campaignId)) return;
  const { data, error } = await authContext.supabase
    .from('meta_campaign_recipients')
    .select('id,campaign_id,phone_e164,status,attempt_count,meta_message_id,error_code,error_message,accepted_at,sent_at,delivered_at,read_at,failed_at,updated_at')
    .eq('agency_id', authContext.profile.agency_id)
    .eq('campaign_id', campaignId)
    .order('created_at');
  if (error) {
    if (!silent) setNotice('Não foi possível carregar os resultados desta campanha.', true);
    return;
  }
  selectedCampaignId = campaignId;
  campaignRecipients = data || [];
  renderCampaignResults();
  if (!silent) resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function exportCampaignResults() {
  const campaign = campaigns.find(item => item.id === selectedCampaignId);
  if (!campaign) return;
  const labels = Object.fromEntries(Object.entries(RECIPIENT_STATUS).map(([status, [label]]) => [status, label]));
  const csv = buildCampaignResultsCsv(visibleCampaignRecipients(), labels);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${campaign.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'campanha'}-resultados.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderConnection() {
  const hasConnection = Boolean(currentConnection);
  const rolloutEnabled = rollout.sending_enabled && ['pilot', 'general'].includes(rollout.release_stage);
  connectionSection.hidden = !hasConnection;
  replaceButton.hidden = !hasConnection || !canManage() || !rolloutEnabled;
  navStatus.textContent = hasConnection ? '●' : '';
  navStatus.classList.toggle('attention', currentConnection?.status === 'attention');
  newCampaignButton.disabled = !rolloutEnabled || !canManage() || !hasConnection || !templates.length;
  newCampaignButton.title = !rolloutEnabled
    ? 'O WhatsApp ainda não foi liberado para esta agência.'
    : !canManage()
    ? 'Somente proprietário ou administrador pode criar campanhas.'
    : !hasConnection
      ? 'Conecte uma conta da Meta antes de criar campanhas.'
      : !templates.length
        ? 'Sincronize ao menos um template aprovado.'
        : '';
  if (!hasConnection) {
    setupCard.hidden = !canManage() || !rolloutEnabled;
    renderTemplates();
    return;
  }

  document.getElementById('whatsappAccountName').textContent = currentConnection.name || 'Conta do WhatsApp';
  document.getElementById('whatsappPhoneNumber').textContent = currentConnection.display_phone_number || 'Número não informado pela Meta';
  document.getElementById('whatsappWabaId').textContent = currentConnection.whatsapp_business_account_id;
  document.getElementById('whatsappPhoneId').textContent = currentConnection.phone_number_id;
  document.getElementById('whatsappLastVerified').textContent = formatDate(currentConnection.last_verified_at);
  document.getElementById('whatsappLastSynced').textContent = formatDate(currentConnection.last_synced_at);
  const status = document.getElementById('whatsappConnectionStatus');
  status.textContent = STATUS_LABELS[currentConnection.status] || 'Status desconhecido';
  status.dataset.status = currentConnection.status;
  testButton.disabled = !canManage() || !rolloutEnabled;
  syncButton.disabled = !canManage() || !rolloutEnabled;
  setupCard.hidden = true;
  renderTemplates();
}

function canManage() {
  return ['owner', 'admin'].includes(authContext?.profile?.role);
}

async function integrationRequest(action, body = {}) {
  const { data, error } = await authContext.supabase.functions.invoke('meta-integration', {
    body: { action, ...body }
  });
  if (!error) return data;
  let message = error.message;
  try {
    const payload = await error.context?.json();
    message = payload?.error || message;
  } catch (_) {}
  throw new Error(message || 'Não foi possível concluir a operação com a Meta.');
}

async function loadWhatsappData() {
  setNotice('');
  const [connectionResult, rolloutResult] = await Promise.all([
    authContext.supabase
      .from('meta_connections')
      .select('id,agency_id,name,whatsapp_business_account_id,phone_number_id,display_phone_number,status,last_verified_at,last_synced_at,updated_at')
      .eq('agency_id', authContext.profile.agency_id)
      .order('updated_at', { ascending: false })
      .limit(1),
    authContext.supabase
      .from('meta_whatsapp_rollouts')
      .select('release_stage,sending_enabled')
      .eq('agency_id', authContext.profile.agency_id)
      .limit(1)
  ]);
  const { data: connections, error: connectionError } = connectionResult;
  if (connectionError) throw connectionError;
  if (rolloutResult.error) throw rolloutResult.error;
  rollout = rolloutResult.data?.[0] || { release_stage: 'disabled', sending_enabled: false };
  currentConnection = connections?.[0] || null;

  if (!rollout.sending_enabled || !['pilot', 'general'].includes(rollout.release_stage)) {
    setNotice('A nova operação de WhatsApp está em liberação gradual e ainda não foi habilitada para esta agência.', true);
  } else if (rollout.release_stage === 'pilot') {
    setNotice('Agência piloto: os disparos estão restritos aos números internos previamente autorizados.');
  } else if (!canManage()) {
    setNotice('Você pode consultar campanhas e resultados. Somente proprietário ou administrador pode configurar e disparar.');
  }

  if (!currentConnection) {
    templates = [];
    renderConnection();
    await loadCampaigns();
    return;
  }
  const { data, error } = await authContext.supabase
    .from('meta_templates')
    .select('id,name,language,category,components,parameters,synced_at')
    .eq('agency_id', authContext.profile.agency_id)
    .eq('connection_id', currentConnection.id)
    .eq('status', 'approved')
    .order('name');
  if (error) throw error;
  templates = data || [];
  renderConnection();
  await loadCampaigns();
}

function setButtonsBusy(activeButton, busyLabel) {
  const buttons = [replaceButton, cancelButton, testButton, syncButton, form.querySelector('[type="submit"]')];
  buttons.forEach(button => { if (button) button.disabled = true; });
  const original = activeButton.textContent;
  activeButton.textContent = busyLabel;
  return () => {
    buttons.forEach(button => { if (button) button.disabled = false; });
    activeButton.textContent = original;
  };
}

function openCredentialsForm() {
  setupTitle.textContent = currentConnection ? 'Substituir credenciais' : 'Conectar conta da Meta';
  connectionIdInput.value = currentConnection?.id || '';
  wabaInput.value = currentConnection?.whatsapp_business_account_id || '';
  phoneInput.value = currentConnection?.phone_number_id || '';
  tokenInput.value = '';
  cancelButton.hidden = !currentConnection;
  setupCard.hidden = false;
  setFormStatus('');
  setupCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  wabaInput.focus({ preventScroll: true });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!canManage()) return;
  if (!form.reportValidity()) return;
  const submit = form.querySelector('[type="submit"]');
  const restore = setButtonsBusy(submit, 'Validando na Meta…');
  setFormStatus('Validando conta, número e templates aprovados…');
  setNotice('');
  try {
    await integrationRequest('connection.save', {
      connectionId: connectionIdInput.value || undefined,
      whatsappBusinessAccountId: wabaInput.value.trim(),
      phoneNumberId: phoneInput.value.trim(),
      accessToken: tokenInput.value.trim()
    });
    tokenInput.value = '';
    setFormStatus('');
    await loadWhatsappData();
    setupCard.hidden = true;
    setNotice('Conta validada e templates aprovados sincronizados com sucesso.');
  } catch (error) {
    setFormStatus(error.message || 'Não foi possível validar as credenciais.', true);
    tokenInput.value = '';
    tokenInput.focus();
  } finally {
    restore();
  }
});

replaceButton.addEventListener('click', openCredentialsForm);
cancelButton.addEventListener('click', () => {
  tokenInput.value = '';
  setFormStatus('');
  setupCard.hidden = Boolean(currentConnection);
});

testButton.addEventListener('click', async () => {
  if (!currentConnection || !canManage()) return;
  const restore = setButtonsBusy(testButton, 'Testando…');
  setNotice('Testando a conexão com a Meta…');
  try {
    await integrationRequest('connection.test', { connectionId: currentConnection.id });
    await loadWhatsappData();
    setNotice('Conexão validada com sucesso.');
  } catch (error) {
    await loadWhatsappData().catch(() => {});
    setNotice(error.message || 'A conexão não pôde ser validada.', true);
  } finally {
    restore();
  }
});

syncButton.addEventListener('click', async () => {
  if (!currentConnection || !canManage()) return;
  const restore = setButtonsBusy(syncButton, 'Sincronizando…');
  setNotice('Consultando os templates aprovados na Meta…');
  try {
    const result = await integrationRequest('templates.sync', { connectionId: currentConnection.id });
    await loadWhatsappData();
    const count = Number(result?.sync?.approvedCount || templates.length);
    setNotice(`${count} ${count === 1 ? 'template aprovado sincronizado' : 'templates aprovados sincronizados'}.`);
  } catch (error) {
    await loadWhatsappData().catch(() => {});
    setNotice(error.message || 'Não foi possível sincronizar os templates.', true);
  } finally {
    restore();
  }
});

function selectedWizardTemplate() {
  return templates.find(template => template.id === wizard.templateId) || null;
}

function setWizardStatus(message = '', attention = false) {
  wizardStatus.textContent = message;
  wizardStatus.classList.toggle('error', attention);
}

function setWizardStep(step) {
  wizard.step = step;
  document.querySelectorAll('[data-wizard-step]').forEach(pane => {
    pane.hidden = Number(pane.dataset.wizardStep) !== step;
  });
  document.querySelectorAll('[data-wizard-indicator]').forEach(indicator => {
    const indicatorStep = Number(indicator.dataset.wizardIndicator);
    indicator.classList.toggle('active', indicatorStep === step);
    indicator.classList.toggle('done', indicatorStep < step);
  });
  wizardBack.hidden = step === 1;
  wizardNext.textContent = step === 5 ? 'Confirmar disparo agora' : 'Continuar';
  setWizardStatus('');
  campaignForm.querySelector('.whatsapp-wizard-body').scrollTop = 0;
}

function renderTemplatePicker() {
  templatePicker.replaceChildren();
  templates.forEach(template => {
    const label = document.createElement('label');
    label.className = 'whatsapp-template-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'whatsappTemplate';
    input.value = template.id;
    input.checked = template.id === wizard.templateId;
    input.addEventListener('change', () => { wizard.templateId = template.id; });
    const card = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = template.name;
    const details = document.createElement('b');
    const count = requiredTemplateParams(template).length;
    details.textContent = `${template.language} · ${count ? `${count} ${count === 1 ? 'variável' : 'variáveis'}` : 'sem variáveis'}`;
    const preview = document.createElement('p');
    preview.textContent = templateBody(template);
    card.append(name, details, preview);
    label.append(input, card);
    templatePicker.appendChild(label);
  });
}

function resetWizard() {
  wizard = { step: 1, source: 'csv', templateId: '', csv: null, result: null, campaignId: null };
  campaignForm.reset();
  document.getElementById('whatsappCsvFileName').textContent = 'Cabeçalho obrigatório; até 100 contatos válidos.';
  document.getElementById('whatsappCampaignConfirmation').checked = false;
  renderTemplatePicker();
  setRecipientSource('csv');
  setWizardStep(1);
}

function openCampaignWizard() {
  if (newCampaignButton.disabled) return;
  resetWizard();
  campaignModal.hidden = false;
  document.body.style.overflow = 'hidden';
  campaignNameInput.focus();
}

function closeCampaignWizard() {
  campaignModal.hidden = true;
  document.body.style.overflow = '';
}

function setRecipientSource(source) {
  const template = selectedWizardTemplate();
  const requiresCsv = requiredTemplateParams(template).length > 0;
  wizard.source = requiresCsv ? 'csv' : source;
  document.querySelectorAll('[data-recipient-source]').forEach(button => {
    button.disabled = button.dataset.recipientSource === 'paste' && requiresCsv;
    button.classList.toggle('active', button.dataset.recipientSource === wizard.source);
  });
  document.getElementById('whatsappCsvSource').hidden = wizard.source !== 'csv';
  document.getElementById('whatsappPasteSource').hidden = wizard.source !== 'paste';
  const hint = document.getElementById('whatsappRecipientHint');
  hint.classList.remove('error');
  hint.textContent = requiresCsv
    ? 'Este template possui variáveis. Use um CSV com uma coluna para cada parâmetro obrigatório.'
    : 'Você pode usar CSV ou colar um número por linha. Duplicados serão removidos automaticamente.';
}

function normalizedLabel(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function suggestedColumn(headers, names) {
  const normalizedNames = names.map(normalizedLabel);
  return headers.find(header => normalizedNames.includes(normalizedLabel(header))) || '';
}

function mappingSelect(headers, selected, key, type) {
  const select = document.createElement('select');
  select.dataset.mappingKey = key;
  select.dataset.mappingType = type;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecione uma coluna';
  select.appendChild(placeholder);
  headers.forEach(header => {
    const option = document.createElement('option');
    option.value = header;
    option.textContent = header;
    option.selected = header === selected;
    select.appendChild(option);
  });
  return select;
}

function appendMappingRow(label, detail, select) {
  const row = document.createElement('label');
  row.className = 'whatsapp-mapping-row';
  const target = document.createElement('div');
  const targetLabel = document.createElement('span');
  targetLabel.textContent = detail;
  const targetName = document.createElement('strong');
  targetName.textContent = label;
  target.append(targetLabel, targetName);
  const arrow = document.createElement('b');
  arrow.textContent = '←';
  const source = document.createElement('div');
  const sourceLabel = document.createElement('span');
  sourceLabel.textContent = 'COLUNA DO CSV';
  source.append(sourceLabel, select);
  row.append(target, arrow, source);
  mappingList.appendChild(row);
}

function renderMappings() {
  mappingList.replaceChildren();
  const template = selectedWizardTemplate();
  const parameters = requiredTemplateParams(template);
  if (wizard.source === 'paste') {
    document.getElementById('whatsappMappingCopy').textContent = 'Este template não possui variáveis. Os números já estão prontos para validação.';
    const empty = document.createElement('div');
    empty.className = 'whatsapp-campaign-empty';
    empty.textContent = 'Nenhum mapeamento necessário.';
    mappingList.appendChild(empty);
    return;
  }
  const headers = wizard.csv.headers;
  document.getElementById('whatsappMappingCopy').textContent = 'Associe o número e cada variável obrigatória a uma coluna diferente. A campanha só avança com todas as correspondências.';
  const phoneSuggestion = suggestedColumn(headers, ['telefone', 'numero', 'número', 'phone', 'whatsapp', 'celular']);
  appendMappingRow('Número do WhatsApp', 'DESTINATÁRIO', mappingSelect(headers, phoneSuggestion, 'phone', 'phone'));
  parameters.forEach(parameter => {
    const suggestion = suggestedColumn(headers, [parameter.name]);
    appendMappingRow(`{{${parameter.name}}}`, `${String(parameter.component || 'body').toUpperCase()} · OBRIGATÓRIA`, mappingSelect(headers, suggestion, parameter.name, 'variable'));
  });
}

function collectMappedRecipients() {
  if (wizard.source === 'paste') return preparePastedRecipients(campaignPasteInput.value);
  const selects = [...mappingList.querySelectorAll('select')];
  if (selects.some(select => !select.value)) {
    throw new Error('Selecione uma coluna para o número e para cada variável obrigatória.');
  }
  const selectedColumns = selects.map(select => select.value);
  if (new Set(selectedColumns).size !== selectedColumns.length) {
    throw new Error('Use uma coluna diferente para o número e para cada parâmetro.');
  }
  const phoneColumn = selects.find(select => select.dataset.mappingType === 'phone')?.value;
  const mappings = Object.fromEntries(
    selects.filter(select => select.dataset.mappingType === 'variable')
      .map(select => [select.dataset.mappingKey, select.value])
  );
  return prepareCsvRecipients(wizard.csv, phoneColumn, mappings);
}

function renderReview() {
  const result = wizard.result;
  const template = selectedWizardTemplate();
  document.getElementById('whatsappReviewAccepted').textContent = String(result.accepted.length);
  document.getElementById('whatsappReviewIgnored').textContent = String(result.duplicates.length);
  document.getElementById('whatsappReviewRejected').textContent = String(result.rejected.length);
  const limit = document.getElementById('whatsappCampaignLimit');
  limit.hidden = result.accepted.length <= 100;
  limit.textContent = result.accepted.length > 100
    ? `Esta campanha tem ${result.accepted.length} contatos válidos. O limite é 100: divida o arquivo em listas menores para continuar.`
    : '';

  const summary = document.getElementById('whatsappReviewSummary');
  summary.replaceChildren();
  [['Campanha', campaignNameInput.value.trim()], ['Template', template.name], ['Idioma', template.language], ['Origem', wizard.source === 'csv' ? 'Arquivo CSV' : 'Colagem simples']]
    .forEach(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      summary.append(term, detail);
    });
  const rejected = document.getElementById('whatsappRejectedDetails');
  const issues = result.rejected.slice(0, 5).map(item => `Linha ${item.line}: ${item.reason}`);
  rejected.textContent = issues.length
    ? `${issues.join(' · ')}${result.rejected.length > 5 ? ` · e mais ${result.rejected.length - 5}` : ''}`
    : 'Nenhuma linha rejeitada.';

  const previewRecipient = document.getElementById('whatsappPreviewRecipient');
  previewRecipient.replaceChildren();
  result.accepted.slice(0, 5).forEach((recipient, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = recipient.phone;
    previewRecipient.appendChild(option);
  });
  const updatePreview = () => {
    const recipient = result.accepted[Number(previewRecipient.value || 0)];
    document.getElementById('whatsappMessagePreview').textContent = recipient
      ? renderTemplatePreview(template, recipient.variables)
      : 'Nenhum destinatário válido para gerar a prévia.';
  };
  previewRecipient.onchange = updatePreview;
  updatePreview();
}

async function saveReviewDraft() {
  const result = wizard.result;
  if (!result.accepted.length || result.accepted.length > 100) return;
  const { data, error } = await authContext.supabase.rpc('save_meta_campaign_draft', {
    p_campaign_id: wizard.campaignId,
    p_connection_id: currentConnection.id,
    p_template_id: wizard.templateId,
    p_name: campaignNameInput.value.trim(),
    p_recipients: result.accepted.map(recipient => ({ phone: recipient.phone, variables: recipient.variables }))
  });
  if (error) throw error;
  wizard.campaignId = data?.campaignId;
}

async function goToReview() {
  wizard.result = collectMappedRecipients();
  renderReview();
  setWizardStep(5);
  if (!wizard.result.accepted.length) {
    setWizardStatus('Nenhum destinatário válido. Volte e corrija a lista antes de confirmar.', true);
    return;
  }
  if (wizard.result.accepted.length > 100) {
    setWizardStatus('O disparo está bloqueado até a lista ter no máximo 100 contatos válidos.', true);
    return;
  }
  wizardNext.disabled = true;
  setWizardStatus('Salvando o rascunho para revisão…');
  try {
    await saveReviewDraft();
    setWizardStatus('Rascunho salvo. Revise a prévia e confirme somente quando estiver pronto.');
    await loadCampaigns();
  } catch (error) {
    setWizardStatus(error.message || 'Não foi possível salvar o rascunho.', true);
  } finally {
    wizardNext.disabled = false;
  }
}

async function confirmCampaign() {
  if (!wizard.campaignId || !wizard.result?.accepted.length || wizard.result.accepted.length > 100) {
    setWizardStatus('Corrija os destinatários antes de confirmar o disparo.', true);
    return;
  }
  if (!document.getElementById('whatsappCampaignConfirmation').checked) {
    setWizardStatus('Marque a confirmação explícita do disparo imediato.', true);
    return;
  }
  wizardNext.disabled = true;
  wizardBack.disabled = true;
  wizardNext.textContent = 'Colocando na fila…';
  setWizardStatus('Confirmando o disparo imediato…');
  try {
    await integrationRequest('campaign.queue', { campaignId: wizard.campaignId });
    closeCampaignWizard();
    await loadCampaigns();
    setNotice('Campanha confirmada e colocada na fila de processamento.');
  } catch (error) {
    setWizardStatus(error.message || 'Não foi possível confirmar o disparo.', true);
  } finally {
    wizardNext.disabled = false;
    wizardBack.disabled = false;
    wizardNext.textContent = 'Confirmar disparo agora';
  }
}

newCampaignButton.addEventListener('click', openCampaignWizard);
document.getElementById('closeWhatsappCampaign').addEventListener('click', closeCampaignWizard);
campaignModal.addEventListener('click', event => { if (event.target === campaignModal) closeCampaignWizard(); });
campaignFilter.addEventListener('change', renderCampaigns);
recipientStatusFilter.addEventListener('change', renderCampaignResults);
document.getElementById('exportWhatsappResults').addEventListener('click', exportCampaignResults);
document.getElementById('closeWhatsappResults').addEventListener('click', () => {
  selectedCampaignId = null;
  campaignRecipients = [];
  resultsPanel.hidden = true;
});
document.querySelectorAll('[data-recipient-source]').forEach(button => {
  button.addEventListener('click', () => setRecipientSource(button.dataset.recipientSource));
});
campaignCsvInput.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  wizard.csv = null;
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('O CSV deve ter no máximo 5 MB.');
    wizard.csv = parseCsv(await file.text());
    document.getElementById('whatsappCsvFileName').textContent = `${file.name} · ${wizard.csv.rows.length} linhas encontradas`;
    setWizardStatus('');
  } catch (error) {
    campaignCsvInput.value = '';
    document.getElementById('whatsappCsvFileName').textContent = 'Selecione outro arquivo CSV.';
    setWizardStatus(error.message || 'Não foi possível ler o CSV.', true);
  }
});
wizardBack.addEventListener('click', () => setWizardStep(Math.max(1, wizard.step - 1)));
wizardNext.addEventListener('click', async () => {
  try {
    if (wizard.step === 1) {
      const name = campaignNameInput.value.trim();
      if (name.length < 2) throw new Error('Informe um nome com ao menos 2 caracteres.');
      setWizardStep(2);
    } else if (wizard.step === 2) {
      wizard.templateId = campaignForm.querySelector('input[name="whatsappTemplate"]:checked')?.value || '';
      if (!wizard.templateId) throw new Error('Selecione um template e idioma para continuar.');
      setRecipientSource(wizard.source || 'csv');
      setWizardStep(3);
    } else if (wizard.step === 3) {
      if (wizard.source === 'csv' && !wizard.csv) throw new Error('Selecione um arquivo CSV válido.');
      if (wizard.source === 'paste' && !campaignPasteInput.value.trim()) throw new Error('Cole ao menos um número de telefone.');
      renderMappings();
      setWizardStep(4);
    } else if (wizard.step === 4) {
      await goToReview();
    } else {
      await confirmCampaign();
    }
  } catch (error) {
    setWizardStatus(error.message || 'Revise os dados desta etapa.', true);
  }
});

async function initializeWhatsapp(context) {
  authContext = context;
  if (context.localMode) {
    newCampaignButton.disabled = true;
    setupCard.hidden = true;
    connectionSection.hidden = true;
    replaceButton.hidden = true;
    setNotice('A conexão com a Meta fica disponível no ambiente autenticado com Supabase. O modo local não armazena credenciais.', true);
    return;
  }
  if (!canManage()) {
    setupCard.hidden = true;
    setNotice('Você pode consultar a conexão e os templates. Somente proprietário ou administrador pode alterar esta configuração.');
  }
  try {
    await loadWhatsappData();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      if (!campaigns.some(campaign => ['queued', 'running'].includes(campaign.status)) && !selectedCampaignId) return;
      await loadCampaigns().catch(() => {});
      if (selectedCampaignId) await loadCampaignRecipients(selectedCampaignId, true);
    }, 5000);
  } catch (_) {
    setupCard.hidden = true;
    setNotice('Não foi possível carregar a configuração do WhatsApp. Verifique se as migrations do Goal 2 foram aplicadas.', true);
  }
}

let mounted = false;
return {
  id: 'whatsapp',
  async mount() {
    if (mounted) return;
    mounted = true;
    await initializeWhatsapp(auth);
  },
  unmount() {
    clearInterval(refreshTimer);
    refreshTimer = null;
    mounted = false;
  }
};
}
