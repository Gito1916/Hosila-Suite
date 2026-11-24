// Hosila POS Early-Access Waitlist Form -> Instant WhatsApp DM (100% static-compatible)
const WHATSAPP_NUMBER = '2349063814659';
const form = document.getElementById('pos-waitlist-form');
const emailInput = document.getElementById('wl-email');
const bizInput = document.getElementById('wl-biz');
const statusEl = document.getElementById('wl-status');

function syncErrorState(input) {
  const errId = input.dataset.error;
  if (!errId) return;
  const invalid = !input.validity.valid;
  input.classList.toggle('user-invalid-fallback', invalid);
  if (invalid) {
    input.setAttribute('aria-describedby', `wl-email-hint ${errId}`);
  } else {
    input.setAttribute('aria-describedby', 'wl-email-hint');
  }
}

if (emailInput) {
  emailInput.addEventListener('blur', () => {
    if (emailInput.value.trim().length > 0) syncErrorState(emailInput);
  });
  emailInput.addEventListener('input', () => {
    if (emailInput.classList.contains('user-invalid-fallback')) syncErrorState(emailInput);
  });
}

if (form && emailInput && statusEl) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    syncErrorState(emailInput);
    if (!emailInput.validity.valid) {
      emailInput.focus();
      return;
    }

    const email = emailInput.value.trim();
    const biz = bizInput ? bizInput.value.trim() : '';
    const msg = [
      'Hello Hosila Sales Team,',
      '',
      'Please add me to the Hosila POS early-access list.',
      `Email: ${email}`,
      ...(biz ? [`Business / Venue: ${biz}`] : []),
    ].join('\n');

    const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
    statusEl.innerHTML = `Opening WhatsApp to register your venue... <a href="${waUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline;">Open WhatsApp</a>`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    form.reset();
  });
}
