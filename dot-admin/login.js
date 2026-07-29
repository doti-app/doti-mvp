import { authUrl, getSupabase } from './supabase-client.js';

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('loginEmail');
const passwordInput = document.getElementById('loginPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const fullNameInput = document.getElementById('fullName');
const agencyNameInput = document.getElementById('agencyName');
const submitButton = form.querySelector('.login-submit');
const submitLabel = submitButton.querySelector('span');
const secondaryAction = document.getElementById('secondaryAction');
const secondaryLabel = secondaryAction.querySelector('span');
const statusBox = document.getElementById('loginStatus');
const forgotButton = document.getElementById('forgotPassword');
const title = document.getElementById('loginTitle');
const kicker = document.getElementById('loginKicker');
const description = document.getElementById('loginDescription');
const query = new URLSearchParams(location.search);

let mode = query.get('mode') === 'reset' ? 'reset' : 'login';
let supabase;

const modeContent = {
  login: {
    kicker: 'SEU ESPAÇO DE TRABALHO',
    title: 'Bem-vindo<br>de volta<span>.</span>',
    description: 'Entre para continuar de onde sua equipe parou.',
    submit: 'Entrar na Doti',
    secondary: 'Criar minha conta'
  },
  signup: {
    kicker: 'COMECE SUA OPERAÇÃO',
    title: 'Crie sua<br>agência<span>.</span>',
    description: 'Configure sua identidade e convide a equipe depois.',
    submit: 'Criar conta',
    secondary: 'Já tenho uma conta'
  },
  recovery: {
    kicker: 'RECUPERAÇÃO DE ACESSO',
    title: 'Recupere sua<br>senha<span>.</span>',
    description: 'Enviaremos um link seguro para o seu e-mail.',
    submit: 'Enviar link de recuperação',
    secondary: 'Voltar para o login'
  },
  reset: {
    kicker: 'NOVA SENHA',
    title: 'Proteja seu<br>acesso<span>.</span>',
    description: 'Crie uma nova senha para continuar na Doti.',
    submit: 'Salvar nova senha',
    secondary: 'Voltar para o login'
  }
};

function showStatus(message, type = 'error') {
  statusBox.textContent = message;
  statusBox.className = `login-form-status visible ${type}`;
}

function clearStatus() {
  statusBox.textContent = '';
  statusBox.className = 'login-form-status';
}

function setBusy(busy) {
  submitButton.disabled = busy;
  secondaryAction.disabled = busy;
  submitButton.classList.toggle('loading', busy);
}

function setMode(nextMode) {
  mode = nextMode;
  const content = modeContent[mode];
  kicker.textContent = content.kicker;
  title.innerHTML = content.title;
  description.textContent = content.description;
  submitLabel.textContent = content.submit;
  secondaryLabel.textContent = content.secondary;

  document.querySelectorAll('.signup-only').forEach(field => {
    field.hidden = mode !== 'signup';
  });
  document.querySelectorAll('.confirm-only').forEach(field => {
    field.hidden = !['signup', 'reset'].includes(mode);
  });
  document.querySelectorAll('.login-only').forEach(field => {
    field.hidden = mode !== 'login';
  });
  document.querySelector('.email-field').hidden = mode === 'reset';
  document.querySelector('.password-field').hidden = ['recovery'].includes(mode);

  passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  clearStatus();
  form.querySelectorAll('.invalid').forEach(field => field.classList.remove('invalid'));
  const focusTarget = mode === 'reset' ? passwordInput : mode === 'signup' ? fullNameInput : emailInput;
  setTimeout(() => focusTarget.focus(), 50);
}

function validateEmail() {
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value.trim());
  emailInput.closest('.login-field').classList.toggle('invalid', !valid);
  return valid;
}

function validatePassword(requireConfirmation = false) {
  const passwordValid = passwordInput.value.length >= 8;
  passwordInput.closest('.login-field').classList.toggle('invalid', !passwordValid);
  let confirmationValid = true;
  if (requireConfirmation) {
    confirmationValid =
      confirmPasswordInput.value.length >= 8 &&
      confirmPasswordInput.value === passwordInput.value;
    confirmPasswordInput.closest('.login-field').classList.toggle('invalid', !confirmationValid);
  }
  return passwordValid && confirmationValid;
}

function translateAuthError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (message.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (message.includes('user already registered')) return 'Este e-mail já possui uma conta.';
  if (message.includes('password')) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (message.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return error?.message || 'Não foi possível concluir a operação. Tente novamente.';
}

async function handleLogin() {
  if (!validateEmail() || !validatePassword()) return;
  const { error } = await supabase.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value
  });
  if (error) throw error;
  location.replace('../index.html');
}

async function handleSignup() {
  const nameValid = fullNameInput.value.trim().split(/\s+/).length >= 2;
  const agencyValid = agencyNameInput.value.trim().length >= 2;
  fullNameInput.closest('.login-field').classList.toggle('invalid', !nameValid);
  agencyNameInput.closest('.login-field').classList.toggle('invalid', !agencyValid);
  if (!nameValid || !agencyValid || !validateEmail() || !validatePassword(true)) return;

  const { data, error } = await supabase.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value,
    options: {
      emailRedirectTo: authUrl('confirmed=1'),
      data: {
        full_name: fullNameInput.value.trim(),
        agency_name: agencyNameInput.value.trim()
      }
    }
  });
  if (error) throw error;

  if (data.session) {
    location.replace('../index.html');
    return;
  }
  form.reset();
  setMode('login');
  showStatus('Conta criada. Enviamos um link para confirmar seu e-mail.', 'success');
}

async function handleRecovery() {
  if (!validateEmail()) return;
  const { error } = await supabase.auth.resetPasswordForEmail(emailInput.value.trim(), {
    redirectTo: authUrl('mode=reset')
  });
  if (error) throw error;
  showStatus('Link enviado. Confira sua caixa de entrada e também o spam.', 'success');
}

async function handleReset() {
  if (!validatePassword(true)) return;
  const { error } = await supabase.auth.updateUser({ password: passwordInput.value });
  if (error) throw error;
  await supabase.auth.signOut();
  form.reset();
  setMode('login');
  showStatus('Senha atualizada. Entre novamente com sua nova senha.', 'success');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  clearStatus();
  setBusy(true);
  try {
    if (mode === 'login') await handleLogin();
    if (mode === 'signup') await handleSignup();
    if (mode === 'recovery') await handleRecovery();
    if (mode === 'reset') await handleReset();
  } catch (error) {
    showStatus(translateAuthError(error));
  } finally {
    setBusy(false);
  }
});

secondaryAction.addEventListener('click', () => {
  setMode(mode === 'login' ? 'signup' : 'login');
});

forgotButton.addEventListener('click', () => setMode('recovery'));

document.getElementById('passwordToggle').addEventListener('click', event => {
  const showing = passwordInput.type === 'text';
  passwordInput.type = showing ? 'password' : 'text';
  event.currentTarget.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
  passwordInput.focus();
});

form.querySelectorAll('input').forEach(input => {
  input.addEventListener('input', () => {
    input.closest('.login-field').classList.remove('invalid');
    clearStatus();
  });
});

async function initialize() {
  setMode(mode);
  setBusy(true);
  try {
    supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (session && mode !== 'reset') {
      location.replace('../index.html');
      return;
    }
    if (query.get('confirmed') === '1') {
      showStatus('E-mail confirmado. Sua conta está pronta para entrar.', 'success');
    }
    if (query.get('reason') === 'expired') {
      showStatus('Sua sessão expirou. Entre novamente para continuar.', 'info');
    }
  } catch (error) {
    showStatus(error.message, 'info');
    form.querySelectorAll('button,input').forEach(element => {
      element.disabled = true;
    });
  } finally {
    if (supabase) setBusy(false);
  }
}

initialize();
