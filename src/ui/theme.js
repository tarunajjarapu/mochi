const colorPreference = window.matchMedia('(prefers-color-scheme: dark)');
let preferredTheme = 'dark';
function applyTheme(theme) {
  preferredTheme = ['dark', 'light', 'system'].includes(theme) ? theme : 'dark';
  document.documentElement.dataset.theme = preferredTheme === 'system' ? (colorPreference.matches ? 'dark' : 'light') : preferredTheme;
  const picker = document.querySelector('#theme'); if (picker) picker.value = preferredTheme;
}
colorPreference.addEventListener('change', () => applyTheme(preferredTheme));
window.mochi.onEvent(event => { if (event.type === 'state') applyTheme(event.state.theme); });
window.mochi.state().then(state => applyTheme(state.theme)).catch(() => {});
