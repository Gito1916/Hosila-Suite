use crate::error::{ApiError, AppResult};

pub const MILLI_SCALE: i64 = 1_000;
pub const MINOR_SCALE: i64 = 100;
pub const MICRO_SCALE: i64 = 1_000_000;

/// Exact integer banker's rounding (round half to even) for `num / den` (`den > 0`).
pub fn round_div_half_even(num: i128, den: i128) -> i128 {
    assert!(den > 0, "denominator must be positive");
    let sign = if num < 0 { -1 } else { 1 };
    let abs_num = num.abs();
    let q = abs_num / den;
    let r = abs_num % den;
    let twice_r = r * 2;
    let rounded = if twice_r > den || (twice_r == den && q % 2 == 1) {
        q + 1
    } else {
        q
    };
    sign * rounded
}

/// Converts an input quantity (in milli-units) into base units (in milli-units) using `factor_milli`.
/// Example: 2.5 crates (`2_500`) * 24 bottles/crate (`24_000`) = 60 bottles (`60_000`).
pub fn to_base_qty_milli(input_qty_milli: i64, factor_milli: i64) -> AppResult<i64> {
    if factor_milli <= 0 {
        return Err(ApiError::validation("Conversion factor must be greater than zero."));
    }
    let prod = (input_qty_milli as i128)
        .checked_mul(factor_milli as i128)
        .ok_or_else(|| ApiError::validation("Quantity overflow during unit conversion."))?;
    let rounded = round_div_half_even(prod, MILLI_SCALE as i128);
    i64::try_from(rounded)
        .map_err(|_| ApiError::validation("Converted base quantity exceeds supported range."))
}

/// Computes line value in minor currency units (kobo, x100) from base quantity (x1,000) and unit cost (x1,000,000).
/// Formula: `(base_qty_milli / 1_000) * (unit_cost_micro / 1_000_000) * 100 = (base * cost) / 10_000_000`.
pub fn line_value_minor(base_qty_milli: i64, unit_cost_micro: i64) -> AppResult<i64> {
    let prod = (base_qty_milli as i128)
        .checked_mul(unit_cost_micro as i128)
        .ok_or_else(|| ApiError::validation("Line value calculation overflow."))?;
    let rounded = round_div_half_even(prod, 10_000_000);
    i64::try_from(rounded)
        .map_err(|_| ApiError::validation("Line value exceeds supported currency range."))
}

/// Derives per-base-unit cost in micro-currency (x1,000,000) from a total line amount in minor units (x100).
pub fn derive_unit_cost_micro(total_minor: i64, base_qty_milli: i64) -> AppResult<i64> {
    if base_qty_milli <= 0 {
        return Err(ApiError::validation(
            "Base quantity must be greater than zero to compute unit cost.",
        ));
    }
    let num = (total_minor as i128)
        .checked_mul(10_000_000)
        .ok_or_else(|| ApiError::validation("Unit cost calculation overflow."))?;
    let rounded = round_div_half_even(num, base_qty_milli as i128);
    i64::try_from(rounded)
        .map_err(|_| ApiError::validation("Unit cost exceeds supported range."))
}

/// Computes suggested purchase order quantity in whole purchase units (returned as milli-units),
/// always rounding UP so stock meets or exceeds par level.
/// Example: deficit = 30 bottles (`30_000`), purchase factor = 24 bottles/crate (`24_000`) -> 2 crates (`2_000`).
pub fn suggested_order_units_ceil(
    deficit_base_milli: i64,
    purchase_factor_milli: i64,
) -> AppResult<i64> {
    if purchase_factor_milli <= 0 {
        return Err(ApiError::validation(
            "Purchase conversion factor must be greater than zero.",
        ));
    }
    if deficit_base_milli <= 0 {
        return Ok(0);
    }
    let num = deficit_base_milli as i128;
    let den = purchase_factor_milli as i128;
    let whole_units = (num + den - 1) / den;
    let milli_units = whole_units
        .checked_mul(MILLI_SCALE as i128)
        .ok_or_else(|| ApiError::validation("Suggested order quantity overflow."))?;
    i64::try_from(milli_units)
        .map_err(|_| ApiError::validation("Suggested order quantity exceeds supported range."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_even_rounding_handles_ties_and_negatives() {
        assert_eq!(round_div_half_even(5, 2), 2);
        assert_eq!(round_div_half_even(7, 2), 4);
        assert_eq!(round_div_half_even(6, 2), 3);
        assert_eq!(round_div_half_even(-5, 2), -2);
        assert_eq!(round_div_half_even(-7, 2), -4);
    }

    #[test]
    fn converts_input_qty_to_base_qty() {
        // 2.5 crates * 24 bottles/crate = 60 bottles
        assert_eq!(to_base_qty_milli(2_500, 24_000).unwrap(), 60_000);
        // 0.5 pack * 1 pack = 0.5 pack
        assert_eq!(to_base_qty_milli(500, 1_000).unwrap(), 500);
        // 1 bag * 50,000 g/bag = 50,000 g
        assert_eq!(to_base_qty_milli(1_000, 50_000_000).unwrap(), 50_000_000);
        assert!(to_base_qty_milli(1_000, 0).is_err());
    }

    #[test]
    fn computes_line_value_and_tiny_per_gram_costs() {
        // 10 bottles @ NGN 958.33 (958_330_000 micro) = NGN 9,583.30 (958_330 kobo)
        assert_eq!(line_value_minor(10_000, 958_330_000).unwrap(), 958_330);
        // 150 g @ NGN 2.50/g (2_500_000 micro) = NGN 375.00 (37_500 kobo)
        assert_eq!(line_value_minor(150_000, 2_500_000).unwrap(), 37_500);
        // Very small cost: 500 g @ NGN 0.005/g (5_000 micro) = NGN 2.50 (250 kobo)
        assert_eq!(line_value_minor(500_000, 5_000).unwrap(), 250);
    }

    #[test]
    fn derives_unit_cost_from_lump_sum_amount() {
        // NGN 10,000 (1_000_000 kobo) for 8 kg (8_000 milli-kg) = NGN 1,250.00/kg
        assert_eq!(
            derive_unit_cost_micro(1_000_000, 8_000).unwrap(),
            1_250_000_000
        );
        // NGN 68,000 (6_800_000 kobo) for 25 L (25_000 milli-L) = NGN 2,720.00/L
        assert_eq!(
            derive_unit_cost_micro(6_800_000, 25_000).unwrap(),
            2_720_000_000
        );
        assert!(derive_unit_cost_micro(10_000, 0).is_err());
    }

    #[test]
    fn rounds_suggested_order_up_to_whole_purchase_units() {
        // Need 30 bottles, crate = 24 bottles -> order 2 crates (2_000 milli-crates)
        assert_eq!(suggested_order_units_ceil(30_000, 24_000).unwrap(), 2_000);
        // Exact multiple: need 24 bottles -> 1 crate
        assert_eq!(suggested_order_units_ceil(24_000, 24_000).unwrap(), 1_000);
        // No deficit -> 0
        assert_eq!(suggested_order_units_ceil(0, 24_000).unwrap(), 0);
        assert_eq!(suggested_order_units_ceil(-5_000, 24_000).unwrap(), 0);
    }
}
