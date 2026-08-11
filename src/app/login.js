import { authUrl, getAuthConfig, getSupabase } from '../shared/auth/supabase-client.js';

/** @param {{ document?: Document, location?: Location }} [options] */
export function createLoginPage(options = {}) {
const document = options.document || globalThis.document;
const location = options.location || globalThis.location;

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('loginEmail');
const passwordInput = document.getElementById('loginPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const passwordToggle = document.getElementById('passwordToggle');
const confirmPasswordToggle = document.getElementById('confirmPasswordToggle');
const fullNameInput = document.getElementById('fullName');
const agencyNameInput = document.getElementById('agencyName');
const submitButton = form.querySelector('.login-submit');
const submitLabel = submitButton.querySelector('span');
const secondaryAction = document.getElementById('secondaryAction');
const secondaryLabel = secondaryAction.querySelector('span');
const statusBox = document.getElementById('loginStatus');
const forgotButton = document.getElementById('forgotPassword');
const resendConfirmationButton = document.getElementById('resendConfirmation');
const title = document.getElementById('loginTitle');
const kicker = document.getElementById('loginKicker');
const description = document.getElementById('loginDescription');
const illustration = document.getElementById('loginIllustration');
const experience = document.getElementById('loginExperience');
const panel = document.querySelector('.login-panel');
const query = new URLSearchParams(location.search);

let mode = ['reset', 'invite'].includes(query.get('mode')) ? query.get('mode') : 'login';
let supabase;
let confirmationEmail = '';
let confirmationResendForExistingAccount = false;

const modeContent = {
  login: {
    kicker: 'SEU ESPAÇO DE TRABALHO',
    title: 'Seja bem-vindo!',
    description: 'Entre para continuar de onde sua equipe parou.',
    submit: 'Entrar na Doti',
    secondary: 'Criar sua conta'
  },
  signup: {
    kicker: 'COMECE SUA OPERAÇÃO',
    title: 'Crie sua agência<span>.</span>',
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
  },
  invite: {
    kicker: 'CONVITE ACEITO',
    title: 'Crie sua<br>senha<span>.</span>',
    description: 'Seu acesso à agência está quase pronto.',
    submit: 'Ativar meu acesso',
    secondary: 'Sair e voltar ao login'
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

function hideConfirmationResend() {
  confirmationEmail = '';
  confirmationResendForExistingAccount = false;
  resendConfirmationButton.hidden = true;
  resendConfirmationButton.disabled = false;
}

function showConfirmationResend(email, forExistingAccount = false) {
  confirmationEmail = email;
  confirmationResendForExistingAccount = forExistingAccount;
  resendConfirmationButton.hidden = false;
  resendConfirmationButton.disabled = false;
}

function setBusy(busy) {
  submitButton.disabled = busy;
  secondaryAction.disabled = busy;
  resendConfirmationButton.disabled = busy;
  submitButton.classList.toggle('loading', busy);
}

function setMode(nextMode) {
  mode = nextMode;
  form.dataset.mode = mode;
  panel.dataset.mode = mode;
  const content = modeContent[mode];
  kicker.textContent = content.kicker;
  title.innerHTML = content.title;
  description.textContent = content.description;
  submitLabel.textContent = content.submit;
  secondaryLabel.textContent = content.secondary;
  const signupMode = mode === 'signup';
  illustration.src = signupMode
    ? '/assets/login-signup-illustration.png'
    : '/assets/login-illustration.png';
  illustration.alt = signupMode
    ? 'Ilustração de uma profissional conectando pessoas'
    : 'Ilustração de uma profissional diante de uma fechadura';

  document.querySelectorAll('.signup-only').forEach(field => {
    field.hidden = mode !== 'signup';
  });
  document.querySelectorAll('.confirm-only').forEach(field => {
    field.hidden = !['signup', 'reset', 'invite'].includes(mode);
  });
  document.querySelectorAll('.login-only').forEach(field => {
    field.hidden = mode !== 'login';
  });
  document.querySelector('.email-field').hidden = ['reset', 'invite'].includes(mode);
  document.querySelector('.password-field').hidden = ['recovery'].includes(mode);

  passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  passwordInput.type = 'password';
  confirmPasswordInput.type = 'password';
  passwordToggle.setAttribute('aria-label', 'Mostrar senha');
  confirmPasswordToggle.setAttribute('aria-label', 'Mostrar confirmação de senha');
  hideConfirmationResend();
  clearStatus();
  form.querySelectorAll('.invalid').forEach(field => field.classList.remove('invalid'));
  const focusTarget = ['reset', 'invite'].includes(mode) ? passwordInput : mode === 'signup' ? fullNameInput : emailInput;
  setTimeout(() => focusTarget.focus(), 50);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function preloadImage(src) {
  return new Promise(resolve => {
    const ImageConstructor = globalThis.Image;
    if (!ImageConstructor) {
      resolve();
      return;
    }
    const image = new ImageConstructor();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
    image.src = src;
    if (image.complete) finish();
    setTimeout(finish, 500);
  });
}

async function switchModeWithLoading(nextMode, illustrationSrc) {
  secondaryAction.disabled = true;
  experience.classList.add('mode-switching');
  try {
    await Promise.all([
      preloadImage(illustrationSrc),
      delay(260)
    ]);
    setMode(nextMode);
    await delay(70);
  } finally {
    experience.classList.remove('mode-switching');
    secondaryAction.disabled = false;
  }
}

function openSignupMode() {
  return switchModeWithLoading('signup', '/assets/login-signup-illustration.png');
}

function openLoginMode() {
  return switchModeWithLoading('login', '/assets/login-illustration.png');
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
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return 'Aguarde alguns minutos antes de pedir outro e-mail de confirmação.';
  }
  return error?.message || 'Não foi possível concluir a operação. Tente novamente.';
}

async function authenticatedDestination() {
  const { data, error } = await supabase.rpc('get_account_context');
  if (!error && data?.platform?.isActive) return '/doti/';
  return '/';
}

async function handleLogin() {
  if (!validateEmail() || !validatePassword()) return;
  const { error } = await supabase.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value
  });
  if (error) throw error;
  location.replace(await authenticatedDestination());
}

async function handleSignup() {
  const nameValid = fullNameInput.value.trim().split(/\s+/).length >= 2;
  const agencyValid = agencyNameInput.value.trim().length >= 2;
  fullNameInput.closest('.login-field').classList.toggle('invalid', !nameValid);
  agencyNameInput.closest('.login-field').classList.toggle('invalid', !agencyValid);
  if (!nameValid || !agencyValid || !validateEmail() || !validatePassword(true)) return;

  const email = emailInput.value.trim();
  const { data, error } = await supabase.auth.signUp({
    email,
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
    location.replace(await authenticatedDestination());
    return;
  }

  form.reset();
  setMode('login');
  emailInput.value = email;

  if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
    showConfirmationResend(email, true);
    showStatus('Este e-mail já possui uma conta. Entre ou recupere sua senha. Se ela ainda não foi confirmada, reenvie o e-mail de confirmação.', 'info');
    return;
  }

  showConfirmationResend(email);
  showStatus('Enviamos um link para confirmar este e-mail. Se já havia um cadastro pendente, use o mesmo link para continuar.', 'success');
}

async function handleResendConfirmation() {
  if (!confirmationEmail) return;
  resendConfirmationButton.disabled = true;
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: confirmationEmail,
      options: { emailRedirectTo: authUrl('confirmed=1') }
    });
    if (error) throw error;
    const message = confirmationResendForExistingAccount
      ? 'Se esta conta ainda estiver pendente de confirmação, enviamos um novo link. Confira sua caixa de entrada e também o spam.'
      : 'Novo e-mail de confirmação enviado. Confira sua caixa de entrada e também o spam.';
    showStatus(message, 'success');
  } catch (error) {
    showStatus(translateAuthError(error));
  } finally {
    resendConfirmationButton.disabled = false;
  }
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

async function handleInvite() {
  if (!validatePassword(true)) return;
  const { error } = await supabase.auth.updateUser({ password: passwordInput.value });
  if (error) throw error;
  const { data: context } = await supabase.rpc('get_account_context');
  if (!context?.platform?.isActive) {
    const { error: acceptError } = await supabase.functions.invoke('team-admin', {
      body: { action: 'accept_invite' }
    });
    if (acceptError) throw acceptError;
  }
  location.replace(context?.platform?.isActive ? '/doti/' : '/');
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
    if (mode === 'invite') await handleInvite();
  } catch (error) {
    showStatus(translateAuthError(error));
  } finally {
    setBusy(false);
  }
});

secondaryAction.addEventListener('click', async () => {
  if (mode === 'invite') {
    await supabase?.auth.signOut();
  }
  if (mode === 'login') {
    await openSignupMode();
    return;
  }
  if (mode === 'signup') {
    await openLoginMode();
    return;
  }
  setMode('login');
});

forgotButton.addEventListener('click', () => setMode('recovery'));
resendConfirmationButton.addEventListener('click', handleResendConfirmation);

passwordToggle.addEventListener('click', event => {
  const showing = passwordInput.type === 'text';
  passwordInput.type = showing ? 'password' : 'text';
  event.currentTarget.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
  passwordInput.focus();
});

confirmPasswordToggle.addEventListener('click', event => {
  const showing = confirmPasswordInput.type === 'text';
  confirmPasswordInput.type = showing ? 'password' : 'text';
  event.currentTarget.setAttribute('aria-label', showing ? 'Mostrar confirmação de senha' : 'Ocultar confirmação de senha');
  confirmPasswordInput.focus();
});

form.querySelectorAll('input').forEach(input => {
  input.addEventListener('input', () => {
    input.closest('.login-field')?.classList.remove('invalid');
    if (input === emailInput && confirmationEmail && emailInput.value.trim().toLowerCase() !== confirmationEmail.toLowerCase()) {
      hideConfirmationResend();
    }
    clearStatus();
  });
});

async function initialize() {
  setMode(mode);
  setBusy(true);
  try {
    const config = await getAuthConfig();
    if (config.localMode) {
      location.replace('../index.html');
      return;
    }
    supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (session && !['reset', 'invite'].includes(mode)) {
      location.replace(await authenticatedDestination());
      return;
    }
    if (mode === 'invite' && !session) {
      setMode('login');
      showStatus('Este convite é inválido ou expirou. Peça um novo convite ao administrador.', 'info');
    }
    if (query.get('confirmed') === '1') {
      showStatus('E-mail confirmado. Sua conta está pronta para entrar.', 'success');
    }
    if (query.get('reason') === 'expired') {
      showStatus('Sua sessão expirou. Entre novamente para continuar.', 'info');
    }
    if (query.get('error') === 'disabled') {
      showStatus('Seu acesso foi desativado. Fale com o administrador da agência.', 'info');
    }
    if (query.get('error') === 'agency-archived') {
      showStatus('Esta agência foi arquivada. Fale com o suporte DOT para restaurar o acesso.', 'info');
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

return { mount: initialize };
}
