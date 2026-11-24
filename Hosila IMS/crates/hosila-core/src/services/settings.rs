use chrono::{SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension, Transaction};

use crate::db::Database;
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::require_admin;
use crate::types::{
    AllSettingsDto, AppearanceSettings, BusinessProfile, InventoryRules, SessionUser,
};

pub fn default_business_profile() -> BusinessProfile {
    BusinessProfile {
        name: "My Store".to_string(),
        legal_name: String::new(),
        address: String::new(),
        phone: String::new(),
        email: String::new(),
        currency_symbol: "₦".to_string(),
        currency_code: "NGN".to_string(),
        date_format: "DD MMM YYYY".to_string(),
        logo_data_url: None,
    }
}

pub fn default_inventory_rules() -> InventoryRules {
    InventoryRules {
        allow_negative_stock: false,
        costing_method: "wac".to_string(),
        require_storekeeper_pin_on_issue: false,
        require_manager_pin_above_minor: 5_000_000,
    }
}

pub fn default_appearance() -> AppearanceSettings {
    AppearanceSettings {
        theme: "system".to_string(),
    }
}

fn parse_business_profile(raw: &str) -> BusinessProfile {
    let val: serde_json::Value = serde_json::from_str(raw).unwrap_or_default();
    let d = default_business_profile();
    BusinessProfile {
        name: val
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&d.name)
            .to_string(),
        legal_name: val
            .get("legal_name")
            .and_then(|v| v.as_str())
            .unwrap_or(&d.legal_name)
            .to_string(),
        address: val
            .get("address")
            .and_then(|v| v.as_str())
            .unwrap_or(&d.address)
            .to_string(),
        phone: val
            .get("phone")
            .and_then(|v| v.as_str())
            .unwrap_or(&d.phone)
            .to_string(),
        email: val
            .get("email")
            .and_then(|v| v.as_str())
            .unwrap_or(&d.email)
            .to_string(),
        currency_symbol: val
            .get("currency_symbol")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&d.currency_symbol)
            .to_string(),
        currency_code: val
            .get("currency_code")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&d.currency_code)
            .to_string(),
        date_format: val
            .get("date_format")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&d.date_format)
            .to_string(),
        logo_data_url: val
            .get("logo_data_url")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
    }
}

fn parse_inventory_rules(raw: &str) -> InventoryRules {
    let val: serde_json::Value = serde_json::from_str(raw).unwrap_or_default();
    let d = default_inventory_rules();
    InventoryRules {
        allow_negative_stock: val
            .get("allow_negative_stock")
            .and_then(|v| v.as_bool())
            .unwrap_or(d.allow_negative_stock),
        costing_method: val
            .get("costing_method")
            .and_then(|v| v.as_str())
            .unwrap_or(&d.costing_method)
            .to_string(),
        require_storekeeper_pin_on_issue: val
            .get("require_storekeeper_pin_on_issue")
            .and_then(|v| v.as_bool())
            .unwrap_or(d.require_storekeeper_pin_on_issue),
        require_manager_pin_above_minor: val
            .get("require_manager_pin_above_minor")
            .and_then(|v| v.as_i64())
            .unwrap_or(d.require_manager_pin_above_minor),
    }
}

fn parse_appearance(raw: &str) -> AppearanceSettings {
    let val: serde_json::Value = serde_json::from_str(raw).unwrap_or_default();
    let d = default_appearance();
    AppearanceSettings {
        theme: val
            .get("theme")
            .and_then(|v| v.as_str())
            .unwrap_or(&d.theme)
            .to_string(),
    }
}

pub fn save_business_profile_tx(
    tx: &Transaction<'_>,
    profile: &BusinessProfile,
    now: &str,
) -> AppResult<BusinessProfile> {
    let name = profile.name.trim().to_string();
    let currency_symbol = profile.currency_symbol.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::validation("Business name is required.").with_field("name"));
    }
    if currency_symbol.is_empty() {
        return Err(
            ApiError::validation("Currency symbol is required.").with_field("currency_symbol")
        );
    }

    let cleaned = BusinessProfile {
        name,
        legal_name: profile.legal_name.trim().to_string(),
        address: profile.address.trim().to_string(),
        phone: profile.phone.trim().to_string(),
        email: profile.email.trim().to_string(),
        currency_symbol,
        currency_code: if profile.currency_code.trim().is_empty() {
            "NGN".to_string()
        } else {
            profile.currency_code.trim().to_uppercase()
        },
        date_format: if profile.date_format.trim().is_empty() {
            "DD MMM YYYY".to_string()
        } else {
            profile.date_format.trim().to_string()
        },
        logo_data_url: profile
            .logo_data_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string),
    };

    let json = serde_json::to_string(&cleaned)?;
    tx.execute(
        "INSERT INTO settings (key, value_json, updated_at) VALUES ('business_profile', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![json, now],
    )?;

    Ok(cleaned)
}

pub fn get_settings(db: &Database) -> AppResult<AllSettingsDto> {
    db.with_read(|conn| {
        let bp_raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = 'business_profile'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let ir_raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = 'inventory_rules'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let ap_raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = 'appearance'",
                [],
                |r| r.get(0),
            )
            .optional()?;

        Ok(AllSettingsDto {
            business_profile: bp_raw
                .as_deref()
                .map(parse_business_profile)
                .unwrap_or_else(default_business_profile),
            inventory_rules: ir_raw
                .as_deref()
                .map(parse_inventory_rules)
                .unwrap_or_else(default_inventory_rules),
            appearance: ap_raw
                .as_deref()
                .map(parse_appearance)
                .unwrap_or_else(default_appearance),
        })
    })
}

pub fn update_business_profile(
    db: &Database,
    actor: &SessionUser,
    profile: BusinessProfile,
) -> AppResult<BusinessProfile> {
    require_admin(actor)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let saved = save_business_profile_tx(tx, &profile, &now)?;
        record_activity(
            tx,
            Some(&actor.id),
            "settings.business_profile.updated",
            "settings",
            "business_profile",
            &format!("Updated business profile ({})", saved.name),
            serde_json::json!({ "name": saved.name }),
        )?;
        Ok(saved)
    })
}

pub fn update_inventory_rules(
    db: &Database,
    actor: &SessionUser,
    rules: InventoryRules,
) -> AppResult<InventoryRules> {
    require_admin(actor)?;
    let method = rules.costing_method.trim().to_ascii_lowercase();
    if method != "wac" {
        return Err(
            ApiError::validation("Only Weighted Average Cost ('wac') is supported in v1.")
                .with_field("costing_method"),
        );
    }
    if rules.require_manager_pin_above_minor < 0 {
        return Err(
            ApiError::validation("Manager PIN threshold cannot be negative.")
                .with_field("require_manager_pin_above_minor"),
        );
    }

    let cleaned = InventoryRules {
        allow_negative_stock: rules.allow_negative_stock,
        costing_method: method,
        require_storekeeper_pin_on_issue: rules.require_storekeeper_pin_on_issue,
        require_manager_pin_above_minor: rules.require_manager_pin_above_minor,
    };

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let json = serde_json::to_string(&cleaned)?;

    db.transaction(|tx| {
        tx.execute(
            "INSERT INTO settings (key, value_json, updated_at) VALUES ('inventory_rules', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![json, now],
        )?;
        record_activity(
            tx,
            Some(&actor.id),
            "settings.inventory_rules.updated",
            "settings",
            "inventory_rules",
            "Updated inventory rules",
            serde_json::json!({
                "allow_negative_stock": cleaned.allow_negative_stock,
                "require_storekeeper_pin_on_issue": cleaned.require_storekeeper_pin_on_issue,
            }),
        )?;
        Ok(cleaned)
    })
}

pub fn update_appearance(
    db: &Database,
    settings: AppearanceSettings,
) -> AppResult<AppearanceSettings> {
    let theme = settings.theme.trim().to_ascii_lowercase();
    if !matches!(theme.as_str(), "light" | "dark" | "system") {
        return Err(
            ApiError::validation("Theme must be 'light', 'dark', or 'system'.")
                .with_field("theme"),
        );
    }
    let cleaned = AppearanceSettings { theme };
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let json = serde_json::to_string(&cleaned)?;

    db.transaction(|tx| {
        tx.execute(
            "INSERT INTO settings (key, value_json, updated_at) VALUES ('appearance', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![json, now],
        )?;
        Ok(cleaned)
    })
}
