// Dark-first two-state theme toggle controller (per modern-web-guidance: dark-mode-toggle)
export function getRenderedScheme() {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const content = meta?.content;
  if (content === 'light' || content === 'dark') return content;
  return 'dark';
}

function applyMetaContent(value) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = value;
  }
  window.dispatchEvent(
    new CustomEvent('hosila:themechange', {
      detail: { scheme: getRenderedScheme(), raw: value },
    })
  );
}

export function initThemeController() {
  const buttons = document.querySelectorAll('[data-theme-toggle]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = getRenderedScheme() === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('color-scheme', target);
      } catch {}
      applyMetaContent(target);
    });
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'color-scheme') {
      const next = e.newValue === 'light' ? 'light' : 'dark';
      applyMetaContent(next);
    }
  });
}
