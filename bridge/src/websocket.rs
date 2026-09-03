use crate::{
    api::{origin, AppState},
    error::Result,
    protocol::Event,
};
use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket},
        State, WebSocketUpgrade,
    },
    http::HeaderMap,
    response::Response,
};
use serde::Deserialize;
use std::time::Duration;

pub async fn upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response> {
    let origin = origin(&headers)?.to_owned();
    Ok(ws
        .max_message_size(8192)
        .max_frame_size(8192)
        .on_upgrade(move |socket| events(socket, state, origin)))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Authenticate {
    token: String,
}
async fn events(mut socket: WebSocket, state: AppState, origin: String) {
    let auth = tokio::time::timeout(Duration::from_secs(5), socket.recv()).await;
    let session = match auth {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Authenticate>(&text)
            .ok()
            .and_then(|auth| state.auth.authenticate(&auth.token, &origin).ok()),
        _ => None,
    };
    let Some(session) = session else {
        let _=socket.send(Message::Text(serde_json::json!({"error":{"code":"INVALID_TOKEN","message":"The first WebSocket message must contain the paired token"}}).to_string().into())).await;
        let _ = socket
            .send(Message::Close(Some(CloseFrame {
                code: 1008,
                reason: "Pairing required".into(),
            })))
            .await;
        return;
    };
    let mut receiver = state.events.subscribe();
    let ready = Event::new(
        "bridge.connected",
        serde_json::json!({"sessionId":session.info.id}),
    );
    let _ = socket
        .send(Message::Text(serde_json::to_string(&ready).unwrap().into()))
        .await;
    let mut heartbeat = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            _=heartbeat.tick()=>{if session.check().is_err(){break;}},
            incoming=socket.recv()=>{match incoming{Some(Ok(Message::Ping(p)))=>{if socket.send(Message::Pong(p)).await.is_err(){break;}},Some(Ok(Message::Pong(_)))=>{},_=>break}},
            event=receiver.recv()=>{match event{Ok(event) if event.session_id==session.info.id=>{if session.check().is_err(){break;}if socket.send(Message::Text(serde_json::to_string(&event.event).unwrap().into())).await.is_err(){break;}},Err(tokio::sync::broadcast::error::RecvError::Closed)=>break,Err(tokio::sync::broadcast::error::RecvError::Lagged(count))=>{let event=Event::new("bridge.eventsDropped",serde_json::json!({"count":count}));if socket.send(Message::Text(serde_json::to_string(&event).unwrap().into())).await.is_err(){break;}},_=>{}}}
        }
    }
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code: if session.check().is_err() { 1008 } else { 1000 },
            reason: "Desktop events disconnected".into(),
        })))
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        api,
        config::Config,
        input::{MockInputExecutor, PairApprover},
    };
    use futures_util::{SinkExt, StreamExt};
    use std::sync::Arc;
    use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message as ClientMessage};

    struct Allow;
    impl PairApprover for Allow {
        fn approve(&self, _: &str) -> bool {
            true
        }
    }

    #[tokio::test]
    async fn websocket_requires_first_message_token_and_closes_on_revoke() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = AppState::new(
            Config {
                origins: ["https://test.example".into()].into(),
                dry_run: false,
                port: address.port(),
            },
            Arc::new(MockInputExecutor::new()),
            Arc::new(Allow),
        );
        let app = api::router(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let request = || {
            let mut request = format!("ws://{address}/v1/events")
                .into_client_request()
                .unwrap();
            request
                .headers_mut()
                .insert("origin", "https://test.example".parse().unwrap());
            request
        };
        let (mut rejected, _) = tokio_tungstenite::connect_async(request()).await.unwrap();
        rejected
            .send(ClientMessage::Text("{\"token\":\"wrong\"}".into()))
            .await
            .unwrap();
        let error = rejected.next().await.unwrap().unwrap().into_text().unwrap();
        assert!(error.contains("INVALID_TOKEN"));
        assert!(
            matches!(rejected.next().await.unwrap().unwrap(), ClientMessage::Close(Some(frame)) if u16::from(frame.code) == 1008)
        );

        let session = state.auth.pair("https://test.example".into());
        let (mut socket, _) = tokio_tungstenite::connect_async(request()).await.unwrap();
        socket
            .send(ClientMessage::Text(
                serde_json::json!({"token": session.info.token})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let ready = socket.next().await.unwrap().unwrap().into_text().unwrap();
        assert!(ready.contains("bridge.connected"));
        state.emit(
            &session,
            "watch.tick",
            serde_json::json!({"watchId": "sample"}),
        );
        let event = socket.next().await.unwrap().unwrap().into_text().unwrap();
        assert!(event.contains("watch.tick"));
        state.auth.revoke(&session.info.token);
        let close = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(
            matches!(close, ClientMessage::Close(Some(frame)) if u16::from(frame.code) == 1008)
        );
        server.abort();
    }
}
