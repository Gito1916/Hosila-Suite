import { initThemeController } from './theme.js';
import { initSiteAnimations } from './animations.js';

initThemeController();

try {
  if (localStorage.getItem('hosila-motion') === 'paused') {
    document.documentElement.dataset.motion = 'paused';
  } else {
    document.documentElement.dataset.motion = 'playing';
  }
} catch {}

// Clean up any legacy Workbox PWA Service Worker from the prior SPA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      regs.forEach((reg) => reg.unregister());
    })
    .catch(() => {});
}

// Shrinking header fallback for browsers without scroll-driven animations
const header = document.querySelector('[data-site-header]');
if (header && !CSS.supports('(animation-timeline: scroll()) and (animation-range: 0% 100%)')) {
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Adaptive navbar collapse only if row would overflow
const inner = document.querySelector('[data-header-inner]');
function syncNavLayout() {
  if (!header || !inner) return;
  header.classList.add('is-wide');
  const fits = inner.scrollWidth <= inner.clientWidth + 2 && window.innerWidth >= 860;
  header.classList.toggle('is-wide', fits);
}
if (header) {
  new ResizeObserver(syncNavLayout).observe(header);
  syncNavLayout();
}

// Products Popover hover preview + Anchor Positioning JS fallback
const dropdownItem = document.querySelector('[data-nav-dropdown]');
const dropdownTrigger = document.querySelector('[data-dropdown-trigger]');
const dropdownList = document.querySelector('[data-dropdown-list]');
let hoverOpened = false;

if (dropdownItem && dropdownTrigger && dropdownList) {
  dropdownList.addEventListener('toggle', (e) => {
    const isOpen = e?.newState === 'open';
    dropdownTrigger.setAttribute('aria-expanded', String(isOpen));
    if (isOpen && !CSS.supports('position-area', 'block-end')) {
      const rect = dropdownTrigger.getBoundingClientRect();
      const menuRect = dropdownList.getBoundingClientRect();
      dropdownList.style.position = 'fixed';
      dropdownList.style.top = `${rect.bottom + 8}px`;
      dropdownList.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - menuRect.width - 12))}px`;
    }
  });

  if (window.matchMedia('(hover: hover)').matches) {
    dropdownItem.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      if (!dropdownList.matches(':popover-open')) {
        hoverOpened = true;
        try {
          dropdownList.showPopover({ source: dropdownTrigger });
        } catch {}
      }
    });
    dropdownItem.addEventListener('pointerleave', () => {
      if (hoverOpened && dropdownList.matches(':popover-open')) {
        hoverOpened = false;
        try {
          dropdownList.hidePopover();
        } catch {}
      }
    });
    dropdownTrigger.addEventListener('click', (e) => {
      if (hoverOpened) {
        hoverOpened = false;
        e.preventDefault();
      }
    });
  }
}

// Mobile Scroll-Snap Drawer
const drawer = document.getElementById('mobile-drawer');
const openBtn = document.getElementById('drawer-open');
const closeBtn = document.getElementById('drawer-close');
const scroller = drawer?.querySelector('[data-drawer-scroller]');
const sheet = drawer?.querySelector('[data-drawer-sheet]');

async function openDrawer() {
  if (!drawer || !scroller) return;
  drawer.showModal();
  if (!CSS.supports('scroll-initial-target', 'nearest')) {
    scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'instant' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  scroller.scrollTo({ left: 0, behavior: 'auto' });
}

function closeDrawer() {
  if (!scroller) return;
  scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'auto' });
}

if (drawer && scroller && sheet && openBtn && closeBtn) {
  const threshold = 1 / Math.max(window.innerWidth, 320);
  const io = new IntersectionObserver(
    (entries) => {
      const last = entries.at(-1);
      if (!last) return;
      if (last.intersectionRatio < threshold && drawer.open) {
        drawer.close();
        openBtn.setAttribute('aria-expanded', 'false');
      } else if (last.intersectionRatio === 1) {
        openBtn.setAttribute('aria-expanded', 'true');
      }
    },
    { root: drawer, threshold: [threshold, 1] }
  );
  io.observe(sheet);

  openBtn.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  drawer.addEventListener('click', (e) => {
    if (!sheet.contains(e.target)) closeDrawer();
  });
  drawer.addEventListener('cancel', (e) => {
    if (e.cancelable) {
      e.preventDefault();
      closeDrawer();
    }
  });
}

// AppWindowFrame zoom modal + backdrop click fallback (per light-dismiss-a-dialog)
document.querySelectorAll('[data-open-dialog]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-open-dialog');
    const dlg = id ? document.getElementById(id) : null;
    dlg?.showModal();
  });
});

document.querySelectorAll('dialog.hosila-dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    const rect = dlg.getBoundingClientRect();
    const outside =
      e.clientY < rect.top ||
      e.clientY > rect.bottom ||
      e.clientX < rect.left ||
      e.clientX > rect.right;
    if (outside) dlg.close();
  });
});

// Subtle pointer tilt on mockup windows when pointer is fine and motion active
if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && document.documentElement.dataset.motion !== 'paused') {
  document.querySelectorAll('[data-perspective-card]').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      if (document.documentElement.dataset.motion === 'paused') return;
      const r = card.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateX(${(-ny * 2.2).toFixed(2)}deg) rotateY(${(nx * 2.8).toFixed(2)}deg)`;
    });
    card.addEventListener('pointerleave', () => {
      card.style.transform = 'rotateX(0deg) rotateY(0deg)';
    });
  });
}

// Shared copy-to-clipboard handler
document.querySelectorAll('[data-copy-text]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const text = btn.getAttribute('data-copy-text') || '';
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => {
        btn.textContent = orig;
      }, 1600);
    } catch {}
  });
});

initSiteAnimations();

