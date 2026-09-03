use crate::{
    error::{BridgeError, Result},
    protocol,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub token: String,
    pub origin: String,
    pub scopes: Vec<String>,
    pub created_at: String,
}
pub struct Session {
    pub info: SessionInfo,
    pub enabled: AtomicBool,
    pub input_gate: Mutex<()>,
    action_times: Mutex<VecDeque<Instant>>,
}
impl Session {
    pub fn require(&self, scope: &str) -> Result<()> {
        self.check()?;
        if !self.info.scopes.iter().any(|s| s == scope) {
            return Err(BridgeError::new(
                "SCOPE_DENIED",
                format!("Session does not allow {scope}"),
            ));
        }
        Ok(())
    }
    pub fn check(&self) -> Result<()> {
        if self.enabled.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(BridgeError::new(
                "CONTROL_DISABLED",
                "Desktop control has stopped. Pair again to continue",
            ))
        }
    }
    pub fn revoke(&self) {
        let _guard = self.input_gate.lock().unwrap();
        self.enabled.store(false, Ordering::SeqCst);
    }
    pub fn count_action(&self) -> Result<()> {
        let mut times = self.action_times.lock().unwrap();
        let now = Instant::now();
        while times
            .front()
            .is_some_and(|v| now.duration_since(*v) >= Duration::from_secs(60))
        {
            times.pop_front();
        }
        if times.len() >= 120 {
            return Err(BridgeError::new(
                "RATE_LIMITED",
                "The native limit is 120 actions per minute",
            ));
        }
        times.push_back(now);
        Ok(())
    }
}
#[derive(Default)]
pub struct Auth {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}
impl Auth {
    pub fn pair(&self, origin: String) -> Arc<Session> {
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let info = SessionInfo {
            id: protocol::id(),
            token: URL_SAFE_NO_PAD.encode(bytes),
            origin,
            created_at: protocol::timestamp(),
            scopes: ["screen.read", "pointer", "keyboard", "windows.read"]
                .map(str::to_owned)
                .to_vec(),
        };
        let session = Arc::new(Session {
            info,
            enabled: AtomicBool::new(true),
            input_gate: Mutex::new(()),
            action_times: Mutex::new(VecDeque::new()),
        });
        let mut sessions = self.sessions.lock().unwrap();
        for existing in sessions.values() {
            existing.revoke();
        }
        sessions.clear();
        sessions.insert(session.info.token.clone(), session.clone());
        session
    }
    pub fn authenticate(&self, token: &str, origin: &str) -> Result<Arc<Session>> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(token).ok_or_else(|| {
            BridgeError::new("INVALID_TOKEN", "Pair this website with the desktop bridge")
        })?;
        if session.info.origin != origin {
            return Err(BridgeError::new(
                "INVALID_TOKEN",
                "Session belongs to a different website origin",
            ));
        }
        session.check()?;
        Ok(session.clone())
    }
    pub fn revoke(&self, token: &str) {
        if let Some(session) = self.sessions.lock().unwrap().remove(token) {
            session.revoke();
        }
    }
    pub fn revoke_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for session in sessions.values() {
            session.revoke();
        }
        sessions.clear();
    }
}

pub struct RateLimit {
    window: Instant,
    count: u32,
    pub maximum: u32,
}
impl RateLimit {
    pub fn new(maximum: u32) -> Self {
        Self {
            window: Instant::now(),
            count: 0,
            maximum,
        }
    }
    pub fn check(&mut self) -> Result<()> {
        if self.window.elapsed() >= Duration::from_secs(60) {
            self.window = Instant::now();
            self.count = 0;
        }
        self.count += 1;
        if self.count > self.maximum {
            Err(BridgeError::new(
                "RATE_LIMITED",
                "Too many bridge requests. Wait before retrying",
            ))
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sessions_bind_origin_revoke_and_scope() {
        let auth = Auth::default();
        let s = auth.pair("https://a.test".into());
        assert!(s.require("keyboard").is_ok());
        assert!(s.require("clipboard.read").is_err());
        assert!(auth.authenticate(&s.info.token, "https://b.test").is_err());
        auth.revoke(&s.info.token);
        assert!(s.check().is_err());
        assert!(auth.authenticate(&s.info.token, "https://a.test").is_err());
    }
    #[test]
    fn pairing_replaces_prior_control() {
        let auth = Auth::default();
        let first = auth.pair("https://a.test".into());
        let second = auth.pair("https://a.test".into());
        assert_ne!(first.info.token, second.info.token);
        assert!(first.check().is_err());
        assert!(second.check().is_ok());
    }
    #[test]
    fn action_and_request_limits() {
        let auth = Auth::default();
        let s = auth.pair("x".into());
        for _ in 0..120 {
            assert!(s.count_action().is_ok());
        }
        assert!(s.count_action().is_err());
        let mut limit = RateLimit::new(2);
        assert!(limit.check().is_ok());
        assert!(limit.check().is_ok());
        assert!(limit.check().is_err());
    }
}
