import { initHeroStage } from './hero-stage.js';

initHeroStage();

const appBtns = document.querySelectorAll('[data-showcase-app]');
const appPanels = document.querySelectorAll('[data-showcase-panel]');

appBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-showcase-app');
    appBtns.forEach((b) => {
      const active = b.getAttribute('data-showcase-app') === target;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    });
    appPanels.forEach((p) => {
      p.hidden = p.getAttribute('data-showcase-panel') !== target;
    });
  });
});

document.querySelectorAll('[data-view-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    const key = tab.getAttribute('data-view-tab') || '';
    const panel = tab.closest('[data-showcase-panel]');
    if (!panel) return;
    panel.querySelectorAll('[data-view-tab]').forEach((t) => {
      t.classList.toggle('is-active', t.getAttribute('data-view-tab') === key);
    });
    panel.querySelectorAll('[data-view-pane]').forEach((pane) => {
      pane.hidden = pane.getAttribute('data-view-pane') !== key;
    });
  });
});

