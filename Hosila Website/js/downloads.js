const label = document.querySelector('[data-os-label]');
const ua = navigator.userAgent.toLowerCase();

if (label) {
  if (ua.includes('win')) {
    label.textContent = 'Ready for Windows · Compatible with Windows 10 & Windows 11';
  } else if (ua.includes('mac') || ua.includes('linux')) {
    label.textContent = 'Designed for Windows reception and store computers';
  }
}
