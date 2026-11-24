use std::collections::{HashMap, HashSet};
use std::path::Path;

use calamine::{open_workbook, Data, Range, Reader, Xlsx};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};
use strsim::jaro_winkler;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::money::{derive_unit_cost_micro, round_div_half_even, MILLI_SCALE};
use crate::domain::uom::{format_qty_milli, resolve_factor_milli};
use crate::error::{ApiError, AppResult};
use crate::parser::{
    cell_to_f64, cell_to_trimmed_string, f64_to_scaled_i64, normalize_name_key, normalize_unit_code,
};
use crate::services::activity::record_activity;
use crate::services::auth::require_operator;
use crate::services::items::{load_item_units, load_unit_map, next_auto_sku, refresh_item_fts};
use crate::services::receipts::{get_receipt, post_receipt_tx};
use crate::types::{
    ConfirmParsedRestockInput, ExtraChargeDto, ItemUnitDto, ParsedAnomalyCode,
    ParsedMatchCandidate, ParsedProcurementDraft, ParsedProcurementLineDto, ReceiptDto,
    ReceiptLineInput, SessionUser, UnitDto, WorkbookSheetSummary,
};

#[derive(Clone)]
struct ItemRef {
    id: String,
    name: String,
    norm_name: String,
    base_unit_id: String,
    avg_cost_micro: i64,
    last_cost_micro: i64,
    cost_missing: bool,
}

#[derive(Clone)]
struct MetaRowRef {
    list_id: String,
    line_id: String,
    item_id: String,
    unit_id: String,
    factor_milli: i64,
    sheet_name: String,
    excel_row: usize, // 1-based
}

fn parse_qty_and_hint(cell: &Data) -> (Option<f64>, Option<String>) {
    match cell {
        Data::Float(f) => (Some(*f), None),
        Data::Int(i) => (Some(*i as f64), None),
        Data::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() || trimmed == "-" {
                return (None, None);
            }
            let cleaned = trimmed.replace(',', "");
            if let Ok(v) = cleaned.parse::<f64>() {
                return (Some(v), None);
            }
            let mut split_idx = 0usize;
            for (idx, ch) in cleaned.char_indices() {
                if ch.is_ascii_digit() || ch == '.' {
                    split_idx = idx + ch.len_utf8();
                } else {
                    break;
                }
            }
            if split_idx > 0 {
                if let Ok(num) = cleaned[..split_idx].parse::<f64>() {
                    let rest = cleaned[split_idx..].trim();
                    let hint = if rest.is_empty() {
                        None
                    } else {
                        Some(rest.to_string())
                    };
                    return (Some(num), hint);
                }
            }
            (None, None)
        }
        _ => (None, None),
    }
}

fn is_known_section_banner(norm: &str) -> bool {
    matches!(
        norm,
        "KITCHEN"
            | "PROTEIN"
            | "F & B"
            | "F&B"
            | "FOOD & BEVERAGE"
            | "HOUSEKEEPING"
            | "HOUSE KEEPING"
            | "MAINTENANCE"
            | "STORE"
            | "BAR"
    )
}

fn is_summary_skip_section(norm: &str) -> bool {
    is_known_section_banner(norm)
        || matches!(
            norm,
            "GRAND TOTAL"
                | "TOTAL"
                | "T"
                | "ACTUAL EXP."
                | "ACTUAL EXP"
                | "ACTUAL EXPENDITURE"
                | "REFUNDED TO CASH CONTROLLER"
                | "REFUND"
                | "BALANCE"
        )
}

fn detect_buyer_from_text(sheet_name: &str, title: Option<&str>) -> Option<String> {
    let check = |src: &str| -> Option<String> {
        let up = src.trim().to_ascii_uppercase();
        if let Some(pos) = up.find("'S LIST") {
            let prefix = up[..pos].split_whitespace().last()?;
            if !prefix.is_empty() {
                return Some(prefix.to_string());
            }
        }
        None
    };

    check(sheet_name).or_else(|| title.and_then(check))
}

fn read_hosila_meta(workbook: &mut Xlsx<std::io::BufReader<std::fs::File>>) -> Vec<MetaRowRef> {
    let Ok(range) = workbook.worksheet_range("_hosila_meta") else {
        return Vec::new();
    };
    let mut rows = Vec::new();
    for (idx, r) in range.rows().enumerate() {
        if idx == 0 || r.len() < 7 {
            continue;
        }
        let list_id = cell_to_trimmed_string(&r[0]);
        let line_id = cell_to_trimmed_string(&r[1]);
        let item_id = cell_to_trimmed_string(&r[2]);
        let unit_id = cell_to_trimmed_string(&r[3]);
        let factor_milli = cell_to_f64(&r[4]).map(|v| v.round() as i64).unwrap_or(MILLI_SCALE);
        let sheet_name = cell_to_trimmed_string(&r[5]);
        let excel_row = cell_to_f64(&r[6]).map(|v| v.round() as usize).unwrap_or(0);
        if !item_id.is_empty() && !sheet_name.is_empty() && excel_row > 0 {
            rows.push(MetaRowRef {
                list_id,
                line_id,
                item_id,
                unit_id,
                factor_milli: factor_milli.max(1),
                sheet_name,
                excel_row,
            });
        }
    }
    rows
}

/// Lists all visible worksheets in an uploaded Excel procurement workbook along with
/// row counts and whether Hosila round-trip metadata (`_hosila_meta`) is embedded.
pub fn inspect_procurement_workbook(file_path: &str) -> AppResult<Vec<WorkbookSheetSummary>> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(ApiError::not_found(format!(
            "Procurement Excel file not found: {file_path}"
        )));
    }
    let mut workbook: Xlsx<_> = open_workbook(path)
        .map_err(|e| ApiError::import_error(format!("Failed to open Excel file: {e}")))?;

    let meta_rows = read_hosila_meta(&mut workbook);
    let meta_sheets: HashSet<String> = meta_rows
        .iter()
        .map(|m| m.sheet_name.to_ascii_lowercase())
        .collect();

    let sheet_names = workbook.sheet_names().to_vec();
    let mut out = Vec::new();
    for name in sheet_names {
        if name == "_hosila_meta" {
            continue;
        }
        let range = workbook
            .worksheet_range(&name)
            .map_err(|e| ApiError::import_error(format!("Failed reading sheet '{name}': {e}")))?;
        let mut title: Option<String> = None;
        for r in range.rows().take(3) {
            for c in r.iter().take(6) {
                let s = cell_to_trimmed_string(c);
                if !s.is_empty() && !s.eq_ignore_ascii_case("S/N") {
                    title = Some(s);
                    break;
                }
            }
            if title.is_some() {
                break;
            }
        }
        let has_hosila_meta = !meta_rows.is_empty()
            && (meta_sheets.contains(&name.to_ascii_lowercase()) || meta_sheets.is_empty());
        let detected_buyer = detect_buyer_from_text(&name, title.as_deref());
        out.push(WorkbookSheetSummary {
            name,
            row_count: range.height() as i32,
            has_hosila_meta,
            detected_buyer,
            detected_title: title,
        });
    }

    if out.is_empty() {
        return Err(ApiError::import_error("Workbook has no readable worksheets."));
    }
    Ok(out)
}

struct ColIndices {
    sn: usize,
    desc: usize,
    vol: usize,
    qty: usize,
    price: usize,
    amt: usize,
    header_row_idx: Option<usize>,
}

fn detect_columns(range: &Range<Data>) -> ColIndices {
    for (r_idx, r) in range.rows().enumerate().take(12) {
        let mut sn = None;
        let mut desc = None;
        let mut vol = None;
        let mut qty = None;
        let mut price = None;
        let mut amt = None;
        for (c_idx, cell) in r.iter().enumerate() {
            let txt = normalize_name_key(&cell_to_trimmed_string(cell));
            if txt == "S/N" || txt == "SN" || txt == "NO." {
                sn = Some(c_idx);
            } else if txt.contains("DESCRIPTION") || txt == "ITEM" || txt == "ITEMS" {
                desc = Some(c_idx);
            } else if txt.contains("VOLUME") || txt == "UOM" || txt == "UNIT" {
                vol = Some(c_idx);
            } else if txt.contains("QUANTITY") || txt == "QTY" {
                qty = Some(c_idx);
            } else if txt.contains("UNIT PRICE") || txt == "RATE" || txt == "PRICE" {
                price = Some(c_idx);
            } else if txt == "AMOUNT" || txt == "TOTAL AMOUNT" {
                amt = Some(c_idx);
            }
        }
        if desc.is_some() && (qty.is_some() || amt.is_some()) {
            return ColIndices {
                sn: sn.unwrap_or(0),
                desc: desc.unwrap_or(1),
                vol: vol.unwrap_or(2),
                qty: qty.unwrap_or(3),
                price: price.unwrap_or(4),
                amt: amt.unwrap_or(5),
                header_row_idx: Some(r_idx),
            };
        }
    }
    ColIndices {
        sn: 0,
        desc: 1,
        vol: 2,
        qty: 3,
        price: 4,
        amt: 5,
        header_row_idx: None,
    }
}

fn lookup_unit<'a>(raw_unit: &str, units_by_code: &'a HashMap<String, UnitDto>) -> Option<&'a UnitDto> {
    let trimmed = raw_unit.trim();
    if trimmed.is_empty() {
        return None;
    }
    let direct = trimmed.to_ascii_uppercase();
    if let Some(u) = units_by_code.get(&direct) {
        return Some(u);
    }
    let normalized = normalize_unit_code(trimmed);
    // Avoid blind "PCS" fallback if raw text isn't a piece/unit synonym
    if normalized == "PCS"
        && !matches!(
            direct.as_str(),
            "PCS" | "PC" | "PIECE" | "PIECES" | "UNIT" | "UNITS"
        )
    {
        return units_by_code
            .values()
            .find(|u| u.name.eq_ignore_ascii_case(trimmed) || u.plural.eq_ignore_ascii_case(trimmed));
    }
    units_by_code.get(normalized)
}

fn append_financial_anomalies(
    raw_qty_milli: Option<i64>,
    raw_unit_price_minor: Option<i64>,
    raw_amount_minor: Option<i64>,
    anomalies: &mut Vec<ParsedAnomalyCode>,
    messages: &mut Vec<String>,
) {
    if raw_qty_milli.unwrap_or(0) <= 0 && raw_amount_minor.unwrap_or(0) > 0 {
        if !anomalies.contains(&ParsedAnomalyCode::AmountOnly) {
            anomalies.push(ParsedAnomalyCode::AmountOnly);
            messages.push(
                "Amount was recorded without a countable quantity — please confirm purchased quantity and unit."
                    .to_string(),
            );
        }
    }

    if let (Some(q), Some(up), Some(amt)) = (raw_qty_milli, raw_unit_price_minor, raw_amount_minor) {
        if q > 0 && up > 0 && amt > 0 {
            let expected = round_div_half_even((q as i128) * (up as i128), MILLI_SCALE as i128) as i64;
            if (expected - amt).abs() > 100 {
                if !anomalies.contains(&ParsedAnomalyCode::AmountMismatch) {
                    anomalies.push(ParsedAnomalyCode::AmountMismatch);
                    messages.push(format!(
                        "Qty ({}) × Unit Price ({:.2}) = {:.2} does not equal Amount ({:.2}). Confirm the true total.",
                        format_qty_milli(q),
                        up as f64 / 100.0,
                        expected as f64 / 100.0,
                        amt as f64 / 100.0
                    ));
                }
            }
        }
    }
}

fn check_price_jump(
    item: &ItemRef,
    resolved_factor_milli: Option<i64>,
    raw_qty_milli: Option<i64>,
    raw_unit_price_minor: Option<i64>,
    raw_amount_minor: Option<i64>,
    anomalies: &mut Vec<ParsedAnomalyCode>,
    messages: &mut Vec<String>,
) {
    if item.cost_missing {
        return;
    }
    let baseline_micro = if item.last_cost_micro > 0 {
        item.last_cost_micro
    } else {
        item.avg_cost_micro
    };
    if baseline_micro <= 0 {
        return;
    }
    let Some(factor_milli) = resolved_factor_milli.filter(|&f| f > 0) else {
        return;
    };
    let Some(qty_milli) = raw_qty_milli.filter(|&q| q > 0) else {
        return;
    };

    let effective_total_minor = match raw_amount_minor.filter(|&a| a > 0) {
        Some(a) => a,
        None => match raw_unit_price_minor.filter(|&p| p > 0) {
            Some(p) => round_div_half_even((qty_milli as i128) * (p as i128), MILLI_SCALE as i128) as i64,
            None => return,
        },
    };

    let base_qty_milli = round_div_half_even((qty_milli as i128) * (factor_milli as i128), MILLI_SCALE as i128) as i64;
    if base_qty_milli <= 0 {
        return;
    }
    let Ok(new_cost_micro) = derive_unit_cost_micro(effective_total_minor, base_qty_milli) else {
        return;
    };
    if new_cost_micro <= 0 {
        return;
    }
    let ratio = new_cost_micro as f64 / baseline_micro as f64;
    if !(0.6..=1.4).contains(&ratio) {
        if !anomalies.contains(&ParsedAnomalyCode::PriceJump) {
            anomalies.push(ParsedAnomalyCode::PriceJump);
            let pct = ((ratio - 1.0) * 100.0).round() as i64;
            messages.push(format!(
                "Unit cost changed by {pct:+}% compared to previous recorded cost."
            ));
        }
    }
}

fn parse_summary_extras(
    range: &Range<Data>,
    desc_col: usize,
    amt_col: usize,
    seen_extra_labels: &mut HashSet<String>,
    extra_charges: &mut Vec<ExtraChargeDto>,
    disbursement_minor: &mut Option<i64>,
) {
    let mut in_summary = false;
    for r in range.rows() {
        let desc = r.get(desc_col).map(cell_to_trimmed_string).unwrap_or_default();
        let norm = normalize_name_key(&desc);
        if norm == "SUMMARY" {
            in_summary = true;
            continue;
        }
        let amt = r.get(amt_col).and_then(cell_to_f64);
        if norm == "DISBURMENT" || norm == "DISBURSEMENT" {
            if let Some(v) = amt {
                if v > 0.0 && disbursement_minor.is_none() {
                    *disbursement_minor = Some(f64_to_scaled_i64(v, 100.0));
                }
            }
            continue;
        }
        if !in_summary || desc.is_empty() || is_summary_skip_section(&norm) {
            continue;
        }
        if let Some(v) = amt {
            if v > 0.0 && seen_extra_labels.insert(norm) {
                extra_charges.push(ExtraChargeDto {
                    label: desc.trim().to_string(),
                    amount_minor: f64_to_scaled_i64(v, 100.0),
                });
            }
        }
    }
}

/// Parses an uploaded Excel procurement list into a confirmation draft without mutating inventory.
///
/// Tier 1 uses embedded `_hosila_meta` rows when present for lossless round-trip mapping;
/// Tier 2 heuristically parses third-party sheets (such as De Palms' multi-sheet buyer workbooks),
/// matches items via exact names, saved `item_aliases`, and Jaro-Winkler similarity, and flags
/// arithmetic, quantity-less, missing-unit-conversion, unmatched-item, and price-jump anomalies.
pub fn parse_procurement_workbook(
    db: &Database,
    file_path: &str,
    selected_sheets: Vec<String>,
) -> AppResult<ParsedProcurementDraft> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(ApiError::not_found(format!(
            "Procurement Excel file not found: {file_path}"
        )));
    }
    let filename = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string());

    let mut workbook: Xlsx<_> = open_workbook(path)
        .map_err(|e| ApiError::import_error(format!("Failed to open Excel workbook: {e}")))?;

    let meta_rows = read_hosila_meta(&mut workbook);
    let visible_sheets: Vec<String> = workbook
        .sheet_names()
        .iter()
        .filter(|s| s.as_str() != "_hosila_meta")
        .cloned()
        .collect();
    if visible_sheets.is_empty() {
        return Err(ApiError::import_error("Workbook has no readable worksheets."));
    }

    let sheets_to_parse: Vec<String> = if !selected_sheets.is_empty() {
        let wanted: HashSet<String> = selected_sheets
            .iter()
            .map(|s| s.trim().to_ascii_lowercase())
            .collect();
        let chosen: Vec<String> = visible_sheets
            .iter()
            .filter(|s| wanted.contains(&s.to_ascii_lowercase()))
            .cloned()
            .collect();
        if chosen.is_empty() {
            return Err(ApiError::validation("Selected worksheet(s) were not found in workbook."));
        }
        chosen
    } else if let Some(master) = visible_sheets
        .iter()
        .find(|s| s.eq_ignore_ascii_case("Procurement List"))
    {
        vec![master.clone()]
    } else if visible_sheets.len() > 1
        && visible_sheets[0].eq_ignore_ascii_case("Sheet1")
        && visible_sheets[1..]
            .iter()
            .any(|s| s.to_ascii_uppercase().contains("LIST"))
    {
        vec![visible_sheets[0].clone()]
    } else {
        visible_sheets.clone()
    };

    // Load DB reference catalog
    let (units_by_id, units_by_code, items, aliases_by_norm, item_units_map) = db.with_read(|conn| {
        let units_by_id = load_unit_map(conn)?;
        let units_by_code: HashMap<String, UnitDto> = units_by_id
            .values()
            .map(|u| (u.code.to_ascii_uppercase(), u.clone()))
            .collect();

        let mut stmt = conn.prepare(
            "SELECT id, name, base_unit_id, avg_cost_micro, last_cost_micro, cost_missing
             FROM items WHERE is_active = 1",
        )?;
        let items: Vec<ItemRef> = stmt
            .query_map([], |r| {
                let name: String = r.get(1)?;
                Ok(ItemRef {
                    id: r.get(0)?,
                    norm_name: normalize_name_key(&name),
                    name,
                    base_unit_id: r.get(2)?,
                    avg_cost_micro: r.get(3)?,
                    last_cost_micro: r.get(4)?,
                    cost_missing: r.get::<_, i64>(5)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut a_stmt = conn.prepare("SELECT alias_normalized, item_id FROM item_aliases")?;
        let aliases_by_norm: HashMap<String, String> = a_stmt
            .query_map([], |r| {
                let raw_a: String = r.get(0)?;
                Ok((normalize_name_key(&raw_a), r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .collect();

        let mut item_units_map: HashMap<String, Vec<ItemUnitDto>> = HashMap::new();
        for item in &items {
            item_units_map.insert(item.id.clone(), load_item_units(conn, &item.id)?);
        }

        Ok((units_by_id, units_by_code, items, aliases_by_norm, item_units_map))
    })?;

    let items_by_id: HashMap<String, &ItemRef> =
        items.iter().map(|i| (i.id.clone(), i)).collect();
    let items_by_norm: HashMap<String, &ItemRef> =
        items.iter().map(|i| (i.norm_name.clone(), i)).collect();

    let tier1_active = !meta_rows.is_empty()
        && sheets_to_parse.iter().all(|s| {
            meta_rows
                .iter()
                .any(|m| m.sheet_name.eq_ignore_ascii_case(s))
        });

    let mut lines: Vec<ParsedProcurementLineDto> = Vec::new();
    let mut extra_charges: Vec<ExtraChargeDto> = Vec::new();
    let mut seen_extra_labels: HashSet<String> = HashSet::new();
    let mut disbursement_minor: Option<i64> = None;
    let mut linked_procurement_list_id: Option<String> = None;

    if tier1_active {
        for sheet_name in &sheets_to_parse {
            let range = workbook.worksheet_range(sheet_name).map_err(|e| {
                ApiError::import_error(format!("Failed reading worksheet '{sheet_name}': {e}"))
            })?;
            let cols = detect_columns(&range);
            parse_summary_extras(
                &range,
                cols.desc,
                cols.amt,
                &mut seen_extra_labels,
                &mut extra_charges,
                &mut disbursement_minor,
            );

            let mut current_section = "KITCHEN".to_string();
            for meta in meta_rows
                .iter()
                .filter(|m| m.sheet_name.eq_ignore_ascii_case(sheet_name))
            {
                if linked_procurement_list_id.is_none() && !meta.list_id.is_empty() {
                    linked_procurement_list_id = Some(meta.list_id.clone());
                }
                let r_idx = meta.excel_row.saturating_sub(1);
                let Some(row) = range.rows().nth(r_idx) else {
                    continue;
                };
                // Track section headers above if possible
                for back in (0..r_idx).rev().take(60) {
                    if let Some(prev) = range.rows().nth(back) {
                        let d = prev.get(cols.desc).map(cell_to_trimmed_string).unwrap_or_default();
                        let dk = normalize_name_key(&d);
                        if is_known_section_banner(&dk) {
                            current_section = dk;
                            break;
                        }
                    }
                }

                let raw_description = row
                    .get(cols.desc)
                    .map(cell_to_trimmed_string)
                    .filter(|s| !s.is_empty())
                    .or_else(|| items_by_id.get(&meta.item_id).map(|i| i.name.clone()))
                    .unwrap_or_else(|| "Unknown Item".to_string());
                let raw_unit = row
                    .get(cols.vol)
                    .map(cell_to_trimmed_string)
                    .filter(|s| !s.is_empty());

                let (qty_val, _) = row
                    .get(cols.qty)
                    .map(parse_qty_and_hint)
                    .unwrap_or((None, None));
                let unit_price_val = row.get(cols.price).and_then(cell_to_f64);
                let amt_val = row.get(cols.amt).and_then(cell_to_f64);

                let raw_qty_milli = qty_val.map(|v| f64_to_scaled_i64(v, 1000.0));
                let raw_unit_price_minor = unit_price_val.map(|v| f64_to_scaled_i64(v, 100.0));
                let raw_amount_minor = amt_val.map(|v| f64_to_scaled_i64(v, 100.0));

                if raw_qty_milli.unwrap_or(0) <= 0
                    && raw_amount_minor.unwrap_or(0) <= 0
                    && raw_unit_price_minor.unwrap_or(0) <= 0
                {
                    continue;
                }

                let mut anomalies = Vec::new();
                let mut anomaly_messages = Vec::new();
                append_financial_anomalies(
                    raw_qty_milli,
                    raw_unit_price_minor,
                    raw_amount_minor,
                    &mut anomalies,
                    &mut anomaly_messages,
                );

                let item_ref = items_by_id.get(&meta.item_id).copied();
                let resolved_unit = units_by_id.get(&meta.unit_id);
                let suggested_unit_cost_minor = raw_unit_price_minor.or_else(|| {
                    if let (Some(q), Some(a)) = (raw_qty_milli.filter(|&q| q > 0), raw_amount_minor) {
                        Some(round_div_half_even((a as i128) * (MILLI_SCALE as i128), q as i128) as i64)
                    } else {
                        None
                    }
                });

                if let Some(it) = item_ref {
                    check_price_jump(
                        it,
                        Some(meta.factor_milli),
                        raw_qty_milli,
                        raw_unit_price_minor,
                        raw_amount_minor,
                        &mut anomalies,
                        &mut anomaly_messages,
                    );
                } else {
                    anomalies.push(ParsedAnomalyCode::UnmatchedItem);
                    anomaly_messages.push("Referenced item could not be found in catalog.".to_string());
                }

                let base_unit = item_ref.and_then(|i| units_by_id.get(&i.base_unit_id));
                lines.push(ParsedProcurementLineDto {
                    row_key: format!("{sheet_name}:{}", meta.excel_row),
                    sheet_name: sheet_name.clone(),
                    excel_row: meta.excel_row as i32,
                    section_label: current_section.clone(),
                    raw_description,
                    raw_unit,
                    raw_qty_milli,
                    raw_unit_price_minor,
                    raw_amount_minor,
                    match_status: if item_ref.is_some() {
                        "exact".to_string()
                    } else {
                        "unmatched".to_string()
                    },
                    matched_item_id: item_ref.map(|i| i.id.clone()),
                    matched_item_name: item_ref.map(|i| i.name.clone()),
                    matched_base_unit_id: item_ref.map(|i| i.base_unit_id.clone()),
                    matched_base_unit_code: base_unit.map(|u| u.code.clone()),
                    resolved_unit_id: Some(meta.unit_id.clone()),
                    resolved_unit_code: resolved_unit.map(|u| u.code.clone()),
                    resolved_factor_milli: Some(meta.factor_milli),
                    suggested_unit_cost_minor,
                    procurement_line_id: if meta.line_id.is_empty() {
                        None
                    } else {
                        Some(meta.line_id.clone())
                    },
                    anomalies,
                    anomaly_messages,
                    candidates: Vec::new(),
                });
            }
        }
    } else {
        for sheet_name in &sheets_to_parse {
            let range = workbook.worksheet_range(sheet_name).map_err(|e| {
                ApiError::import_error(format!("Failed reading worksheet '{sheet_name}': {e}"))
            })?;
            let cols = detect_columns(&range);
            parse_summary_extras(
                &range,
                cols.desc,
                cols.amt,
                &mut seen_extra_labels,
                &mut extra_charges,
                &mut disbursement_minor,
            );

            let start_row = cols.header_row_idx.map(|i| i + 1).unwrap_or(0);
            let mut current_section = "KITCHEN".to_string();

            for (r_idx, r) in range.rows().enumerate().skip(start_row) {
                let raw_desc = r.get(cols.desc).map(cell_to_trimmed_string).unwrap_or_default();
                let desc_key = normalize_name_key(&raw_desc);
                if desc_key == "SUMMARY" {
                    break;
                }
                if desc_key.is_empty() {
                    continue;
                }
                if desc_key == "TOTAL"
                    || desc_key.starts_with("TOTAL ")
                    || desc_key.ends_with(" TOTAL")
                    || is_summary_skip_section(&desc_key) && desc_key != current_section && {
                        // Distinguish section banner from summary-only labels
                        matches!(
                            desc_key.as_str(),
                            "GRAND TOTAL"
                                | "ACTUAL EXP."
                                | "ACTUAL EXP"
                                | "ACTUAL EXPENDITURE"
                                | "REFUNDED TO CASH CONTROLLER"
                                | "DISBURMENT"
                                | "DISBURSEMENT"
                        )
                    }
                {
                    continue;
                }

                let raw_sn = r.get(cols.sn).map(cell_to_trimmed_string).unwrap_or_default();
                let raw_vol = r.get(cols.vol).map(cell_to_trimmed_string).unwrap_or_default();
                let (qty_val, qty_unit_hint) = r
                    .get(cols.qty)
                    .map(parse_qty_and_hint)
                    .unwrap_or((None, None));
                let price_val = r.get(cols.price).and_then(cell_to_f64);
                let amt_val = r.get(cols.amt).and_then(cell_to_f64);

                if raw_sn.is_empty()
                    && qty_val.is_none()
                    && price_val.is_none()
                    && amt_val.is_none()
                {
                    if is_known_section_banner(&desc_key) || !raw_desc.is_empty() {
                        current_section = desc_key;
                    }
                    continue;
                }

                let raw_qty_milli = qty_val.map(|v| f64_to_scaled_i64(v, 1000.0));
                let raw_unit_price_minor = price_val.map(|v| f64_to_scaled_i64(v, 100.0));
                let raw_amount_minor = amt_val.map(|v| f64_to_scaled_i64(v, 100.0));

                if raw_qty_milli.unwrap_or(0) <= 0 && raw_amount_minor.unwrap_or(0) <= 0 {
                    continue;
                }

                // Match item: 1. Exact -> 2. Alias -> 3. Fuzzy (Jaro-Winkler)
                let mut candidates: Vec<ParsedMatchCandidate> = Vec::new();
                let (match_status, matched_item): (String, Option<&ItemRef>) =
                    if let Some(&exact) = items_by_norm.get(&desc_key) {
                        ("exact".to_string(), Some(exact))
                    } else if let Some(alias_item_id) = aliases_by_norm.get(&desc_key) {
                        if let Some(&aliased) = items_by_id.get(alias_item_id) {
                            ("alias".to_string(), Some(aliased))
                        } else {
                            ("unmatched".to_string(), None)
                        }
                    } else {
                        let mut scored: Vec<(f64, &ItemRef)> = items
                            .iter()
                            .filter_map(|it| {
                                let sim = jaro_winkler(&desc_key, &it.norm_name);
                                (sim >= 0.72).then_some((sim, it))
                            })
                            .collect();
                        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
                        for (sc, it) in scored.iter().take(5) {
                            let bu_code = units_by_id
                                .get(&it.base_unit_id)
                                .map(|u| u.code.clone())
                                .unwrap_or_default();
                            candidates.push(ParsedMatchCandidate {
                                item_id: it.id.clone(),
                                item_name: it.name.clone(),
                                base_unit_code: bu_code,
                                score: *sc,
                            });
                        }
                        if let Some((top_score, top_item)) = scored.first() {
                            if *top_score >= 0.88 {
                                ("fuzzy".to_string(), Some(*top_item))
                            } else {
                                ("unmatched".to_string(), None)
                            }
                        } else {
                            ("unmatched".to_string(), None)
                        }
                    };

                let mut anomalies = Vec::new();
                let mut anomaly_messages = Vec::new();

                if matched_item.is_none() {
                    anomalies.push(ParsedAnomalyCode::UnmatchedItem);
                    anomaly_messages.push(format!(
                        "No close catalog match found for '{raw_desc}'. Map it to an existing item or create a new one."
                    ));
                }

                append_financial_anomalies(
                    raw_qty_milli,
                    raw_unit_price_minor,
                    raw_amount_minor,
                    &mut anomalies,
                    &mut anomaly_messages,
                );

                // Unit & conversion factor resolution
                let unit_hint_str = raw_vol
                    .is_empty()
                    .then_some(qty_unit_hint.as_deref())
                    .flatten()
                    .unwrap_or(raw_vol.as_str());

                let mut resolved_unit_id: Option<String> = None;
                let mut resolved_unit_code: Option<String> = None;
                let mut resolved_factor_milli: Option<i64> = None;

                if let Some(it) = matched_item {
                    if let Some(base_unit) = units_by_id.get(&it.base_unit_id) {
                        let i_units = item_units_map.get(&it.id).map(Vec::as_slice).unwrap_or(&[]);
                        if unit_hint_str.is_empty() {
                            resolved_unit_id = Some(base_unit.id.clone());
                            resolved_unit_code = Some(base_unit.code.clone());
                            resolved_factor_milli = Some(MILLI_SCALE);
                        } else if let Some(target_unit) = lookup_unit(unit_hint_str, &units_by_code) {
                            match resolve_factor_milli(base_unit, target_unit, i_units) {
                                Ok(factor) => {
                                    // Extra check: if qty cell itself had a different inline unit (e.g. "25 LITRES" while VOLUME="KEG" and base=L or BTL)
                                    if let Some(ref inline_u) = qty_unit_hint {
                                        if let Some(inline_unit) = lookup_unit(inline_u, &units_by_code) {
                                            if inline_unit.id != target_unit.id {
                                                anomalies.push(ParsedAnomalyCode::UnitConversionNeeded);
                                                anomaly_messages.push(format!(
                                                    "Quantity text ('{}') uses unit '{}', while VOLUME column says '{}'. Please confirm purchase unit & conversion factor.",
                                                    cell_to_trimmed_string(&r[cols.qty]),
                                                    inline_unit.code,
                                                    target_unit.code
                                                ));
                                            }
                                        }
                                    }
                                    resolved_unit_id = Some(target_unit.id.clone());
                                    resolved_unit_code = Some(target_unit.code.clone());
                                    resolved_factor_milli = Some(factor);
                                }
                                Err(_) => {
                                    resolved_unit_id = Some(target_unit.id.clone());
                                    resolved_unit_code = Some(target_unit.code.clone());
                                    anomalies.push(ParsedAnomalyCode::UnitConversionNeeded);
                                    anomaly_messages.push(format!(
                                        "No conversion factor saved from '{}' to base unit '{}' for '{}'. Specify how many {} per {}.",
                                        target_unit.code, base_unit.code, it.name, base_unit.code, target_unit.code
                                    ));
                                }
                            }
                        } else {
                            anomalies.push(ParsedAnomalyCode::UnitConversionNeeded);
                            anomaly_messages.push(format!(
                                "Unrecognized unit '{}' for '{}' (catalog base unit is '{}'). Choose a unit & conversion factor.",
                                unit_hint_str, it.name, base_unit.code
                            ));
                        }
                    }

                    check_price_jump(
                        it,
                        resolved_factor_milli,
                        raw_qty_milli,
                        raw_unit_price_minor,
                        raw_amount_minor,
                        &mut anomalies,
                        &mut anomaly_messages,
                    );
                }

                let suggested_unit_cost_minor = raw_unit_price_minor.or_else(|| {
                    if let (Some(q), Some(a)) = (raw_qty_milli.filter(|&q| q > 0), raw_amount_minor) {
                        Some(round_div_half_even((a as i128) * (MILLI_SCALE as i128), q as i128) as i64)
                    } else {
                        None
                    }
                });

                let matched_base_unit_code = matched_item
                    .and_then(|i| units_by_id.get(&i.base_unit_id))
                    .map(|u| u.code.clone());

                lines.push(ParsedProcurementLineDto {
                    row_key: format!("{sheet_name}:{}", r_idx + 1),
                    sheet_name: sheet_name.clone(),
                    excel_row: (r_idx + 1) as i32,
                    section_label: current_section.clone(),
                    raw_description: raw_desc,
                    raw_unit: if raw_vol.is_empty() {
                        qty_unit_hint
                    } else {
                        Some(raw_vol)
                    },
                    raw_qty_milli,
                    raw_unit_price_minor,
                    raw_amount_minor,
                    match_status,
                    matched_item_id: matched_item.map(|i| i.id.clone()),
                    matched_item_name: matched_item.map(|i| i.name.clone()),
                    matched_base_unit_id: matched_item.map(|i| i.base_unit_id.clone()),
                    matched_base_unit_code,
                    resolved_unit_id,
                    resolved_unit_code,
                    resolved_factor_milli,
                    suggested_unit_cost_minor,
                    procurement_line_id: None,
                    anomalies,
                    anomaly_messages,
                    candidates,
                });
            }
        }
    }

    let ready_count = lines
        .iter()
        .filter(|l| l.anomalies.is_empty() && l.matched_item_id.is_some())
        .count() as i32;
    let needs_attention_count = (lines.len() as i32) - ready_count;

    Ok(ParsedProcurementDraft {
        filename,
        tier: if tier1_active {
            "tier1_meta".to_string()
        } else {
            "tier2_heuristic".to_string()
        },
        linked_procurement_list_id,
        parsed_sheets: sheets_to_parse,
        lines,
        extra_charges,
        disbursement_minor,
        ready_count,
        needs_attention_count,
    })
}

/// Storekeeper Confirmation Gate: validates all resolved mappings, creates any requested
/// new catalog items, optionally remembers description aliases and UoM conversions for future
/// imports, and atomically posts a Goods Receipt Note (`receipts` + `stock_movements` + WAC).
pub fn confirm_parsed_restock(
    db: &Database,
    actor: &SessionUser,
    input: ConfirmParsedRestockInput,
) -> AppResult<ReceiptDto> {
    require_operator(actor)?;

    let receipt_id = db.transaction(|tx| {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        let units_map = load_unit_map(tx)?;
        let default_dept_id: Option<String> = tx
            .query_row(
                "SELECT id FROM departments WHERE is_active = 1 AND LOWER(name) != 'store' ORDER BY sort_order ASC, name ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;

        let mut items_created = 0i64;
        let mut receipt_lines: Vec<ReceiptLineInput> = Vec::new();
        let mut audit_notes: Vec<String> = Vec::new();

        for (idx, line) in input.lines.iter().enumerate() {
            let action = line.action.trim().to_ascii_lowercase();
            if action == "skip" {
                continue;
            }
            if !matches!(action.as_str(), "map" | "create_new") {
                return Err(ApiError::validation(format!(
                    "Line {}: action must be 'map', 'create_new', or 'skip'.",
                    idx + 1
                )));
            }
            if line.quantity_milli <= 0 {
                return Err(ApiError::validation(format!(
                    "Line {} ('{}'): confirmed quantity must be greater than zero.",
                    idx + 1,
                    line.raw_description
                )));
            }
            if line.line_total_minor < 0 {
                return Err(ApiError::validation(format!(
                    "Line {} ('{}'): line total cannot be negative.",
                    idx + 1,
                    line.raw_description
                )));
            }
            if line.factor_milli <= 0 {
                return Err(ApiError::validation(format!(
                    "Line {} ('{}'): conversion factor must be greater than zero.",
                    idx + 1,
                    line.raw_description
                )));
            }
            if !units_map.contains_key(line.unit_id.trim()) {
                return Err(ApiError::not_found(format!(
                    "Line {} ('{}'): purchase unit not found.",
                    idx + 1,
                    line.raw_description
                )));
            }

            let (item_id, base_unit_id) = if action == "create_new" {
                let name = line
                    .new_item_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| line.raw_description.trim())
                    .to_string();
                if name.is_empty() {
                    return Err(ApiError::validation(format!(
                        "Line {}: new item name is required.",
                        idx + 1
                    )));
                }
                let dept_id = line
                    .new_item_department_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(ToString::to_string)
                    .or_else(|| default_dept_id.clone())
                    .ok_or_else(|| {
                        ApiError::validation("Create a department before adding new items.")
                    })?;

                let existing_id: Option<String> = tx
                    .query_row(
                        "SELECT id FROM items WHERE LOWER(name) = LOWER(?1)",
                        [&name],
                        |r| r.get(0),
                    )
                    .optional()?;

                if let Some(eid) = existing_id {
                    let bu: String = tx.query_row(
                        "SELECT base_unit_id FROM items WHERE id = ?1",
                        [&eid],
                        |r| r.get(0),
                    )?;
                    (eid, bu)
                } else {
                    let sku = next_auto_sku(tx)?;
                    let iid = Uuid::now_v7().to_string();
                    let unit_id = line.unit_id.trim().to_string();
                    tx.execute(
                        "INSERT INTO items (
                            id, sku, name, base_unit_id, display_unit_id, default_issue_unit_id,
                            default_purchase_unit_id, on_hand_milli, avg_cost_micro, last_cost_micro,
                            cost_missing, is_returnable, reorder_point_milli, par_level_milli,
                            is_active, created_at, updated_at
                         ) VALUES (?1, ?2, ?3, ?4, ?4, ?4, ?4, 0, 0, 0, 1, 0, 0, 0, 1, ?5, ?5)",
                        params![iid, sku, name, unit_id, now],
                    )?;
                    tx.execute(
                        "INSERT OR IGNORE INTO item_departments (item_id, department_id) VALUES (?1, ?2)",
                        params![iid, dept_id],
                    )?;
                    items_created += 1;
                    audit_notes.push(format!("Created catalog item '{name}'"));
                    (iid, unit_id)
                }
            } else {
                let iid = line
                    .item_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| {
                        ApiError::validation(format!(
                            "Line {} ('{}'): item_id is required when action is 'map'.",
                            idx + 1,
                            line.raw_description
                        ))
                    })?
                    .to_string();
                let bu: Option<String> = tx
                    .query_row(
                        "SELECT base_unit_id FROM items WHERE id = ?1",
                        [&iid],
                        |r| r.get(0),
                    )
                    .optional()?;
                let base_unit_id = bu.ok_or_else(|| {
                    ApiError::not_found(format!("Item '{}' not found.", iid))
                })?;
                (iid, base_unit_id)
            };

            // Persist alias if requested
            if line.save_alias {
                let raw_trim = line.raw_description.trim();
                let norm = normalize_name_key(raw_trim);
                let item_name: String = tx.query_row(
                    "SELECT name FROM items WHERE id = ?1",
                    [&item_id],
                    |r| r.get(0),
                )?;
                if !norm.is_empty() && norm != normalize_name_key(&item_name) {
                    tx.execute(
                        "INSERT OR IGNORE INTO item_aliases (id, item_id, alias_normalized, created_at)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![Uuid::now_v7().to_string(), item_id, norm, now],
                    )?;
                }
            }
            refresh_item_fts(tx, &item_id)?;

            // Resolve or persist purchase unit conversion
            let mut receipt_unit_id = line.unit_id.trim().to_string();
            let mut receipt_input_qty_milli = line.quantity_milli;

            if receipt_unit_id != base_unit_id {
                let base_u = &units_map[&base_unit_id];
                let target_u = &units_map[&receipt_unit_id];
                let item_units = load_item_units(tx, &item_id)?;
                let has_resolved = resolve_factor_milli(base_u, target_u, &item_units).is_ok();

                if line.save_unit_conversion {
                    tx.execute(
                        "INSERT INTO item_units (id, item_id, unit_id, factor_milli, can_purchase, can_issue)
                         VALUES (?1, ?2, ?3, ?4, 1, 0)
                         ON CONFLICT(item_id, unit_id) DO UPDATE SET
                           factor_milli = excluded.factor_milli,
                           can_purchase = 1",
                        params![
                            Uuid::now_v7().to_string(),
                            item_id,
                            receipt_unit_id,
                            line.factor_milli
                        ],
                    )?;
                } else if !has_resolved {
                    // One-off conversion without persisting into item_units
                    receipt_input_qty_milli = round_div_half_even(
                        (line.quantity_milli as i128) * (line.factor_milli as i128),
                        MILLI_SCALE as i128,
                    ) as i64;
                    receipt_unit_id = base_unit_id.clone();
                }
            }

            let derived_unit_cost_minor = round_div_half_even(
                (line.line_total_minor as i128) * (MILLI_SCALE as i128),
                receipt_input_qty_milli as i128,
            ) as i64;

            receipt_lines.push(ReceiptLineInput {
                procurement_line_id: line.procurement_line_id.clone(),
                item_id,
                unit_id: receipt_unit_id,
                input_qty_milli: receipt_input_qty_milli,
                unit_cost_minor: derived_unit_cost_minor,
                line_total_minor: line.line_total_minor,
            });
        }

        if receipt_lines.is_empty() {
            return Err(ApiError::validation(
                "At least one non-skipped line is required to confirm restock.",
            )
            .with_field("lines"));
        }

        let rid = post_receipt_tx(
            tx,
            actor,
            "parsed_excel",
            Some(&input.filename),
            input.procurement_list_id.as_deref(),
            input.supplier_id.as_deref(),
            input.invoice_ref.as_deref(),
            &input.received_by_staff_id,
            &input.approved_by_staff_id,
            input.received_at.as_deref(),
            input.disbursement_minor,
            &input.extra_charges,
            input.notes.as_deref(),
            &receipt_lines,
        )?;

        tx.execute(
            "INSERT INTO import_runs (id, profile, filename, items_created, items_updated, warnings_json, imported_by_user_id, created_at)
             VALUES (?1, 'procurement_upload', ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                Uuid::now_v7().to_string(),
                input.filename,
                items_created,
                receipt_lines.len() as i64,
                serde_json::to_string(&audit_notes)?,
                actor.id,
                now
            ],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "import.procurement",
            "receipt",
            &rid,
            &format!(
                "Confirmed parsed procurement sheet '{}' ({} restocked lines)",
                input.filename,
                receipt_lines.len()
            ),
            serde_json::json!({
                "filename": input.filename,
                "items_created": items_created,
                "lines": receipt_lines.len(),
            }),
        )?;

        Ok(rid)
    })?;

    get_receipt(db, &receipt_id)
}
