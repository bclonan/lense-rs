use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct BridgeError {
    pub code: &'static str,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, BridgeError>;
impl BridgeError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for BridgeError {}
impl IntoResponse for BridgeError {
    fn into_response(self) -> Response {
        let status = match self.code {
            "ORIGIN_NOT_ALLOWED" | "PAIRING_DENIED" | "SCOPE_DENIED" => StatusCode::FORBIDDEN,
            "INVALID_TOKEN" | "NOT_PAIRED" | "CONTROL_DISABLED" => StatusCode::UNAUTHORIZED,
            "RATE_LIMITED" => StatusCode::TOO_MANY_REQUESTS,
            "WATCH_NOT_FOUND" | "WINDOW_NOT_FOUND" | "MONITOR_NOT_FOUND" => StatusCode::NOT_FOUND,
            "CAPTURE_FAILED" | "INPUT_FAILED" | "INTERNAL_ERROR" => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            "BUSY" => StatusCode::CONFLICT,
            _ => StatusCode::BAD_REQUEST,
        };
        (status, Json(serde_json::json!({"error": self}))).into_response()
    }
}
