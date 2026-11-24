use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Transaction};
use uuid::Uuid;

use crate::error::AppResult;

pub fn record_activity(
    tx: &Transaction<'_>,
    user_id: Option<&str>,
    action: &str,
    entity: &str,
    entity_id: &str,
    summary: &str,
    meta: serde_json::Value,
) -> AppResult<()> {
    let id = Uuid::now_v7().to_string();
    let at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    tx.execute(
        "INSERT INTO activity_log (id, at, user_id, action, entity, entity_id, summary, meta_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, at, user_id, action, entity, entity_id, summary, meta.to_string()],
    )?;
    Ok(())
}
