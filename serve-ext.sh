#!/usr/bin/env bash
# Package the extension, serve it for download, then start the backend.
# Run from the project root:  ./serve-ext.sh
set -euo pipefail
cd "$(dirname "$0")"

bun run --filter @browserpilot/extension build

cd apps/extension/dist
tar cfv ../out.tar *
cd ..

python3 -m http.server 9876 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT   # ensure it dies even on Ctrl-C

echo
echo "Serving on http://localhost:9876/out.tar"
read -rp "Press Enter once you've downloaded the file to stop the server… "

kill "$SERVER_PID" 2>/dev/null || true
trap - EXIT
wait "$SERVER_PID" 2>/dev/null || true

cd ../..
exec bun run dev:backend
