export const COMMERCIAL_CATALOG = {
  'hosila-pms': {
    product: 'hosila-pms',
    name: 'Hosila PMS',
    tagline: 'Front desk, room reservations, guest billing, hotel dining, and daily accounting in one calm system.',
    architectureNote: 'One license per property · Connect front desk, restaurant & back-office computers over hotel Wi-Fi · Full access included',
    terms: {
      monthly: { label: 'Monthly', days: 30, ngn: 35000, usd: 29, note: '30-day full-access license' },
      yearly: { label: 'Annual', days: 365, ngn: 350000, usd: 290, note: '1-year full-access license (save 2 months)' },
      lifetime: { label: 'Lifetime', days: null, ngn: 950000, usd: 790, note: 'One-time purchase · Never expires' },
    },
  },
  'hosila-ims': {
    product: 'hosila-ims',
    name: 'Hosila IMS',
    tagline: 'Kitchen, bar, and central store inventory—buy in crates or bags, issue in single units, and track exact stock value.',
    architectureNote: 'One license per store computer · Works completely offline · Full access included',
    terms: {
      monthly: { label: 'Monthly', days: 30, ngn: 20000, usd: 19, note: '30-day full-access license' },
      yearly: { label: 'Annual', days: 365, ngn: 200000, usd: 190, note: '1-year full-access license (save 2 months)' },
      lifetime: { label: 'Lifetime', days: null, ngn: 550000, usd: 490, note: 'One-time purchase · Never expires' },
    },
  },
};

export function formatMoneyAmount(amount, currency) {
  return currency === 'NGN'
    ? `\u20A6${Number(amount).toLocaleString('en-NG')}`
    : `$${Number(amount).toLocaleString('en-US')}`;
}
