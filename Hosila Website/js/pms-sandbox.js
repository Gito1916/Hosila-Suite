const rooms = document.querySelectorAll('[data-sb-room]');
const titleEl = document.querySelector('[data-ins-title]');
const badgeEl = document.querySelector('[data-ins-badge]');
const metaEl = document.querySelector('[data-ins-meta]');
const noteEl = document.querySelector('[data-ins-note]');
const checkinBtn = document.querySelector('[data-ins-checkin]');
const cleanBtn = document.querySelector('[data-ins-clean]');
const feedbackEl = document.querySelector('[data-ins-feedback]');

let activeBtn = rooms[0] ?? null;

function renderInspector(btn) {
  activeBtn = btn;
  const room = btn.getAttribute('data-sb-room') || '';
  const status = btn.getAttribute('data-sb-status') || 'clean';
  const guest = btn.getAttribute('data-sb-guest') || '';
  const rate = btn.getAttribute('data-sb-rate') || '';
  const type = btn.getAttribute('data-sb-type') || '';

  rooms.forEach((r) => r.classList.toggle('is-selected', r === btn));
  if (titleEl) titleEl.textContent = `Room ${room} · ${type}`;
  if (metaEl) metaEl.textContent = `Rate: ${rate}`;
  if (feedbackEl) feedbackEl.textContent = '';

  if (status === 'clean') {
    if (badgeEl) {
      badgeEl.textContent = 'Clean & Ready';
      badgeEl.className = 'badge badge-mint';
    }
    if (noteEl) noteEl.textContent = 'Ready for immediate walk-in check-in or reservation assignment.';
    if (checkinBtn) {
      checkinBtn.disabled = false;
      checkinBtn.textContent = 'Check In Guest';
    }
    if (cleanBtn) cleanBtn.hidden = true;
  } else if (status === 'occupied') {
    if (badgeEl) {
      badgeEl.textContent = 'Occupied';
      badgeEl.className = 'badge';
    }
    if (noteEl) noteEl.textContent = `In-house guest: ${guest}. Folio open for charges or check-out.`;
    if (checkinBtn) {
      checkinBtn.disabled = true;
      checkinBtn.textContent = 'Already Occupied';
    }
    if (cleanBtn) cleanBtn.hidden = true;
  } else {
    if (badgeEl) {
      badgeEl.textContent = status === 'dirty' ? 'Dirty · Blocked' : 'Maintenance · Blocked';
      badgeEl.className = 'badge badge-danger';
    }
    if (noteEl) {
      noteEl.textContent = `Check-in is blocked while Room ${room} is marked ${status}. Mark it Clean first to release it.`;
    }
    if (checkinBtn) {
      checkinBtn.disabled = true;
      checkinBtn.textContent = 'Check-In Blocked';
    }
    if (cleanBtn) cleanBtn.hidden = false;
  }
}

rooms.forEach((btn) => btn.addEventListener('click', () => renderInspector(btn)));

checkinBtn?.addEventListener('click', () => {
  if (feedbackEl && activeBtn?.getAttribute('data-sb-status') === 'clean') {
    feedbackEl.style.color = 'var(--color-accent-ink)';
    feedbackEl.textContent = `Room ${activeBtn.getAttribute('data-sb-room')} cleared housekeeping guard — ready to open Check-In Folio.`;
  }
});

cleanBtn?.addEventListener('click', () => {
  if (!activeBtn) return;
  activeBtn.setAttribute('data-sb-status', 'clean');
  const bar = activeBtn.querySelector('.sb-bar');
  if (bar) bar.className = 'sb-bar sb-bar-mint';
  renderInspector(activeBtn);
  if (feedbackEl) {
    feedbackEl.style.color = 'var(--color-accent-ink)';
    feedbackEl.textContent = `Room ${activeBtn.getAttribute('data-sb-room')} marked Clean and released for check-in.`;
  }
});

