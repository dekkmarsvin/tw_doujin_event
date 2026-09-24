#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# The cloud container ships a Node older than `engines` allows, and its
# preinstalled Chromium matches one specific Playwright release. This installs
# the pinned Node and npm, the project's dependencies, and a matching
# Playwright outside node_modules (Playwright is deliberately not a
# devDependency), so lint, `npm test` and `npm run test:browser` work as-is.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

NODE_VERSION="$(tr -d '[:space:]v' < .nvmrc)"
NPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
# The container's Chromium lives in /opt/pw-browsers as chromium-1194, which is
# the build Playwright 1.56 expects. Change both together.
PLAYWRIGHT_VERSION="1.56"

CACHE="$HOME/.cache/claude-session"
NODE_DIR="$CACHE/node-v$NODE_VERSION-linux-x64"
PLAYWRIGHT_DIR="$CACHE/playwright-$PLAYWRIGHT_VERSION"

if [ ! -x "$NODE_DIR/bin/node" ]; then
  mkdir -p "$CACHE"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" | tar -xJ -C "$CACHE"
fi
export PATH="$NODE_DIR/bin:$PATH"

if [ "$(npm -v)" != "$NPM_VERSION" ]; then
  npm install -g "npm@$NPM_VERSION" --no-fund --no-audit --loglevel=error
fi

# `npm ci` rather than `npm install`: install rewrites package-lock.json here.
npm ci --no-fund --no-audit --loglevel=error

if [ ! -f "$PLAYWRIGHT_DIR/node_modules/playwright/index.mjs" ]; then
  mkdir -p "$PLAYWRIGHT_DIR"
  npm install --prefix "$PLAYWRIGHT_DIR" --no-save --no-fund --no-audit --loglevel=error "playwright@$PLAYWRIGHT_VERSION"
fi

{
  echo "export PATH=\"$NODE_DIR/bin:\$PATH\""
  echo "export PLAYWRIGHT_MODULE=\"$PLAYWRIGHT_DIR/node_modules/playwright/index.mjs\""
} >> "$CLAUDE_ENV_FILE"
