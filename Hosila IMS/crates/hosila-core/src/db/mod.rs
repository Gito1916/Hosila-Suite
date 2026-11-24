pub mod backup;
pub mod migrations;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, Transaction, TransactionBehavior};

use crate::error::{ApiError, AppResult};
use crate::types::IntegrityReport;

pub struct Database {
    writer: Mutex<Connection>,
    readers: Option<Pool<SqliteConnectionManager>>,
    db_path: Option<PathBuf>,
}

impl Database {
    /// Opens or creates a file-backed SQLite database in WAL mode and runs embedded migrations.
    pub fn open_file(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut writer = Connection::open(path)?;
        configure_writer(&writer)?;
        migrations::run_migrations(&mut writer)?;

        let manager = SqliteConnectionManager::file(path).with_init(|conn| {
            conn.busy_timeout(Duration::from_millis(5000))?;
            conn.execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA query_only = ON;",
            )?;
            Ok(())
        });

        let pool = Pool::builder()
            .max_size(6)
            .build(manager)
            .map_err(|e| ApiError::database(format!("Failed to initialize SQLite read pool: {e}")))?;

        Ok(Self {
            writer: Mutex::new(writer),
            readers: Some(pool),
            db_path: Some(path.to_path_buf()),
        })
    }

    /// Opens an isolated in-memory SQLite database (used in unit tests).
    pub fn open_in_memory() -> AppResult<Self> {
        let mut writer = Connection::open_in_memory()?;
        configure_writer(&writer)?;
        migrations::run_migrations(&mut writer)?;

        Ok(Self {
            writer: Mutex::new(writer),
            readers: None,
            db_path: None,
        })
    }

    pub fn db_path(&self) -> Option<&Path> {
        self.db_path.as_deref()
    }

    pub fn with_read<F, R>(&self, f: F) -> AppResult<R>
    where
        F: FnOnce(&Connection) -> AppResult<R>,
    {
        if let Some(pool) = &self.readers {
            let conn = pool.get()?;
            f(&conn)
        } else {
            let guard = self
                .writer
                .lock()
                .map_err(|_| ApiError::internal("Database writer lock poisoned"))?;
            f(&guard)
        }
    }

    pub fn with_write<F, R>(&self, f: F) -> AppResult<R>
    where
        F: FnOnce(&mut Connection) -> AppResult<R>,
    {
        let mut guard = self
            .writer
            .lock()
            .map_err(|_| ApiError::internal("Database writer lock poisoned"))?;
        f(&mut guard)
    }

    pub fn transaction<F, R>(&self, f: F) -> AppResult<R>
    where
        F: FnOnce(&Transaction<'_>) -> AppResult<R>,
    {
        self.with_write(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let result = f(&tx)?;
            tx.commit()?;
            Ok(result)
        })
    }

    pub fn schema_version(&self) -> AppResult<i32> {
        self.with_read(|conn| {
            let v: Option<i32> = conn.query_row(
                "SELECT MAX(version) FROM schema_migrations",
                [],
                |row| row.get(0),
            )?;
            Ok(v.unwrap_or(0))
        })
    }

    /// Runs `PRAGMA quick_check` and reconciles cached `items.on_hand_milli` against `stock_movements`.
    pub fn check_integrity(&self) -> AppResult<IntegrityReport> {
        self.with_read(|conn| {
            let mut stmt = conn.prepare("PRAGMA quick_check")?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            let quick_check = if rows.is_empty() {
                "unknown".to_string()
            } else {
                rows.join("; ")
            };

            let ledger_mismatches: i32 = conn.query_row(
                "SELECT COUNT(*) FROM items i
                 WHERE i.on_hand_milli != COALESCE(
                     (SELECT SUM(m.qty_milli) FROM stock_movements m WHERE m.item_id = i.id),
                     0
                 )",
                [],
                |row| row.get(0),
            )?;

            let ok = quick_check.eq_ignore_ascii_case("ok") && ledger_mismatches == 0;
            Ok(IntegrityReport {
                ok,
                sqlite_quick_check: quick_check,
                ledger_mismatches,
                checked_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            })
        })
    }
}

pub(crate) fn configure_writer(conn: &Connection) -> AppResult<()> {
    conn.busy_timeout(Duration::from_millis(5000))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seed::{seed_dev_demo, seed_system_defaults};
    use tempfile::tempdir;

    #[test]
    fn file_db_enables_wal_and_migrations_are_idempotent() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        let db = Database::open_file(&db_path).unwrap();
        assert_eq!(db.schema_version().unwrap(), 1);

        let journal_mode: String = db
            .with_read(|c| {
                c.query_row("PRAGMA journal_mode", [], |r| r.get(0))
                    .map_err(Into::into)
            })
            .unwrap();
        assert_eq!(journal_mode.to_lowercase(), "wal");

        // Verify FTS5 virtual table is operational
        db.with_write(|c| {
            c.execute(
                "INSERT INTO items_fts (item_id, name, sku, aliases) VALUES (?1, ?2, ?3, ?4)",
                ["item-1", "Basmati Rice", "SKU-001", "basmatic rice"],
            )?;
            Ok(())
        })
        .unwrap();

        let count: i64 = db
            .with_read(|c| {
                c.query_row(
                    "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'basmatic'",
                    [],
                    |r| r.get(0),
                )
                .map_err(Into::into)
            })
            .unwrap();
        assert_eq!(count, 1);

        drop(db);

        // Re-opening runs migrations again idempotently
        let db2 = Database::open_file(&db_path).unwrap();
        assert_eq!(db2.schema_version().unwrap(), 1);
    }

    #[test]
    fn integrity_check_detects_clean_and_corrupt_ledger_balances() {
        let db = Database::open_in_memory().unwrap();
        seed_system_defaults(&db).unwrap();
        seed_dev_demo(&db).unwrap();

        let report = db.check_integrity().unwrap();
        assert!(report.ok);
        assert_eq!(report.sqlite_quick_check, "ok");
        assert_eq!(report.ledger_mismatches, 0);

        // Introduce an artificial cached balance mismatch without a movement row
        db.with_write(|c| {
            c.execute(
                "UPDATE items SET on_hand_milli = on_hand_milli + 5000 WHERE sku = 'DEMO-001'",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        let bad_report = db.check_integrity().unwrap();
        assert!(!bad_report.ok);
        assert_eq!(bad_report.ledger_mismatches, 1);
    }
}
