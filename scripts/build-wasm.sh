#!/usr/bin/env bash
# Builds the engine for the browser and copies it into the web app.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release -p engine-wasm --target wasm32-unknown-unknown
mkdir -p web/public
cp target/wasm32-unknown-unknown/release/engine_wasm.wasm web/public/engine.wasm
ls -l web/public/engine.wasm
