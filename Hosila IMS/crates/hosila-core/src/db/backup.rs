use std::path::Path;
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{Connection, OpenFlags, OptionalExtension};

use crate::db::{configure_writer, migrations, Database};
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::require_admin;
use crate::types::{BackupFileDto, IntegrityReport, SessionUser};

const VALID_KINDS: &[&str] = &["manual", "auto", "pre_restore"];

fn classify_kind(filename: &str) -> String {
    if filename.starts_with("hosila_auto_") {
        "auto".to_string()
    } else if filename.starts_with("hosila_pre_restore_") {
        "pre_restore".to_string()
    } else {
        "manual".to_string()
    }
}

fn quick_check_file(path: &Path) -> AppResult<()> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut stmt = conn.prepare("PRAGMA quick_check")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if rows.is_empty() || !rows.iter().all(|s| s.eq_ignore_ascii_case("ok")) {
        return Err(ApiError::database(format!(
            "SQLite backup integrity check failed ({})",
            rows.join("; ")
        )));
    }
    let version: i32 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| {
            r.get(0)
        })
        .map_err(|e| ApiError::validation(format!("Not a valid Hosila IMS backup file: {e}")))?;
    if version < 1 {
        return Err(ApiError::validation(
            "Backup file does not contain a valid Hosila database schema.",
        ));
    }
    Ok(())
}

fn rotate_backups(backups_dir: &Path, kind: &str, keep_last: usize) -> AppResult<()> {
    if keep_last == 0 || !backups_dir.exists() {
        return Ok(());
    }
    let prefix = format!("hosila_{kind}_");
    let mut matching: Vec<(String, std::path::PathBuf)> = Vec::new();
    for entry in std::fs::read_dir(backups_dir)? {
        let entry = entry?;
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&prefix) && name.ends_with(".db") {
            matching.push((name, p));
        }
    }
    matching.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, old_path) in matching.into_iter().skip(keep_last) {
        let _ = std::fs::remove_file(old_path);
    }
    Ok(())
}

/// Runs an online hot SQLite backup via `rusqlite::backup::Backup`, verifies the
/// destination archive with `PRAGMA quick_check`, and rotates older snapshots.
pub fn create_backup(
    db: &Database,
    backups_dir: &Path,
    kind: &str,
    keep_last: usize,
) -> AppResult<BackupFileDto> {
    let clean_kind = kind.trim().to_ascii_lowercase();
    if !VALID_KINDS.contains(&clean_kind.as_str()) {
        return Err(
            ApiError::validation("Backup kind must be 'manual', 'auto', or 'pre_restore'.")
                .with_field("kind"),
        );
    }

    std::fs::create_dir_all(backups_dir)?;
    let now = Utc::now();
    let stamp = now.format("%Y%m%d_%H%M%S_%3f");
    let filename = format!("hosila_{clean_kind}_{stamp}.db");
    let target_path = backups_dir.join(&filename);

    db.with_write(|src_conn| {
        let mut dst_conn = Connection::open(&target_path)?;
        let backup = rusqlite::backup::Backup::new(src_conn, &mut dst_conn)?;
        backup.run_to_completion(100, Duration::from_millis(10), None)?;
        Ok(())
    })?;

    if let Err(err) = quick_check_file(&target_path) {
        let _ = std::fs::remove_file(&target_path);
        return Err(err);
    }

    rotate_backups(backups_dir, &clean_kind, keep_last)?;

    let size_bytes = std::fs::metadata(&target_path)?.len() as i64;
    Ok(BackupFileDto {
        filename,
        path: target_path.to_string_lossy().to_string(),
        size_bytes,
        created_at: now.to_rfc3339_opts(SecondsFormat::Secs, true),
        kind: clean_kind,
    })
}

/// Automatically captures once-per-calendar-day `"auto"` backup if none exists yet today,
/// keeping the latest 30 daily backups.
pub fn auto_backup_if_due(db: &Database, backups_dir: &Path) -> AppResult<Option<BackupFileDto>> {
    std::fs::create_dir_all(backups_dir)?;
    let today_prefix = format!("hosila_auto_{}_", Utc::now().format("%Y%m%d"));
    for entry in std::fs::read_dir(backups_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&today_prefix) && name.ends_with(".db") {
            return Ok(None);
        }
    }
    let created = create_backup(db, backups_dir, "auto", 30)?;
    Ok(Some(created))
}

pub fn list_backups(backups_dir: &Path) -> AppResult<Vec<BackupFileDto>> {
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(backups_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        if !filename.ends_with(".db") {
            continue;
        }
        let meta = entry.metadata()?;
        let created_at = meta
            .modified()
            .ok()
            .map(DateTime::<Utc>::from)
            .unwrap_or_else(Utc::now)
            .to_rfc3339_opts(SecondsFormat::Secs, true);

        entries.push(BackupFileDto {
            kind: classify_kind(&filename),
            filename,
            path: path.to_string_lossy().to_string(),
            size_bytes: meta.len() as i64,
            created_at,
        });
    }
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| b.filename.cmp(&a.filename)));
    Ok(entries)
}

/// Restores an existing validated SQLite backup into the active database after capturing a
/// `"pre_restore"` safety snapshot. Admin-only.
pub fn restore_backup(
    db: &Database,
    backups_dir: &Path,
    actor: &SessionUser,
    backup_path: &Path,
) -> AppResult<IntegrityReport> {
    require_admin(actor)?;
    if !backup_path.is_file() {
        return Err(ApiError::not_found(format!(
            "Backup file not found: {}",
            backup_path.display()
        )));
    }

    quick_check_file(backup_path)?;
    let safety = create_backup(db, backups_dir, "pre_restore", 10)?;

    db.with_write(|dst_conn| {
        {
            let src_conn =
                Connection::open_with_flags(backup_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            let backup = rusqlite::backup::Backup::new(&src_conn, dst_conn)?;
            backup.run_to_completion(100, Duration::from_millis(10), None)?;
        }
        let _ = dst_conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        migrations::run_migrations(dst_conn)?;
        configure_writer(dst_conn)?;
        Ok(())
    })?;

    db.transaction(|tx| {
        let valid_actor: Option<String> = tx
            .query_row(
                "SELECT id FROM users WHERE id = ?1",
                [&actor.id],
                |r| r.get(0),
            )
            .optional()?;

        record_activity(
            tx,
            valid_actor.as_deref(),
            "backup.restored",
            "system",
            "database",
            &format!(
                "Restored database backup '{}' (safety snapshot saved as '{}')",
                backup_path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| backup_path.display().to_string()),
                safety.filename
            ),
            serde_json::json!({
                "restored_from": backup_path.to_string_lossy(),
                "safety_backup": safety.filename,
            }),
        )?;
        Ok(())
    })?;

    db.check_integrity()
}

/// Restores a validated SQLite backup during first-time onboarding (only permitted when 0 users exist).
pub fn restore_backup_for_onboarding(
    db: &Database,
    backups_dir: &Path,
    backup_path: &Path,
) -> AppResult<IntegrityReport> {
    let user_count: i64 = db.with_read(|conn| {
        conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
            .map_err(Into::into)
    })?;
    if user_count > 0 {
        return Err(ApiError::forbidden(
            "Sign in as an administrator to restore a backup on an existing workspace.",
        ));
    }

    if !backup_path.is_file() {
        return Err(ApiError::not_found(format!(
            "Backup file not found: {}",
            backup_path.display()
        )));
    }

    quick_check_file(backup_path)?;
    let _ = create_backup(db, backups_dir, "pre_restore", 10);

    db.with_write(|dst_conn| {
        {
            let src_conn =
                Connection::open_with_flags(backup_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            let backup = rusqlite::backup::Backup::new(&src_conn, dst_conn)?;
            backup.run_to_completion(100, Duration::from_millis(10), None)?;
        }
        let _ = dst_conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        migrations::run_migrations(dst_conn)?;
        configure_writer(dst_conn)?;
        Ok(())
    })?;

    db.check_integrity()
}
