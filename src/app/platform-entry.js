import { getAuthConfig, getSupabase } from '../shared/auth/supabase-client.js';

const state = { supabase: null, context: null, overview: null, accounts: null, staff: null, audit: null, toastTimer: null };
const roles = { owner: 'Proprietário', admin: 'Administrador', member: 'Membro', viewer: 'Visualizador' };
const actionNames = {
  'agency.entered': 'Entrou em suporte', 'agency.created': 'Criou a agência',
  'agency.renamed': 'Renomeou a agência', 'agency.archived': 'Arquivou a agência',
  'agency.restored': 'Restaurou a agência', 'agency.member_invited': 'Convidou um usuário',
  'agency.member_updated': 'Alterou um usuário', 'agency.owner_transferred': 'Transferiu a propriedade',
  'staff.invited': 'Convidou para a equipe DOT', 'staff.updated': 'Alterou um acesso DOT'
};

const byId = id => document.getElementById(id);
const admin = () => state.context?.platform?.role === 'admin';
const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const number = value => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
const date = (value, time = false) => value ? new Intl.DateTimeFormat('pt-BR', time ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value)) : '—';
const agency = id => state.overview?.agencies?.find(item => item.id === id);

function activity(value) {
  if (!value) return 'Sem atividade registrada';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  return days <= 0 ? 'Atividade hoje' : days === 1 ? 'Atividade ontem' : `Há ${days} dias`;
}

function toast(title, detail = '') {
  const element = byId('platformToast');
  element.querySelector('strong').textContent = title;
  element.querySelector('span').textContent = detail;
  element.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove('show'), 3800);
}

async function request(action, body = {}) {
  const { data, error } = await state.supabase.functions.invoke('platform-admin', { body: { action, ...body } });
  if (error) {
    const responseBody = error.context?.json ? await error.context.json().catch(() => null) : null;
    throw new Error(responseBody?.error || error.message || 'Não foi possível concluir esta operação.');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const metric = (label, value, note, warning = false) => `<article class="platform-metric${warning ? ' attention' : ''}"><span>${escapeHtml(label)}</span><strong>${number(value)}</strong><small><b></b>${escapeHtml(note)}</small></article>`;

function renderOverview() {
  const summary = state.overview.summary;
  const agencies = state.overview.agencies;
  byId('platformUpdatedAt').textContent = `Atualizado em ${date(new Date(), true)}`;
  byId('platformMetrics').innerHTML = [
    metric('AGÊNCIAS ATIVAS', summary.activeAgencyCount, `${summary.archivedAgencyCount} arquivadas`),
    metric('USUÁRIOS ATIVOS', summary.activeUserCount, `${summary.userCount} perfis de clientes`),
    metric('PROJETOS', summary.projectCount, 'em toda a operação'),
    metric('ENTREGAS ATRASADAS', summary.overdueCount, 'precisam de atenção', summary.overdueCount > 0),
    metric('BOTS ATIVOS', summary.activeBotCount, 'em todas as agências')
  ].join('');

  const attention = agencies.filter(item => item.status === 'active' && (item.overdueCount || !item.activeMemberCount || !item.lastActivityAt)).sort((a, b) => b.overdueCount - a.overdueCount).slice(0, 6);
  const attentionElement = byId('platformAttentionList');
  attentionElement.className = 'platform-attention-list';
  attentionElement.innerHTML = attention.length ? attention.map(item => {
    const reason = item.overdueCount ? `${item.overdueCount} entrega(s) atrasada(s)` : !item.activeMemberCount ? 'Nenhum usuário ativo' : 'Sem atividade registrada';
    return `<div class="platform-attention-item"><i></i><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(reason)}</span></div><button type="button" data-open-agency="${item.id}">Analisar →</button></div>`;
  }).join('') : '<div class="platform-empty">Nenhuma agência exige atenção agora.</div>';

  const total = Math.max(summary.agencyCount, 1);
  const distribution = [['Ativas', summary.activeAgencyCount], ['Com atividade em 7 dias', agencies.filter(item => item.lastActivityAt && Date.now() - new Date(item.lastActivityAt).getTime() <= 604800000).length], ['WhatsApp habilitado', agencies.filter(item => item.whatsappEnabled).length]];
  const distributionElement = byId('platformDistribution');
  distributionElement.className = 'platform-distribution';
  distributionElement.innerHTML = distribution.map(([label, value]) => `<div><div>${label}</div><strong>${number(value)}</strong><span><i style="width:${Math.round(Number(value) / total * 100)}%"></i></span></div>`).join('');

  const recent = [...agencies].filter(item => item.status === 'active').sort((a, b) => String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || ''))).slice(0, 7);
  byId('platformRecentAgencies').innerHTML = recent.length ? recent.map(item => `<div class="platform-agency-compact"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.ownerName)}</span></div><div><strong>${number(item.activeMemberCount)}</strong><small>pessoas ativas</small></div><div><strong>${number(item.projectCount)}</strong><small>projetos</small></div><div><strong>${escapeHtml(activity(item.lastActivityAt))}</strong><small>última movimentação</small></div><button type="button" data-open-agency="${item.id}">Ver agência</button></div>`).join('') : '<div class="platform-empty">Nenhuma agência ativa.</div>';
}

function renderAgencies() {
  const term = clean(byId('agencySearch').value);
  const status = byId('agencyStatusFilter').value;
  const list = state.overview.agencies.filter(item => (!term || clean(`${item.name} ${item.ownerName} ${item.ownerEmail}`).includes(term)) && (status === 'all' || item.status === status));
  byId('agencyDirectory').innerHTML = list.length ? list.map(item => `<div class="platform-table-row agency-columns"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.ownerName)} · ${escapeHtml(item.ownerEmail || 'sem e-mail')}</span></div><div><strong>${number(item.activeMemberCount)} ativos</strong><span>${number(item.memberCount)} acessos</span></div><div><strong>${number(item.projectCount)} projetos</strong><span>${number(item.overdueCount)} atrasos</span></div><div><strong>${number(item.activeBotCount)} bots ativos</strong><span>${item.whatsappEnabled ? 'WhatsApp habilitado' : 'WhatsApp desabilitado'}</span></div><div><span class="platform-badge ${item.status === 'archived' ? 'archived' : ''}">${item.status === 'archived' ? 'ARQUIVADA' : 'ATIVA'}</span></div><button class="platform-row-action" type="button" data-open-agency="${item.id}">Abrir →</button></div>`).join('') : '<div class="platform-empty">Nenhuma agência encontrada.</div>';
}

function renderAccounts() {
  const term = clean(byId('accountSearch').value);
  const list = (state.accounts || []).filter(item => !term || clean(`${item.fullName} ${item.email}`).includes(term));
  byId('accountDirectory').innerHTML = list.length ? list.map(item => {
    const customerAgency = item.customer ? agency(item.customer.agencyId) : null;
    return `<div class="platform-table-row account-columns"><div><strong>${escapeHtml(item.fullName || 'Sem nome')}</strong><span>${escapeHtml(item.email)}</span></div><div>${item.customer ? `<strong>${escapeHtml(customerAgency?.name || 'Agência não localizada')}</strong><span>${escapeHtml(roles[item.customer.role])}</span>` : '<span>Sem agência</span>'}</div><div>${item.platform ? `<strong>${escapeHtml(roles[item.platform.role])}</strong><span>${item.platform.isActive ? 'Acesso ativo' : 'Acesso suspenso'}</span>` : '<span>Sem perfil DOT</span>'}</div><div><strong>${date(item.lastSignInAt, true)}</strong><span>Criada em ${date(item.createdAt)}</span></div><div><span class="platform-badge ${item.customer?.isActive === false || item.platform?.isActive === false ? 'warning' : ''}">${item.emailConfirmedAt ? 'CONFIRMADA' : 'PENDENTE'}</span></div></div>`;
  }).join('') : '<div class="platform-empty">Nenhum acesso encontrado.</div>';
}

const roleOptions = selected => ['admin', 'member', 'viewer'].map(role => `<option value="${role}"${selected === role ? ' selected' : ''}>${roles[role]}</option>`).join('');

function renderStaff() {
  const payload = state.staff || { staff: [], invitations: [] };
  const rows = payload.staff.map(person => { const self = person.id === state.context.userId; return `<div class="platform-staff-row"><div><strong>${escapeHtml(person.full_name)}</strong><span>${escapeHtml(person.email)}${self ? ' · você' : ''}</span></div><select data-staff-role="${person.id}"${self ? ' disabled title="Outro administrador deve alterar seu nível"' : ''}>${roleOptions(person.role)}</select><span class="platform-badge ${person.is_active ? '' : 'inactive'}">${person.is_active ? 'ATIVO' : 'SUSPENSO'}</span><button type="button" data-toggle-staff="${person.id}" data-active="${person.is_active}"${self ? ' disabled title="Outro administrador deve alterar seu acesso"' : ''}>${person.is_active ? 'Suspender' : 'Reativar'}</button></div>`; });
  rows.push(...payload.invitations.map(invitation => `<div class="platform-staff-row"><div><strong>${escapeHtml(invitation.full_name)}</strong><span>${escapeHtml(invitation.email)} · convite pendente</span></div><span>${escapeHtml(roles[invitation.role])}</span><span class="platform-badge warning">ATÉ ${escapeHtml(date(invitation.expires_at))}</span><button type="button" data-revoke-staff-invitation="${invitation.id}">Revogar</button></div>`));
  byId('staffDirectory').innerHTML = rows.join('') || '<div class="platform-empty">Nenhuma pessoa na equipe DOT.</div>';
}

function renderAudit() {
  const names = new Map((state.staff?.staff || []).map(person => [person.id, person.full_name]));
  byId('auditDirectory').innerHTML = state.audit?.length ? state.audit.map(event => `<div class="platform-table-row audit-columns"><div><strong>${escapeHtml(date(event.occurred_at, true))}</strong></div><div><strong>${escapeHtml(names.get(event.actor_id) || 'Equipe DOT')}</strong><span>${escapeHtml(event.actor_id || 'sistema')}</span></div><div><strong>${escapeHtml(agency(event.agency_id)?.name || 'Geral')}</strong><span>${escapeHtml(event.agency_id || '')}</span></div><div><strong>${escapeHtml(actionNames[event.action] || event.action)}</strong></div><div><strong>${escapeHtml(event.resource_type || '—')}</strong><span>${escapeHtml(event.resource_id || '')}</span></div></div>`).join('') : '<div class="platform-empty">Nenhum evento de auditoria registrado.</div>';
}

async function loadOverview() { state.overview = await request('overview'); renderOverview(); renderAgencies(); }
async function loadAccounts() { if (!state.accounts) state.accounts = (await request('list_accounts')).accounts; renderAccounts(); }
async function loadStaff(force = false) { if (!state.staff || force) state.staff = await request('list_staff'); renderStaff(); }
async function loadAudit(force = false) { if (!state.staff || force) await loadStaff(force); if (!state.audit || force) state.audit = (await request('list_audit')).events; renderAudit(); }

async function showPage(page) {
  if (['staff', 'audit'].includes(page) && !admin()) return;
  document.querySelectorAll('[data-platform-page]').forEach(button => button.classList.toggle('active', button.dataset.platformPage === page));
  document.querySelectorAll('.platform-page').forEach(section => section.classList.toggle('active', section.id === `platform-${page}`));
  byId('platformPageLabel').textContent = { overview: 'Visão macro', agencies: 'Agências', accounts: 'Todos os acessos', staff: 'Equipe DOT', audit: 'Auditoria' }[page] || 'Portal DOT';
  try { if (page === 'accounts') await loadAccounts(); if (page === 'staff') await loadStaff(); if (page === 'audit') await loadAudit(); }
  catch (error) { toast('Não foi possível carregar', error.message); }
}

function openAgency(id) {
  const item = agency(id); if (!item) return;
  byId('agencyDialogContent').innerHTML = `<header><div><small>${item.status === 'archived' ? 'AGÊNCIA ARQUIVADA' : 'CONTA ATIVA'}</small><h2>${escapeHtml(item.name)}</h2></div><button type="button" data-close-dialog>×</button></header><div class="platform-agency-detail"><article><small>PROPRIETÁRIO</small><strong>${escapeHtml(item.ownerName)}</strong></article><article><small>EQUIPE ATIVA</small><strong>${number(item.activeMemberCount)}</strong></article><article><small>PROJETOS</small><strong>${number(item.projectCount)}</strong></article><article><small>ATRASOS</small><strong>${number(item.overdueCount)}</strong></article></div><div class="platform-dialog-actions">${item.status === 'active' ? `<button class="platform-primary" type="button" data-support-agency="${item.id}">Entrar em suporte →</button>` : ''}<button class="platform-secondary" type="button" data-team-agency="${item.id}">Ver equipe</button>${admin() ? `<button class="platform-secondary" type="button" data-rename-agency="${item.id}">Renomear</button><button class="platform-secondary${item.status === 'active' ? ' danger' : ''}" type="button" data-archive-agency="${item.id}" data-archived="${item.status === 'archived'}">${item.status === 'archived' ? 'Restaurar agência' : 'Arquivar agência'}</button>` : ''}</div>`;
  byId('agencyDialog').showModal();
}

async function enterSupport(id) { location.assign(`/?supportAgency=${encodeURIComponent(id)}`); }
async function renameAgency(id) { const name = globalThis.prompt('Novo nome da agência:', agency(id)?.name || ''); if (!name || name.trim() === agency(id)?.name) return; await request('rename_agency', { agencyId: id, name: name.trim() }); byId('agencyDialog').close(); await loadOverview(); toast('Agência renomeada', name.trim()); }
async function toggleArchive(id, archived) { if (!globalThis.confirm(`Deseja ${archived ? 'restaurar' : 'arquivar'} a agência ${agency(id)?.name || ''}?`)) return; await request(archived ? 'restore_agency' : 'archive_agency', { agencyId: id }); byId('agencyDialog').close(); await loadOverview(); toast(archived ? 'Agência restaurada' : 'Agência arquivada'); }

function renderTeam(item, payload) {
  const members = (payload.members || []).map(member => `<div class="platform-team-row"><div><strong>${escapeHtml(member.full_name)}</strong><span>${escapeHtml(member.email)}</span></div>${admin() && member.role !== 'owner' ? `<select data-member-role="${member.id}" data-agency-id="${item.id}">${roleOptions(member.role)}</select>` : `<span>${escapeHtml(roles[member.role])}</span>`}<span class="platform-badge ${member.is_active ? '' : 'inactive'}">${member.is_active ? 'ATIVO' : 'SUSPENSO'}</span><div>${admin() && member.role !== 'owner' ? `<button type="button" data-toggle-member="${member.id}" data-agency-id="${item.id}" data-active="${member.is_active}">${member.is_active ? 'Suspender' : 'Reativar'}</button>${member.is_active ? `<button type="button" data-transfer-owner="${member.id}" data-agency-id="${item.id}" data-member-name="${escapeHtml(member.full_name)}">Tornar proprietário</button>` : ''}` : ''}</div></div>`).join('');
  const invitations = (payload.invitations || []).map(invitation => `<div class="platform-team-row"><div><strong>${escapeHtml(invitation.full_name)}</strong><span>${escapeHtml(invitation.email)} · convite pendente</span></div><span>${escapeHtml(roles[invitation.role])}</span><span class="platform-badge warning">PENDENTE</span>${admin() ? `<button type="button" data-revoke-member-invitation="${invitation.id}" data-agency-id="${item.id}">Revogar</button>` : '<span></span>'}</div>`).join('');
  byId('agencyTeamDialogContent').innerHTML = `<header><div><small>EQUIPE DA AGÊNCIA</small><h2>${escapeHtml(item.name)}</h2></div><button type="button" data-close-dialog>×</button></header>${admin() && item.status === 'active' ? `<div class="platform-dialog-actions"><button class="platform-primary" type="button" data-invite-member="${item.id}">+ Convidar usuário</button></div>` : ''}<div class="platform-team-list">${members || '<div class="platform-empty">Nenhum usuário.</div>'}${invitations}</div>`;
}

async function openTeam(id) { const item = agency(id); renderTeam(item, await request('agency_team_list', { agencyId: id })); byId('agencyDialog').close(); byId('agencyTeamDialog').showModal(); }
async function refreshTeam(id) { renderTeam(agency(id), await request('agency_team_list', { agencyId: id })); }
async function inviteMember(id) { const fullName = globalThis.prompt('Nome completo da pessoa:'); if (!fullName) return; const email = globalThis.prompt('E-mail da pessoa:'); if (!email) return; const role = globalThis.prompt('Nível: admin, member ou viewer', 'member'); if (!role) return; await request('agency_team_invite', { agencyId: id, fullName, email, role: role.trim().toLowerCase() }); await refreshTeam(id); toast('Convite enviado', email); }
async function updateMember(agencyId, memberId, changes) { await request('agency_team_update_member', { agencyId, memberId, ...changes }); await refreshTeam(agencyId); state.accounts = null; toast('Acesso atualizado'); }
async function transferOwner(agencyId, newOwnerId, name) { if (!globalThis.confirm(`Transferir a propriedade desta agência para ${name}?`)) return; await request('transfer_owner', { agencyId, newOwnerId }); await loadOverview(); await refreshTeam(agencyId); toast('Propriedade transferida', name); }

async function submit(form, action, success) {
  const button = form.querySelector('[type="submit"]'); const status = form.querySelector('.platform-form-status'); button.disabled = true; status.textContent = '';
  try { const result = await request(action, Object.fromEntries(new FormData(form))); form.closest('dialog').close(); form.reset(); await success(result); }
  catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}

function bindEvents() {
  document.querySelectorAll('[data-platform-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.platformPage)));
  document.querySelectorAll('[data-go-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.goPage)));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  byId('agencySearch').addEventListener('input', renderAgencies); byId('agencyStatusFilter').addEventListener('change', renderAgencies); byId('accountSearch').addEventListener('input', renderAccounts);
  byId('platformGlobalSearch').addEventListener('input', event => { byId('agencySearch').value = event.target.value; showPage('agencies'); renderAgencies(); });
  byId('newAgencyButton').addEventListener('click', () => byId('newAgencyDialog').showModal()); byId('inviteStaffButton').addEventListener('click', () => byId('inviteStaffDialog').showModal());
  byId('personalAgencyButton').addEventListener('click', () => location.assign('/')); byId('platformLogout').addEventListener('click', async () => { await state.supabase.auth.signOut(); location.replace('/dot-admin/'); });
  byId('newAgencyForm').addEventListener('submit', event => { event.preventDefault(); submit(event.currentTarget, 'create_agency', async result => { state.accounts = null; await loadOverview(); toast('Agência criada', result.message); }); });
  byId('inviteStaffForm').addEventListener('submit', event => { event.preventDefault(); submit(event.currentTarget, 'invite_staff', async result => { await loadStaff(true); state.accounts = null; toast('Acesso DOT preparado', result.message); }); });

  document.addEventListener('click', async event => {
    const target = event.target.closest('button'); if (!target) return;
    try {
      if (target.dataset.closeDialog) target.closest('dialog').close();
      if (target.dataset.openAgency) openAgency(target.dataset.openAgency); if (target.dataset.supportAgency) await enterSupport(target.dataset.supportAgency);
      if (target.dataset.teamAgency) await openTeam(target.dataset.teamAgency); if (target.dataset.renameAgency) await renameAgency(target.dataset.renameAgency);
      if (target.dataset.archiveAgency) await toggleArchive(target.dataset.archiveAgency, target.dataset.archived === 'true'); if (target.dataset.inviteMember) await inviteMember(target.dataset.inviteMember);
      if (target.dataset.toggleMember) await updateMember(target.dataset.agencyId, target.dataset.toggleMember, { isActive: target.dataset.active !== 'true' });
      if (target.dataset.transferOwner) await transferOwner(target.dataset.agencyId, target.dataset.transferOwner, target.dataset.memberName);
      if (target.dataset.revokeMemberInvitation) { await request('agency_team_revoke_invitation', { agencyId: target.dataset.agencyId, invitationId: target.dataset.revokeMemberInvitation }); await refreshTeam(target.dataset.agencyId); toast('Convite revogado'); }
      if (target.dataset.toggleStaff) { await request('update_staff', { staffId: target.dataset.toggleStaff, isActive: target.dataset.active !== 'true' }); await loadStaff(true); toast('Acesso DOT atualizado'); }
      if (target.dataset.revokeStaffInvitation) { await request('revoke_staff_invitation', { invitationId: target.dataset.revokeStaffInvitation }); await loadStaff(true); toast('Convite DOT revogado'); }
    } catch (error) { toast('Operação não concluída', error.message); }
  });
  document.addEventListener('change', async event => {
    const target = event.target;
    try { if (target.matches('[data-member-role]')) await updateMember(target.dataset.agencyId, target.dataset.memberRole, { role: target.value }); if (target.matches('[data-staff-role]')) { await request('update_staff', { staffId: target.dataset.staffRole, role: target.value }); await loadStaff(true); toast('Nível DOT atualizado'); } }
    catch (error) { toast('Operação não concluída', error.message); }
  });
}

async function start() {
  try {
    const config = await getAuthConfig(); if (config.localMode) { location.replace('/'); return; }
    state.supabase = await getSupabase(); const { data: session } = await state.supabase.auth.getSession(); if (!session.session) { location.replace('/dot-admin/?reason=expired'); return; }
    const { data: context, error } = await state.supabase.rpc('get_account_context'); if (error) throw error; if (!context?.platform?.isActive) { location.replace(context?.personalAgency ? '/' : '/dot-admin/?reason=unauthorized'); return; }
    state.context = context; const person = context.platform; byId('platformAvatar').textContent = person.fullName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    byId('platformUserName').textContent = person.fullName; byId('platformUserRole').textContent = roles[person.role] || person.role; if (context.personalAgency?.status === 'active') byId('personalAgencyButton').hidden = false;
    if (!admin()) document.querySelectorAll('[data-admin-only]').forEach(element => { element.hidden = true; });
    bindEvents(); document.documentElement.classList.remove('platform-auth-pending');
    try { await loadOverview(); }
    catch (error) { console.error(error); toast('Não foi possível carregar o portal DOT', error.message); }
  } catch (error) { console.error(error); location.replace('/dot-admin/?reason=unauthorized'); }
}

start();
