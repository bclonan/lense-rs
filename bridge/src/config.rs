use crate::error::{BridgeError, Result};
use std::collections::HashSet;

#[derive(Clone)]
pub struct Config {
    pub origins: HashSet<String>,
    pub dry_run: bool,
    pub port: u16,
}
impl Config {
    pub fn from_env() -> Result<Self> {
        let args: Vec<_> = std::env::args().skip(1).collect();
        if args
            .iter()
            .any(|arg| !["--dev", "--dry-run"].contains(&arg.as_str()))
        {
            return Err(BridgeError::new(
                "INVALID_CONFIG",
                "Usage: lense-bridge [--dev] [--dry-run]",
            ));
        }
        let mut origins = HashSet::new();
        let production = std::env::var("LENSE_PRODUCTION_ORIGIN").ok().or_else(|| {
            Some(
                option_env!("LENSE_PRODUCTION_ORIGIN")
                    .unwrap_or("https://lense-visual-control.netlify.app")
                    .to_owned(),
            )
        });
        if let Some(origin) = production {
            if !valid_production_origin(&origin) {
                return Err(BridgeError::new(
                    "INVALID_CONFIG",
                    "LENSE_PRODUCTION_ORIGIN must be a single HTTPS origin without a path",
                ));
            }
            origins.insert(origin);
        }
        if args.iter().any(|arg| arg == "--dev") {
            for host in ["localhost", "127.0.0.1"] {
                for port in [5173, 4173, 4174] {
                    origins.insert(format!("http://{host}:{port}"));
                }
            }
        }
        if origins.is_empty() {
            return Err(BridgeError::new("INVALID_CONFIG", "Set LENSE_PRODUCTION_ORIGIN to your HTTPS website origin, or use --dev for local development"));
        }
        Ok(Self {
            origins,
            dry_run: args.iter().any(|arg| arg == "--dry-run"),
            port: crate::startup::PORTS[0],
        })
    }
    pub fn allows(&self, origin: &str) -> bool {
        origin != "null" && self.origins.contains(origin)
    }
}
pub fn valid_production_origin(origin: &str) -> bool {
    let Ok(uri) = origin.parse::<axum::http::Uri>() else {
        return false;
    };
    uri.scheme_str() == Some("https")
        && uri.authority().is_some_and(|a| !a.as_str().contains('@'))
        && uri.path() == "/"
        && uri.query().is_none()
        && !origin.ends_with('/')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origins_are_exact() {
        let config = Config {
            origins: ["https://lense.netlify.app".into()].into(),
            dry_run: false,
            port: crate::startup::PORTS[0],
        };
        assert!(config.allows("https://lense.netlify.app"));
        for origin in [
            "null",
            "https://lense.netlify.app.attacker.org",
            "http://lense.netlify.app",
            "https://lense.netlify.app/",
        ] {
            assert!(!config.allows(origin));
        }
    }
    #[test]
    fn config_rejects_paths_and_credentials() {
        assert!(valid_production_origin("https://lense.netlify.app"));
        for origin in [
            "https://lense.netlify.app/",
            "https://lense.netlify.app/path",
            "https://u@lense.netlify.app",
            "http://localhost:5173",
            "null",
        ] {
            assert!(!valid_production_origin(origin));
        }
    }
}
