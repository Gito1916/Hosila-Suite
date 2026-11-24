use std::collections::BTreeMap;
use std::path::Path;

use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook};

use crate::db::Database;
use crate::error::{ApiError, AppResult};
use crate::services::procurement::section_sort_rank;
use crate::services::reports::get_weekly_stock_sheet;
use crate::services::settings::get_settings;
use crate::types::WeeklyStockSheetRowDto;

/// Exports a weekly stock sheet with De Palms section grouping, live formulas
/// (`=E{r}+F{r}` available, `=G{r}-H{r}` closing, `=I{r}*J{r}` total value),
/// section subtotals, and a `GRAND TOTAL` formula.
pub fn export_weekly_stock_sheet_xlsx(
    db: &Database,
    start_date: &str,
    end_date: &str,
    output_path: &Path,
) -> AppResult<String> {
    let report = get_weekly_stock_sheet(db, start_date, end_date)?;
    let settings = get_settings(db)?;

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let sym = settings.business_profile.currency_symbol.replace('"', "");
    let money_fmt = if sym.is_empty() {
        "#,##0.00".to_string()
    } else {
        format!("\"{sym}\"#,##0.00")
    };

    let fmt_title = Format::new()
        .set_bold()
        .set_font_size(14)
        .set_font_color(Color::RGB(0x111827))
        .set_background_color(Color::RGB(0x8EA9DB))
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);

    let fmt_header = Format::new()
        .set_bold()
        .set_font_size(10)
        .set_background_color(Color::RGB(0xBFBFBF))
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);

    let fmt_section = Format::new()
        .set_bold()
        .set_font_size(10)
        .set_background_color(Color::RGB(0xD9D9D9))
        .set_align(FormatAlign::Left)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);

    let fmt_center = Format::new()
        .set_font_size(10)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);

    let fmt_text = Format::new()
        .set_font_size(10)
        .set_align(FormatAlign::Left)
        .set_align(FormatAlign::VerticalCenter)
        .set_text_wrap()
        .set_border(FormatBorder::Thin);

    let fmt_qty = Format::new()
        .set_font_size(10)
        .set_num_format("#,##0.###")
        .set_align(FormatAlign::Right)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);

    let fmt_money = Format::new()
        .set_font_size(10)
        .set_num_format(&money_fmt)
        .set_align(FormatAlign::Right)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);

    let fmt_sub_fill = Format::new()
        .set_bold()
        .set_font_size(10)
        .set_background_color(Color::RGB(0xACB9CA))
        .set_border(FormatBorder::Thin);

    let fmt_sub_money = Format::new()
        .set_bold()
        .set_font_size(10)
        .set_num_format(&money_fmt)
        .set_background_color(Color::RGB(0xACB9CA))
        .set_align(FormatAlign::Right)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);

    let fmt_grand_fill = Format::new()
        .set_bold()
        .set_font_size(11)
        .set_background_color(Color::RGB(0xB4C6E7))
        .set_border(FormatBorder::Thin);

    let fmt_grand_money = Format::new()
        .set_bold()
        .set_font_size(11)
        .set_num_format(&money_fmt)
        .set_background_color(Color::RGB(0xB4C6E7))
        .set_align(FormatAlign::Right)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);

    let mut workbook = Workbook::new();
    let ws = workbook.add_worksheet();
    ws.set_name("Weekly Stock Sheet")
        .map_err(|e| ApiError::internal(e.to_string()))?;

    ws.set_paper_size(9); // A4
    ws.set_landscape();
    ws.set_print_fit_to_pages(1, 0);
    ws.set_margins(0.35, 0.35, 0.45, 0.45, 0.25, 0.25);
    ws.set_repeat_rows(2, 2)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let widths = [5.5, 14.0, 30.0, 10.0, 11.0, 11.0, 11.0, 11.0, 11.0, 14.0, 16.0];
    for (c, w) in widths.iter().enumerate() {
        ws.set_column_width(c as u16, *w)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }

    let banner = format!(
        "{} — WEEKLY STOCK SHEET ({} TO {})",
        settings.business_profile.name.to_ascii_uppercase(),
        report.start_date,
        report.end_date
    );
    ws.set_row_height(0, 22.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.set_row_height(1, 22.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.merge_range(0, 0, 1, 10, &banner, &fmt_title)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let headers = [
        "S/N",
        "SECTION",
        "ITEM DESCRIPTION",
        "UNIT",
        "OPENING",
        "PURCHASE",
        "AVAILABLE",
        "ISSUED",
        "CLOSING",
        "UNIT COST",
        "TOTAL VALUE",
    ];
    ws.set_row_height(2, 22.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    for (c, h) in headers.iter().enumerate() {
        ws.write_string_with_format(2, c as u16, *h, &fmt_header)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }

    let mut grouped: BTreeMap<(usize, String), Vec<&WeeklyStockSheetRowDto>> = BTreeMap::new();
    for r in &report.rows {
        grouped
            .entry(section_sort_rank(&r.section_label))
            .or_default()
            .push(r);
    }

    let mut row: u32 = 3;
    let mut section_total_rows: Vec<u32> = Vec::new();

    for ((_, sec_label), sec_rows) in grouped {
        ws.set_row_height(row, 20.0)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_blank(row, 0, &fmt_section)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_string_with_format(row, 1, &sec_label, &fmt_section)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        for c in 2..=10 {
            ws.write_blank(row, c, &fmt_section)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
        row += 1;

        let first_excel_row = row + 1;
        for (idx, item) in sec_rows.iter().enumerate() {
            let excel_row = row + 1;
            ws.set_row_height(row, 19.0)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_number_with_format(row, 0, (idx + 1) as f64, &fmt_center)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_string_with_format(row, 1, &item.section_label, &fmt_center)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_string_with_format(row, 2, &item.item_name, &fmt_text)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_string_with_format(row, 3, &item.unit_code, &fmt_center)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_number_with_format(row, 4, item.opening_milli as f64 / 1000.0, &fmt_qty)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_number_with_format(row, 5, item.purchase_milli as f64 / 1000.0, &fmt_qty)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_formula_with_format(
                row,
                6,
                format!("=E{excel_row}+F{excel_row}").as_str(),
                &fmt_qty,
            )
            .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_number_with_format(row, 7, item.issued_milli as f64 / 1000.0, &fmt_qty)
                .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_formula_with_format(
                row,
                8,
                format!("=G{excel_row}-H{excel_row}").as_str(),
                &fmt_qty,
            )
            .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_number_with_format(
                row,
                9,
                item.unit_cost_micro as f64 / 1_000_000.0,
                &fmt_money,
            )
            .map_err(|e| ApiError::internal(e.to_string()))?;
            ws.write_formula_with_format(
                row,
                10,
                format!("=I{excel_row}*J{excel_row}").as_str(),
                &fmt_money,
            )
            .map_err(|e| ApiError::internal(e.to_string()))?;
            row += 1;
        }
        let last_excel_row = row;

        // Section subtotal
        ws.set_row_height(row, 20.0)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_blank(row, 0, &fmt_sub_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        ws.write_string_with_format(row, 1, &format!("{sec_label} TOTAL"), &fmt_sub_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        for c in 2..=9 {
            ws.write_blank(row, c, &fmt_sub_fill)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
        ws.write_formula_with_format(
            row,
            10,
            format!("=SUM(K{first_excel_row}:K{last_excel_row})").as_str(),
            &fmt_sub_money,
        )
        .map_err(|e| ApiError::internal(e.to_string()))?;
        section_total_rows.push(row + 1);
        row += 1;
    }

    // Grand Total row
    row += 1;
    ws.set_row_height(row, 22.0)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_blank(row, 0, &fmt_grand_fill)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    ws.write_string_with_format(row, 1, "GRAND TOTAL", &fmt_grand_fill)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    for c in 2..=9 {
        ws.write_blank(row, c, &fmt_grand_fill)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }
    if section_total_rows.is_empty() {
        ws.write_number_with_format(row, 10, 0.0, &fmt_grand_money)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    } else {
        let sum_expr = section_total_rows
            .iter()
            .map(|r| format!("K{r}"))
            .collect::<Vec<_>>()
            .join(",");
        ws.write_formula_with_format(row, 10, format!("=SUM({sum_expr})").as_str(), &fmt_grand_money)
            .map_err(|e| ApiError::internal(e.to_string()))?;
    }

    workbook
        .save(output_path)
        .map_err(|e| ApiError::internal(format!("Failed writing weekly stock sheet Excel file: {e}")))?;

    Ok(output_path.to_string_lossy().to_string())
}
