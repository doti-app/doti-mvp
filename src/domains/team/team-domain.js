const roleLabels = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador',
  client: 'Cliente da agência'
};

const roleDescriptions = {
  owner: 'Controle total da agência',
  admin: 'Gerencia operação e equipe',
  member: 'Cria e atualiza o trabalho',
  viewer: 'Apenas acompanha a operação',
  client: 'Aprova somente os próprios projetos'
};

/** @param {{ auth: any, events?: EventTarget, document?: Document }} dependencies */
export function createTeamDomain({ auth, events = new EventTarget(), document: documentRef = globalThis.document }) {
const document = documentRef;
let authContext;
let teamState = { members: [], invitations: [], clients: [], currentUserId: '', currentRole: '' };
const LOCAL_TEAM_KEY = 'doti-local-team-v1';

const teamNavItem = document.getElementById('teamNavItem');
const inviteButton = document.getElementById('inviteMemberButton');
const membersContainer = document.getElementById('teamMembers');
const teamSearch = document.getElementById('teamSearch');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function localOwnerProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem('doti-local-profile-v1') || 'null');
    if (saved && typeof saved === 'object') {
      return {
        full_name: String(saved.full_name || 'Ambiente local'),
        avatar_url: String(saved.avatar_url || '')
      };
    }
  } catch (_) {}
  return { full_name: 'Ambiente local', avatar_url: '' };
}

function memberAvatar(member) {
  const avatarUrl = String(member.avatar_url || '');
  const isPreset = /^\/assets\/avatars-users\/avatar-\d{2}\.png$/.test(avatarUrl);
  const isLocalPhoto = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(avatarUrl) && avatarUrl.length <= 900000;
  if (isPreset || isLocalPhoto) {
    return `<img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy">`;
  }
  return escapeHtml(initials(member.full_name));
}

let teamNoticeTimer;
function showTeamNotice(title, message, attention = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.querySelector(':scope > span').textContent = attention ? '!' : '✓';
  toast.querySelector('strong').textContent = title;
  toast.querySelector('p').textContent = message;
  toast.setAttribute('role', attention ? 'alert' : 'status');
  toast.classList.add('show');
  clearTimeout(teamNoticeTimer);
  teamNoticeTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}

function defaultLocalTeam() {
  const localOwner = localOwnerProfile();
  return {
    members: [
      {
        id: 'local-owner',
        email: 'local@doti.dev',
        full_name: localOwner.full_name,
        avatar_url: localOwner.avatar_url,
        role: 'owner',
        is_active: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'local-member-design',
        email: 'design@doti.dev',
        full_name: 'Pessoa de Design',
        role: 'member',
        is_active: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'local-member-viewer',
        email: 'cliente@doti.dev',
        full_name: 'Cliente de Teste',
        role: 'client',
        client_id: 'local-client',
        client_name: 'Cliente local',
        is_active: true,
        created_at: new Date().toISOString()
      }
    ],
    invitations: [],
    currentUserId: 'local-owner',
    currentRole: 'owner'
  };
}

function readLocalTeam() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_TEAM_KEY) || 'null');
    if (saved?.members && saved?.invitations) return saved;
  } catch (_) {}
  const initial = defaultLocalTeam();
  localStorage.setItem(LOCAL_TEAM_KEY, JSON.stringify(initial));
  return initial;
}

function saveLocalTeam(state) {
  localStorage.setItem(LOCAL_TEAM_KEY, JSON.stringify(state));
  return JSON.parse(JSON.stringify(state));
}

function localTeamRequest(action, body = {}) {
  const state = readLocalTeam();
  const operation = (() => {
    try { return JSON.parse(localStorage.getItem('doti-agency-live-v4') || 'null'); } catch (_) { return null; }
  })();
  state.clients = (operation?.clients || []).map(client => ({ id: client.id, name: client.name }));
  if (action === 'list') return JSON.parse(JSON.stringify(state));

  if (action === 'invite') {
    const email = String(body?.email || '').trim().toLowerCase();
    if (state.members.some(member => member.email.toLowerCase() === email)) {
      throw new Error('Este e-mail ja faz parte da equipe local.');
    }
    const id = `local-member-${Date.now()}`;
    const role = body?.role || 'member';
    const clientId = role === 'client' ? String(body?.clientId || '') : null;
    const client = state.clients.find(item => item.id === clientId);
    if (role === 'client' && !client) throw new Error('Escolha o cliente deste acesso.');
    state.members.push({
      id,
      email,
      full_name: String(body?.fullName || 'Pessoa de teste').trim(),
      role,
      client_id: clientId,
      client_name: client?.name || '',
      is_active: true,
      created_at: new Date().toISOString()
    });
    state.invitations.push({
      id: `local-invite-${Date.now()}`,
      email,
      full_name: String(body?.fullName || 'Pessoa de teste').trim(),
      role,
      client_id: clientId,
      status: 'pending',
      created_at: new Date().toISOString()
    });
    saveLocalTeam(state);
    return { message: `Convite simulado para ${email}. Nenhum e-mail foi enviado.` };
  }

  if (action === 'update_member') {
    const member = state.members.find(item => item.id === body?.memberId);
    if (!member) throw new Error('Membro local nao encontrado.');
    if (body.role != null && !member.is_active) {
      throw new Error('Reative a pessoa antes de alterar o nivel de acesso.');
    }
    if (body.role != null) {
      const nextRole = String(body.role);
      const clientId = nextRole === 'client' ? String(body.clientId || '') : null;
      const client = state.clients.find(item => item.id === clientId);
      if (nextRole === 'client' && !client) throw new Error('Escolha o cliente deste acesso.');
      member.role = nextRole;
      member.client_id = clientId;
      member.client_name = client?.name || '';
    }
    if (body.isActive != null) member.is_active = Boolean(body.isActive);
    saveLocalTeam(state);
    return { message: 'Alteracao salva somente neste navegador.' };
  }

  if (action === 'remove_member') {
    const member = state.members.find(item => item.id === body?.memberId);
    if (!member) throw new Error('Membro local nao encontrado.');
    if (member.id === state.currentUserId || member.role === 'owner') {
      throw new Error('O proprietario e o usuario atual nao podem ser removidos.');
    }
    state.members = state.members.filter(item => item.id !== member.id);
    state.invitations = state.invitations.filter(
      invitation => invitation.email.toLowerCase() !== member.email.toLowerCase()
    );
    saveLocalTeam(state);
    return { message: `${member.full_name} foi removido somente da equipe local.` };
  }

  throw new Error('Operacao local nao suportada.');
}

async function teamRequest(action = 'list', body = {}) {
  if (authContext?.localMode) {
    return localTeamRequest(action, body);
  }
  const supportActions = {
    list: 'agency_team_list',
    invite: 'agency_team_invite',
    update_member: 'agency_team_update_member',
    revoke_invitation: 'agency_team_revoke_invitation'
  };
  const supportMode = Boolean(authContext.supportMode);
  const functionName = supportMode ? 'platform-admin' : 'team-admin';
  const requestAction = supportMode ? supportActions[action] : action;
  if (!requestAction) throw new Error('Esta ação não está disponível no modo de suporte.');
  const client = authContext.baseSupabase || authContext.supabase;
  const { data, error } = await client.functions.invoke(functionName, {
    body: {
      action: requestAction,
      ...(supportMode ? { agencyId: authContext.profile.agency_id } : {}),
      ...body
    }
  });
  if (error) {
    let message = error.message;
    try {
      const payload = await error.context?.json();
      message = payload?.error || message;
    } catch (_) {}
    throw new Error(message || 'Não foi possível concluir a operação.');
  }
  return data;
}

function renderMetrics() {
  const members = teamState.members;
  const pendingEmails = new Set(teamState.invitations.map(invitation => invitation.email.toLowerCase()));
  document.getElementById('teamMemberMetric').textContent = String(members.length);
  document.getElementById('teamActiveMetric').textContent = members.filter(
    member => member.is_active && !pendingEmails.has(member.email.toLowerCase())
  ).length.toString();
  document.getElementById('teamInviteMetric').textContent = String(teamState.invitations.length);
  document.getElementById('teamNavCount').textContent = members.length ? String(members.length) : '';
}

function roleOptions(member) {
  if (member.role === 'owner') {
    return '<option value="owner">Proprietário</option>';
  }
  const roles = teamState.currentRole === 'owner'
    ? ['admin', 'member', 'viewer', 'client']
    : ['member', 'viewer', 'client'];
  return roles
    .map(role => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${roleLabels[role]}</option>`)
    .join('');
}

function renderMembers() {
  const filter = teamSearch.value.trim().toLowerCase();
  const members = teamState.members.filter(member =>
    !filter ||
    member.full_name.toLowerCase().includes(filter) ||
    member.email.toLowerCase().includes(filter)
  );

  if (!members.length) {
    membersContainer.innerHTML = `
      <div class="team-empty">
        <span>◎</span>
        <strong>Nenhuma pessoa encontrada</strong>
        <p>Tente outro nome ou e-mail.</p>
      </div>`;
    return;
  }

  membersContainer.innerHTML = members.map(member => {
    const isCurrent = member.id === teamState.currentUserId;
    const invitePending = teamState.invitations.some(
      invitation => invitation.email.toLowerCase() === member.email.toLowerCase()
    );
    const protectedMember =
      isCurrent ||
      member.role === 'owner' ||
      (teamState.currentRole !== 'owner' && member.role === 'admin');
    return `
      <article class="team-member ${member.is_active ? '' : 'disabled'}" data-member-id="${escapeHtml(member.id)}">
        <div class="team-avatar">${memberAvatar(member)}</div>
        <div class="team-person">
          <div><strong>${escapeHtml(member.full_name)}</strong>${isCurrent ? '<span>VOCÊ</span>' : ''}</div>
          <p>${escapeHtml(member.email)}</p>
        </div>
        <div class="team-role-copy">
          <strong>${escapeHtml(roleLabels[member.role] || member.role)}</strong>
          <small>${escapeHtml(member.role === 'client' && member.client_name
            ? `Vinculado a ${member.client_name}`
            : roleDescriptions[member.role] || '')}</small>
        </div>
        <label class="team-role-select">
          <span>Nível</span>
          <select data-member-role ${protectedMember || !member.is_active ? 'disabled' : ''}>${roleOptions(member)}</select>
        </label>
        <div class="team-member-status ${member.is_active && !invitePending ? 'active' : 'inactive'}">
          <i></i>${invitePending ? 'Convidado' : member.is_active ? 'Ativo' : 'Desativado'}
        </div>
        <div class="team-actions">
          ${member.role === 'client' && !protectedMember ? `<button class="team-client-link" type="button" data-change-client>Alterar cliente</button>` : ''}
          <button class="team-access-toggle" type="button" data-toggle-access
            ${protectedMember ? 'disabled' : ''}
            aria-label="${member.is_active ? 'Desativar' : 'Reativar'} acesso de ${escapeHtml(member.full_name)}">
            ${member.is_active ? 'Desativar' : 'Reativar'}
          </button>
          ${authContext?.localMode && !protectedMember && !member.is_active ? `
            <button class="team-remove-member" type="button" data-remove-member
              aria-label="Remover ${escapeHtml(member.full_name)} da equipe">
              Remover
            </button>` : ''}
        </div>
      </article>`;
  }).join('');
}

async function loadTeam() {
  if (!authContext || !['owner', 'admin'].includes(authContext.profile.role)) return;
  membersContainer.innerHTML = '<div class="team-loading">Carregando equipe…</div>';
  try {
    teamState = await teamRequest();
    renderMetrics();
    renderMembers();
  } catch (error) {
    membersContainer.innerHTML = `
      <div class="team-empty error">
        <span>!</span>
        <strong>Administração indisponível</strong>
        <p>${escapeHtml(error.message)}</p>
      </div>`;
  }
}

function closeModal(modal) {
  modal?.remove();
}

function openRemoveMemberModal(member) {
  const modal = document.createElement('div');
  modal.className = 'doti-modal team-remove-modal';
  modal.innerHTML = `
    <form>
      <header>
        <div><p class="eyebrow">REMOVER ACESSO</p><h2>Remover da equipe?</h2></div>
        <button type="button" data-close-modal aria-label="Fechar">&times;</button>
      </header>
      <div class="modal-body">
        <div class="team-remove-person">
          <span>${escapeHtml(initials(member.full_name))}</span>
          <div><strong>${escapeHtml(member.full_name)}</strong><small>${escapeHtml(member.email)}</small></div>
        </div>
        <p class="team-remove-warning">
          Esta pessoa sera removida da equipe simulada. O historico de projetos permanece e nenhum dado sera enviado ao banco.
        </p>
      </div>
      <footer>
        <button type="button" class="cancel" data-close-modal>Cancelar</button>
        <button type="submit" class="team-remove-confirm">Remover da equipe</button>
      </footer>
    </form>`;
  document.body.appendChild(modal);

  modal.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(modal));
  });
  modal.addEventListener('click', event => {
    if (event.target === modal) closeModal(modal);
  });
  modal.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Removendo...';
    try {
      const result = await teamRequest('remove_member', { memberId: member.id });
      closeModal(modal);
      showTeamNotice('Pessoa removida', result.message);
      await loadTeam();
    } catch (error) {
      closeModal(modal);
      showTeamNotice('Remocao nao realizada', error.message, true);
    }
  });
}

function openInviteModal() {
  const canInviteAdmin = teamState.currentRole === 'owner';
  const modal = document.createElement('div');
  modal.className = 'doti-modal team-invite-modal';
  modal.innerHTML = `
    <form id="teamInviteForm">
      <header>
        <div><p class="eyebrow">NOVO ACESSO</p><h2>Convidar para a equipe</h2></div>
        <button type="button" data-close-modal aria-label="Fechar">&times;</button>
      </header>
      <div class="modal-body">
        <p class="team-invite-intro">A pessoa receberá um e-mail seguro para criar a própria senha e entrar no espaço da agência.</p>
        <label>Nome completo
          <input name="fullName" autocomplete="name" required minlength="2" placeholder="Nome e sobrenome">
        </label>
        <label>E-mail profissional
          <input name="email" type="email" autocomplete="email" required placeholder="pessoa@agencia.com">
        </label>
        <fieldset class="team-role-picker">
          <legend>Nível de acesso</legend>
          ${canInviteAdmin ? `
            <label><input type="radio" name="role" value="admin"><span><i>02</i><b>Administrador</b><small>Gerencia operação e equipe</small></span></label>` : ''}
          <label><input type="radio" name="role" value="member" checked><span><i>03</i><b>Membro</b><small>Cria e atualiza o trabalho</small></span></label>
          <label><input type="radio" name="role" value="viewer"><span><i>04</i><b>Visualizador</b><small>Acompanha sem alterar</small></span></label>
          <label><input type="radio" name="role" value="client"><span><i>05</i><b>Cliente da agência</b><small>Aprova somente os próprios projetos</small></span></label>
        </fieldset>
        <label class="team-client-picker" hidden>Cliente vinculado
          <select name="clientId"><option value="">Escolha o cliente</option>${teamState.clients.map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`).join('')}</select>
          <small>Esta pessoa verá apenas aprovações dos projetos deste cliente.</small>
        </label>
        <div class="team-modal-status" role="alert"></div>
      </div>
      <footer>
        <button type="button" class="cancel" data-close-modal>Cancelar</button>
        <button type="submit" class="primary-btn">Enviar convite →</button>
      </footer>
    </form>`;
  document.body.appendChild(modal);

  modal.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(modal));
  });
  modal.addEventListener('click', event => {
    if (event.target === modal) closeModal(modal);
  });

  const form = modal.querySelector('form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const status = form.querySelector('.team-modal-status');
    const data = new FormData(form);
    submit.disabled = true;
    submit.textContent = 'Enviando…';
    status.textContent = '';
    try {
    const result = await teamRequest('invite', {
        fullName: data.get('fullName'),
        email: data.get('email'),
        role: data.get('role'),
        clientId: data.get('clientId')
      });
      closeModal(modal);
      showTeamNotice('Convite enviado', result.message);
      await loadTeam();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Enviar convite →';
    }
  });
  const clientPicker = form.querySelector('.team-client-picker');
  const syncClientPicker = () => {
    const clientRole = form.querySelector('input[name="role"]:checked')?.value === 'client';
    clientPicker.hidden = !clientRole;
    clientPicker.querySelector('select').required = clientRole;
  };
  form.querySelectorAll('input[name="role"]').forEach(input => input.addEventListener('change', syncClientPicker));
  syncClientPicker();
  form.elements.fullName.focus();
}

function openClientAssignmentModal(member) {
  if (!teamState.clients.length) {
    showTeamNotice('Nenhum cliente cadastrado', 'Cadastre um cliente antes de criar este acesso.', true);
    return;
  }
  const modal = document.createElement('div');
  modal.className = 'doti-modal team-client-assignment-modal';
  modal.innerHTML = `<form>
    <header><div><p class="eyebrow">ACESSO DO CLIENTE</p><h2>Vincular cliente</h2></div><button type="button" data-close-modal aria-label="Fechar">&times;</button></header>
    <div class="modal-body"><p class="team-invite-intro">${escapeHtml(member.full_name)} verá somente aprovações dos projetos do cliente escolhido.</p><label>Cliente<select name="clientId" required><option value="">Escolha o cliente</option>${teamState.clients.map(client => `<option value="${escapeHtml(client.id)}" ${client.id === member.client_id ? 'selected' : ''}>${escapeHtml(client.name)}</option>`).join('')}</select></label><div class="team-modal-status" role="alert"></div></div>
    <footer><button type="button" class="cancel" data-close-modal>Cancelar</button><button type="submit" class="primary-btn">Salvar vínculo</button></footer>
  </form>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(modal)));
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); });
  modal.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const status = form.querySelector('.team-modal-status');
    submit.disabled = true;
    try {
      const result = await teamRequest('update_member', {
        memberId: member.id,
        role: 'client',
        clientId: form.elements.namedItem('clientId').value
      });
      closeModal(modal);
      showTeamNotice('Cliente vinculado', result.message);
      await loadTeam();
    } catch (error) {
      status.textContent = error.message;
      submit.disabled = false;
    }
  });
}

membersContainer.addEventListener('change', async event => {
  const select = event.target.closest('[data-member-role]');
  if (!select) return;
  const row = select.closest('[data-member-id]');
  const member = teamState.members.find(item => item.id === row.dataset.memberId);
  if (!member?.is_active) {
    showTeamNotice('Alteração não realizada', 'Reative a pessoa antes de alterar o nível de acesso.', true);
    await loadTeam();
    return;
  }
  select.disabled = true;
  if (select.value === 'client') {
    select.disabled = false;
    openClientAssignmentModal(member);
    return;
  }
  try {
    const result = await teamRequest('update_member', {
      memberId: row.dataset.memberId,
      role: select.value
    });
    showTeamNotice('Nível atualizado', result.message);
    await loadTeam();
  } catch (error) {
    showTeamNotice('Alteração não realizada', error.message, true);
    await loadTeam();
  }
});

membersContainer.addEventListener('click', async event => {
  const changeClientButton = event.target.closest('[data-change-client]');
  if (changeClientButton) {
    const row = changeClientButton.closest('[data-member-id]');
    const member = teamState.members.find(item => item.id === row.dataset.memberId);
    if (member) openClientAssignmentModal(member);
    return;
  }
  const removeButton = event.target.closest('[data-remove-member]');
  if (removeButton) {
    const row = removeButton.closest('[data-member-id]');
    const member = teamState.members.find(item => item.id === row.dataset.memberId);
    if (member) openRemoveMemberModal(member);
    return;
  }

  const button = event.target.closest('[data-toggle-access]');
  if (!button) return;
  const row = button.closest('[data-member-id]');
  const member = teamState.members.find(item => item.id === row.dataset.memberId);
  if (!member) return;
  const action = member.is_active ? 'desativar' : 'reativar';
  if (!confirm(`Deseja ${action} o acesso de ${member.full_name}?`)) return;
  button.disabled = true;
  try {
    const result = await teamRequest('update_member', {
      memberId: member.id,
      isActive: !member.is_active
    });
    showTeamNotice('Acesso atualizado', result.message);
    await loadTeam();
  } catch (error) {
    showTeamNotice('Alteração não realizada', error.message, true);
    button.disabled = false;
  }
});

teamSearch.addEventListener('input', renderMembers);
inviteButton.addEventListener('click', openInviteModal);
teamNavItem.addEventListener('click', loadTeam);

function applyRole(profile) {
  authContext = auth;
  const canManageTeam = ['owner', 'admin'].includes(profile.role);
  teamNavItem.hidden = !canManageTeam;
  inviteButton.hidden = !canManageTeam;

  if (!canManageTeam && location.hash === '#equipe') {
    document.querySelector('[data-page="dashboard"]')?.click();
  }

  if (profile.role === 'viewer') {
    document.body.classList.add('viewer-access');
    [
      'topNewProject',
      'dashboardNewProject',
      'importData',
      'newDemand',
      'newWorkflow',
      'newClient'
    ].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.hidden = true;
    });
  }
}

const onProfileUpdated = () => {
  if (location.hash === '#equipe') loadTeam();
};

let mounted = false;
return {
  id: 'team',
  async mount() {
    if (mounted) return;
    mounted = true;
    authContext = auth;
    applyRole(auth.profile);
    events.addEventListener('profile-updated', onProfileUpdated);
    if (location.hash === '#equipe') await loadTeam();
  },
  unmount() {
    events.removeEventListener('profile-updated', onProfileUpdated);
    mounted = false;
  }
};
}
