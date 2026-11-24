use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};

use crate::error::AppResult;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    Installed,
    Portable,
}

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub mode: RunMode,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub backups_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub is_network_path: bool,
}

impl AppPaths {
    /// Resolves data directories based on whether `portable.flag` sits beside the executable.
    pub fn resolve(exe_dir: &Path, os_app_data_dir: &Path) -> Self {
        let is_portable = exe_dir.join("portable.flag").exists();
        let (mode, data_dir) = if is_portable {
            (RunMode::Portable, exe_dir.join("data"))
        } else {
            (RunMode::Installed, os_app_data_dir.join("data"))
        };

        let db_path = data_dir.join("hosila.db");
        let backups_dir = data_dir.join("backups");
        let logs_dir = data_dir.join("logs");
        let is_network_path = is_unc_path(&data_dir);

        Self {
            mode,
            data_dir,
            db_path,
            backups_dir,
            logs_dir,
            is_network_path,
        }
    }

    pub fn ensure_dirs(&self) -> AppResult<()> {
        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::create_dir_all(&self.backups_dir)?;
        std::fs::create_dir_all(&self.logs_dir)?;
        Ok(())
    }
}

fn is_unc_path(path: &Path) -> bool {
    let raw = path.to_string_lossy();
    raw.starts_with(r"\\") || raw.starts_with("//")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolves_installed_mode_by_default() {
        let exe_dir = tempdir().unwrap();
        let app_data = tempdir().unwrap();

        let paths = AppPaths::resolve(exe_dir.path(), app_data.path());
        assert_eq!(paths.mode, RunMode::Installed);
        assert_eq!(paths.data_dir, app_data.path().join("data"));
        assert_eq!(paths.db_path, app_data.path().join("data").join("hosila.db"));
        assert!(!paths.is_network_path);
    }

    #[test]
    fn resolves_portable_mode_when_flag_exists() {
        let exe_dir = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        std::fs::write(exe_dir.path().join("portable.flag"), b"").unwrap();

        let paths = AppPaths::resolve(exe_dir.path(), app_data.path());
        assert_eq!(paths.mode, RunMode::Portable);
        assert_eq!(paths.data_dir, exe_dir.path().join("data"));
        assert_eq!(paths.db_path, exe_dir.path().join("data").join("hosila.db"));
        assert_eq!(paths.backups_dir, exe_dir.path().join("data").join("backups"));
        assert_eq!(paths.logs_dir, exe_dir.path().join("data").join("logs"));
    }

    #[test]
    fn detects_unc_network_paths() {
        let exe_dir = Path::new(r"\\FILESERVER\Shared\Hosila");
        let app_data = Path::new(r"\\FILESERVER\Users\Store\AppData\Hosila IMS");
        let paths = AppPaths::resolve(exe_dir, app_data);
        assert!(paths.is_network_path);
    }
}
