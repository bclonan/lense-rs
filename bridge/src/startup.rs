use crate::{
    config::Config,
    error::{BridgeError, Result},
};
use std::{
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream},
    time::{Duration, Instant},
};
use tokio::net::TcpListener;

/// These are the only desktop endpoints the website discovers.
pub const PORTS: [u16; 3] = [17373, 17374, 17375];
const PROBE_TIMEOUT: Duration = Duration::from_millis(350);
const MAX_STATUS_BYTES: u64 = 16 * 1024;

#[derive(Debug)]
pub enum Endpoint {
    Listening(TcpListener),
    AlreadyRunning(u16),
}

pub async fn select_endpoint(config: &Config) -> Result<Endpoint> {
    select_from(config, &PORTS).await
}

async fn select_from(config: &Config, ports: &[u16]) -> Result<Endpoint> {
    // Search all known endpoints before binding. A previous launch may already
    // use a fallback port even though the default port is now free.
    if let Some(port) = find_existing(config, ports).await {
        return Ok(Endpoint::AlreadyRunning(port));
    }
    for &port in ports {
        match TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => return Ok(Endpoint::Listening(listener)),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::AddrInUse | std::io::ErrorKind::PermissionDenied
                ) => {}
            Err(error) => {
                return Err(BridgeError::new(
                    "STARTUP_FAILED",
                    format!("Windows could not open the local bridge connection on port {port}: {error}"),
                ));
            }
        }
    }
    // Another launch may have started while this process was checking ports.
    if let Some(port) = find_existing(config, ports).await {
        return Ok(Endpoint::AlreadyRunning(port));
    }
    Err(BridgeError::new(
        "PORTS_UNAVAILABLE",
        format!(
            "The local bridge ports {} are all in use or unavailable. Close an older Lense companion you no longer need, then open LenseBridge again. Other applications were left running.",
            ports.iter().map(u16::to_string).collect::<Vec<_>>().join(", ")
        ),
    ))
}

async fn find_existing(config: &Config, ports: &[u16]) -> Option<u16> {
    let mut origins: Vec<_> = config.origins.iter().cloned().collect();
    origins.sort_by_key(|origin| (!origin.starts_with("https://"), origin.clone()));
    for &port in ports {
        let origins = origins.clone();
        let matches = tokio::task::spawn_blocking(move || {
            origins.iter().any(|origin| probe_status(port, origin))
        })
        .await
        .unwrap_or(false);
        if matches {
            return Some(port);
        }
    }
    None
}

fn probe_status(port: u16, origin: &str) -> bool {
    let address = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, PROBE_TIMEOUT) else {
        return false;
    };
    if stream.set_read_timeout(Some(PROBE_TIMEOUT)).is_err()
        || stream.set_write_timeout(Some(PROBE_TIMEOUT)).is_err()
    {
        return false;
    }
    let request = format!(
        "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {origin}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let deadline = Instant::now() + PROBE_TIMEOUT;
    let mut response = Vec::new();
    let mut chunk = [0; 2048];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() || stream.set_read_timeout(Some(remaining)).is_err() {
            return false;
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => response.extend_from_slice(&chunk[..count]),
            Err(_) => return false,
        }
        if response.len() as u64 > MAX_STATUS_BYTES {
            return false;
        }
    }
    matches_status(&response)
}

fn matches_status(response: &[u8]) -> bool {
    let Some(split) = response.windows(4).position(|part| part == b"\r\n\r\n") else {
        return false;
    };
    let Ok(headers) = std::str::from_utf8(&response[..split]) else {
        return false;
    };
    let status = headers.lines().next().unwrap_or_default();
    if !status.starts_with("HTTP/1.1 200 ") && !status.starts_with("HTTP/1.0 200 ") {
        return false;
    }
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(&response[split + 4..]) else {
        return false;
    };
    body["name"] == "LenseBridge" && body["protocolVersion"] == 1 && body["platform"] == "windows"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        api::{self, AppState},
        input::{MockInputExecutor, PairApprover},
    };
    use axum::{routing::get, Json, Router};
    use std::sync::Arc;

    struct Reject;
    impl PairApprover for Reject {
        fn approve(&self, _: &str) -> bool {
            panic!("Endpoint discovery must never request native pairing")
        }
    }

    fn config(port: u16) -> Config {
        Config {
            origins: ["https://test.example".into()].into(),
            dry_run: false,
            port,
        }
    }

    async fn unused_port() -> u16 {
        TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    async fn unrelated_service() -> (u16, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let app = Router::new().route(
            "/v1/status",
            get(|| async { Json(serde_json::json!({"name":"OldCompanion","protocolVersion":1})) }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (port, server)
    }

    #[tokio::test]
    async fn occupied_default_uses_next_local_port_and_leaves_service_running() {
        let (occupied, other) = unrelated_service().await;
        let fallback = unused_port().await;
        let endpoint = select_from(&config(occupied), &[occupied, fallback])
            .await
            .unwrap();
        let Endpoint::Listening(listener) = endpoint else {
            panic!("An unrelated service must not count as LenseBridge")
        };
        assert_eq!(listener.local_addr().unwrap().port(), fallback);
        assert!(listener.local_addr().unwrap().ip().is_loopback());
        assert!(
            tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, occupied))
                .await
                .is_ok()
        );
        other.abort();
    }

    #[tokio::test]
    async fn second_launch_recognizes_existing_fallback_with_trusted_origin() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let app = api::router(AppState::new(
            config(port),
            Arc::new(MockInputExecutor::new()),
            Arc::new(Reject),
        ));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let free_default = unused_port().await;
        let endpoint = select_from(&config(free_default), &[free_default, port])
            .await
            .unwrap();
        assert!(matches!(endpoint, Endpoint::AlreadyRunning(found) if found == port));
        server.abort();
    }

    #[tokio::test]
    async fn all_ports_occupied_returns_recovery_instructions() {
        let (first, first_server) = unrelated_service().await;
        let (second, second_server) = unrelated_service().await;
        let error = select_from(&config(first), &[first, second])
            .await
            .unwrap_err();
        assert_eq!(error.code, "PORTS_UNAVAILABLE");
        assert!(error.message.contains(&format!("{first}, {second}")));
        assert!(error.message.contains("Close an older Lense companion"));
        assert!(!error.message.contains("10048"));
        assert!(tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, first))
            .await
            .is_ok());
        first_server.abort();
        second_server.abort();
    }

    #[test]
    fn recognizes_only_a_successful_matching_protocol_status() {
        let response =
            |body: &str| format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{body}");
        assert!(matches_status(
            response(r#"{"name":"LenseBridge","protocolVersion":1,"platform":"windows"}"#)
                .as_bytes()
        ));
        for body in [
            r#"{"name":"OldCompanion","protocolVersion":1,"platform":"windows"}"#,
            r#"{"name":"LenseBridge","protocolVersion":2,"platform":"windows"}"#,
            r#"{"name":"LenseBridge","protocolVersion":1,"platform":"other"}"#,
            "not json",
        ] {
            assert!(!matches_status(response(body).as_bytes()));
        }
        assert!(!matches_status(b"HTTP/1.1 403 Forbidden\r\n\r\n{}"));
    }
}
