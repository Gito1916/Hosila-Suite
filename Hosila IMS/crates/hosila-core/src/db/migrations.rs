use chrono::{SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

use crate::error::{ApiError, AppResult};

pub const MIGRATIONS: &[(i64, &str, &str)] = &[(
    1,
    "0001_initial_schema",
    include_str!("../../../../migrations/0001_initial_schema.sql"),
)];

/// Deterministic 64-bit FNV-1a hex checksum for migration integrity verification.
pub fn fnv1a_checksum(sql: &str) -> String {
    let normalized = sql.replace("\r\n", "\n");
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in normalized.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

pub fn run_migrations(conn: &mut Connection) -> AppResult<i32> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )?;

    let mut latest_version: i32 = 0;

    for &(version, name, sql) in MIGRATIONS {
        let expected_checksum = fnv1a_checksum(sql);
        let existing: Option<(String, String)> = conn
            .query_row(
                "SELECT name, checksum FROM schema_migrations WHERE version = ?1",
                [version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;

        if let Some((applied_name, applied_checksum)) = existing {
            if applied_name != name || applied_checksum != expected_checksum {
                return Err(ApiError::database(format!(
                    "Migration v{version} ({name}) checksum mismatch: expected {expected_checksum}, found {applied_checksum}."
                )));
            }
            latest_version = latest_version.max(version as i32);
            continue;
        }

        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(sql)?;
        let applied_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        tx.execute(
            "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![version, name, expected_checksum, applied_at],
        )?;
        tx.commit()?;
        latest_version = latest_version.max(version as i32);
    }

    Ok(latest_version)
}
