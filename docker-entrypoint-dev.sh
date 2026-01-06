#!/bin/sh
set -eu

cd /app

if [ ! -d node_modules ]; then
  pnpm install --frozen-lockfile
fi

exec "$@"
