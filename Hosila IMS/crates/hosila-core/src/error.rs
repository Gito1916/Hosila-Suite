use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    ValidationError,
    NotFound,
    Conflict,
    Unauthorized,
    Forbidden,
    InsufficientStock,
    BaseUnitLocked,
    UnitConversionNeeded,
    DatabaseError,
    IoError,
    ImportError,
    LicenseInvalid,
    InternalError,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, thiserror::Error)]
#[error("{message}")]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    pub field: Option<String>,
    #[specta(type = Option<specta_typescript::Unknown>)]
    pub meta: Option<serde_json::Value>,
}

pub type AppResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            field: None,
            meta: None,
        }
    }

    pub fn with_field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }

    pub fn with_meta(mut self, meta: serde_json::Value) -> Self {
        self.meta = Some(meta);
        self
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ValidationError, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Conflict, message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unauthorized, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Forbidden, message)
    }

    pub fn insufficient_stock(
        item_name: &str,
        available_display: &str,
        requested_display: &str,
    ) -> Self {
        Self::new(
            ErrorCode::InsufficientStock,
            format!(
                "Quantity is more than available for {item_name}. Only {available_display} in stock (requested {requested_display})."
            ),
        )
        .with_meta(serde_json::json!({
            "item_name": item_name,
            "available": available_display,
            "requested": requested_display,
        }))
    }

    pub fn database(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::DatabaseError, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::IoError, message)
    }

    pub fn import_error(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ImportError, message)
    }

    pub fn license_invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::LicenseInvalid, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InternalError, message)
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(err: rusqlite::Error) -> Self {
        Self::database(format!("Database error: {err}"))
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        Self::io(format!("I/O error: {err}"))
    }
}

impl From<r2d2::Error> for ApiError {
    fn from(err: r2d2::Error) -> Self {
        Self::database(format!("Database connection pool error: {err}"))
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(err: serde_json::Error) -> Self {
        Self::internal(format!("JSON serialization error: {err}"))
    }
}
