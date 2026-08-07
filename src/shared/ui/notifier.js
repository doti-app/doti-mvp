// @ts-check

/** @param {Document} document */
export function createNotifier(document) {
  let timer;
  return (title, message, icon = '✓') => {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.querySelector(':scope > span').textContent = icon;
    toast.querySelector('strong').textContent = title;
    toast.querySelector('p').textContent = message;
    toast.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('show'), 3200);
  };
}
