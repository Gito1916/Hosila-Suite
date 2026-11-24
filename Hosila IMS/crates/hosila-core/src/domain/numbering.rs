use rusqlite::{OptionalExtension, Transaction};

use crate::error::{ApiError, AppResult};

pub fn format_doc_number(prefix: &str, year: i32, seq: i64) -> String {
    format!("{prefix}-{year}-{seq:06}")
}

/// Atomically allocates and increments the next sequential document number for `doc_type`.
pub fn next_doc_number(tx: &Transaction<'_>, doc_type: &str, year: i32) -> AppResult<String> {
    let row: Option<(String, i64)> = tx
        .query_row(
            "SELECT prefix, next_value FROM doc_sequences WHERE doc_type = ?1",
            [doc_type],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;

    let (prefix, seq) = row.ok_or_else(|| {
        ApiError::not_found(format!("Document sequence '{doc_type}' is not configured."))
    })?;

    tx.execute(
        "UPDATE doc_sequences SET next_value = next_value + 1 WHERE doc_type = ?1",
        [doc_type],
    )?;

    Ok(format_doc_number(&prefix, year, seq))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::seed::seed_system_defaults;

    #[test]
    fn formats_and_increments_sequentially() {
        assert_eq!(format_doc_number("COL", 2026, 1), "COL-2026-000001");
        assert_eq!(format_doc_number("GRN", 2026, 42), "GRN-2026-000042");

        let db = Database::open_in_memory().unwrap();
        seed_system_defaults(&db).unwrap();

        let (n1, n2) = db
            .transaction(|tx| {
                let first = next_doc_number(tx, "collection", 2026)?;
                let second = next_doc_number(tx, "collection", 2026)?;
                Ok((first, second))
            })
            .unwrap();

        assert_eq!(n1, "COL-2026-000001");
        assert_eq!(n2, "COL-2026-000002");
    }
}
