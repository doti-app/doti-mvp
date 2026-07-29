const roleLabels = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador'
};

const roleDescriptions = {
  owner: 'Controle total da agência',
  admin: 'Gerencia operação e equipe',
  member: 'Cria e atualiza o trabalho',
  viewer: 'Apenas acompanha a operação'
};

let authContext;
let teamState = { members: [], invitations: [], currentUserId: '', currentRole: '' };

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

function showTeamNotice(title, message, attention = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.querySelector(':scope > span').textContent = attention ? '!' : '✓';
  toast.querySelector('strong').textContent = title;
  toast.querySelector('p').textContent = message;
  toast.setAttribute('role', attention ? 'alert' : 'status');
  toast.classList.add('show');
  clearTimeout(showTeamNotice.timer);
  showTeamNotice.timer = setTimeout(() => toast.classList.remove('show'), 3600);
}

async function teamRequest(action = 'list', body = {}) {
  const { data, error } = await authContext.supabase.functions.invoke('team-admin', {
    body: { action, ...body }
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
  document.getElementById('teamMemberMetric').textContent = members.length;
  document.getElementById('teamActiveMetric').textContent = members.filter(
    member => member.is_active && !pendingEmails.has(member.email.toLowerCase())
  ).length;
  document.getElementById('teamInviteMetric').textContent = teamState.invitations.length;
  document.getElementById('teamNavCount').textContent = members.length || '';
}

function roleOptions(member) {
  if (member.role === 'owner') {
    return '<option value="owner">Proprietário</option>';
  }
  const roles = teamState.currentRole === 'owner'
    ? ['admin', 'member', 'viewer']
    : ['member', 'viewer'];
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
        <div class="team-avatar">${escapeHtml(initials(member.full_name))}</div>
        <div class="team-person">
          <div><strong>${escapeHtml(member.full_name)}</strong>${isCurrent ? '<span>VOCÊ</span>' : ''}</div>
          <p>${escapeHtml(member.email)}</p>
        </div>
        <div class="team-role-copy">
          <strong>${escapeHtml(roleLabels[member.role] || member.role)}</strong>
          <small>${escapeHtml(roleDescriptions[member.role] || '')}</small>
        </div>
        <label class="team-role-select">
          <span>Nível</span>
          <select data-member-role ${protectedMember ? 'disabled' : ''}>${roleOptions(member)}</select>
        </label>
        <div class="team-member-status ${member.is_active && !invitePending ? 'active' : 'inactive'}">
          <i></i>${invitePending ? 'Convidado' : member.is_active ? 'Ativo' : 'Desativado'}
        </div>
        <button class="team-access-toggle" type="button" data-toggle-access
          ${protectedMember ? 'disabled' : ''}
          aria-label="${member.is_active ? 'Desativar' : 'Reativar'} acesso de ${escapeHtml(member.full_name)}">
          ${member.is_active ? 'Desativar' : 'Reativar'}
        </button>
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

function openInviteModal() {
  const canInviteAdmin = teamState.currentRole === 'owner';
  const modal = document.createElement('div');
  modal.className = 'doti-modal team-invite-modal';
  modal.innerHTML = `
    <form id="teamInviteForm">
      <header>
        <div><p class="eyebrow">NOVO ACESSO</p><h2>Convidar para a equipe</h2></div>
        <button type="button" data-close-modal aria-label="Fechar">×</button>
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
        </fieldset>
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
        role: data.get('role')
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
  form.elements.fullName.focus();
}

membersContainer.addEventListener('change', async event => {
  const select = event.target.closest('[data-member-role]');
  if (!select) return;
  const row = select.closest('[data-member-id]');
  select.disabled = true;
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
  authContext = window.dotiAuthContext;
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

window.addEventListener('doti:auth-ready', event => {
  authContext = event.detail;
  applyRole(event.detail.profile);
  if (location.hash === '#equipe') loadTeam();
});

if (window.dotiAuthContext) {
  applyRole(window.dotiAuthContext.profile);
  if (location.hash === '#equipe') loadTeam();
}
