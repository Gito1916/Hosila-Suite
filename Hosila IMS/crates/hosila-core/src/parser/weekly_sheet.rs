use std::collections::{HashMap, HashSet};
use std::path::Path;

use calamine::{open_workbook, Reader, Xlsx};
use chrono::{NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::money::{line_value_minor, MILLI_SCALE};
use crate::error::{ApiError, AppResult};
use crate::parser::{cell_to_f64, cell_to_trimmed_string, f64_to_scaled_i64, normalize_name_key, normalize_unit_code};
use crate::services::activity::record_activity;
use crate::services::auth::require_admin;
use crate::services::items::{next_auto_sku, refresh_item_fts};
use crate::types::{
    SessionUser, WeeklySheetImportOptions, WeeklySheetImportPreview, WeeklySheetImportResult,
    WeeklySheetPreviewRow,
};

fn dept_display_and_section(raw: &str, profile: &str) -> (String, Option<String>) {
    let upper = raw.trim().to_ascii_uppercase();
    if profile == "de_palms" {
        match upper.as_str() {
            "KITCHEN" => ("Kitchen".to_string(), None),
            "PROTEIN" => ("Kitchen".to_string(), Some("Protein".to_string())),
            "F&B" | "F & B" => ("F&B".to_string(), None),
            "HOUSE KEEPING" | "HOUSEKEEPING" => ("Housekeeping".to_string(), None),
            "MAINTENANCE" => ("Maintenance".to_string(), None),
            _ => (title_case_dept(raw), None),
        }
    } else {
        match upper.as_str() {
            "HOUSE KEEPING" | "HOUSEKEEPING" => ("Housekeeping".to_string(), None),
            "F&B" | "F & B" => ("F&B".to_string(), None),
            _ => (title_case_dept(raw), None),
        }
    }
}

fn title_case_dept(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "General".to_string();
    }
    if trimmed.eq_ignore_ascii_case("F&B") || trimmed.eq_ignore_ascii_case("F & B") {
        return "F&B".to_string();
    }
    trimmed
        .split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    first.to_uppercase().collect::<String>()
                        + &chars.as_str().to_ascii_lowercase()
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn unit_suffix_label(code: &str) -> &'static str {
    match code {
        "CAN" => "Can",
        "BTL" => "Bottle",
        "PACK" => "Pack",
        "TIN" => "Tin",
        "SACHET" => "Sachet",
        "CARTON" => "Carton",
        "CRATE" => "Crate",
        "KG" => "Kg",
        "L" => "Litre",
        _ => "Unit",
    }
}

pub fn preview_weekly_sheet_import(
    options: &WeeklySheetImportOptions,
) -> AppResult<WeeklySheetImportPreview> {
    let path = Path::new(&options.file_path);
    if !path.exists() {
        return Err(ApiError::not_found(format!(
            "Excel file not found: {}",
            options.file_path
        )));
    }

    let mut workbook: Xlsx<_> = open_workbook(path)
        .map_err(|e| ApiError::import_error(format!("Failed to open Excel workbook: {e}")))?;

    let available_sheets = workbook.sheet_names().to_vec();
    if available_sheets.is_empty() {
        return Err(ApiError::import_error("Workbook contains no sheets."));
    }

    let target_sheet = if let Some(ref s) = options.sheet_name {
        if available_sheets.iter().any(|a| a.eq_ignore_ascii_case(s)) {
            available_sheets
                .iter()
                .find(|a| a.eq_ignore_ascii_case(s))
                .cloned()
                .unwrap()
        } else {
            return Err(ApiError::not_found(format!(
                "Worksheet '{s}' was not found in workbook. Available sheets: {}",
                available_sheets.join(", ")
            )));
        }
    } else {
        // Default to the latest (last) worksheet tab in the workbook (e.g. WEEK 3 / latest week)
        available_sheets
            .iter()
            .rev()
            .find(|name| !name.starts_with('_'))
            .cloned()
            .unwrap_or_else(|| available_sheets[available_sheets.len() - 1].clone())
    };

    let range = workbook
        .worksheet_range(&target_sheet)
        .map_err(|e| ApiError::import_error(format!("Failed to read sheet '{target_sheet}': {e}")))?;

    let mut warnings = Vec::new();
    let mut raw_rows: Vec<(usize, String, Option<String>, String, String, i64, i64, i64, i64, i64)> =
        Vec::new();
    let mut current_dept_raw = String::new();
    let mut sheet_cached_grand_total: Option<i64> = None;

    for (r_idx, row) in range.rows().enumerate() {
        let excel_row = r_idx + 1;
        if excel_row <= 2 {
            continue;
        }
        let col_b = row.get(1).map(cell_to_trimmed_string).unwrap_or_default();
        if col_b.eq_ignore_ascii_case("GRAND TOTAL") {
            if let Some(gt) = row.get(10).and_then(cell_to_f64) {
                sheet_cached_grand_total = Some(f64_to_scaled_i64(gt, 100.0));
            }
            continue;
        }
        if !col_b.is_empty() {
            current_dept_raw = col_b;
        }

        let desc = row.get(2).map(cell_to_trimmed_string).unwrap_or_default();
        if desc.is_empty() {
            continue;
        }

        let unit_raw = row.get(3).map(cell_to_trimmed_string).unwrap_or_default();
        let unit_code = normalize_unit_code(&unit_raw).to_string();
        if unit_raw.is_empty() {
            warnings.push(format!(
                "Row {excel_row} ({desc}): blank unit defaulted to {unit_code}."
            ));
        }

        let opening_f = row.get(4).and_then(cell_to_f64).unwrap_or(0.0);
        let purchase_f = row.get(5).and_then(cell_to_f64).unwrap_or(0.0);
        let issued_f = row.get(7).and_then(cell_to_f64).unwrap_or(0.0);
        let closing_f = row
            .get(8)
            .and_then(cell_to_f64)
            .unwrap_or(opening_f + purchase_f - issued_f);
        let cost_f = row.get(9).and_then(cell_to_f64).unwrap_or(0.0);

        let opening_milli = f64_to_scaled_i64(opening_f, 1_000.0);
        let purchase_milli = f64_to_scaled_i64(purchase_f, 1_000.0);
        let issued_milli = f64_to_scaled_i64(issued_f, 1_000.0);
        let closing_milli = f64_to_scaled_i64(closing_f, 1_000.0);
        let unit_cost_micro = f64_to_scaled_i64(cost_f.max(0.0), 1_000_000.0);

        let (dept, section) = dept_display_and_section(&current_dept_raw, &options.profile);
        raw_rows.push((
            excel_row,
            dept,
            section,
            desc,
            unit_code,
            opening_milli,
            purchase_milli,
            issued_milli,
            closing_milli,
            unit_cost_micro,
        ));
    }

    // Check De Palms Pineapple rule (D8) and detect duplicate names with distinct packaging
    let mut name_counts: HashMap<String, usize> = HashMap::new();
    let has_fnb_pineapple = options.profile == "de_palms"
        && raw_rows
            .iter()
            .any(|r| r.1 == "F&B" && normalize_name_key(&r.3) == "PINEAPPLE");

    let mut filtered_rows = Vec::with_capacity(raw_rows.len());
    for r in raw_rows {
        if has_fnb_pineapple && r.1 == "Kitchen" && normalize_name_key(&r.3) == "PINEAPPLE" {
            warnings.push(format!(
                "Row {} (Kitchen PINEAPPLE): dropped duplicate Kitchen row per De Palms rule; F&B PINEAPPLE shared with Kitchen.",
                r.0
            ));
            continue;
        }
        *name_counts.entry(normalize_name_key(&r.3)).or_insert(0) += 1;
        filtered_rows.push(r);
    }

    let mut seen_final_names: HashSet<String> = HashSet::new();
    let mut rows = Vec::with_capacity(filtered_rows.len());
    let mut total_closing_value_minor: i64 = 0;
    let mut total_purchase_value_minor: i64 = 0;
    let mut cost_missing_count: i32 = 0;

    for (
        excel_row,
        dept,
        section,
        raw_desc,
        unit_code,
        opening_milli,
        purchase_milli,
        issued_milli,
        closing_milli,
        unit_cost_micro,
    ) in filtered_rows
    {
        let collapsed = raw_desc.split_whitespace().collect::<Vec<_>>().join(" ");
        let norm_key = normalize_name_key(&collapsed);
        let is_dup_name = name_counts.get(&norm_key).copied().unwrap_or(0) > 1;
        let mut final_name = if is_dup_name {
            format!("{collapsed} ({})", unit_suffix_label(&unit_code))
        } else {
            collapsed.clone()
        };
        if !seen_final_names.insert(normalize_name_key(&final_name)) {
            final_name = format!("{final_name} #{excel_row}");
            seen_final_names.insert(normalize_name_key(&final_name));
        }

        let mut shared_departments = vec![dept.clone()];
        let mut note = None;
        if options.profile == "de_palms" && norm_key == "PINEAPPLE" && dept == "F&B" {
            shared_departments.push("Kitchen".to_string());
            note = Some("Shared with Kitchen (F&B stock kept)".to_string());
        } else if is_dup_name {
            note = Some(format!("Split by pack unit ({unit_code})"));
        }

        let cost_missing = unit_cost_micro == 0;
        if cost_missing {
            cost_missing_count += 1;
        }

        let closing_value_minor = line_value_minor(closing_milli.max(0), unit_cost_micro)?;
        let purchase_value_minor = line_value_minor(purchase_milli.max(0), unit_cost_micro)?;
        total_closing_value_minor += closing_value_minor;
        total_purchase_value_minor += purchase_value_minor;

        rows.push(WeeklySheetPreviewRow {
            row_number: excel_row as i32,
            department: dept,
            store_section: section,
            item_name: final_name,
            unit_code,
            opening_milli,
            purchase_milli,
            issued_milli,
            closing_milli,
            unit_cost_micro,
            closing_value_minor,
            cost_missing,
            shared_departments,
            note,
        });
    }

    if let Some(cached) = sheet_cached_grand_total {
        if (cached - total_closing_value_minor).abs() > 100 {
            warnings.push(format!(
                "Sheet cached GRAND TOTAL ({:.2}) differs from computed closing total ({:.2}); row-level closing math used.",
                cached as f64 / 100.0,
                total_closing_value_minor as f64 / 100.0
            ));
        }
    }

    Ok(WeeklySheetImportPreview {
        sheet_name: target_sheet,
        available_sheets,
        total_items: rows.len() as i32,
        cost_missing_count,
        total_closing_value_minor,
        total_purchase_value_minor,
        warnings,
        rows,
    })
}

pub fn commit_weekly_sheet_import(
    db: &Database,
    actor: &SessionUser,
    options: WeeklySheetImportOptions,
) -> AppResult<WeeklySheetImportResult> {
    require_admin(actor)?;
    NaiveDate::parse_from_str(options.opening_date.trim(), "%Y-%m-%d").map_err(|_| {
        ApiError::validation("opening_date must be YYYY-MM-DD.").with_field("opening_date")
    })?;
    NaiveDate::parse_from_str(options.purchase_date.trim(), "%Y-%m-%d").map_err(|_| {
        ApiError::validation("purchase_date must be YYYY-MM-DD.").with_field("purchase_date")
    })?;

    let preview = preview_weekly_sheet_import(&options)?;
    let excluded_set: HashSet<i32> = options
        .excluded_row_numbers
        .unwrap_or_default()
        .into_iter()
        .collect();
    let included_rows: Vec<&WeeklySheetPreviewRow> = preview
        .rows
        .iter()
        .filter(|r| !excluded_set.contains(&r.row_number))
        .collect();
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let filename = Path::new(&options.file_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| options.file_path.clone());

    db.transaction(|tx| {
        // Load units lookup
        let unit_ids: HashMap<String, String> = {
            let mut stmt = tx.prepare("SELECT UPPER(code), id FROM units")?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            rows.into_iter().collect()
        };

        // Ensure all required departments exist
        let dept_colors = HashMap::from([
            ("Kitchen", "#21C29C"),
            ("F&B", "#3B82F6"),
            ("Housekeeping", "#F59E0B"),
            ("Maintenance", "#8B5CF6"),
            ("Store", "#64748B"),
        ]);
        let mut required_depts: Vec<String> = vec!["Store".to_string()];
        for r in &included_rows {
            for d in &r.shared_departments {
                if !required_depts.iter().any(|x| x.eq_ignore_ascii_case(d)) {
                    required_depts.push(d.clone());
                }
            }
        }
        let mut dept_map: HashMap<String, String> = HashMap::new();
        for (idx, dname) in required_depts.iter().enumerate() {
            let existing: Option<(String, String)> = tx
                .query_row(
                    "SELECT id, name FROM departments WHERE LOWER(name) = LOWER(?1)",
                    [dname],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let did = match existing {
                Some((id, _)) => id,
                None => {
                    let id = Uuid::now_v7().to_string();
                    let color = dept_colors.get(dname.as_str()).copied().unwrap_or("#21C29C");
                    tx.execute(
                        "INSERT INTO departments (id, name, color, sort_order, is_active, created_at)
                         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                        params![id, dname, color, (idx as i32) + 1, now],
                    )?;
                    id
                }
            };
            dept_map.insert(dname.to_ascii_lowercase(), did);
        }

        // Ensure store sections exist
        let mut section_map: HashMap<String, String> = HashMap::new();
        for r in &included_rows {
            if let Some(ref sec_name) = r.store_section {
                let key = sec_name.to_ascii_lowercase();
                if section_map.contains_key(&key) {
                    continue;
                }
                let existing: Option<String> = tx
                    .query_row(
                        "SELECT id FROM store_sections WHERE LOWER(name) = LOWER(?1)",
                        [sec_name],
                        |row| row.get(0),
                    )
                    .optional()?;
                let sid = match existing {
                    Some(id) => id,
                    None => {
                        let id = Uuid::now_v7().to_string();
                        tx.execute(
                            "INSERT INTO store_sections (id, name, sort_order, is_active, created_at)
                             VALUES (?1, ?2, 1, 1, ?3)",
                            params![id, sec_name, now],
                        )?;
                        id
                    }
                };
                section_map.insert(key, sid);
            }
        }

        let mut items_created = 0;
        let mut items_updated = 0;
        let mut committed_closing_value_minor: i64 = 0;
        let mut committed_cost_missing_count: i32 = 0;

        for row in included_rows {
            let unit_id = unit_ids
                .get(&row.unit_code.to_ascii_uppercase())
                .cloned()
                .ok_or_else(|| {
                    ApiError::import_error(format!("Missing system unit '{}' in database.", row.unit_code))
                })?;

            let section_id = row
                .store_section
                .as_ref()
                .and_then(|s| section_map.get(&s.to_ascii_lowercase()).cloned());

            committed_closing_value_minor += row.closing_value_minor;
            if row.cost_missing {
                committed_cost_missing_count += 1;
            }

            let existing_item: Option<(String, i64, bool)> = tx
                .query_row(
                    "SELECT id, on_hand_milli, is_active FROM items WHERE LOWER(name) = LOWER(?1)",
                    [&row.item_name],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0)),
                )
                .optional()?;

            let starting_qty_milli = row.closing_milli.max(0);

            if let Some((eid, cur_on_hand, _was_active)) = existing_item {
                items_updated += 1;
                if row.unit_cost_micro > 0 {
                    tx.execute(
                        "UPDATE items
                         SET store_section_id = COALESCE(?1, store_section_id),
                             avg_cost_micro = ?2,
                             last_cost_micro = ?2,
                             cost_missing = 0,
                             is_active = 1,
                             updated_at = ?3
                         WHERE id = ?4",
                        params![section_id, row.unit_cost_micro, now, eid],
                    )?;
                } else {
                    tx.execute(
                        "UPDATE items
                         SET store_section_id = COALESCE(?1, store_section_id),
                             is_active = 1,
                             updated_at = ?2
                         WHERE id = ?3",
                        params![section_id, now, eid],
                    )?;
                }

                for dname in &row.shared_departments {
                    if let Some(did) = dept_map.get(&dname.to_ascii_lowercase()) {
                        tx.execute(
                            "INSERT OR IGNORE INTO item_departments (item_id, department_id) VALUES (?1, ?2)",
                            params![eid, did],
                        )?;
                    }
                }
                refresh_item_fts(tx, &eid)?;

                let delta = starting_qty_milli - cur_on_hand;
                if delta != 0 {
                    tx.execute(
                        "UPDATE items SET on_hand_milli = ?1, updated_at = ?2 WHERE id = ?3",
                        params![starting_qty_milli, now, eid],
                    )?;
                    let val_minor = line_value_minor(delta.abs(), row.unit_cost_micro)?;
                    let primary_did = dept_map.get(&row.department.to_ascii_lowercase()).cloned();
                    tx.execute(
                        "INSERT INTO stock_movements (
                            id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                            department_id, doc_type, doc_id, doc_number,
                            input_unit_id, input_qty_milli, factor_milli,
                            actor_user_id, business_date, created_at
                        ) VALUES (?1, ?2, 'count', ?3, ?4, ?5, ?6, ?7, 'seed', 'weekly-sheet-import', 'IMP-RECON', ?8, ?3, ?9, ?10, ?11, ?12)",
                        params![
                            Uuid::now_v7().to_string(),
                            eid,
                            delta,
                            starting_qty_milli,
                            row.unit_cost_micro,
                            val_minor,
                            primary_did,
                            unit_id,
                            MILLI_SCALE,
                            actor.id,
                            options.opening_date.trim(),
                            now
                        ],
                    )?;
                }
            } else {
                let sku = next_auto_sku(tx)?;
                let iid = Uuid::now_v7().to_string();

                tx.execute(
                    "INSERT INTO items (
                        id, sku, name, base_unit_id, display_unit_id, default_issue_unit_id, default_purchase_unit_id,
                        store_section_id, on_hand_milli, avg_cost_micro, last_cost_micro, cost_missing,
                        is_returnable, reorder_point_milli, par_level_milli, is_active, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?4, ?4, ?4, ?5, ?6, ?7, ?7, ?8, 0, 0, 0, 1, ?9, ?9)",
                    params![
                        iid,
                        sku,
                        row.item_name,
                        unit_id,
                        section_id,
                        starting_qty_milli,
                        row.unit_cost_micro,
                        if row.cost_missing { 1 } else { 0 },
                        now
                    ],
                )?;

                for dname in &row.shared_departments {
                    if let Some(did) = dept_map.get(&dname.to_ascii_lowercase()) {
                        tx.execute(
                            "INSERT OR IGNORE INTO item_departments (item_id, department_id) VALUES (?1, ?2)",
                            params![iid, did],
                        )?;
                    }
                }
                refresh_item_fts(tx, &iid)?;
                items_created += 1;

                if starting_qty_milli > 0 {
                    let val_minor = line_value_minor(starting_qty_milli, row.unit_cost_micro)?;
                    let primary_did = dept_map.get(&row.department.to_ascii_lowercase()).cloned();
                    tx.execute(
                        "INSERT INTO stock_movements (
                            id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                            department_id, doc_type, doc_id, doc_number,
                            input_unit_id, input_qty_milli, factor_milli,
                            actor_user_id, business_date, created_at
                        ) VALUES (?1, ?2, 'opening', ?3, ?3, ?4, ?5, ?6, 'seed', 'weekly-sheet-import', 'IMP-OPEN', ?7, ?3, ?8, ?9, ?10, ?11)",
                        params![
                            Uuid::now_v7().to_string(),
                            iid,
                            starting_qty_milli,
                            row.unit_cost_micro,
                            val_minor,
                            primary_did,
                            unit_id,
                            MILLI_SCALE,
                            actor.id,
                            options.opening_date.trim(),
                            now
                        ],
                    )?;
                }
            }
        }

        let import_run_id = Uuid::now_v7().to_string();
        let warnings_json = serde_json::to_string(&preview.warnings)?;
        tx.execute(
            "INSERT INTO import_runs (id, profile, filename, items_created, items_updated, warnings_json, imported_by_user_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                import_run_id,
                options.profile,
                filename,
                items_created,
                items_updated,
                warnings_json,
                actor.id,
                now
            ],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "import.weekly_sheet",
            "import_runs",
            &import_run_id,
            &format!(
                "Imported {} new and updated {} existing items from {} ({} sheet, opening {})",
                items_created, items_updated, filename, preview.sheet_name, options.opening_date
            ),
            serde_json::json!({
                "items_created": items_created,
                "items_updated": items_updated,
                "closing_value_minor": committed_closing_value_minor,
                "cost_missing_count": committed_cost_missing_count,
            }),
        )?;

        Ok(WeeklySheetImportResult {
            import_run_id,
            items_created,
            items_updated,
            total_closing_value_minor: committed_closing_value_minor,
            cost_missing_count: committed_cost_missing_count,
            warnings: preview.warnings,
        })
    })
}
