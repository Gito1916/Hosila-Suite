pub mod db;
pub mod domain;
pub mod error;
pub mod export;
pub mod license;
pub mod parser;
pub mod paths;
pub mod seed;
pub mod services;
pub mod types;

use crate::db::Database;
use crate::error::AppResult;
use crate::paths::AppPaths;
use crate::types::{IntegrityReport, SystemInfo, UnitDto};

pub fn get_system_info(
    db: &Database,
    paths: &AppPaths,
    app_version: &str,
    integrity: IntegrityReport,
) -> AppResult<SystemInfo> {
    let schema_version = db.schema_version()?;
    let (user_count, item_count, unit_count) = db.with_read(|conn| {
        let users: i32 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
        let items: i32 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))?;
        let units: i32 = conn.query_row("SELECT COUNT(*) FROM units", [], |r| r.get(0))?;
        Ok((users, items, units))
    })?;

    Ok(SystemInfo {
        app_version: app_version.to_string(),
        run_mode: paths.mode,
        db_path: paths.db_path.to_string_lossy().to_string(),
        is_network_path: paths.is_network_path,
        schema_version,
        needs_onboarding: user_count == 0,
        user_count,
        item_count,
        unit_count,
        integrity,
    })
}

pub fn list_units(db: &Database) -> AppResult<Vec<UnitDto>> {
    services::units::list_units(db)
}
