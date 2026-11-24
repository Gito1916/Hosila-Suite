const slider = document.querySelector('[data-uom-slider]');
const btlEl = document.querySelector('[data-uom-bottles]');
const upEl = document.querySelector('[data-uom-upscaled]');
const rateEl = document.querySelector('[data-uom-rate]');
const valEl = document.querySelector('[data-uom-val]');

slider?.addEventListener('input', () => {
  const btl = Number(slider.value);
  const crates = Math.floor(btl / 24);
  const rem = btl % 24;
  if (btlEl) btlEl.textContent = `${btl} Bottles`;
  if (upEl) {
    upEl.textContent =
      crates > 0
        ? rem > 0
          ? `${crates} ${crates === 1 ? 'Crate' : 'Crates'} + ${rem} ${rem === 1 ? 'Bottle' : 'Bottles'}`
          : `${crates} ${crates === 1 ? 'Crate' : 'Crates'}`
        : `${rem} ${rem === 1 ? 'Bottle' : 'Bottles'}`;
  }
  if (rateEl) rateEl.textContent = '\u20A6950 / Bottle (\u20A622,800 / Crate)';
  if (valEl) valEl.textContent = `\u20A6${(btl * 950).toLocaleString()}.00`;
});
