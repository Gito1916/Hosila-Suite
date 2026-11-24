use std::collections::BTreeMap;

use crate::db::Database;
use crate::domain::money::{round_div_half_even, MILLI_SCALE};
use crate::domain::uom::format_qty_milli;
use crate::error::AppResult;
use crate::services::procurement::{get_procurement_list, section_sort_rank};
use crate::services::settings::get_settings;
use crate::types::ProcurementLineDto;

fn html_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn format_minor(minor: i64, symbol: &str) -> String {
    let sign = if minor < 0 { "-" } else { "" };
    let abs = minor.unsigned_abs();
    let major = abs / 100;
    let cents = abs % 100;
    let major_str = major.to_string();
    let mut grouped = String::with_capacity(major_str.len() + major_str.len() / 3);
    for (idx, ch) in major_str.chars().rev().enumerate() {
        if idx > 0 && idx % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    let formatted_major: String = grouped.chars().rev().collect();
    format!("{sign}{symbol}{formatted_major}.{cents:02}")
}

fn estimate_line_minor(line: &ProcurementLineDto) -> i64 {
    let qty = line.ordered_qty_milli.unwrap_or(line.suggested_qty_milli);
    if let Some(cost) = line.est_unit_cost_minor {
        round_div_half_even((qty as i128) * (cost as i128), MILLI_SCALE as i128) as i64
    } else {
        line.budget_amount_minor.unwrap_or(0)
    }
}

/// Renders an A4 print-ready HTML document for a procurement list.
pub fn render_procurement_print_html(db: &Database, list_id: &str) -> AppResult<String> {
    let list = get_procurement_list(db, list_id)?;
    let settings = get_settings(db)?;
    let sym = &settings.business_profile.currency_symbol;

    let mut grouped: BTreeMap<(usize, String), Vec<&ProcurementLineDto>> = BTreeMap::new();
    for line in &list.lines {
        grouped
            .entry(section_sort_rank(&line.section_label))
            .or_default()
            .push(line);
    }

    let mut rows_html = String::new();
    let mut summary_rows_html = String::new();
    let mut grand_total_minor: i64 = 0;

    for ((_, section), lines) in grouped {
        rows_html.push_str(&format!(
            "<tr class=\"section-row\"><td colspan=\"6\">{}</td></tr>\n",
            html_escape(&section)
        ));
        let mut section_total: i64 = 0;
        for (idx, line) in lines.iter().enumerate() {
            let qty_milli = line.ordered_qty_milli.unwrap_or(line.suggested_qty_milli);
            let amt = estimate_line_minor(line);
            section_total += amt;
            let vol = line.unit_code.as_deref().unwrap_or(&line.base_unit_code);
            let unit_price_cell = match line.est_unit_cost_minor {
                Some(c) => format_minor(c, sym),
                None => "—".to_string(),
            };
            rows_html.push_str(&format!(
                "<tr><td class=\"c\">{}</td><td>{}</td><td class=\"c\">{}</td><td class=\"c num\">{}</td><td class=\"r num\">{}</td><td class=\"r num\">{}</td></tr>\n",
                idx + 1,
                html_escape(&line.item_name),
                html_escape(vol),
                format_qty_milli(qty_milli),
                html_escape(&unit_price_cell),
                html_escape(&format_minor(amt, sym)),
            ));
        }
        grand_total_minor += section_total;
        rows_html.push_str(&format!(
            "<tr class=\"total-row\"><td></td><td>TOTAL ({})</td><td></td><td></td><td></td><td class=\"r num\">{}</td></tr>\n",
            html_escape(&section),
            html_escape(&format_minor(section_total, sym))
        ));
        summary_rows_html.push_str(&format!(
            "<tr><td>{}</td><td class=\"r num\">{}</td></tr>\n",
            html_escape(&section),
            html_escape(&format_minor(section_total, sym))
        ));
    }

    for extra in &list.extra_charges {
        grand_total_minor += extra.amount_minor;
        summary_rows_html.push_str(&format!(
            "<tr><td>{}</td><td class=\"r num\">{}</td></tr>\n",
            html_escape(&extra.label),
            html_escape(&format_minor(extra.amount_minor, sym))
        ));
    }

    let doc = format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{title} — {number}</title>
<style>
  @page {{ size: A4 portrait; margin: 12mm; }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #111827;
    font-size: 11px;
    line-height: 1.35;
    margin: 0;
  }}
  .header {{
    border-bottom: 2px solid #21C29C;
    padding-bottom: 8px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }}
  .header h1 {{ font-size: 16px; margin: 0 0 2px; }}
  .meta {{ color: #4B5563; font-size: 10px; }}
  table {{ width: 100%; border-collapse: collapse; margin-bottom: 14px; }}
  th, td {{ border: 1px solid #D1D5DB; padding: 4px 6px; }}
  th {{ background: #E5E7EB; text-align: center; font-weight: 600; }}
  .section-row td {{ background: #F3F4F6; font-weight: 700; letter-spacing: 0.03em; }}
  .total-row td {{ background: #E5EDF6; font-weight: 700; }}
  .c {{ text-align: center; }}
  .r {{ text-align: right; }}
  .num {{ font-variant-numeric: tabular-nums; }}
  .summary {{ width: 55%; margin-left: auto; }}
  .summary .grand td {{ background: #DCE7F7; font-weight: 700; font-size: 12px; }}
  .sigs {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 18px;
    margin-top: 24px;
  }}
  .sig-box {{ border-top: 1px solid #9CA3AF; padding-top: 4px; font-size: 10px; color: #374151; }}
  @media print {{ body {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }} }}
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>{biz} — {title}</h1>
      <div class="meta">List #{number} · Prepared by {prep} · Status: {status}</div>
    </div>
    <div class="meta">{date}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 36px;">S/N</th>
        <th>DESCRIPTION</th>
        <th style="width: 78px;">VOLUME</th>
        <th style="width: 68px;">QTY</th>
        <th style="width: 92px;">UNIT PRICE</th>
        <th style="width: 102px;">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      {rows_html}
    </tbody>
  </table>

  <table class="summary">
    <thead>
      <tr><th colspan="2">SUMMARY</th></tr>
    </thead>
    <tbody>
      {summary_rows_html}
      <tr class="grand"><td>GRAND TOTAL</td><td class="r num">{grand_total}</td></tr>
      <tr><td>DISBURSEMENT</td><td class="r num"></td></tr>
      <tr><td>ACTUAL EXP.</td><td class="r num"></td></tr>
      <tr><td>REFUNDED TO CASH CONTROLLER</td><td class="r num"></td></tr>
    </tbody>
  </table>

  <div class="sigs">
    <div class="sig-box">Prepared By ({prep})</div>
    <div class="sig-box">Approved By</div>
    <div class="sig-box">Storekeeper Received &amp; Date</div>
  </div>
</body>
</html>
"#,
        title = html_escape(&list.title),
        number = html_escape(&list.number),
        biz = html_escape(&settings.business_profile.name),
        prep = html_escape(&list.prepared_by_name),
        status = html_escape(&list.status),
        date = html_escape(&list.created_at.chars().take(10).collect::<String>()),
        rows_html = rows_html,
        summary_rows_html = summary_rows_html,
        grand_total = html_escape(&format_minor(grand_total_minor, sym)),
    );

    Ok(doc)
}
