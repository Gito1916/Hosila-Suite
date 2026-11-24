use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet};

use crate::db::Database;
use crate::error::{ApiError, AppResult};
use crate::services::procurement::{get_procurement_list, section_sort_rank};
use crate::services::settings::get_settings;
use crate::types::{ExtraChargeDto, ProcurementLineDto};

struct MetaRow {
    list_id: String,
    line_id: String,
    item_id: String,
    unit_id: String,
    factor_milli: i64,
    sheet_name: String,
    excel_row: u32,
}

struct SheetStyles {
    title: Format,
    table_header: Format,
    section_banner: Format,
    sn: Format,
    desc: Format,
    unit: Format,
    qty: Format,
    money: Format,
    section_total_label: Format,
    section_total_fill: Format,
    section_total_money: Format,
    summary_header_label: Format,
    summary_header_fill: Format,
    summary_row_label: Format,
    summary_row_fill: Format,
    summary_row_money: Format,
    grand_total_label: Format,
    grand_total_fill: Format,
    grand_total_money: Format,
    footer_label: Format,
    footer_fill: Format,
    footer_money: Format,
}

impl SheetStyles {
    fn new(currency_symbol: &str) -> Self {
        let sym = currency_symbol.replace('"', "");
        let money_fmt = if sym.is_empty() {
            "#,##0.00".to_string()
        } else {
            format!("\"{sym}\"#,##0.00")
        };

        let title = Format::new()
            .set_bold()
            .set_font_size(14)
            .set_font_color(Color::RGB(0x111827))
            .set_background_color(Color::RGB(0x8EA9DB))
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
            .set_text_wrap()
            .set_border(FormatBorder::Thin);

        let table_header = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_font_color(Color::RGB(0x111827))
            .set_background_color(Color::RGB(0xBFBFBF))
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let section_banner = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_font_color(Color::RGB(0x111827))
            .set_background_color(Color::RGB(0xD9D9D9))
            .set_align(FormatAlign::Left)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let sn = Format::new()
            .set_font_size(10)
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let desc = Format::new()
            .set_font_size(10)
            .set_align(FormatAlign::Left)
            .set_align(FormatAlign::VerticalCenter)
            .set_text_wrap()
            .set_border(FormatBorder::Thin);

        let unit = Format::new()
            .set_font_size(10)
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let qty = Format::new()
            .set_font_size(10)
            .set_num_format("#,##0.###")
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let money = Format::new()
            .set_font_size(10)
            .set_num_format(&money_fmt)
            .set_align(FormatAlign::Right)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let section_total_label = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_background_color(Color::RGB(0xACB9CA))
            .set_align(FormatAlign::Left)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let section_total_fill = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_background_color(Color::RGB(0xACB9CA))
            .set_border(FormatBorder::Thin);

        let section_total_money = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_num_format(&money_fmt)
            .set_background_color(Color::RGB(0xACB9CA))
            .set_align(FormatAlign::Right)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let summary_header_label = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_background_color(Color::RGB(0x8EA9DB))
            .set_align(FormatAlign::Left)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let summary_header_fill = Format::new()
            .set_bold()
            .set_background_color(Color::RGB(0x8EA9DB))
            .set_border(FormatBorder::Thin);

        let summary_row_label = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_background_color(Color::RGB(0xD6DCE4))
            .set_align(FormatAlign::Left)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let summary_row_fill = Format::new()
            .set_background_color(Color::RGB(0xD6DCE4))
            .set_border(FormatBorder::Thin);

        let summary_row_money = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_num_format(&money_fmt)
            .set_background_color(Color::RGB(0xD6DCE4))
            .set_align(FormatAlign::Right)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let grand_total_label = Format::new()
            .set_bold()
            .set_font_size(11)
            .set_background_color(Color::RGB(0xB4C6E7))
            .set_align(FormatAlign::Left)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let grand_total_fill = Format::new()
            .set_bold()
            .set_background_color(Color::RGB(0xB4C6E7))
            .set_border(FormatBorder::Thin);

        let grand_total_money = Format::new()
            .set_bold()
            .set_font_size(11)
            .set_num_format(&money_fmt)
            .set_background_color(Color::RGB(0xB4C6E7))
            .set_align(FormatAlign::Right)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let footer_label = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_align(FormatAlign::Left)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        let footer_fill = Format::new().set_border(FormatBorder::Thin);

        let footer_money = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_num_format(&money_fmt)
            .set_align(FormatAlign::Right)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);

        Self {
            title,
            table_header,
            section_banner,
            sn,
            desc,
            unit,
            qty,
            money,
            section_total_label,
            section_total_fill,
            section_total_money,
            summary_header_label,
            summary_header_fill,
            summary_row_label,
            summary_row_fill,
            summary_row_money,
            grand_total_label,
            grand_total_fill,
            grand_total_money,
            footer_label,
            footer_fill,
            footer_money,
        }
    }
}

fn sanitize_sheet_name(raw: &str, used: &mut HashSet<String>) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            ':' | '\\' | '/' | '?' | '*' | '[' | ']' => ' ',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .trim_matches('\'')
        .to_string();

    let base = if cleaned.is_empty() {
        "Sheet".to_string()
    } else {
        cleaned.chars().take(31).collect()
    };

    let mut candidate = base.clone();
    let mut idx = 2usize;
    while !used.insert(candidate.to_ascii_lowercase()) {
        let suffix = format!(" ({idx})");
        let max_len = 31usize.saturating_sub(suffix.len());
        let prefix: String = base.chars().take(max_len).collect();
        candidate = format!("{prefix}{suffix}");
        idx += 1;
    }
    candidate
}

fn configure_print(ws: &mut Worksheet) -> AppResult<()> {
    ws.set_paper_size(9); // A4
    ws.set_portrait();
    ws.set_print_fit_to_pages(1, 0);
    ws.set_margins(0.4, 0.4, 0.5, 0.5, 0.25, 0.25);
    ws.set_repeat_rows(2, 2)
        .map_err(|e| ApiError::internal(format!("Failed setting repeat rows: {e}")))?;
    ws.set_column_width(0, 6.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.set_column_width(1, 34.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.set_column_width(2, 13.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.set_column_width(3, 12.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.set_column_width(4, 15.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.set_column_width(5, 18.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn write_procurement_sheet(
    ws: &mut Worksheet,
    list_id: &str,
    sheet_name: &str,
    banner_title: &str,
    lines: &[&ProcurementLineDto],
    extra_charges: &[ExtraChargeDto],
    item_base_units: &HashMap<String, String>,
    styles: &SheetStyles,
    meta_rows: &mut Vec<MetaRow>,
) -> AppResult<()> {
    configure_print(ws)?;

    ws.set_row_height(0, 22.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.set_row_height(1, 22.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.merge_range(0, 0, 1, 5, banner_title, &styles.title)
        .map_err(|e| ApiError::internal(format!("Excel merge failed: {e}")))?;

    let headers = ["S/N", "DESCRIPTION", "VOLUME", "QUANTITY", "UNIT PRICE", "AMOUNT"];
    ws.set_row_height(2, 22.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    for (col, h) in headers.iter().enumerate() {
        ws.write_string_with_format(2, col as u16, *h, &styles.table_header)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }

    // Group lines by section_label respecting De Palms section sort order
    let mut grouped: BTreeMap<(usize, String), Vec<&ProcurementLineDto>> = BTreeMap::new();
    for line in lines {
        let key = section_sort_rank(&line.section_label);
        grouped.entry(key).or_default().push(*line);
    }

    let mut row: u32 = 3; // 0-based (Excel row 4)
    let mut section_totals: Vec<(String, u32)> = Vec::new(); // (label, 1-based excel row)

    for ((_, section_label), section_lines) in grouped {
        ws.set_row_height(row, 20.0)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_blank(row, 0, &styles.section_banner)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_string_with_format(row, 1, &section_label, &styles.section_banner)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        for col in 2..=5 {
            ws.write_blank(row, col, &styles.section_banner)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
        row += 1;

        let first_item_excel_row = row + 1;
        for (idx, line) in section_lines.iter().enumerate() {
            let excel_row = row + 1;
            ws.set_row_height(row, 20.0)
                .map_err(|e| ApiError::internal(e.to_string()))?;

            ws.write_number_with_format(row, 0, (idx + 1) as f64, &styles.sn)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_string_with_format(row, 1, &line.item_name, &styles.desc)
                .map_err(|e| ApiError::internal(e.to_string()))?;

            let volume_label = line
                .unit_code
                .as_deref()
                .unwrap_or(&line.base_unit_code);
            ws.write_string_with_format(row, 2, volume_label, &styles.unit)
                .map_err(|e| ApiError::internal(e.to_string()))?;

            let qty_milli = line.ordered_qty_milli.unwrap_or(line.suggested_qty_milli);
            ws.write_number_with_format(row, 3, qty_milli as f64 / 1000.0, &styles.qty)
                .map_err(|e| ApiError::internal(e.to_string()))?;

            if let Some(unit_cost_minor) = line.est_unit_cost_minor {
                ws.write_number_with_format(
                    row,
                    4,
                    unit_cost_minor as f64 / 100.0,
                    &styles.money,
                )
                .map_err(|e| ApiError::internal(e.to_string()))?;
                ws.write_formula_with_format(
                    row,
                    5,
                    format!("=D{excel_row}*E{excel_row}").as_str(),
                    &styles.money,
                )
                .map_err(|e| ApiError::internal(e.to_string()))?;
            } else if let Some(budget_minor) = line.budget_amount_minor {
                ws.write_blank(row, 4, &styles.money)
                    .map_err(|e| ApiError::internal(e.to_string()))?;
                ws.write_number_with_format(
                    row,
                    5,
                    budget_minor as f64 / 100.0,
                    &styles.money,
                )
                .map_err(|e| ApiError::internal(e.to_string()))?;
            } else {
                ws.write_blank(row, 4, &styles.money)
                    .map_err(|e| ApiError::internal(e.to_string()))?;
                ws.write_formula_with_format(
                    row,
                    5,
                    format!("=D{excel_row}*E{excel_row}").as_str(),
                    &styles.money,
                )
                .map_err(|e| ApiError::internal(e.to_string()))?;
            }

            let resolved_unit_id = line
                .unit_id
                .clone()
                .or_else(|| item_base_units.get(&line.item_id).cloned())
                .unwrap_or_default();

            meta_rows.push(MetaRow {
                list_id: list_id.to_string(),
                line_id: line.id.clone(),
                item_id: line.item_id.clone(),
                unit_id: resolved_unit_id,
                factor_milli: line.factor_milli.max(1000),
                sheet_name: sheet_name.to_string(),
                excel_row,
            });

            row += 1;
        }
        let last_item_excel_row = row; // previous row was (row - 1), so 1-based = row

        // Section TOTAL row
        ws.set_row_height(row, 21.0)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_blank(row, 0, &styles.section_total_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_string_with_format(row, 1, "TOTAL", &styles.section_total_label)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        for col in 2..=4 {
            ws.write_blank(row, col, &styles.section_total_fill)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
        ws.write_formula_with_format(
            row,
            5,
            format!("=SUM(F{first_item_excel_row}:F{last_item_excel_row})").as_str(),
            &styles.section_total_money,
        )
        .map_err(|e| ApiError::internal(e.to_string()))?;

        section_totals.push((section_label, row + 1));
        row += 1;
    }

    // Blank spacer row before SUMMARY
    row += 1;

    // SUMMARY block
    ws.set_row_height(row, 21.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_blank(row, 0, &styles.summary_header_fill)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_string_with_format(row, 1, "SUMMARY", &styles.summary_header_label)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    for col in 2..=5 {
        ws.write_blank(row, col, &styles.summary_header_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }
    row += 1;

    let summary_first_excel_row = row + 1;
    for (sec_label, sec_total_excel_row) in &section_totals {
        ws.set_row_height(row, 20.0)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_blank(row, 0, &styles.summary_row_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_string_with_format(row, 1, sec_label, &styles.summary_row_label)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        for col in 2..=4 {
            ws.write_blank(row, col, &styles.summary_row_fill)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
        ws.write_formula_with_format(
            row,
            5,
            format!("=F{sec_total_excel_row}").as_str(),
            &styles.summary_row_money,
        )
        .map_err(|e| ApiError::internal(e.to_string()))?;
        row += 1;
    }

    for extra in extra_charges {
        ws.set_row_height(row, 20.0)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_blank(row, 0, &styles.summary_row_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_string_with_format(row, 1, &extra.label, &styles.summary_row_label)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        for col in 2..=4 {
            ws.write_blank(row, col, &styles.summary_row_fill)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
        ws.write_number_with_format(row, 5, extra.amount_minor as f64 / 100.0, &styles.summary_row_money)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        row += 1;
    }
    let summary_last_excel_row = row.max(summary_first_excel_row);

    // GRAND TOTAL row
    let grand_total_excel_row = row + 1;
    ws.set_row_height(row, 22.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_blank(row, 0, &styles.grand_total_fill)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_string_with_format(row, 1, "GRAND TOTAL", &styles.grand_total_label)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    for col in 2..=4 {
        ws.write_blank(row, col, &styles.grand_total_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }
    if !section_totals.is_empty() || !extra_charges.is_empty() {
        ws.write_formula_with_format(
            row,
            5,
            format!("=SUM(F{summary_first_excel_row}:F{summary_last_excel_row})").as_str(),
            &styles.grand_total_money,
        )
        .map_err(|e| ApiError::internal(e.to_string()))?;
    } else {
        ws.write_number_with_format(row, 5, 0.0, &styles.grand_total_money)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }
    row += 1;

    // Disbursement / Actual Exp. / Refunded reconciliation rows
    let disbursement_excel_row = row + 1;
    ws.set_row_height(row, 20.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_blank(row, 0, &styles.footer_fill)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_string_with_format(row, 1, "DISBURSEMENT", &styles.footer_label)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    for col in 2..=4 {
        ws.write_blank(row, col, &styles.footer_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }
    ws.write_blank(row, 5, &styles.footer_money)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    row += 1;

    let actual_exp_excel_row = row + 1;
    ws.set_row_height(row, 20.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_blank(row, 0, &styles.footer_fill)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_string_with_format(row, 1, "ACTUAL EXP.", &styles.footer_label)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    for col in 2..=4 {
        ws.write_blank(row, col, &styles.footer_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }
    ws.write_formula_with_format(
        row,
        5,
        format!("=F{grand_total_excel_row}").as_str(),
        &styles.footer_money,
    )
    .map_err(|e| ApiError::internal(e.to_string()))?;
    row += 1;

    ws.set_row_height(row, 20.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_blank(row, 0, &styles.footer_fill)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_string_with_format(row, 1, "REFUNDED TO CASH CONTROLLER", &styles.footer_label)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    for col in 2..=4 {
        ws.write_blank(row, col, &styles.footer_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }
    ws.write_formula_with_format(
        row,
        5,
        format!("=F{disbursement_excel_row}-F{actual_exp_excel_row}").as_str(),
        &styles.footer_money,
    )
    .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(())
}

/// Exports a procurement list into a formatted multi-sheet Excel workbook (.xlsx)
/// with live formulas, optional per-buyer worksheets, and hidden `_hosila_meta`
/// round-trip metadata for 100% Tier-1 re-import fidelity.
pub fn export_procurement_xlsx(
    db: &Database,
    list_id: &str,
    output_path: &Path,
) -> AppResult<String> {
    let list = get_procurement_list(db, list_id)?;
    let settings = get_settings(db)?;

    let item_base_units: HashMap<String, String> = db.with_read(|conn| {
        let mut stmt = conn.prepare("SELECT id, base_unit_id FROM items")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows.into_iter().collect())
    })?;

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let mut workbook = Workbook::new();
    let styles = SheetStyles::new(&settings.business_profile.currency_symbol);
    let mut used_sheet_names: HashSet<String> = HashSet::new();
    let mut meta_rows: Vec<MetaRow> = Vec::new();

    // 1. Master sheet
    let master_name = sanitize_sheet_name("Procurement List", &mut used_sheet_names);
    let master_banner = format!(
        "{} — {} ({})",
        settings.business_profile.name.to_ascii_uppercase(),
        list.title.to_ascii_uppercase(),
        list.number
    );
    let all_refs: Vec<&ProcurementLineDto> = list.lines.iter().collect();
    {
        let ws = workbook.add_worksheet();
        ws.set_name(&master_name)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        write_procurement_sheet(
            ws,
            &list.id,
            &master_name,
            &master_banner,
            &all_refs,
            &list.extra_charges,
            &item_base_units,
            &styles,
            &mut meta_rows,
        )?;
    }

    // 2. Per-buyer worksheets (only if buyers exist on lines)
    let mut buyer_order: Vec<String> = Vec::new();
    let mut buyer_map: HashMap<String, Vec<&ProcurementLineDto>> = HashMap::new();
    for line in &list.lines {
        if let Some(ref b) = line.buyer_name {
            let clean = b.trim();
            if !clean.is_empty() {
                let key = clean.to_ascii_uppercase();
                if !buyer_map.contains_key(&key) {
                    buyer_order.push(key.clone());
                }
                buyer_map.entry(key).or_default().push(line);
            }
        }
    }

    for buyer_key in buyer_order {
        if let Some(buyer_lines) = buyer_map.get(&buyer_key) {
            let tab_raw = format!("{buyer_key}'S LIST");
            let tab_name = sanitize_sheet_name(&tab_raw, &mut used_sheet_names);
            let buyer_banner = format!("{} — {}'S LIST", list.title.to_ascii_uppercase(), buyer_key);
            let ws = workbook.add_worksheet();
            ws.set_name(&tab_name)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            write_procurement_sheet(
                ws,
                &list.id,
                &tab_name,
                &buyer_banner,
                buyer_lines,
                &[],
                &item_base_units,
                &styles,
                &mut meta_rows,
            )?;
        }
    }

    // 3. Hidden _hosila_meta sheet for Tier-1 lossless re-import
    {
        let _ = used_sheet_names.insert("_hosila_meta".to_string());
        let ws = workbook.add_worksheet();
        ws.set_name("_hosila_meta")
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.set_hidden(true);

        let meta_headers = [
            "list_id",
            "line_id",
            "item_id",
            "unit_id",
            "factor_milli",
            "sheet_name",
            "excel_row",
        ];
        for (c, h) in meta_headers.iter().enumerate() {
            ws.write_string(0, c as u16, *h)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
        for (idx, m) in meta_rows.iter().enumerate() {
            let r = (idx + 1) as u32;
            ws.write_string(r, 0, &m.list_id)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_string(r, 1, &m.line_id)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_string(r, 2, &m.item_id)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_string(r, 3, &m.unit_id)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_number(r, 4, m.factor_milli as f64)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_string(r, 5, &m.sheet_name)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_number(r, 6, f64::from(m.excel_row))
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
    }

    workbook
        .save(output_path)
        .map_err(|e| ApiError::internal(format!("Failed writing Excel workbook: {e}")))?;

    Ok(output_path.to_string_lossy().to_string())
}
