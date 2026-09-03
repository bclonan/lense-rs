use crate::{
    auth::{Auth, RateLimit, Session},
    config::Config,
    error::{BridgeError, Result},
    input::{InputExecutor, PairApprover},
    protocol::*,
    watch::{SessionEvent, WatchManager},
};
use axum::{
    extract::{rejection::JsonRejection, DefaultBodyLimit, Path, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::{broadcast, Mutex as AsyncMutex, Semaphore};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub auth: Arc<Auth>,
    pub backend: Arc<dyn InputExecutor>,
    pub approver: Arc<dyn PairApprover>,
    pub watches: Arc<WatchManager>,
    pub events: broadcast::Sender<SessionEvent>,
    pub capture_gate: Arc<Semaphore>,
    action_gate: Arc<AsyncMutex<()>>,
    pair_gate: Arc<AsyncMutex<()>>,
    limits: Arc<Mutex<HashMap<String, RateLimit>>>,
    pair_limit: Arc<Mutex<RateLimit>>,
}
impl AppState {
    pub fn new(
        config: Config,
        backend: Arc<dyn InputExecutor>,
        approver: Arc<dyn PairApprover>,
    ) -> Self {
        Self {
            config: Arc::new(config),
            auth: Arc::new(Auth::default()),
            backend,
            approver,
            watches: Arc::new(WatchManager::default()),
            events: broadcast::channel(512).0,
            capture_gate: Arc::new(Semaphore::new(1)),
            action_gate: Arc::new(AsyncMutex::new(())),
            pair_gate: Arc::new(AsyncMutex::new(())),
            limits: Arc::new(Mutex::new(HashMap::new())),
            pair_limit: Arc::new(Mutex::new(RateLimit::new(6))),
        }
    }
    pub fn emit(&self, session: &Session, kind: &str, data: serde_json::Value) {
        let event = Event::new(kind, data);
        println!("{} {} {}", event.timestamp, event.id, event.kind);
        let _ = self.events.send(SessionEvent {
            session_id: session.info.id.clone(),
            event,
        });
    }
}
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/v1/status", get(status))
        .route("/v1/pair", post(pair))
        .route("/v1/unpair", post(unpair))
        .route("/v1/action", post(action))
        .route("/v1/screen", post(screen).get(default_screen))
        .route("/v1/monitors", get(monitors))
        .route("/v1/windows", get(windows))
        .route("/v1/cursor", get(cursor))
        .route("/v1/watches", post(create_watch).get(watches))
        .route("/v1/watches/{id}", delete(remove_watch))
        .route("/v1/events", get(crate::websocket::upgrade))
        .fallback(|| async { BridgeError::new("INVALID_REQUEST", "Unknown bridge endpoint") })
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), security))
        .with_state(state)
}
pub fn origin(headers: &HeaderMap) -> Result<&str> {
    headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            BridgeError::new(
                "ORIGIN_NOT_ALLOWED",
                "An explicit trusted website Origin is required",
            )
        })
}
fn authenticated(
    state: &AppState,
    headers: &HeaderMap,
    scope: Option<&str>,
) -> Result<Arc<Session>> {
    let origin = origin(headers)?;
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| BridgeError::new("NOT_PAIRED", "Pair this website before desktop access"))?;
    let session = state.auth.authenticate(token, origin)?;
    if let Some(scope) = scope {
        session.require(scope)?;
    }
    Ok(session)
}
fn json<T>(body: std::result::Result<Json<T>, JsonRejection>) -> Result<T> {
    body.map(|Json(value)| value)
        .map_err(|error| BridgeError::new("INVALID_REQUEST", error.body_text()))
}
async fn security(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let origin = match origin(request.headers()) {
        Ok(origin) if state.config.allows(origin) => origin.to_owned(),
        _ => {
            return BridgeError::new(
                "ORIGIN_NOT_ALLOWED",
                "This website origin is not trusted by LenseBridge",
            )
            .into_response()
        }
    };
    let expected_host = format!("127.0.0.1:{}", state.config.port);
    if request.headers().get("host").and_then(|v| v.to_str().ok()) != Some(expected_host.as_str()) {
        return BridgeError::new(
            "ORIGIN_NOT_ALLOWED",
            format!("Bridge requests must use {expected_host}"),
        )
        .into_response();
    }
    let preflight = request.method() == Method::OPTIONS;
    let is_stop = request.uri().path() == "/v1/unpair";
    let response = if preflight {
        StatusCode::NO_CONTENT.into_response()
    } else if !is_stop {
        let allowed = state
            .limits
            .lock()
            .unwrap()
            .entry(origin.clone())
            .or_insert_with(|| RateLimit::new(600))
            .check();
        match allowed {
            Ok(()) => next.run(request).await,
            Err(error) => error.into_response(),
        }
    } else {
        next.run(request).await
    };
    let mut response = response;
    let headers = response.headers_mut();
    headers.insert(
        "access-control-allow-origin",
        HeaderValue::from_str(&origin).unwrap(),
    );
    headers.insert(
        "vary",
        HeaderValue::from_static(
            "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
        ),
    );
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    if preflight {
        headers.insert(
            "access-control-allow-methods",
            HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
        );
        headers.insert(
            "access-control-allow-headers",
            HeaderValue::from_static("Authorization, Content-Type"),
        );
        headers.insert(
            "access-control-allow-private-network",
            HeaderValue::from_static("true"),
        );
        headers.insert("access-control-max-age", HeaderValue::from_static("600"));
    }
    response
}
async fn status(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(
        serde_json::json!({"name":"LenseBridge","version":env!("CARGO_PKG_VERSION"),"protocolVersion":1,"platform":"windows","capabilities":["screen","pointer","keyboard","windows","watches"],"dryRun":state.config.dry_run,"port":state.config.port,"endpoint":format!("http://127.0.0.1:{}",state.config.port)}),
    )
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PairRequest {}
async fn pair(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: std::result::Result<Json<PairRequest>, JsonRejection>,
) -> Result<Json<crate::auth::SessionInfo>> {
    json(body)?;
    let origin = origin(&headers)?.to_owned();
    let _guard =
        state.pair_gate.clone().try_lock_owned().map_err(|_| {
            BridgeError::new("BUSY", "A native pairing confirmation is already open")
        })?;
    state.pair_limit.lock().unwrap().check()?;
    let approver = state.approver.clone();
    let approved_origin = origin.clone();
    let approved = tokio::task::spawn_blocking(move || approver.approve(&approved_origin))
        .await
        .map_err(|e| BridgeError::new("INTERNAL_ERROR", e.to_string()))?;
    if !approved {
        return Err(BridgeError::new(
            "PAIRING_DENIED",
            "Desktop access was declined in the Windows confirmation",
        ));
    }
    state.watches.clear();
    let session = state.auth.pair(origin);
    state.emit(
        &session,
        "bridge.paired",
        serde_json::json!({"sessionId":session.info.id}),
    );
    Ok(Json(session.info.clone()))
}
async fn unpair(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>> {
    let session = authenticated(&state, &headers, None)?;
    state.auth.revoke(&session.info.token);
    state.watches.clear();
    state.emit(
        &session,
        "bridge.unpaired",
        serde_json::json!({"sessionId":session.info.id}),
    );
    Ok(Json(serde_json::json!({"ok":true})))
}
async fn action(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: std::result::Result<Json<Action>, JsonRejection>,
) -> Result<Json<serde_json::Value>> {
    let action = json(body)?;
    action.validate()?;
    let session = authenticated(&state, &headers, Some(action.scope()))?;
    session.count_action()?;
    let action_id = id();
    let started = timestamp();
    state.emit(
        &session,
        "action.requested",
        serde_json::json!({"id":action_id,"action":action}),
    );
    let _guard = state
        .action_gate
        .clone()
        .try_lock_owned()
        .map_err(|_| BridgeError::new("BUSY", "Another desktop action is running"))?;
    session.check()?;
    state.emit(
        &session,
        "action.started",
        serde_json::json!({"id":action_id,"action":action}),
    );
    let backend = state.backend.clone();
    let execution = action.clone();
    let owner = session.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _guard = _guard;
        backend.execute(&execution, &owner)
    })
    .await
    .map_err(|e| BridgeError::new("INTERNAL_ERROR", e.to_string()))?;
    match result {
        Ok(result) => {
            let completed = timestamp();
            let response = serde_json::json!({"id":action_id,"ok":true,"startedAt":started,"completedAt":completed,"action":action,"result":result});
            state.emit(&session, "action.completed", response.clone());
            Ok(Json(response))
        }
        Err(error) => {
            state.emit(
                &session,
                "action.failed",
                serde_json::json!({"id":action_id,"error":error}),
            );
            Err(error)
        }
    }
}
async fn observe(
    state: AppState,
    headers: HeaderMap,
    options: CaptureOptions,
) -> Result<Json<Observation>> {
    options.validate()?;
    let session = authenticated(&state, &headers, Some("screen.read"))?;
    let permit = state
        .capture_gate
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| BridgeError::new("INTERNAL_ERROR", "Capture scheduler stopped"))?;
    session.check()?;
    let backend = state.backend.clone();
    let frame = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        backend.capture(&options)
    })
    .await
    .map_err(|e| BridgeError::new("INTERNAL_ERROR", e.to_string()))??;
    session.check()?;
    state.emit(&session,"observation.captured",serde_json::json!({"frameId":frame.observation.id,"width":frame.observation.width,"height":frame.observation.height}));
    Ok(Json(frame.observation))
}
async fn screen(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: std::result::Result<Json<CaptureOptions>, JsonRejection>,
) -> Result<Json<Observation>> {
    observe(state, headers, json(body)?).await
}
async fn default_screen(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Observation>> {
    observe(state, headers, CaptureOptions::default()).await
}
async fn monitors(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<Monitor>>> {
    authenticated(&state, &headers, Some("screen.read"))?;
    Ok(Json(state.backend.monitors()?))
}
async fn windows(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<DesktopWindow>>> {
    authenticated(&state, &headers, Some("windows.read"))?;
    Ok(Json(state.backend.windows()?))
}
async fn cursor(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Point>> {
    authenticated(&state, &headers, Some("pointer"))?;
    Ok(Json(state.backend.cursor()?))
}
async fn create_watch(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: std::result::Result<Json<WatchSpec>, JsonRejection>,
) -> Result<Json<WatchSpec>> {
    let session = authenticated(&state, &headers, Some("screen.read"))?;
    let spec = json(body)?;
    state.watches.start(
        spec.clone(),
        session.clone(),
        state.backend.clone(),
        state.capture_gate.clone(),
        state.events.clone(),
    )?;
    state.emit(
        &session,
        "watch.created",
        serde_json::json!({"watchId":spec.id}),
    );
    Ok(Json(spec))
}
async fn watches(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<WatchSpec>>> {
    let session = authenticated(&state, &headers, Some("screen.read"))?;
    Ok(Json(state.watches.list(&session)))
}
async fn remove_watch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let session = authenticated(&state, &headers, Some("screen.read"))?;
    state.watches.remove(&id, &session)?;
    state.emit(&session, "watch.removed", serde_json::json!({"watchId":id}));
    Ok(Json(serde_json::json!({"ok":true})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::MockInputExecutor;
    use axum::body::Body;
    use tower::ServiceExt;
    struct Allow;
    impl PairApprover for Allow {
        fn approve(&self, _: &str) -> bool {
            true
        }
    }
    fn setup() -> (AppState, Arc<MockInputExecutor>) {
        let backend = Arc::new(MockInputExecutor::new());
        (
            AppState::new(
                Config {
                    origins: ["https://test.example".into()].into(),
                    dry_run: false,
                    port: crate::startup::PORTS[0],
                },
                backend.clone(),
                Arc::new(Allow),
            ),
            backend,
        )
    }
    fn request(path: &str, method: &str, token: Option<&str>, body: &str) -> Request {
        let mut request = Request::builder()
            .uri(path)
            .method(method)
            .header("host", "127.0.0.1:17373")
            .header("origin", "https://test.example")
            .header("content-type", "application/json");
        if let Some(token) = token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        request.body(Body::from(body.to_owned())).unwrap()
    }
    #[tokio::test]
    async fn rejects_unknown_and_null_origins() {
        let (state, _) = setup();
        for origin in ["null", "https://attacker.example"] {
            let mut request = request("/v1/status", "GET", None, "");
            request
                .headers_mut()
                .insert("origin", HeaderValue::from_str(origin).unwrap());
            let response = router(state.clone()).oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            assert!(response
                .headers()
                .get("access-control-allow-origin")
                .is_none());
        }
    }
    #[tokio::test]
    async fn host_must_match_the_selected_loopback_port() {
        let (mut state, _) = setup();
        Arc::make_mut(&mut state.config).port = 17374;
        for host in [
            None,
            Some("127.0.0.1:17373"),
            Some("localhost:17374"),
            Some("attacker.example:17374"),
        ] {
            let mut req = request("/v1/status", "GET", None, "");
            req.headers_mut().remove("host");
            if let Some(host) = host {
                req.headers_mut()
                    .insert("host", HeaderValue::from_str(host).unwrap());
            }
            assert_eq!(
                router(state.clone()).oneshot(req).await.unwrap().status(),
                StatusCode::FORBIDDEN
            );
        }
        let mut req = request("/v1/status", "GET", None, "");
        req.headers_mut()
            .insert("host", HeaderValue::from_static("127.0.0.1:17374"));
        let response = router(state).oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        use http_body_util::BodyExt;
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let status: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(status["port"], 17374);
        assert_eq!(status["endpoint"], "http://127.0.0.1:17374");
    }
    #[tokio::test]
    async fn preflight_is_exact_and_has_private_network_compatibility() {
        let (state, _) = setup();
        let response = router(state)
            .oneshot(request("/v1/action", "OPTIONS", None, ""))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            "https://test.example"
        );
        assert_eq!(
            response.headers()["access-control-allow-private-network"],
            "true"
        );
    }
    #[tokio::test]
    async fn authenticated_action_uses_mock_and_unpair_revokes() {
        let (state, backend) = setup();
        let app = router(state.clone());
        let body = r#"{"type":"keyboard.type","text":"Hello 世界 😀"}"#;
        assert_eq!(
            app.clone()
                .oneshot(request("/v1/action", "POST", None, body))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let session = state.auth.pair("https://test.example".into());
        assert_eq!(
            app.clone()
                .oneshot(request(
                    "/v1/action",
                    "POST",
                    Some(&session.info.token),
                    body
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(backend.actions.lock().unwrap().len(), 1);
        assert_eq!(
            app.clone()
                .oneshot(request("/v1/unpair", "POST", Some(&session.info.token), ""))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            app.oneshot(request(
                "/v1/action",
                "POST",
                Some(&session.info.token),
                body
            ))
            .await
            .unwrap()
            .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(backend.actions.lock().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn malformed_action_has_machine_readable_error() {
        use http_body_util::BodyExt;
        let (state, backend) = setup();
        let session = state.auth.pair("https://test.example".into());
        let response = router(state)
            .oneshot(request(
                "/v1/action",
                "POST",
                Some(&session.info.token),
                r#"{"type":"shell","command":"anything"}"#,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["error"]["code"], "INVALID_REQUEST");
        assert!(backend.actions.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn pairing_uses_approver_and_returns_session() {
        use http_body_util::BodyExt;
        let (state, _) = setup();
        let response = router(state)
            .oneshot(request("/v1/pair", "POST", None, "{}"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["origin"], "https://test.example");
        assert!(value["token"].as_str().unwrap().len() > 40);
    }
}
