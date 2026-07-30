const LOCAL_PROFILE_KEY = 'doti-local-profile-v1';
const LOCAL_TEAM_KEY = 'doti-local-team-v1';
const AVATAR_BASE = '/assets/avatars-users';
const AVATARS = Array.from(
  { length: 30 },
  (_, index) => `${AVATAR_BASE}/avatar-${String(index + 1).padStart(2, '0')}.png`
);

const ROLE_LABELS = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador'
};

const form = document.getElementById('profileSettingsForm');
const fullNameInput = document.getElementById('profileFullName');
const emailInput = document.getElementById('profileEmail');
const roleInput = document.getElementById('profileRole');
const avatarPicker = document.getElementById('profileAvatarPicker');
const avatarPreview = document.getElementById('profileAvatarPreview');
const saveStatus = document.getElementById('profileSaveStatus');
const storageHint = document.getElementById('profileStorageHint');

let authContext;
let selectedAvatar = '';

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function validAvatar(value) {
  return AVATARS.includes(String(value || '')) ? String(value) : '';
}

function setAvatar(element, avatarUrl, fullName) {
  if (!element) return;
  element.replaceChildren();
  const safeAvatar = validAvatar(avatarUrl);
  element.classList.toggle('has-image', Boolean(safeAvatar));
  if (!safeAvatar) {
    element.textContent = initials(fullName);
    return;
  }
  const image = document.createElement('img');
  image.src = safeAvatar;
  image.alt = '';
  element.appendChild(image);
}

function readLocalProfile(baseProfile) {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return {
        ...baseProfile,
        full_name: String(saved.full_name || baseProfile.full_name),
        avatar_url: validAvatar(saved.avatar_url)
      };
    }
  } catch (_) {}
  return { ...baseProfile, avatar_url: validAvatar(baseProfile.avatar_url) };
}

function syncLocalTeam(profile) {
  try {
    const team = JSON.parse(localStorage.getItem(LOCAL_TEAM_KEY) || 'null');
    if (!team?.members) return;
    const member = team.members.find(item => item.id === profile.id);
    if (!member) return;
    member.full_name = profile.full_name;
    member.avatar_url = profile.avatar_url;
    localStorage.setItem(LOCAL_TEAM_KEY, JSON.stringify(team));
  } catch (_) {}
}

function showStatus(message, attention = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle('error', attention);
}

function showToast(title, message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.querySelector(':scope > span').textContent = '✓';
  toast.querySelector('strong').textContent = title;
  toast.querySelector('p').textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function applyProfile(profile) {
  fullNameInput.value = profile.full_name || '';
  emailInput.value = profile.email || authContext?.user?.email || '';
  roleInput.value = ROLE_LABELS[profile.role] || 'Membro';
  selectedAvatar = validAvatar(profile.avatar_url);

  setAvatar(avatarPreview, selectedAvatar, profile.full_name);
  setAvatar(document.querySelector('.profile .avatar'), selectedAvatar, profile.full_name);

  const sidebarProfile = document.querySelector('.profile');
  if (sidebarProfile) {
    sidebarProfile.querySelector('strong').textContent = profile.full_name;
  }

  avatarPicker.querySelectorAll('[data-avatar]').forEach(button => {
    const selected = button.dataset.avatar === selectedAvatar;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function renderAvatarPicker() {
  avatarPicker.innerHTML = AVATARS.map((avatar, index) => `
    <button type="button" data-avatar="${avatar}" aria-label="Escolher avatar ${index + 1}" aria-pressed="false">
      <img src="${avatar}" alt="" loading="lazy">
    </button>
  `).join('');
}

function initializeProfile(context) {
  authContext = context;
  const profile = context.localMode
    ? readLocalProfile(context.profile)
    : { ...context.profile, avatar_url: validAvatar(context.profile.avatar_url) };

  context.profile = profile;
  window.dotiAuthContext.profile = profile;
  if (context.localMode) syncLocalTeam(profile);

  storageHint.textContent = context.localMode
    ? 'No modo local, as alterações ficam somente neste navegador.'
    : 'Nome e avatar são salvos com segurança no perfil da sua conta.';
  form.querySelector('[type="submit"]').disabled = false;
  applyProfile(profile);
}

renderAvatarPicker();

avatarPicker.addEventListener('click', event => {
  const button = event.target.closest('[data-avatar]');
  if (!button) return;
  selectedAvatar = button.dataset.avatar;
  avatarPicker.querySelectorAll('[data-avatar]').forEach(item => {
    const selected = item === button;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  setAvatar(avatarPreview, selectedAvatar, fullNameInput.value);
  showStatus('');
});

fullNameInput.addEventListener('input', () => {
  setAvatar(avatarPreview, selectedAvatar, fullNameInput.value);
  showStatus('');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const fullName = fullNameInput.value.trim();
  if (fullName.length < 2) {
    showStatus('Informe um nome com pelo menos 2 caracteres.', true);
    fullNameInput.focus();
    return;
  }
  if (!selectedAvatar) {
    showStatus('Escolha um avatar para continuar.', true);
    avatarPicker.querySelector('[data-avatar]')?.focus();
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Salvando…';
  showStatus('');

  try {
    let profile;
    if (authContext.localMode) {
      profile = {
        ...authContext.profile,
        full_name: fullName,
        avatar_url: selectedAvatar
      };
      localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify({
        full_name: profile.full_name,
        avatar_url: profile.avatar_url
      }));
      syncLocalTeam(profile);
    } else {
      const { data, error } = await authContext.supabase.functions.invoke('team-admin', {
        body: {
          action: 'update_profile',
          fullName,
          avatarUrl: selectedAvatar
        }
      });
      if (error) {
        let message = error.message;
        try {
          const payload = await error.context?.json();
          message = payload?.error || message;
        } catch (_) {}
        throw new Error(message || 'Não foi possível atualizar o perfil.');
      }
      profile = data?.profile;
      if (!profile) throw new Error('O perfil atualizado não foi retornado.');
    }

    authContext.profile = profile;
    if (authContext.user?.user_metadata) {
      authContext.user.user_metadata.full_name = profile.full_name;
    }
    window.dotiAuthContext.profile = profile;
    applyProfile(profile);
    showStatus(authContext.localMode
      ? 'Alterações salvas somente neste navegador.'
      : 'Alterações salvas no seu perfil.');
    showToast('Perfil atualizado', 'Seu nome e avatar foram atualizados.');
    window.dispatchEvent(new CustomEvent('doti:profile-updated', { detail: profile }));
  } catch (error) {
    showStatus(error.message || 'Não foi possível atualizar o perfil.', true);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Salvar alterações';
  }
});

window.addEventListener('doti:auth-ready', event => initializeProfile(event.detail));

if (window.dotiAuthContext) {
  initializeProfile(window.dotiAuthContext);
}
