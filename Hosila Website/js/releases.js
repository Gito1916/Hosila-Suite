const filterBtns = document.querySelectorAll('[data-rel-filter]');
const cards = document.querySelectorAll('[data-rel-product]');

filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const val = btn.getAttribute('data-rel-filter') || 'all';
    filterBtns.forEach((b) => {
      const active = b.getAttribute('data-rel-filter') === val;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    });
    cards.forEach((card) => {
      card.hidden = val !== 'all' && card.getAttribute('data-rel-product') !== val;
    });
  });
});

