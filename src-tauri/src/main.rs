#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    // Set a panic hook that logs to stderr before unwinding.
    // This ensures panics are visible in logs instead of silently crashing.
    // With panic = "abort" removed from Cargo.toml, unwinding is now possible
    // and catch_unwind can be used for graceful error reporting.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[PANIC] {}", info);
    }));

    aurawrite_lib::run()
}
