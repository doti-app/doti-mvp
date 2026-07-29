(() => {
  const LOGIN_STORAGE_KEY = 'doti_authenticated';
  const isAuthenticated =
    localStorage.getItem(LOGIN_STORAGE_KEY) === '1' ||
    sessionStorage.getItem(LOGIN_STORAGE_KEY) === '1';

  if (!isAuthenticated) {
    location.replace('dot-admin/index.html');
    return;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logoutButton')?.addEventListener('click', () => {
      localStorage.removeItem(LOGIN_STORAGE_KEY);
      sessionStorage.removeItem(LOGIN_STORAGE_KEY);
      location.replace('dot-admin/index.html');
    });
  });
})();
