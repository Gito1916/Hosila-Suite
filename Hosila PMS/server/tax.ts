export type TaxMode = 'exclusive' | 'inclusive';
export type TaxAppliesTo = 'accommodation' | 'restaurant' | 'both';
export type TaxDomain = 'accommodation' | 'restaurant' | 'other';

export interface TaxRuleConfig {
  id?: number;
  name: string;
  rate: number;
  mode: TaxMode;
  applies_to: TaxAppliesTo;
  enabled: number;
}

export interface TaxConfig {
  tax_enabled: number;
  tax_name: string;
  tax_rate: number;
  tax_mode: TaxMode;
  tax_applies_to: TaxAppliesTo;
  tax_rules?: TaxRuleConfig[];
}

export interface TaxBreakdownItem {
  id?: number;
  name: string;
  rate: number;
  mode: TaxMode;
  amount: number;
}

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

export function roundMoneyValue(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getActiveTaxRulesForDomain(config: TaxConfig, domain: TaxDomain): TaxRuleConfig[] {
  if (!config.tax_enabled || domain === 'other') return [];

  const rules: TaxRuleConfig[] =
    Array.isArray(config.tax_rules) && config.tax_rules.length > 0
      ? config.tax_rules
      : config.tax_rate > 0
        ? [
            {
              name: config.tax_name || 'Tax',
              rate: config.tax_rate,
              mode: config.tax_mode || 'exclusive',
              applies_to: config.tax_applies_to || 'both',
              enabled: 1,
            },
          ]
        : [];

  return rules.filter(
    (r) => r.enabled === 1 && Number.isFinite(r.rate) && r.rate > 0 && (r.applies_to === 'both' || r.applies_to === domain)
  );
}

export function isTaxApplicableForDomain(config: TaxConfig, domain: TaxDomain): boolean {
  return getActiveTaxRulesForDomain(config, domain).length > 0;
}

export function domainForChargeCategory(category: string): TaxDomain {
  if (category === 'room') return 'accommodation';
  if (category === 'restaurant_pos' || category === 'restaurant_manual') return 'restaurant';
  return 'other';
}

export function calculateTransactionTax(
  baseAmount: number,
  domain: TaxDomain,
  config: TaxConfig
): TaxCalculation {
  const safeBase = Number.isFinite(baseAmount) && baseAmount > 0 ? roundMoneyValue(baseAmount) : 0;
  const activeRules = safeBase > 0 ? getActiveTaxRulesForDomain(config, domain) : [];

  if (activeRules.length === 0) {
    return {
      applicable: false,
      taxName: config.tax_name || 'Tax',
      taxRate: 0,
      taxMode: config.tax_mode || 'exclusive',
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
    totalInclusiveRate > 0 ? roundMoneyValue(safeBase / (1 + totalInclusiveRate)) : safeBase;

  const breakdown: TaxBreakdownItem[] = [];

  // Extract inclusive taxes from safeBase
  if (inclusiveRules.length > 0) {
    const incItems: TaxBreakdownItem[] = inclusiveRules.map((r) => ({
      id: r.id,
      name: r.name || 'Tax',
      rate: r.rate,
      mode: 'inclusive',
      amount: roundMoneyValue(netAmount * (r.rate / 100)),
    }));
    const incSum = roundMoneyValue(incItems.reduce((s, item) => s + item.amount, 0));
    const expectedIncSum = roundMoneyValue(safeBase - netAmount);
    const drift = roundMoneyValue(expectedIncSum - incSum);
    if (drift !== 0 && incItems.length > 0) {
      incItems[incItems.length - 1].amount = roundMoneyValue(incItems[incItems.length - 1].amount + drift);
    }
    breakdown.push(...incItems);
  }

  // Add exclusive taxes on top of netAmount
  for (const r of exclusiveRules) {
    breakdown.push({
      id: r.id,
      name: r.name || 'Tax',
      rate: r.rate,
      mode: 'exclusive',
      amount: roundMoneyValue(netAmount * (r.rate / 100)),
    });
  }

  const taxAmount = roundMoneyValue(breakdown.reduce((s, item) => s + item.amount, 0));
  const totalAmount =
    exclusiveRules.length === 0 && inclusiveRules.length > 0
      ? safeBase
      : roundMoneyValue(netAmount + taxAmount);

  const combinedRate = roundMoneyValue(activeRules.reduce((s, r) => s + r.rate, 0));
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
