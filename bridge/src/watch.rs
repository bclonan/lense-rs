use crate::{
    auth::Session,
    error::{BridgeError, Result},
    image_diff,
    input::InputExecutor,
    protocol::*,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    sync::{broadcast, Semaphore},
    task::JoinHandle,
};

#[derive(Clone)]
pub struct SessionEvent {
    pub session_id: String,
    pub event: Event,
}
struct Watch {
    spec: WatchSpec,
    session_id: String,
    cancelled: Arc<AtomicBool>,
    task: JoinHandle<()>,
}
#[derive(Default)]
pub struct WatchManager {
    watches: Mutex<HashMap<String, Watch>>,
}
impl WatchManager {
    pub fn start(
        &self,
        spec: WatchSpec,
        session: Arc<Session>,
        backend: Arc<dyn InputExecutor>,
        capture_gate: Arc<Semaphore>,
        events: broadcast::Sender<SessionEvent>,
    ) -> Result<()> {
        spec.validate()?;
        session.require("screen.read")?;
        let mut watches = self.watches.lock().unwrap();
        if let Some(existing) = watches.get(&spec.id) {
            if existing.session_id != session.info.id {
                return Err(BridgeError::new(
                    "WATCH_NOT_FOUND",
                    "Watch belongs to another session",
                ));
            }
        }
        if !watches.contains_key(&spec.id) && watches.len() >= 16 {
            return Err(BridgeError::new(
                "RATE_LIMITED",
                "At most 16 native watches can run at once",
            ));
        }
        if let Some(old) = watches.remove(&spec.id) {
            old.cancelled.store(true, Ordering::SeqCst);
            old.task.abort();
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancel = cancelled.clone();
        let saved = spec.clone();
        let owner = session.info.id.clone();
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(spec.interval_ms));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut prior = None;
            let mut prior_window = None;
            let mut unchanged = 0u32;
            loop {
                interval.tick().await;
                if cancel.load(Ordering::SeqCst) || session.check().is_err() {
                    break;
                }
                let permit = match capture_gate.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => break,
                };
                if cancel.load(Ordering::SeqCst) || session.check().is_err() {
                    break;
                }
                let source = backend.clone();
                let options = CaptureOptions {
                    target: spec.target.clone(),
                    region: spec.region.clone(),
                    max_dimension: Some(160),
                    quality: Some(0.6),
                };
                let captured = tokio::task::spawn_blocking(move || {
                    let _permit = permit;
                    source.capture(&options)
                })
                .await;
                if cancel.load(Ordering::SeqCst) || session.check().is_err() {
                    break;
                }
                let captured = match captured {
                    Ok(Ok(frame)) => frame,
                    other => {
                        let message = match other {
                            Ok(Err(error)) => error.to_string(),
                            Err(error) => error.to_string(),
                            _ => unreachable!(),
                        };
                        let _ = events.send(SessionEvent {
                            session_id: session.info.id.clone(),
                            event: Event::new(
                                "watch.failed",
                                serde_json::json!({"watchId":spec.id,"message":message}),
                            ),
                        });
                        continue;
                    }
                };
                let difference = prior
                    .as_ref()
                    .map(|frame| image_diff::difference(frame, &captured.pixels))
                    .unwrap_or(0.0);
                let changed = prior.is_some() && difference > spec.threshold;
                let window = captured
                    .observation
                    .foreground_window
                    .as_ref()
                    .map(|w| w.id.clone());
                let foreground_changed = prior.is_some() && window != prior_window;
                unchanged = if changed {
                    0
                } else {
                    unchanged.saturating_add(1)
                };
                let event = Event::new(
                    if changed || foreground_changed {
                        "watch.changed"
                    } else {
                        "watch.tick"
                    },
                    serde_json::json!({"watchId":spec.id,"changed":changed,"difference":difference,"frameId":captured.observation.id,"foregroundChanged":foreground_changed,"unchangedIntervals":unchanged}),
                );
                let _ = events.send(SessionEvent {
                    session_id: session.info.id.clone(),
                    event,
                });
                prior = Some(captured.pixels);
                prior_window = window;
            }
        });
        watches.insert(
            saved.id.clone(),
            Watch {
                spec: saved,
                session_id: owner,
                cancelled,
                task,
            },
        );
        Ok(())
    }
    pub fn list(&self, session: &Session) -> Vec<WatchSpec> {
        self.watches
            .lock()
            .unwrap()
            .values()
            .filter(|w| w.session_id == session.info.id)
            .map(|w| w.spec.clone())
            .collect()
    }
    pub fn remove(&self, id: &str, session: &Session) -> Result<()> {
        let mut watches = self.watches.lock().unwrap();
        if !watches
            .get(id)
            .is_some_and(|w| w.session_id == session.info.id)
        {
            return Err(BridgeError::new(
                "WATCH_NOT_FOUND",
                "No watch with this id belongs to the session",
            ));
        }
        if let Some(w) = watches.remove(id) {
            w.cancelled.store(true, Ordering::SeqCst);
            w.task.abort();
        }
        Ok(())
    }
    pub fn clear(&self) {
        let mut watches = self.watches.lock().unwrap();
        for (_, w) in watches.drain() {
            w.cancelled.store(true, Ordering::SeqCst);
            w.task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{auth::Auth, input::MockInputExecutor};
    #[tokio::test]
    async fn watches_tick_and_cancel_without_native_input() {
        let manager = WatchManager::default();
        let session = Auth::default().pair("https://a.test".into());
        let backend = Arc::new(MockInputExecutor::new());
        let (events, mut rx) = broadcast::channel(8);
        manager
            .start(
                WatchSpec {
                    id: "a".into(),
                    target: Target::default(),
                    region: None,
                    interval_ms: 500,
                    mode: "visual-change".into(),
                    threshold: 0.1,
                },
                session.clone(),
                backend.clone(),
                Arc::new(Semaphore::new(1)),
                events,
            )
            .unwrap();
        let event = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(event.event.kind, "watch.tick");
        manager.remove("a", &session).unwrap();
        assert!(manager.list(&session).is_empty());
        assert!(backend.actions.lock().unwrap().is_empty());
    }
}
