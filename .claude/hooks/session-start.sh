#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# The cloud container ships a Node older than `engines` allows, and its
# preinstalled Chromium may not match the project's Playwright. This installs
# pinned Node/npm, locked dependencies and the matching Chromium, so the
# browser runner uses the same version as CI.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

NODE_VERSION="$(tr -d '[:space:]v' < .nvmrc)"
NPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
CACHE="$HOME/.cache/claude-session"
NODE_DIR="$CACHE/node-v$NODE_VERSION-linux-x64"

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

npm run test:browser:install

{
  echo "export PATH=\"$NODE_DIR/bin:\$PATH\""
  # Clear an override saved by an older hook; use node_modules and its lockfile.
  echo "unset PLAYWRIGHT_MODULE"
} >> "$CLAUDE_ENV_FILE"
