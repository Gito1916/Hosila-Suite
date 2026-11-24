use crate::domain::money::round_div_half_even;
use crate::error::{ApiError, AppResult};

/// Recalculates Weighted Average Cost (micro-currency per base unit) on stock receipt.
/// If existing `on_hand_milli <= 0`, adopts `receipt_unit_cost_micro` directly.
pub fn recalculate_wac_micro(
    on_hand_milli: i64,
    current_avg_cost_micro: i64,
    received_milli: i64,
    receipt_unit_cost_micro: i64,
) -> AppResult<i64> {
    if received_milli <= 0 {
        return Err(ApiError::validation(
            "Received quantity must be greater than zero.",
        ));
    }
    if receipt_unit_cost_micro < 0 {
        return Err(ApiError::validation("Receipt unit cost cannot be negative."));
    }
    if on_hand_milli <= 0 {
        return Ok(receipt_unit_cost_micro);
    }

    let existing_val = (on_hand_milli as i128) * (current_avg_cost_micro.max(0) as i128);
    let incoming_val = (received_milli as i128) * (receipt_unit_cost_micro as i128);
    let total_qty = (on_hand_milli as i128) + (received_milli as i128);

    let new_wac = round_div_half_even(existing_val + incoming_val, total_qty);
    i64::try_from(new_wac)
        .map_err(|_| ApiError::validation("Weighted average cost exceeds supported range."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adopts_receipt_cost_when_starting_from_zero_or_negative() {
        assert_eq!(recalculate_wac_micro(0, 500_000_000, 10_000, 800_000_000).unwrap(), 800_000_000);
        assert_eq!(recalculate_wac_micro(-2_000, 500_000_000, 10_000, 800_000_000).unwrap(), 800_000_000);
    }

    #[test]
    fn blends_weighted_average_cost_accurately() {
        // 10 units @ 100 + 10 units @ 200 = 20 units @ 150
        let avg = recalculate_wac_micro(10_000, 100_000_000, 10_000, 200_000_000).unwrap();
        assert_eq!(avg, 150_000_000);

        // 30 units @ 100 + 10 units @ 200 = 40 units @ 125
        let avg2 = recalculate_wac_micro(30_000, 100_000_000, 10_000, 200_000_000).unwrap();
        assert_eq!(avg2, 125_000_000);
    }
}
