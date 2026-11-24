// System-first two-state theme toggle controller (per modern-web-guidance: dark-mode-toggle)
function getSystemScheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getRenderedScheme() {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const content = meta?.content;
  if (content === 'light' || content === 'dark') return content;
  return getSystemScheme();
}

function applyMetaContent(value) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = value;
  }
  window.dispatchEvent(new CustomEvent('hosila:themechange', {
    detail: { scheme: getRenderedScheme(), raw: value },
  }));
}

export function initThemeController() {
  const buttons = document.querySelectorAll('[data-theme-toggle]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const currentRendered = getRenderedScheme();
      const target = currentRendered === 'dark' ? 'light' : 'dark';
      const system = getSystemScheme();

      try {
        if (target === system) {
          localStorage.removeItem('color-scheme');
          applyMetaContent('light dark');
        } else {
          localStorage.setItem('color-scheme', target);
          applyMetaContent(target);
        }
      } catch {
        applyMetaContent(target === system ? 'light dark' : target);
      }
    });
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'color-scheme') {
      const next = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'light dark';
      applyMetaContent(next);
    }
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    window.dispatchEvent(
      new CustomEvent('hosila:themechange', {
        detail: { scheme: getRenderedScheme() },
      })
    );
  });
}

