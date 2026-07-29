const LOGIN_STORAGE_KEY = 'doti_authenticated';
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const rememberLogin = document.getElementById('rememberLogin');
const loginSubmit = loginForm.querySelector('.login-submit');

if (
  localStorage.getItem(LOGIN_STORAGE_KEY) === '1' ||
  sessionStorage.getItem(LOGIN_STORAGE_KEY) === '1'
) {
  location.replace('../index.html');
}

function showLoginNotice(message) {
  document.querySelector('.login-notice')?.remove();
  const notice = document.createElement('div');
  notice.className = 'login-notice';
  notice.setAttribute('role', 'status');
  notice.innerHTML = `<i></i><span>${message}</span>`;
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 3600);
}

function enterDoti(persistent = false) {
  loginSubmit.classList.add('loading');
  loginSubmit.disabled = true;
  const storage = persistent ? localStorage : sessionStorage;
  storage.setItem(LOGIN_STORAGE_KEY, '1');
  setTimeout(() => location.replace('../index.html'), 650);
}

function validateLogin() {
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.value.trim());
  const passwordValid = loginPassword.value.length >= 6;
  loginEmail.closest('.login-field').classList.toggle('invalid', !emailValid);
  loginPassword.closest('.login-field').classList.toggle('invalid', !passwordValid);
  return emailValid && passwordValid;
}

loginForm.addEventListener('submit', event => {
  event.preventDefault();
  if (validateLogin()) enterDoti(rememberLogin.checked);
});

[loginEmail, loginPassword].forEach(input => {
  input.addEventListener('input', () => input.closest('.login-field').classList.remove('invalid'));
});

document.getElementById('passwordToggle').addEventListener('click', event => {
  const showing = loginPassword.type === 'text';
  loginPassword.type = showing ? 'password' : 'text';
  event.currentTarget.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
  loginPassword.focus();
});

document.getElementById('demoAccess').addEventListener('click', () => enterDoti(false));
document.getElementById('forgotPassword').addEventListener('click', () => {
  showLoginNotice('A recuperação de senha será ativada com o novo backend.');
});
document.getElementById('requestAccess').addEventListener('click', () => {
  showLoginNotice('Os convites de equipe serão ativados na próxima etapa.');
});
