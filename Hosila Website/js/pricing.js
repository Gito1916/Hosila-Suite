// Pricing page currency/term toggle + instant WhatsApp / Contact Sales routing
const currencyBtns = document.querySelectorAll('[data-currency-btn]');
const termBtns = document.querySelectorAll('[data-term-btn]');
const priceDisplays = document.querySelectorAll('[data-price-display]');
const termSuffixes = document.querySelectorAll('[data-term-suffix]');
const termNotes = document.querySelectorAll('[data-term-note]');
const buyLinks = document.querySelectorAll('[data-whatsapp-buy]');

const SUFFIX_MAP = { monthly: '/ month', yearly: '/ year', lifetime: 'one-time' };
const NOTE_MAP = {
  monthly: '30-day full-access license',
  yearly: '1-year full-access license (save 2 months)',
  lifetime: 'One-time purchase · Never expires',
};

let activeCurrency = 'NGN';
let activeTerm = 'yearly';

function syncPricingUI() {
  priceDisplays.forEach((el) => {
    const key = `${activeCurrency.toLowerCase()}${activeTerm.charAt(0).toUpperCase()}${activeTerm.slice(1)}`;
    if (el.dataset[key]) el.textContent = el.dataset[key];
  });
  termSuffixes.forEach((el) => {
    el.textContent = SUFFIX_MAP[activeTerm];
  });
  termNotes.forEach((el) => {
    el.textContent = NOTE_MAP[activeTerm];
  });
  buyLinks.forEach((link) => {
    const product = link.getAttribute('data-whatsapp-buy') || 'hosila-pms';
    link.setAttribute(
      'href',
      `/contact?product=${encodeURIComponent(product)}&term=${encodeURIComponent(activeTerm)}&intent=license`
    );
  });
}

currencyBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    activeCurrency = btn.dataset.currencyBtn || 'NGN';
    currencyBtns.forEach((b) => {
      const isAct = b === btn;
      b.classList.toggle('is-active', isAct);
      b.setAttribute('aria-pressed', String(isAct));
    });
    syncPricingUI();
  });
});

termBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    activeTerm = btn.dataset.termBtn || 'yearly';
    termBtns.forEach((b) => {
      const isAct = b === btn;
      b.classList.toggle('is-active', isAct);
      b.setAttribute('aria-pressed', String(isAct));
    });
    syncPricingUI();
  });
});

syncPricingUI();
