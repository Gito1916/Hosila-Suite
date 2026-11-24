mod commands;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use hosila_core::db::Database;
use hosila_core::error::{ApiError, AppResult};
use hosila_core::paths::AppPaths;
use hosila_core::seed::{seed_dev_demo, seed_system_defaults};
use hosila_core::types::{IntegrityReport, SessionUser};
use specta_typescript::Typescript;
use tauri::Manager;
use tauri_specta::{collect_commands, Builder, ErrorHandlingMode};
use tracing_subscriber::EnvFilter;

const LICENSE_CACHE_TTL: Duration = Duration::from_secs(60);

pub struct AppState {
    pub db: Database,
    pub paths: AppPaths,
    pub initial_integrity: IntegrityReport,
    pub session: Mutex<Option<SessionUser>>,
    pub license_cache: Mutex<Option<(Instant, Result<(), String>)>>,
}

impl AppState {
    pub fn current_session(&self) -> AppResult<Option<SessionUser>> {
        let guard = self
            .session
            .lock()
            .map_err(|_| ApiError::internal("Session lock poisoned"))?;
        Ok(guard.clone())
    }

    pub fn require_session(&self) -> AppResult<SessionUser> {
        self.current_session()?
            .ok_or_else(|| ApiError::unauthorized("Please sign in to continue."))
    }

    pub fn require_write_session(&self) -> AppResult<SessionUser> {
        let user = self.require_session()?;
        if let Ok(guard) = self.license_cache.lock() {
            if let Some((checked_at, cached)) = guard.as_ref() {
                if checked_at.elapsed() < LICENSE_CACHE_TTL {
                    return match cached {
                        Ok(()) => Ok(user),
                        Err(msg) => Err(ApiError::forbidden(msg.clone())),
                    };
                }
            }
        }
        let check = hosila_core::license::require_writable_license(&self.db);
        if let Ok(mut guard) = self.license_cache.lock() {
            *guard = Some((
                Instant::now(),
                match &check {
                    Ok(()) => Ok(()),
                    Err(e) => Err(e.message.clone()),
                },
            ));
        }
        check?;
        Ok(user)
    }

    pub fn invalidate_license_cache(&self) {
        if let Ok(mut guard) = self.license_cache.lock() {
            *guard = None;
        }
    }

    pub fn set_session(&self, user: Option<SessionUser>) -> AppResult<()> {
        let mut guard = self
            .session
            .lock()
            .map_err(|_| ApiError::internal("Session lock poisoned"))?;
        *guard = user;
        Ok(())
    }
}

pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .error_handling(ErrorHandlingMode::Result)
        .commands(collect_commands![
            // System
            commands::get_system_info,
            commands::run_integrity_check,
            // Auth & Onboarding
            commands::complete_onboarding,
            commands::login,
            commands::login_with_pin,
            commands::logout,
            commands::get_current_session,
            commands::verify_manager_pin,
            // Users
            commands::list_users,
            commands::create_user,
            commands::update_user,
            commands::reset_user_password,
            commands::set_user_pin,
            // Settings
            commands::get_settings,
            commands::update_business_profile,
            commands::update_inventory_rules,
            commands::update_appearance,
            // Departments & Store Sections
            commands::list_departments,
            commands::create_department,
            commands::update_department,
            commands::list_store_sections,
            commands::create_store_section,
            commands::update_store_section,
            // Staff
            commands::list_staff,
            commands::create_staff,
            commands::update_staff,
            // Units of Measure
            commands::list_units,
            commands::create_unit,
            commands::update_unit,
            commands::delete_unit,
            // Suppliers
            commands::list_suppliers,
            commands::create_supplier,
            commands::update_supplier,
            // Items & UoM
            commands::list_items,
            commands::get_item_detail,
            commands::get_item_stock_card,
            commands::create_item,
            commands::update_item,
            commands::change_item_base_unit,
            commands::archive_item,
            commands::clear_inventory,
            // Collections & Returns
            commands::validate_collection,
            commands::create_collection,
            commands::list_collections,
            commands::get_collection,
            commands::reverse_collection,
            commands::list_outstanding_returns,
            commands::record_return,
            // Weekly Sheet Importer
            commands::preview_weekly_sheet_import,
            commands::commit_weekly_sheet_import,
            // Procurement, Export & Goods Receipts
            commands::generate_procurement_draft,
            commands::create_procurement_list,
            commands::update_procurement_list,
            commands::get_procurement_list,
            commands::list_procurement_lists,
            commands::export_procurement_xlsx,
            commands::render_procurement_print_html,
            commands::create_receipt,
            commands::list_receipts,
            commands::get_receipt,
            commands::reverse_receipt,
            // Built-in Procurement Parser
            commands::inspect_procurement_workbook,
            commands::parse_procurement_workbook,
            commands::confirm_parsed_restock,
            // Dashboard & Activity Feed
            commands::get_dashboard_kpis,
            commands::get_consumption_by_department,
            commands::get_daily_consumption_series,
            commands::list_activity_log,
            // Stock Adjustments & Stock Counts
            commands::create_adjustment,
            commands::list_adjustments,
            commands::start_stock_count,
            commands::update_stock_count_lines,
            commands::post_stock_count,
            commands::list_stock_counts,
            commands::get_stock_count,
            // Financial & Stock Reports
            commands::get_stock_valuation_report,
            commands::get_consumption_report,
            commands::get_procurement_spend_report,
            commands::get_weekly_stock_sheet,
            commands::export_weekly_stock_sheet_xlsx,
            // Backups & Offline Licence
            commands::create_backup,
            commands::list_backups,
            commands::restore_backup,
            commands::export_backup_file,
            commands::get_license_status,
            commands::activate_license,
        ])
}

pub fn export_ts_bindings(builder: &Builder<tauri::Wry>) -> Result<(), String> {
    let out_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../bindings");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let out_file = out_dir.join("bindings.ts");
    builder
        .export(Typescript::default(), &out_file)
        .map_err(|e| format!("Failed to export TypeScript bindings: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::args().any(|arg| arg == "--export-bindings") {
        let builder = specta_builder();
        export_ts_bindings(&builder).expect("TypeScript bindings export failed");
        return;
    }

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("hosila_ims=info,hosila_core=info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();

    let dev_seed = std::env::args().any(|arg| arg == "--dev-seed");
    let builder = specta_builder();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            if exe_dir.join("portable.flag").exists() {
                let webview_dir = exe_dir.join("data").join("webview");
                let _ = std::fs::create_dir_all(&webview_dir);
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_dir);
            }
        }
    }

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_dir = exe_path
                .parent()
                .ok_or_else(|| "Failed to resolve executable directory".to_string())?;
            let os_app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve OS app data directory: {e}"))?;

            let paths = AppPaths::resolve(exe_dir, &os_app_data_dir);
            paths.ensure_dirs().map_err(|e| e.message)?;

            if paths.is_network_path {
                tracing::warn!(
                    db_path = %paths.db_path.display(),
                    "Database path appears to be on a network share; local storage is strongly recommended."
                );
            }

            let db = Database::open_file(&paths.db_path).map_err(|e| e.message)?;
            seed_system_defaults(&db).map_err(|e| e.message)?;

            if dev_seed {
                seed_dev_demo(&db).map_err(|e| e.message)?;
            }

            let initial_integrity = db.check_integrity().map_err(|e| e.message)?;
            if !initial_integrity.ok {
                tracing::error!(?initial_integrity, "SQLite integrity check detected issues");
            } else if let Err(err) = hosila_core::db::backup::auto_backup_if_due(&db, &paths.backups_dir) {
                tracing::warn!(%err, "Automatic daily SQLite backup did not complete");
            }

            app.manage(AppState {
                db,
                paths,
                initial_integrity,
                session: Mutex::new(None),
                license_cache: Mutex::new(None),
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hosila IMS");
}
