// Contact Sales & Instant WhatsApp Pre-filled DM Form
const WHATSAPP_NUMBER = '2349063814659';
const SALES_EMAIL = 'Hosilateam@gmail.com';

const PRODUCT_LABELS = {
  'hosila-pms': 'Hosila PMS (Hotel Management)',
  'hosila-ims': 'Hosila IMS (Store & Kitchen Inventory)',
  'both': 'Both Hosila PMS & Hosila IMS',
  'hosila-pos': 'Hosila POS (Early Access)',
};

const INTENT_LABELS = {
  license: 'Pay for a License & Activate',
  support: 'Ask for Support / Help',
  demo: 'Book a Demo or Setup Guidance',
  transfer: 'Move License to a New Computer',
  other: 'General Inquiry',
};

const TERM_LABELS = {
  monthly: 'Monthly Plan',
  yearly: 'Annual Plan (1 Year)',
  lifetime: 'Lifetime Plan (One-time)',
  undecided: 'Not sure yet — advise me',
};

const form = document.getElementById('contact-whatsapp-form');
if (form) {
  const nameInput = document.getElementById('ct-name');
  const bizInput = document.getElementById('ct-business');
  const productSelect = document.getElementById('ct-product');
  const intentSelect = document.getElementById('ct-intent');
  const planField = document.getElementById('ct-plan-field');
  const planSelect = document.getElementById('ct-plan');
  const machineInput = document.getElementById('ct-machine');
  const noteInput = document.getElementById('ct-note');
  const statusEl = document.getElementById('ct-live-status');
  const previewBox = document.getElementById('ct-preview-box');
  const previewText = document.getElementById('ct-preview-text');
  const emailBtn = document.getElementById('ct-email-btn');

  // Pre-fill from query string (?product=hosila-pms&term=yearly&intent=license)
  const params = new URLSearchParams(window.location.search);
  const qProduct = params.get('product');
  const qTerm = params.get('term');
  const qIntent = params.get('intent');
  if (qProduct && PRODUCT_LABELS[qProduct] && productSelect) {
    productSelect.value = qProduct;
  }
  if (qIntent && INTENT_LABELS[qIntent] && intentSelect) {
    intentSelect.value = qIntent;
  }
  if (qTerm && TERM_LABELS[qTerm] && planSelect) {
    planSelect.value = qTerm;
  }

  function syncPlanVisibility() {
    if (!planField || !intentSelect) return;
    planField.hidden = intentSelect.value !== 'license';
  }

  function setFieldError(input, errId, show) {
    const err = document.getElementById(errId);
    if (!err || !input) return;
    err.hidden = !show;
    input.setAttribute('aria-invalid', show ? 'true' : 'false');
    if (show) {
      input.setAttribute('aria-describedby', errId);
    } else {
      input.removeAttribute('aria-describedby');
    }
  }

  function buildMessage() {
    const name = (nameInput?.value || '').trim();
    const biz = (bizInput?.value || '').trim();
    const prod = PRODUCT_LABELS[productSelect?.value] || 'Hosila Software';
    const intent = INTENT_LABELS[intentSelect?.value] || 'Pay for a License & Activate';
    const plan = TERM_LABELS[planSelect?.value] || '';
    const machine = (machineInput?.value || '').trim().toUpperCase();
    const note = (noteInput?.value || '').trim();

    const lines = [
      'Hello Hosila Sales Team,',
      '',
      `Name: ${name || '[Your Name]'}`,
      `Hotel / Business: ${biz || '[Your Business Name]'}`,
      `Product: ${prod}`,
      `Request: ${intent}`,
    ];
    if (intentSelect?.value === 'license' && plan) {
      lines.push(`Preferred Plan: ${plan}`);
    }
    if (machine) {
      lines.push(`Computer Machine ID: ${machine}`);
    }
    if (note) {
      lines.push(`Message: ${note}`);
    }
    return lines.join('\n');
  }

  function updatePreview() {
    const msg = buildMessage();
    if (previewText) previewText.textContent = msg;
    if (emailBtn) {
      const subject = encodeURIComponent(
        `Hosila Inquiry — ${PRODUCT_LABELS[productSelect?.value] || 'Hosila'} (${INTENT_LABELS[intentSelect?.value] || 'Sales'})`
      );
      emailBtn.href = `mailto:${SALES_EMAIL}?subject=${subject}&body=${encodeURIComponent(msg)}`;
    }
  }

  function validateForm() {
    let ok = true;
    const nameVal = (nameInput?.value || '').trim();
    const bizVal = (bizInput?.value || '').trim();

    if (nameVal.length < 2) {
      setFieldError(nameInput, 'ct-name-err', true);
      ok = false;
    } else {
      setFieldError(nameInput, 'ct-name-err', false);
    }

    if (bizVal.length < 2) {
      setFieldError(bizInput, 'ct-business-err', true);
      ok = false;
    } else {
      setFieldError(bizInput, 'ct-business-err', false);
    }

    return ok;
  }

  intentSelect?.addEventListener('change', () => {
    syncPlanVisibility();
    updatePreview();
  });

  [nameInput, bizInput, productSelect, planSelect, machineInput, noteInput].forEach((el) => {
    el?.addEventListener('input', updatePreview);
    el?.addEventListener('change', updatePreview);
  });

  nameInput?.addEventListener('blur', () => {
    if (nameInput.value.trim().length > 0) setFieldError(nameInput, 'ct-name-err', nameInput.value.trim().length < 2);
  });
  bizInput?.addEventListener('blur', () => {
    if (bizInput.value.trim().length > 0) setFieldError(bizInput, 'ct-business-err', bizInput.value.trim().length < 2);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (statusEl) statusEl.textContent = '';

    if (!validateForm()) {
      if (statusEl) {
        statusEl.style.color = 'var(--color-danger-ink)';
        statusEl.textContent = 'Please enter your name and hotel or business name before opening WhatsApp.';
      }
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      if (firstInvalid instanceof HTMLElement) firstInvalid.focus();
      return;
    }

    const msg = buildMessage();
    const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
    if (previewBox) previewBox.hidden = false;
    if (statusEl) {
      statusEl.style.color = 'var(--color-accent-ink)';
      statusEl.innerHTML = `Opening WhatsApp chat with Hosila Sales (09063814659)... <a href="${waUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline;">Click here if it did not open automatically</a>.`;
    }
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  });

  syncPlanVisibility();
  updatePreview();
}
