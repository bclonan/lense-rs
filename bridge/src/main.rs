use lense_bridge::{
    api::{self, AppState},
    config::Config,
    native::{self, NativeApprover, WindowsInputExecutor},
    startup::{self, Endpoint},
};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("LenseBridge could not start: {error}\nPress Enter to close.");
        let mut input = String::new();
        let _ = std::io::stdin().read_line(&mut input);
        std::process::exit(1);
    }
}
async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut config = Config::from_env()?;
    let listener = match startup::select_endpoint(&config).await? {
        Endpoint::Listening(listener) => listener,
        Endpoint::AlreadyRunning(port) => {
            println!("LenseBridge is already running at http://127.0.0.1:{port}.");
            print_setup(&config);
            println!(
                "Keep the original bridge window open. Press Enter to close this extra window."
            );
            let mut input = String::new();
            let _ = std::io::stdin().read_line(&mut input);
            return Ok(());
        }
    };
    config.port = listener.local_addr()?.port();
    let state = AppState::new(
        config.clone(),
        Arc::new(WindowsInputExecutor {
            dry_run: config.dry_run,
        }),
        Arc::new(NativeApprover),
    );
    native::initialize(state.auth.clone())?;
    println!(
        "LenseBridge {}\nReady at http://127.0.0.1:{}\n",
        env!("CARGO_PKG_VERSION"),
        config.port
    );
    if config.port != startup::PORTS[0] {
        println!("Another app is using the usual port. LenseBridge selected another local port. The website will find it automatically.\n");
    }
    print_setup(&config);
    println!("Keep this window open while using Lense. Close it to disconnect.\nPress Ctrl+Alt+Escape at any time to stop all desktop access.\n");
    println!("Trusted website origins:");
    for origin in &config.origins {
        println!("  {origin}");
    }
    if config.dry_run {
        println!("DRY RUN: input actions will be logged but never sent to Windows.");
    }
    let cleanup = state.clone();
    axum::serve(listener, api::router(state))
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            cleanup.auth.revoke_all();
            cleanup.watches.clear();
        })
        .await?;
    Ok(())
}

fn print_setup(config: &Config) {
    let mut websites: Vec<_> = config
        .origins
        .iter()
        .filter(|origin| origin.starts_with("https://"))
        .collect();
    websites.sort();
    if let Some(website) = websites.first() {
        println!("1. Open {website}");
    } else {
        println!("1. Open the Lense website.");
    }
    println!("2. Choose Desktop bridge, then Pair desktop. Allow local-network access if your browser asks.");
    println!("3. Review the Windows pairing prompt and choose Yes to grant desktop access.");
    println!("4. Choose a monitor or window in Lense, then observe it before sending input.");
    println!("Use the ? button on each page for its setup and usage steps.\n");
}
