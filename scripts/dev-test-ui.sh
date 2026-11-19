#!/usr/bin/env bash
#
# Study Hub UI Test Instance Launcher:
# Launches an isolated instance with mock/sample study modes on port 3005.
#
#   npm run dev:test-ui
#   bash scripts/dev-test-ui.sh
#   bash scripts/dev-test-ui.sh --port 3006
#

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="3005"
DATA_DIR="$ROOT/.fresh-data"

while [ $# -gt 0 ]; do
	case "$1" in
	--port)
		[ $# -ge 2 ] || { echo "error: --port needs a value" >&2; exit 1; }
		PORT="$2"
		shift 2
		;;
	--port=*)
		PORT="${1#--port=}"
		shift
		;;
	-h | --help)
		echo "Usage: $0 [--port PORT]"
		exit 0
		;;
	*)
		echo "error: unknown flag: $1" >&2
		exit 1
		;;
	esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
	echo "error: --port must be a number, got \"$PORT\"" >&2
	exit 1
fi

echo "── Setting up mock data & plugins ──────────────────────"
mkdir -p "$DATA_DIR/plugins"

# Seed base settings/graph from existing config if available, or create defaults
USER_CONFIG="$HOME/.config/LearnHarness/data"
if [ -d "$USER_CONFIG" ]; then
	[ -f "$DATA_DIR/settings.json" ] || cp "$USER_CONFIG/settings.json" "$DATA_DIR/" 2>/dev/null || true
	[ -f "$DATA_DIR/chat-organization.json" ] || cp "$USER_CONFIG/chat-organization.json" "$DATA_DIR/" 2>/dev/null || true
	[ -d "$DATA_DIR/graph" ] || cp -r "$USER_CONFIG/graph" "$DATA_DIR/" 2>/dev/null || true
	[ -d "$DATA_DIR/chats" ] || cp -r "$USER_CONFIG/chats" "$DATA_DIR/" 2>/dev/null || true
fi

# Fallback minimal settings.json if still missing
if [ ! -f "$DATA_DIR/settings.json" ]; then
	cat << 'EOF' > "$DATA_DIR/settings.json"
{
	"version": 1,
	"general": { "autoUpdate": false },
	"appearance": { "theme": "nvchad-onedark", "sessionNameSerif": true }
}
EOF
fi

# Copy mock plugins into isolated data dir
MOCK_PLUGINS=("concurrency-lab" "multi-mode" "algo-visualizer" "quantum-sim")
for plugin in "${MOCK_PLUGINS[@]}"; do
	if [ -d "$ROOT/examples/plugins/$plugin" ]; then
		rm -rf "$DATA_DIR/plugins/$plugin"
		cp -r "$ROOT/examples/plugins/$plugin" "$DATA_DIR/plugins/$plugin"
	fi
done

# Write enabled plugins state
cat << 'EOF' > "$DATA_DIR/plugins-state.json"
{
	"version": 1,
	"enabled": {
		"coding-questions": false,
		"drawing-pad": false,
		"flashcards": true,
		"rich-code-blocks": true,
		"concurrency-lab": true,
		"multi-mode": true,
		"algo-visualizer": true,
		"quantum-sim": true
	}
}
EOF

export LH_DATA_DIR="$DATA_DIR"
export PORT

echo "── Study Hub UI Test Instance ──────────────────────────"
echo "  Study Hub URL : http://localhost:$PORT/study-hub"
echo "  Full App URL  : http://localhost:$PORT"
echo "  Data dir      : $DATA_DIR"
echo "  Mock plugins  : ${MOCK_PLUGINS[*]}"
echo "────────────────────────────────────────────────────────"

cd "$ROOT"
# Ensure plugin builds are ready
npm run plugins:build-core
npm run plugins:build-authoring

exec npx next dev -H localhost -p "$PORT"
