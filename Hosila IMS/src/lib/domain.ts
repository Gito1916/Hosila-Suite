import type {
  DepartmentDto,
  ItemListRowDto_Serialize,
  StaffDto_Serialize,
  UnitDto,
} from '../../bindings/bindings';

export function filterIssueDepartments(departments: DepartmentDto[]): DepartmentDto[] {
  return departments.filter((d) => d.is_active && d.name.toLowerCase() !== 'store');
}

export function filterActiveStoreStaff(staff: StaffDto_Serialize[]): StaffDto_Serialize[] {
  return staff.filter((s) => s.is_active && s.is_store_staff);
}

export function resolveItemUnitFactor(
  item: ItemListRowDto_Serialize,
  unitId: string,
  allUnits: UnitDto[]
): number {
  if (unitId === item.base_unit_id) return 1000;

  const extra = item.item_units.find((u) => u.unit_id === unitId);
  if (extra && extra.factor_milli > 0) return extra.factor_milli;

  const targetUnit = allUnits.find((u) => u.id === unitId);
  const baseUnit = allUnits.find((u) => u.id === item.base_unit_id);
  if (
    targetUnit &&
    baseUnit &&
    targetUnit.dimension === baseUnit.dimension &&
    targetUnit.factor_to_dim_base_milli > 0 &&
    baseUnit.factor_to_dim_base_milli > 0
  ) {
    return Math.round(
      (targetUnit.factor_to_dim_base_milli / baseUnit.factor_to_dim_base_milli) * 1000
    );
  }

  return 1000;
}

export function getCompatibleUnits(item: ItemListRowDto_Serialize, allUnits: UnitDto[]): UnitDto[] {
  const baseUnit = allUnits.find((u) => u.id === item.base_unit_id);
  const seen = new Set<string>();
  const result: UnitDto[] = [];

  const addUnit = (id: string) => {
    if (seen.has(id)) return;
    const found = allUnits.find((u) => u.id === id);
    if (found) {
      seen.add(id);
      result.push(found);
    }
  };

  addUnit(item.base_unit_id);
  for (const extra of item.item_units) {
    addUnit(extra.unit_id);
  }
  if (baseUnit && baseUnit.dimension !== 'count') {
    for (const u of allUnits) {
      if (u.dimension === baseUnit.dimension) {
        addUnit(u.id);
      }
    }
  }
  return result;
}

export function getItemUnitSummary(item: ItemListRowDto_Serialize, units: UnitDto[]): string {
  const parts: string[] = [item.base_unit_code];
  for (const iu of item.item_units) {
    const unit = units.find((u) => u.id === iu.unit_id);
    if (!unit) continue;
    const factor = iu.factor_milli / 1000;
    const label = iu.label_override || unit.code;
    parts.push(`${label} (${factor} ${item.base_unit_code})`);
  }
  return parts.join(' · ');
}
