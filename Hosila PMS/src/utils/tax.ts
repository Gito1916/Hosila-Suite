import type { FolioCharge, HotelSettings, TaxBreakdownItem, TaxMode, TaxRule } from '../types';

export type TaxDomain = 'accommodation' | 'restaurant' | 'other';

export interface TaxCalculation {
  applicable: boolean;
  taxName: string;
  taxRate: number;
  taxMode: TaxMode;
  taxLabel: string;
  inputAmount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  breakdown: TaxBreakdownItem[];
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function domainForChargeCategory(category: FolioCharge['category']): TaxDomain {
  if (category === 'room') return 'accommodation';
  if (category === 'restaurant_pos' || category === 'restaurant_manual') return 'restaurant';
  return 'other';
}

type TaxSettingsSlice = Pick<
  HotelSettings,
  'tax_enabled' | 'tax_name' | 'tax_rate' | 'tax_mode' | 'tax_applies_to'
> & {
  tax_rules?: Array<Pick<TaxRule, 'id' | 'name' | 'rate' | 'mode' | 'applies_to' | 'enabled'>>;
};

export function getActiveTaxRules(settings: TaxSettingsSlice, domain: TaxDomain) {
  if (!settings.tax_enabled || domain === 'other') return [];
  const rules =
    Array.isArray(settings.tax_rules) && settings.tax_rules.length > 0
      ? settings.tax_rules
      : settings.tax_rate > 0
        ? [
            {
              id: 0,
              name: settings.tax_name || 'Tax',
              rate: settings.tax_rate,
              mode: settings.tax_mode || 'exclusive',
              applies_to: settings.tax_applies_to || 'both',
              enabled: 1,
            },
          ]
        : [];

  return rules.filter(
    (r) =>
      r.enabled === 1 &&
      Number.isFinite(r.rate) &&
      r.rate > 0 &&
      (r.applies_to === 'both' || r.applies_to === domain)
  );
}

export function isTaxApplicable(settings: TaxSettingsSlice, domain: TaxDomain): boolean {
  return getActiveTaxRules(settings, domain).length > 0;
}

export function calculateTax(
  baseAmount: number,
  domain: TaxDomain,
  settings: TaxSettingsSlice
): TaxCalculation {
  const safeBase = Number.isFinite(baseAmount) && baseAmount > 0 ? roundMoney(baseAmount) : 0;
  const activeRules = safeBase > 0 ? getActiveTaxRules(settings, domain) : [];

  if (activeRules.length === 0) {
    return {
      applicable: false,
      taxName: settings.tax_name || 'Tax',
      taxRate: 0,
      taxMode: settings.tax_mode || 'exclusive',
      taxLabel: 'Tax Exempt',
      inputAmount: safeBase,
      netAmount: safeBase,
      taxAmount: 0,
      totalAmount: safeBase,
      breakdown: [],
    };
  }

  const inclusiveRules = activeRules.filter((r) => r.mode === 'inclusive');
  const exclusiveRules = activeRules.filter((r) => r.mode === 'exclusive');

  const totalInclusiveRate = inclusiveRules.reduce((sum, r) => sum + r.rate / 100, 0);
  const netAmount =
    totalInclusiveRate > 0 ? roundMoney(safeBase / (1 + totalInclusiveRate)) : safeBase;

  const breakdown: TaxBreakdownItem[] = [];

  if (inclusiveRules.length > 0) {
    const incItems: TaxBreakdownItem[] = inclusiveRules.map((r) => ({
      id: r.id,
      name: r.name || 'Tax',
      rate: r.rate,
      mode: 'inclusive',
      amount: roundMoney(netAmount * (r.rate / 100)),
    }));
    const incSum = roundMoney(incItems.reduce((s, item) => s + item.amount, 0));
    const expectedIncSum = roundMoney(safeBase - netAmount);
    const drift = roundMoney(expectedIncSum - incSum);
    if (drift !== 0 && incItems.length > 0) {
      incItems[incItems.length - 1].amount = roundMoney(incItems[incItems.length - 1].amount + drift);
    }
    breakdown.push(...incItems);
  }

  for (const r of exclusiveRules) {
    breakdown.push({
      id: r.id,
      name: r.name || 'Tax',
      rate: r.rate,
      mode: 'exclusive',
      amount: roundMoney(netAmount * (r.rate / 100)),
    });
  }

  const taxAmount = roundMoney(breakdown.reduce((s, item) => s + item.amount, 0));
  const totalAmount =
    exclusiveRules.length === 0 && inclusiveRules.length > 0
      ? safeBase
      : roundMoney(netAmount + taxAmount);

  const combinedRate = roundMoney(activeRules.reduce((s, r) => s + r.rate, 0));
  const taxLabel = breakdown
    .map((b) => `${b.name} (${b.rate}%${b.mode === 'inclusive' ? ' incl.' : ''})`)
    .join(' + ');

  const primaryMode: TaxMode = exclusiveRules.length > 0 ? 'exclusive' : 'inclusive';
  const primaryName = breakdown.length === 1 ? breakdown[0].name : 'Taxes';

  return {
    applicable: true,
    taxName: primaryName,
    taxRate: combinedRate,
    taxMode: primaryMode,
    taxLabel,
    inputAmount: safeBase,
    netAmount,
    taxAmount,
    totalAmount,
    breakdown,
  };
}
