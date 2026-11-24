pub mod procurement_parser;
pub mod weekly_sheet;

use calamine::Data;

pub fn cell_to_trimmed_string(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.trim().to_string(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            if (f.fract()).abs() < 1e-9 {
                format!("{}", *f as i64)
            } else {
                format!("{f}")
            }
        }
        Data::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.trim().to_string(),
        _ => String::new(),
    }
}

pub fn cell_to_f64(cell: &Data) -> Option<f64> {
    match cell {
        Data::Float(f) => Some(*f),
        Data::Int(i) => Some(*i as f64),
        Data::String(s) => {
            let cleaned = s.trim().replace(',', "").replace('₦', "");
            if cleaned.is_empty() || cleaned == "-" {
                None
            } else {
                cleaned.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

pub fn f64_to_scaled_i64(val: f64, scale: f64) -> i64 {
    (val * scale).round() as i64
}

pub fn normalize_unit_code(raw: &str) -> &'static str {
    let u = raw.trim().to_ascii_uppercase();
    match u.as_str() {
        "" | "PCS" | "PC" | "PIECE" | "PIECES" | "UNIT" | "UNITS" => "PCS",
        "BOTTLE" | "BOTTLES" | "BTL" | "BTLS" => "BTL",
        "CAN" | "CANS" => "CAN",
        "TIN" | "TINS" => "TIN",
        "SACHET" | "SACHETS" => "SACHET",
        "ROLL" | "ROLLS" => "ROLL",
        "LOAF" | "LOAFS" | "LOAVES" => "LOAF",
        "REAM" | "REAMS" => "REAM",
        "CUBE" | "CUBES" => "CUBE",
        "DOZEN" | "DOZENS" | "DOZ" => "DOZEN",
        "PACK" | "PACKS" | "PKT" | "PKTS" => "PACK",
        "CRATE" | "CRATES" => "CRATE",
        "CARTON" | "CARTONS" | "CTN" | "CTNS" => "CARTON",
        "BAG" | "BAGS" => "BAG",
        "PORTION" | "PORTIONS" => "PORTION",
        "PAINT" | "PAINTS" => "PAINT",
        "CUP" | "CUPS" => "CUP",
        "HEAD" | "HEADS" => "HEAD",
        "BALL" | "BALLS" => "BALL",
        "BASKET" | "BASKETS" => "BASKET",
        "PLASTIC" | "PLASTICS" => "PLASTIC",
        "TUBER" | "TUBERS" => "TUBER",
        "WHOLE" | "WHOLES" => "WHOLE",
        "G" | "GRAM" | "GRAMS" => "G",
        "KG" | "KILO" | "KILOGRAM" | "KILOGRAMS" => "KG",
        "ML" | "MILLILITRE" | "MILLILITRES" | "MILLILITER" | "MILLILITERS" => "ML",
        "L" | "LITRE" | "LITRES" | "LITER" | "LITERS" => "L",
        "CM" | "CENTIMETRE" | "CENTIMETRES" => "CM",
        "M" | "METRE" | "METRES" | "METER" | "METERS" => "M",
        _ => "PCS",
    }
}

pub fn normalize_name_key(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase()
}
