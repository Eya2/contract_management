#!/bin/sh
# Applies pending database migrations, then starts the API.
# Migrations are safe to run on every start: `migrate deploy` only applies new ones.
set -e
if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  npx prisma migrate deploy
fi
exec "$@"
