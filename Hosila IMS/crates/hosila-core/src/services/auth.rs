use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::org::{insert_department_tx, insert_store_section_tx};
use crate::services::settings::save_business_profile_tx;
use crate::types::{
    CreateUserInput, LoginInput, ManagerApprovalDto, OnboardingInput, PinLoginInput, SessionUser,
    UpdateUserInput, UserDto, UserRole,
};

const MAX_AUTH_FAILURES: u32 = 5;
const AUTH_LOCKOUT_SECS: u64 = 30;

static AUTH_ATTEMPTS: OnceLock<Mutex<HashMap<String, (u32, Instant)>>> = OnceLock::new();

fn auth_attempts_map() -> &'static Mutex<HashMap<String, (u32, Instant)>> {
    AUTH_ATTEMPTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn check_auth_throttle(key: &str) -> AppResult<()> {
    let Ok(mut map) = auth_attempts_map().lock() else {
        return Ok(());
    };
    if let Some((count, last)) = map.get(key).copied() {
        let window = Duration::from_secs(AUTH_LOCKOUT_SECS);
        if count >= MAX_AUTH_FAILURES {
            if last.elapsed() < window {
                return Err(ApiError::unauthorized(
                    "Too many failed attempts. Please wait 30 seconds and try again.",
                ));
            }
            map.remove(key);
        }
    }
    Ok(())
}

fn record_auth_failure(key: &str) {
    if let Ok(mut map) = auth_attempts_map().lock() {
        let entry = map.entry(key.to_string()).or_insert((0, Instant::now()));
        if entry.1.elapsed() >= Duration::from_secs(AUTH_LOCKOUT_SECS) && entry.0 >= MAX_AUTH_FAILURES {
            *entry = (1, Instant::now());
        } else {
            entry.0 = entry.0.saturating_add(1);
            entry.1 = Instant::now();
        }
    }
}

fn clear_auth_failures(key: &str) {
    if let Ok(mut map) = auth_attempts_map().lock() {
        map.remove(key);
    }
}

pub fn hash_secret(plain: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(plain.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| ApiError::internal(format!("Failed to hash secret: {e}")))
}

pub fn verify_secret(plain: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(plain.as_bytes(), &parsed)
        .is_ok()
}

pub fn validate_pin(pin: &str) -> AppResult<()> {
    let trimmed = pin.trim();
    if !(4..=6).contains(&trimmed.len()) || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::validation("PIN must be 4 to 6 digits.").with_field("pin"));
    }
    Ok(())
}

pub fn normalize_optional_pin(pin: Option<String>) -> AppResult<Option<String>> {
    match pin {
        None => Ok(None),
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                validate_pin(trimmed)?;
                Ok(Some(trimmed.to_string()))
            }
        }
    }
}

pub fn require_admin(actor: &SessionUser) -> AppResult<()> {
    if actor.role != UserRole::Admin {
        return Err(ApiError::forbidden("Only administrators can perform this action."));
    }
    Ok(())
}

pub fn require_operator(actor: &SessionUser) -> AppResult<()> {
    if actor.role == UserRole::Viewer {
        return Err(ApiError::forbidden(
            "Viewer accounts have read-only access and cannot modify records.",
        ));
    }
    Ok(())
}

pub fn complete_onboarding(db: &Database, input: OnboardingInput) -> AppResult<SessionUser> {
    let username = input.admin_username.trim().to_string();
    let full_name = input.admin_full_name.trim().to_string();
    if username.is_empty() {
        return Err(
            ApiError::validation("Admin username is required.").with_field("admin_username")
        );
    }
    if full_name.is_empty() {
        return Err(
            ApiError::validation("Admin full name is required.").with_field("admin_full_name")
        );
    }
    if input.admin_password.len() < 6 {
        return Err(
            ApiError::validation("Admin password must be at least 6 characters.")
                .with_field("admin_password"),
        );
    }
    let clean_pin = normalize_optional_pin(input.admin_pin)?;
    let password_hash = hash_secret(&input.admin_password)?;
    let pin_hash = clean_pin.as_deref().map(hash_secret).transpose()?;

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let admin_id = Uuid::now_v7().to_string();

    let session = db.transaction(|tx| {
        let user_count: i32 = tx.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
        if user_count > 0 {
            return Err(ApiError::conflict(
                "Initial setup has already been completed. Sign in with an existing account.",
            ));
        }

        save_business_profile_tx(tx, &input.business_profile, &now)?;

        tx.execute(
            "INSERT INTO users (id, username, full_name, password_hash, pin_hash, role, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'admin', 1, ?6, ?6)",
            params![admin_id, username, full_name, password_hash, pin_hash, now],
        )?;

        for (idx, dept) in input.departments.iter().enumerate() {
            let mut dept_input = dept.clone();
            if dept_input.sort_order.is_none() {
                dept_input.sort_order = Some((idx as i32) + 1);
            }
            insert_department_tx(tx, &dept_input, &now)?;
        }

        for (idx, section) in input.store_sections.iter().enumerate() {
            let mut sec_input = section.clone();
            if sec_input.sort_order.is_none() {
                sec_input.sort_order = Some((idx as i32) + 1);
            }
            insert_store_section_tx(tx, &sec_input, &now)?;
        }

        record_activity(
            tx,
            Some(&admin_id),
            "onboarding.completed",
            "users",
            &admin_id,
            &format!("Initial setup completed by {full_name}"),
            serde_json::json!({
                "business_name": input.business_profile.name.trim(),
                "departments_count": input.departments.len(),
                "store_sections_count": input.store_sections.len(),
            }),
        )?;

        Ok(SessionUser {
            id: admin_id.clone(),
            username: username.clone(),
            full_name: full_name.clone(),
            role: UserRole::Admin,
        })
    })?;

    tracing::info!(user_id = %session.id, username = %session.username, "Onboarding completed");
    Ok(session)
}

pub fn authenticate_password(db: &Database, input: LoginInput) -> AppResult<SessionUser> {
    let username = input.username.trim();
    if username.is_empty() || input.password.is_empty() {
        return Err(ApiError::unauthorized("Username and password are required."));
    }
    let throttle_key = format!("pw:{}", username.to_ascii_lowercase());
    check_auth_throttle(&throttle_key)?;

    let row: Option<(String, String, String, String, String, i64)> = db.with_read(|conn| {
        conn.query_row(
            "SELECT id, username, full_name, password_hash, role, is_active
             FROM users
             WHERE LOWER(username) = LOWER(?1)
             LIMIT 1",
            [username],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(Into::into)
    })?;

    let (id, uname, full_name, password_hash, role_str, is_active) = match row {
        Some(r) => r,
        None => {
            record_auth_failure(&throttle_key);
            return Err(ApiError::unauthorized("Invalid username or password."));
        }
    };

    if is_active == 0 {
        return Err(ApiError::unauthorized(
            "This user account is deactivated. Contact an administrator.",
        ));
    }

    if !verify_secret(&input.password, &password_hash) {
        record_auth_failure(&throttle_key);
        return Err(ApiError::unauthorized("Invalid username or password."));
    }
    clear_auth_failures(&throttle_key);

    let role = UserRole::parse(&role_str)?;
    let session = SessionUser {
        id: id.clone(),
        username: uname,
        full_name: full_name.clone(),
        role,
    };

    db.transaction(|tx| {
        record_activity(
            tx,
            Some(&id),
            "auth.login",
            "users",
            &id,
            &format!("{full_name} signed in"),
            serde_json::json!({ "method": "password" }),
        )
    })?;

    Ok(session)
}

pub fn authenticate_pin(db: &Database, input: PinLoginInput) -> AppResult<SessionUser> {
    let username = input.username.trim();
    if username.is_empty() {
        return Err(ApiError::unauthorized("Username is required."));
    }
    validate_pin(&input.pin)?;
    let throttle_key = format!("pin:{}", username.to_ascii_lowercase());
    check_auth_throttle(&throttle_key)?;

    let row: Option<(String, String, String, Option<String>, String, i64)> = db.with_read(|conn| {
        conn.query_row(
            "SELECT id, username, full_name, pin_hash, role, is_active
             FROM users
             WHERE LOWER(username) = LOWER(?1)
             LIMIT 1",
            [username],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(Into::into)
    })?;

    let (id, uname, full_name, pin_hash, role_str, is_active) = match row {
        Some(r) => r,
        None => {
            record_auth_failure(&throttle_key);
            return Err(ApiError::unauthorized("Invalid username or PIN."));
        }
    };

    if is_active == 0 {
        return Err(ApiError::unauthorized(
            "This user account is deactivated. Contact an administrator.",
        ));
    }

    let stored_pin = pin_hash.ok_or_else(|| {
        ApiError::unauthorized("Quick PIN is not configured for this user.")
    })?;

    if !verify_secret(input.pin.trim(), &stored_pin) {
        record_auth_failure(&throttle_key);
        return Err(ApiError::unauthorized("Invalid username or PIN."));
    }
    clear_auth_failures(&throttle_key);

    let role = UserRole::parse(&role_str)?;
    let session = SessionUser {
        id: id.clone(),
        username: uname,
        full_name: full_name.clone(),
        role,
    };

    db.transaction(|tx| {
        record_activity(
            tx,
            Some(&id),
            "auth.login",
            "users",
            &id,
            &format!("{full_name} signed in with PIN"),
            serde_json::json!({ "method": "pin" }),
        )
    })?;

    Ok(session)
}

pub fn verify_manager_pin(db: &Database, pin: &str) -> AppResult<ManagerApprovalDto> {
    validate_pin(pin)?;
    let throttle_key = "mgr_pin";
    check_auth_throttle(throttle_key)?;

    let admins: Vec<(String, String, String)> = db.with_read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, full_name, pin_hash
             FROM users
             WHERE role = 'admin' AND is_active = 1 AND pin_hash IS NOT NULL",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })?;

    let trimmed = pin.trim();
    for (id, full_name, hash) in admins {
        if verify_secret(trimmed, &hash) {
            clear_auth_failures(throttle_key);
            return Ok(ManagerApprovalDto {
                manager_user_id: id,
                manager_name: full_name,
            });
        }
    }

    record_auth_failure(throttle_key);
    Err(ApiError::unauthorized(
        "Manager PIN did not match any active administrator.",
    ))
}

pub fn verify_storekeeper_pin(db: &Database, pin: &str) -> AppResult<String> {
    validate_pin(pin)?;
    let throttle_key = "sk_pin";
    check_auth_throttle(throttle_key)?;

    let operators: Vec<(String, String)> = db.with_read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, pin_hash
             FROM users
             WHERE role IN ('admin', 'storekeeper') AND is_active = 1 AND pin_hash IS NOT NULL",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })?;

    let trimmed = pin.trim();
    for (id, hash) in operators {
        if verify_secret(trimmed, &hash) {
            clear_auth_failures(throttle_key);
            return Ok(id);
        }
    }

    record_auth_failure(throttle_key);
    Err(ApiError::unauthorized(
        "Storekeeper PIN did not match any active storekeeper or administrator.",
    ))
}

pub fn list_users(db: &Database) -> AppResult<Vec<UserDto>> {
    db.with_read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, username, full_name, role, is_active, pin_hash IS NOT NULL, created_at, updated_at
             FROM users
             ORDER BY is_active DESC, full_name ASC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let role_str: String = r.get(3)?;
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    role_str,
                    r.get::<_, i64>(4)? != 0,
                    r.get::<_, i64>(5)? != 0,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        rows.into_iter()
            .map(
                |(id, username, full_name, role_str, is_active, has_pin, created_at, updated_at)| {
                    Ok(UserDto {
                        id,
                        username,
                        full_name,
                        role: UserRole::parse(&role_str)?,
                        is_active,
                        has_pin,
                        created_at,
                        updated_at,
                    })
                },
            )
            .collect()
    })
}

pub fn create_user(
    db: &Database,
    actor: &SessionUser,
    input: CreateUserInput,
) -> AppResult<UserDto> {
    require_admin(actor)?;
    let username = input.username.trim().to_string();
    let full_name = input.full_name.trim().to_string();
    if username.is_empty() {
        return Err(ApiError::validation("Username is required.").with_field("username"));
    }
    if full_name.is_empty() {
        return Err(ApiError::validation("Full name is required.").with_field("full_name"));
    }
    if input.password.len() < 6 {
        return Err(
            ApiError::validation("Password must be at least 6 characters.").with_field("password"),
        );
    }
    let clean_pin = normalize_optional_pin(input.pin)?;
    let password_hash = hash_secret(&input.password)?;
    let pin_hash = clean_pin.as_deref().map(hash_secret).transpose()?;
    let has_pin = pin_hash.is_some();

    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let dup: Option<String> = tx
            .query_row(
                "SELECT id FROM users WHERE LOWER(username) = LOWER(?1)",
                [&username],
                |r| r.get(0),
            )
            .optional()?;
        if dup.is_some() {
            return Err(
                ApiError::conflict(format!("Username '{username}' is already taken."))
                    .with_field("username"),
            );
        }

        tx.execute(
            "INSERT INTO users (id, username, full_name, password_hash, pin_hash, role, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            params![id, username, full_name, password_hash, pin_hash, input.role.as_str(), now],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "user.created",
            "users",
            &id,
            &format!("Created user {full_name} (@{username}, {})", input.role.as_str()),
            serde_json::json!({ "role": input.role.as_str() }),
        )?;

        Ok(UserDto {
            id: id.clone(),
            username: username.clone(),
            full_name: full_name.clone(),
            role: input.role,
            is_active: true,
            has_pin,
            created_at: now.clone(),
            updated_at: now.clone(),
        })
    })
}

pub fn update_user(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    input: UpdateUserInput,
) -> AppResult<UserDto> {
    require_admin(actor)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let existing: Option<(String, String, String, bool, bool, String)> = tx
            .query_row(
                "SELECT username, full_name, role, is_active, pin_hash IS NOT NULL, created_at
                 FROM users WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get::<_, i64>(3)? != 0,
                        r.get::<_, i64>(4)? != 0,
                        r.get(5)?,
                    ))
                },
            )
            .optional()?;

        let (username, old_name, old_role_str, old_active, has_pin, created_at) =
            existing.ok_or_else(|| ApiError::not_found("User account not found."))?;
        let old_role = UserRole::parse(&old_role_str)?;

        let new_name = match input.full_name {
            Some(n) => {
                let t = n.trim().to_string();
                if t.is_empty() {
                    return Err(
                        ApiError::validation("Full name cannot be empty.").with_field("full_name")
                    );
                }
                t
            }
            None => old_name,
        };
        let new_role = input.role.unwrap_or(old_role);
        let new_active = input.is_active.unwrap_or(old_active);

        if old_role == UserRole::Admin
            && old_active
            && (new_role != UserRole::Admin || !new_active)
        {
            let other_active_admins: i32 = tx.query_row(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?1",
                [id],
                |r| r.get(0),
            )?;
            if other_active_admins == 0 {
                return Err(ApiError::conflict(
                    "Cannot deactivate or demote the last active administrator.",
                ));
            }
        }

        tx.execute(
            "UPDATE users SET full_name = ?1, role = ?2, is_active = ?3, updated_at = ?4 WHERE id = ?5",
            params![
                new_name,
                new_role.as_str(),
                if new_active { 1 } else { 0 },
                now,
                id
            ],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "user.updated",
            "users",
            id,
            &format!("Updated user {new_name} (@{username})"),
            serde_json::json!({ "role": new_role.as_str(), "is_active": new_active }),
        )?;

        Ok(UserDto {
            id: id.to_string(),
            username,
            full_name: new_name,
            role: new_role,
            is_active: new_active,
            has_pin,
            created_at,
            updated_at: now.clone(),
        })
    })
}

pub fn reset_user_password(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    new_password: &str,
) -> AppResult<()> {
    if actor.role != UserRole::Admin && actor.id != id {
        return Err(ApiError::forbidden(
            "Only administrators or the account owner can reset this password.",
        ));
    }
    if new_password.len() < 6 {
        return Err(
            ApiError::validation("Password must be at least 6 characters.")
                .with_field("new_password"),
        );
    }

    let password_hash = hash_secret(new_password)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let full_name: Option<String> = tx
            .query_row("SELECT full_name FROM users WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        let full_name =
            full_name.ok_or_else(|| ApiError::not_found("User account not found."))?;

        tx.execute(
            "UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3",
            params![password_hash, now, id],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "user.password_reset",
            "users",
            id,
            &format!("Password updated for {full_name}"),
            serde_json::json!({}),
        )?;

        Ok(())
    })
}

pub fn set_user_pin(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    pin: Option<String>,
) -> AppResult<()> {
    if actor.role != UserRole::Admin && actor.id != id {
        return Err(ApiError::forbidden(
            "Only administrators or the account owner can change this PIN.",
        ));
    }
    let clean_pin = normalize_optional_pin(pin)?;
    let pin_hash = clean_pin.as_deref().map(hash_secret).transpose()?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let full_name: Option<String> = tx
            .query_row("SELECT full_name FROM users WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        let full_name =
            full_name.ok_or_else(|| ApiError::not_found("User account not found."))?;

        tx.execute(
            "UPDATE users SET pin_hash = ?1, updated_at = ?2 WHERE id = ?3",
            params![pin_hash, now, id],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "user.pin_updated",
            "users",
            id,
            &format!(
                "{} quick PIN for {full_name}",
                if pin_hash.is_some() { "Updated" } else { "Cleared" }
            ),
            serde_json::json!({ "has_pin": pin_hash.is_some() }),
        )?;

        Ok(())
    })
}
