use crate::domain::money::{round_div_half_even, MILLI_SCALE};
use crate::error::{ApiError, ErrorCode, AppResult};
use crate::types::{ItemUnitDto, StockStatus, UnitDto};

/// Resolves the conversion factor (in milli-units) from `target_unit` to `base_unit`:
/// `base_qty_milli = input_qty_milli * factor_milli / 1000`.
pub fn resolve_factor_milli(
    base_unit: &UnitDto,
    target_unit: &UnitDto,
    item_units: &[ItemUnitDto],
) -> AppResult<i64> {
    if target_unit.id == base_unit.id {
        return Ok(MILLI_SCALE);
    }

    if let Some(iu) = item_units.iter().find(|u| u.unit_id == target_unit.id) {
        if iu.factor_milli <= 0 {
            return Err(ApiError::validation(format!(
                "Conversion factor for unit '{}' must be greater than zero.",
                target_unit.code
            )));
        }
        return Ok(iu.factor_milli);
    }

    // Standard physical same-dimension conversion (mass, volume, length, or scaled count like DOZEN -> PCS)
    let allow_global_dim = target_unit.dimension == base_unit.dimension
        && (base_unit.dimension != "count"
            || target_unit.factor_to_dim_base_milli != base_unit.factor_to_dim_base_milli);

    if allow_global_dim && base_unit.factor_to_dim_base_milli > 0 && target_unit.factor_to_dim_base_milli > 0 {
        let num = (target_unit.factor_to_dim_base_milli as i128) * (MILLI_SCALE as i128);
        let den = base_unit.factor_to_dim_base_milli as i128;
        let factor = round_div_half_even(num, den);
        let factor_i64 = i64::try_from(factor)
            .map_err(|_| ApiError::validation("Unit conversion factor exceeds supported range."))?;
        if factor_i64 > 0 {
            return Ok(factor_i64);
        }
    }

    Err(ApiError::new(
        ErrorCode::UnitConversionNeeded,
        format!(
            "No conversion configured from '{}' to base unit '{}' for this item.",
            target_unit.code, base_unit.code
        ),
    ))
}

/// Formats a milli-scaled integer neatly without trailing zeros (`12_000` -> `"12"`, `14_200` -> `"14.2"`).
pub fn format_qty_milli(qty_milli: i64) -> String {
    let sign = if qty_milli < 0 { "-" } else { "" };
    let abs = qty_milli.unsigned_abs();
    let whole = abs / 1_000;
    let frac = abs % 1_000;
    if frac == 0 {
        format!("{sign}{whole}")
    } else {
        let frac_str = format!("{frac:03}");
        let trimmed = frac_str.trim_end_matches('0');
        format!("{sign}{whole}.{trimmed}")
    }
}

fn unit_label(qty_milli: i64, singular: &str, plural: &str) -> String {
    if qty_milli.abs() == MILLI_SCALE {
        singular.to_string()
    } else {
        plural.to_string()
    }
}

/// Formats on-hand stock cleanly in `display_unit`, using mixed units for integer count packages
/// (e.g. `76 btl` -> `"3 Crates + 4 Bottles"`) and decimal display for mass/volume (`12,500 g` -> `"12.5 Kilograms"`).
pub fn format_stock_display(
    on_hand_milli: i64,
    base_unit: &UnitDto,
    display_unit: &UnitDto,
    item_units: &[ItemUnitDto],
) -> String {
    if display_unit.id == base_unit.id {
        let qty = format_qty_milli(on_hand_milli);
        let lbl = unit_label(on_hand_milli, &base_unit.name, &base_unit.plural);
        return format!("{qty} {lbl}");
    }

    let Ok(factor_milli) = resolve_factor_milli(base_unit, display_unit, item_units) else {
        let qty = format_qty_milli(on_hand_milli);
        let lbl = unit_label(on_hand_milli, &base_unit.name, &base_unit.plural);
        return format!("{qty} {lbl}");
    };

    if factor_milli <= MILLI_SCALE {
        let qty = format_qty_milli(on_hand_milli);
        let lbl = unit_label(on_hand_milli, &base_unit.name, &base_unit.plural);
        return format!("{qty} {lbl}");
    }

    if base_unit.dimension == "count" && !base_unit.allows_decimals && on_hand_milli >= 0 {
        let whole_pkgs = on_hand_milli / factor_milli;
        let rem_base = on_hand_milli % factor_milli;
        if whole_pkgs == 0 {
            let qty = format_qty_milli(rem_base);
            let lbl = unit_label(rem_base, &base_unit.name, &base_unit.plural);
            return format!("{qty} {lbl}");
        }
        let pkg_lbl = if whole_pkgs == 1 {
            &display_unit.name
        } else {
            &display_unit.plural
        };
        if rem_base == 0 {
            return format!("{whole_pkgs} {pkg_lbl}");
        }
        let rem_qty = format_qty_milli(rem_base);
        let rem_lbl = unit_label(rem_base, &base_unit.name, &base_unit.plural);
        return format!("{whole_pkgs} {pkg_lbl} + {rem_qty} {rem_lbl}");
    }

    // Continuous display (e.g. grams -> kilograms)
    let display_milli = round_div_half_even(
        (on_hand_milli as i128) * (MILLI_SCALE as i128),
        factor_milli as i128,
    ) as i64;
    let qty = format_qty_milli(display_milli);
    let lbl = unit_label(display_milli, &display_unit.name, &display_unit.plural);
    format!("{qty} {lbl}")
}

pub fn classify_stock_status(on_hand_milli: i64, reorder_point_milli: i64) -> StockStatus {
    if on_hand_milli <= 0 {
        StockStatus::OutOfStock
    } else if reorder_point_milli > 0 && on_hand_milli <= reorder_point_milli {
        StockStatus::LowStock
    } else {
        StockStatus::Healthy
    }
}

pub fn is_unusual_conversion_factor(dimension: &str, factor_milli: i64) -> bool {
    dimension == "count" && factor_milli > 1_000_000
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(id: &str, code: &str, name: &str, plural: &str, dim: &str, dec: bool, f: i64) -> UnitDto {
        UnitDto {
            id: id.into(),
            code: code.into(),
            name: name.into(),
            plural: plural.into(),
            dimension: dim.into(),
            allows_decimals: dec,
            factor_to_dim_base_milli: f,
            is_system: true,
        }
    }

    #[test]
    fn resolves_item_specific_and_global_factors() {
        let btl = unit("u_btl", "BTL", "Bottle", "Bottles", "count", false, 1_000);
        let crate_u = unit("u_crt", "CRATE", "Crate", "Crates", "count", false, 1_000);
        let dozen = unit("u_doz", "DOZEN", "Dozen", "Dozens", "count", false, 12_000);
        let g = unit("u_g", "G", "Gram", "Grams", "mass", true, 1_000);
        let kg = unit("u_kg", "KG", "Kilogram", "Kilograms", "mass", true, 1_000_000);

        let iu = ItemUnitDto {
            id: "iu1".into(),
            unit_id: "u_crt".into(),
            unit_code: "CRATE".into(),
            unit_name: "Crate".into(),
            unit_plural: "Crates".into(),
            factor_milli: 24_000,
            can_purchase: true,
            can_issue: true,
            label_override: None,
            is_unusual_factor: false,
        };

        assert_eq!(resolve_factor_milli(&btl, &btl, &[]).unwrap(), 1_000);
        assert_eq!(resolve_factor_milli(&btl, &crate_u, &[iu.clone()]).unwrap(), 24_000);
        assert_eq!(resolve_factor_milli(&btl, &dozen, &[]).unwrap(), 12_000);
        assert_eq!(resolve_factor_milli(&g, &kg, &[]).unwrap(), 1_000_000);
        assert!(resolve_factor_milli(&btl, &crate_u, &[]).is_err());
        assert!(resolve_factor_milli(&btl, &kg, &[]).is_err());
    }

    #[test]
    fn formats_mixed_and_decimal_stock_displays() {
        let btl = unit("u_btl", "BTL", "Bottle", "Bottles", "count", false, 1_000);
        let crate_u = unit("u_crt", "CRATE", "Crate", "Crates", "count", false, 1_000);
        let iu = ItemUnitDto {
            id: "iu1".into(),
            unit_id: "u_crt".into(),
            unit_code: "CRATE".into(),
            unit_name: "Crate".into(),
            unit_plural: "Crates".into(),
            factor_milli: 24_000,
            can_purchase: true,
            can_issue: true,
            label_override: None,
            is_unusual_factor: false,
        };

        assert_eq!(
            format_stock_display(76_000, &btl, &crate_u, &[iu.clone()]),
            "3 Crates + 4 Bottles"
        );
        assert_eq!(
            format_stock_display(24_000, &btl, &crate_u, &[iu.clone()]),
            "1 Crate"
        );
        assert_eq!(
            format_stock_display(1_000, &btl, &crate_u, &[iu]),
            "1 Bottle"
        );

        let g = unit("u_g", "G", "Gram", "Grams", "mass", true, 1_000);
        let kg = unit("u_kg", "KG", "Kilogram", "Kilograms", "mass", true, 1_000_000);
        assert_eq!(format_stock_display(12_500_000, &g, &kg, &[]), "12.5 Kilograms");
    }

    #[test]
    fn classifies_stock_status_correctly() {
        assert_eq!(classify_stock_status(0, 5_000), StockStatus::OutOfStock);
        assert_eq!(classify_stock_status(-1_000, 5_000), StockStatus::OutOfStock);
        assert_eq!(classify_stock_status(5_000, 5_000), StockStatus::LowStock);
        assert_eq!(classify_stock_status(6_000, 5_000), StockStatus::Healthy);
        assert_eq!(classify_stock_status(2_000, 0), StockStatus::Healthy);
    }
}
