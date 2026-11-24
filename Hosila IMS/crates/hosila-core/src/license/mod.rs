use std::sync::OnceLock;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::Database;
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::require_admin;
use crate::types::{LicenseStatusDto, SessionUser};

const TRIAL_DAYS: i64 = 14;
const GRACE_DAYS: i64 = 30;
pub const CURRENT_PRODUCT_ID: &str = "hosila-ims";
pub const CURRENT_PRODUCT_NAME: &str = "Hosila IMS";

/// Embedded Hosila Suite Master Ed25519 verifying key (`hosila-master-public.pem`).
/// Private signing key stays strictly inside `hosila-keygen`.
pub const HOSILA_PUBLIC_KEY_BYTES: [u8; 32] = [
    0x47, 0x6e, 0xd7, 0x54, 0x0c, 0x59, 0x10, 0x57, 0x0e, 0xcf, 0xd7, 0x92, 0x16, 0x44, 0x7e, 0x5b,
    0xa0, 0xdd, 0x45, 0x6e, 0x05, 0x01, 0x92, 0x91, 0xaa, 0x3b, 0x6d, 0xc3, 0x81, 0x22, 0x5f, 0x33,
];

/// Exact payload schema issued by `hosila-keygen` (`HSL1.<b64url(json)>.<b64url(sig)>`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicensePayload {
    #[serde(default = "default_version")]
    pub v: u32,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub product: Option<String>,
    #[serde(rename = "type")]
    pub license_type: String, // "commercial" | "master"
    #[serde(rename = "machineId")]
    pub machine_id: String, // "HSLA-XXXX-XXXX-XXXX" or "*" (master only)
    #[serde(rename = "hotelName")]
    pub hotel_name: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<String>,
}

fn default_version() -> u32 {
    1
}

fn node_compatible_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "x86" => "ia32",
        "aarch64" => "arm64",
        other => other,
    }
}

fn read_windows_machine_guid() -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            if line.contains("MachineGuid") {
                if let Some(val) = line.split_whitespace().last() {
                    let clean = val.trim().to_ascii_lowercase();
                    if !clean.is_empty() {
                        return Some(clean);
                    }
                }
            }
        }
    }
    None
}

static CACHED_FINGERPRINT: OnceLock<String> = OnceLock::new();

/// Computes the exact Hosila Suite Host PC Machine ID (`HSLA-XXXX-XXXX-XXXX`),
/// matching `hosila-keygen` / `HOSILA_ACTIVATION_ENGINE_SPEC.md`.
pub fn machine_fingerprint() -> String {
    CACHED_FINGERPRINT
        .get_or_init(|| {
            let arch = node_compatible_arch();
            let seed = if let Some(win_guid) = read_windows_machine_guid() {
                format!("hosila-win-v1|{win_guid}|{arch}")
            } else {
                let host = std::env::var("COMPUTERNAME")
                    .or_else(|_| std::env::var("HOSTNAME"))
                    .unwrap_or_else(|_| "hosila-host".to_string())
                    .to_ascii_lowercase();
                let cpu = std::env::var("PROCESSOR_IDENTIFIER")
                    .unwrap_or_default()
                    .trim()
                    .to_ascii_lowercase();
                format!("hosila-gen-v1|{host}|{arch}|{cpu}|")
            };

            let digest = Sha256::digest(seed.as_bytes());
            let hex: String = digest.iter().take(6).map(|b| format!("{b:02X}")).collect();
            format!("HSLA-{}-{}-{}", &hex[0..4], &hex[4..8], &hex[8..12])
        })
        .clone()
}

pub fn default_verifying_key() -> AppResult<VerifyingKey> {
    VerifyingKey::from_bytes(&HOSILA_PUBLIC_KEY_BYTES)
        .map_err(|e| ApiError::internal(format!("Invalid embedded Hosila verifying key: {e}")))
}

/// Signs a `LicensePayload` into the exact `hosila-keygen` format (`HSL1.<b64url>.<b64url>`),
/// signing the UTF-8 bytes of `HSL1.<payload_b64>`.
pub fn sign_license_payload(signing_key: &SigningKey, payload: &LicensePayload) -> AppResult<String> {
    let payload_bytes = serde_json::to_vec(payload)?;
    let payload_b64 = URL_SAFE_NO_PAD.encode(&payload_bytes);
    let signing_input = format!("HSL1.{payload_b64}");
    let sig = signing_key.sign(signing_input.as_bytes());
    let sig_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());
    Ok(format!("HSL1.{payload_b64}.{sig_b64}"))
}

pub fn verify_license_key_with_verifying_key(
    key_str: &str,
    verifying_key: &VerifyingKey,
    expected_fingerprint: &str,
) -> AppResult<LicensePayload> {
    let cleaned: String = key_str.chars().filter(|c| !c.is_whitespace()).collect();
    let parts: Vec<&str> = cleaned.split('.').collect();
    if parts.len() != 3 || parts[0] != "HSL1" {
        return Err(ApiError::license_invalid(
            "Invalid activation key format. Keys must begin with 'HSL1.'.",
        ));
    }

    let payload_b64 = parts[1];
    let sig_b64 = parts[2];

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|_| ApiError::license_invalid("Activation key payload is malformed."))?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|_| ApiError::license_invalid("Activation key signature is malformed."))?;
    let sig_arr: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| ApiError::license_invalid("Activation key signature has invalid length."))?;
    let signature = Signature::from_bytes(&sig_arr);

    let signing_input = format!("HSL1.{payload_b64}");
    verifying_key
        .verify(signing_input.as_bytes(), &signature)
        .map_err(|_| ApiError::license_invalid("Invalid activation key signature."))?;

    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| ApiError::license_invalid("Activation key payload JSON could not be parsed."))?;

    let key_product = payload.product.as_deref().unwrap_or("hosila-pms");

    match payload.license_type.as_str() {
        "commercial" => {
            if key_product == "*" || key_product != CURRENT_PRODUCT_ID {
                return Err(ApiError::license_invalid(format!(
                    "This key is for '{key_product}' and cannot activate {CURRENT_PRODUCT_NAME}."
                )));
            }
            if payload.machine_id == "*"
                || !payload
                    .machine_id
                    .trim()
                    .eq_ignore_ascii_case(expected_fingerprint.trim())
            {
                return Err(ApiError::license_invalid(format!(
                    "This key is locked to Host PC {} and cannot be reused on {}.",
                    payload.machine_id, expected_fingerprint
                )));
            }
        }
        "master" => {
            if key_product != "*" && key_product != CURRENT_PRODUCT_ID {
                return Err(ApiError::license_invalid(format!(
                    "This Master key is scoped to '{key_product}'."
                )));
            }
            if payload.machine_id != "*"
                && !payload
                    .machine_id
                    .trim()
                    .eq_ignore_ascii_case(expected_fingerprint.trim())
            {
                return Err(ApiError::license_invalid(format!(
                    "This Master key is scoped to Host PC {}.",
                    payload.machine_id
                )));
            }
        }
        _ => {
            return Err(ApiError::license_invalid("Unsupported license type."));
        }
    }

    Ok(payload)
}

fn effective_now_with_clock_guard(db: &Database) -> DateTime<Utc> {
    let real_now = Utc::now();
    let stored: Option<String> = db
        .with_read(|conn| {
            conn.query_row(
                "SELECT value_json FROM settings WHERE key = 'license_last_seen_at'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(Into::into)
        })
        .ok()
        .flatten();

    let last_seen = stored.and_then(|raw| {
        let s = serde_json::from_str::<String>(&raw).unwrap_or_else(|_| raw.trim_matches('"').to_string());
        DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc))
    });

    let effective = match last_seen {
        Some(ls) if ls > real_now => ls,
        _ => real_now,
    };

    if last_seen.map(|ls| effective > ls + Duration::minutes(5)).unwrap_or(true) {
        let ts = effective.to_rfc3339_opts(SecondsFormat::Secs, true);
        if let Ok(ts_json) = serde_json::to_string(&ts) {
            let _ = db.transaction(|tx| {
                tx.execute(
                    "INSERT INTO settings (key, value_json, updated_at) VALUES ('license_last_seen_at', ?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                    params![ts_json, ts],
                )?;
                Ok(())
            });
        }
    }

    effective
}

fn ensure_trial_started(db: &Database, now: DateTime<Utc>) -> AppResult<DateTime<Utc>> {
    let existing: Option<String> = db.with_read(|conn| {
        let raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = 'trial_started_at'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(raw)
    })?;

    if let Some(raw_json) = existing {
        if let Ok(ts) = serde_json::from_str::<String>(&raw_json) {
            if let Ok(dt) = DateTime::parse_from_rfc3339(&ts) {
                return Ok(dt.with_timezone(&Utc));
            }
        }
        if let Ok(dt) = DateTime::parse_from_rfc3339(raw_json.trim_matches('"')) {
            return Ok(dt.with_timezone(&Utc));
        }
    }

    let now_str = now.to_rfc3339_opts(SecondsFormat::Secs, true);
    let now_json = serde_json::to_string(&now_str)?;
    db.transaction(|tx| {
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES ('trial_started_at', ?1, ?2)",
            params![now_json, now_str],
        )?;
        Ok(())
    })?;
    Ok(now)
}

pub fn get_license_status_with_key(
    db: &Database,
    verifying_key: &VerifyingKey,
) -> AppResult<LicenseStatusDto> {
    let fp = machine_fingerprint();
    let effective_now = effective_now_with_clock_guard(db);

    let stored: Option<(String, String, String)> = db.with_read(|conn| {
        conn.query_row(
            "SELECT payload_json, signature_b64, activated_at FROM license WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(Into::into)
    })?;

    if let Some((stored_payload, sig_b64, activated_at)) = stored {
        // Support both raw base64url payload (new HSL1 format) and legacy raw JSON
        let payload_b64 = if stored_payload.trim_start().starts_with('{') {
            URL_SAFE_NO_PAD.encode(stored_payload.as_bytes())
        } else {
            stored_payload.trim().to_string()
        };
        let token = format!("HSL1.{payload_b64}.{sig_b64}");

        match verify_license_key_with_verifying_key(&token, verifying_key, &fp) {
            Ok(payload) => {
                let edition_label = if payload.license_type == "master" {
                    "Master License (Full Access)".to_string()
                } else if payload.expires_at.is_none() {
                    "Lifetime License (Full Access)".to_string()
                } else {
                    "Commercial Subscription (Full Access)".to_string()
                };

                if let Some(ref exp_str) = payload.expires_at {
                    if let Ok(exp_dt) = DateTime::parse_from_rfc3339(exp_str) {
                        let exp_utc = exp_dt.with_timezone(&Utc);
                        if effective_now > exp_utc {
                            let grace_end = exp_utc + Duration::days(GRACE_DAYS);
                            if effective_now <= grace_end {
                                let grace_left = ((grace_end - effective_now).num_seconds() + 86_399) / 86_400;
                                return Ok(LicenseStatusDto {
                                    state: "grace".to_string(),
                                    machine_fingerprint: fp,
                                    licensed_to: Some(payload.hotel_name),
                                    edition: Some(edition_label),
                                    activated_at: Some(activated_at),
                                    trial_days_remaining: grace_left.max(1) as i32,
                                    is_read_only: false,
                                    message: format!(
                                        "Subscription expired — {grace_left} day(s) of grace period remaining. Please renew your Hosila IMS key."
                                    ),
                                });
                            }
                            return Ok(LicenseStatusDto {
                                state: "expired".to_string(),
                                machine_fingerprint: fp,
                                licensed_to: Some(payload.hotel_name),
                                edition: Some(edition_label),
                                activated_at: Some(activated_at),
                                trial_days_remaining: 0,
                                is_read_only: true,
                                message: "License expired beyond the 30-day grace period. Enter a renewed Hosila IMS key to unlock writes.".to_string(),
                            });
                        }
                        let days_left = ((exp_utc - effective_now).num_seconds() + 86_399) / 86_400;
                        return Ok(LicenseStatusDto {
                            state: "licensed".to_string(),
                            machine_fingerprint: fp,
                            licensed_to: Some(payload.hotel_name),
                            edition: Some(edition_label),
                            activated_at: Some(activated_at),
                            trial_days_remaining: days_left.max(1) as i32,
                            is_read_only: false,
                            message: format!(
                                "Active {} ({days_left} days remaining).",
                                payload.id
                            ),
                        });
                    }
                }

                return Ok(LicenseStatusDto {
                    state: "licensed".to_string(),
                    machine_fingerprint: fp,
                    licensed_to: Some(payload.hotel_name),
                    edition: Some(edition_label),
                    activated_at: Some(activated_at),
                    trial_days_remaining: 0,
                    is_read_only: false,
                    message: format!("Active Lifetime License ({}).", payload.id),
                });
            }
            Err(err) => {
                return Ok(LicenseStatusDto {
                    state: "invalid".to_string(),
                    machine_fingerprint: fp,
                    licensed_to: None,
                    edition: None,
                    activated_at: Some(activated_at),
                    trial_days_remaining: 0,
                    is_read_only: true,
                    message: err.message,
                });
            }
        }
    }

    let trial_start = ensure_trial_started(db, effective_now)?;
    let trial_end = trial_start + Duration::days(TRIAL_DAYS);
    let remaining_secs = (trial_end - effective_now).num_seconds();
    if remaining_secs > 0 {
        let days_left = ((remaining_secs + 86_399) / 86_400).clamp(1, TRIAL_DAYS) as i32;
        Ok(LicenseStatusDto {
            state: "trial".to_string(),
            machine_fingerprint: fp,
            licensed_to: None,
            edition: Some("14-Day Trial".to_string()),
            activated_at: None,
            trial_days_remaining: days_left,
            is_read_only: false,
            message: format!("14-day evaluation active ({days_left} days remaining)."),
        })
    } else {
        Ok(LicenseStatusDto {
            state: "trial_expired".to_string(),
            machine_fingerprint: fp,
            licensed_to: None,
            edition: None,
            activated_at: None,
            trial_days_remaining: 0,
            is_read_only: true,
            message: "14-day trial expired. Enter a Hosila IMS activation key (HSL1...) to unlock writes."
                .to_string(),
        })
    }
}

pub fn get_license_status(db: &Database) -> AppResult<LicenseStatusDto> {
    let vk = default_verifying_key()?;
    get_license_status_with_key(db, &vk)
}

pub fn activate_license_with_key(
    db: &Database,
    actor: &SessionUser,
    key: &str,
    verifying_key: &VerifyingKey,
) -> AppResult<LicenseStatusDto> {
    require_admin(actor)?;
    let fp = machine_fingerprint();
    let payload = verify_license_key_with_verifying_key(key, verifying_key, &fp)?;

    // Reject already-expired keys (past grace period) on activation
    if let Some(ref exp_str) = payload.expires_at {
        let parsed = DateTime::parse_from_rfc3339(exp_str)
            .map_err(|_| ApiError::license_invalid("Activation key expiry timestamp is invalid."))?;
        let effective_now = effective_now_with_clock_guard(db);
        if effective_now > parsed.with_timezone(&Utc) + Duration::days(GRACE_DAYS) {
            return Err(ApiError::license_invalid("This activation key has already expired."));
        }
    }

    let cleaned: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    let parts: Vec<&str> = cleaned.split('.').collect();
    let payload_b64 = parts[1].to_string();
    let sig_b64 = parts[2].to_string();
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        tx.execute(
            "INSERT INTO license (id, payload_json, signature_b64, activated_at)
             VALUES (1, ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
               payload_json = excluded.payload_json,
               signature_b64 = excluded.signature_b64,
               activated_at = excluded.activated_at",
            params![payload_b64, sig_b64, now],
        )?;
        record_activity(
            tx,
            Some(&actor.id),
            "license.activated",
            "license",
            "1",
            &format!(
                "Activated {} key {} for {} ({})",
                payload.license_type, payload.id, payload.hotel_name, fp
            ),
            serde_json::json!({
                "key_id": payload.id,
                "licensed_to": payload.hotel_name,
                "type": payload.license_type,
                "product": payload.product,
                "fingerprint": fp,
            }),
        )?;
        Ok(())
    })?;

    get_license_status_with_key(db, verifying_key)
}

pub fn activate_license(
    db: &Database,
    actor: &SessionUser,
    key: &str,
) -> AppResult<LicenseStatusDto> {
    let vk = default_verifying_key()?;
    activate_license_with_key(db, actor, key, &vk)
}

pub fn require_writable_license_with_key(
    db: &Database,
    verifying_key: &VerifyingKey,
) -> AppResult<()> {
    let status = get_license_status_with_key(db, verifying_key)?;
    if status.is_read_only {
        return Err(ApiError::forbidden(status.message));
    }
    Ok(())
}

pub fn require_writable_license(db: &Database) -> AppResult<()> {
    let vk = default_verifying_key()?;
    require_writable_license_with_key(db, &vk)
}
