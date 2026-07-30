#!/usr/bin/env sh
set -eu

if [ -f .env ]; then
  docker run --rm -p 3000:3000 --env-file .env equipchain-backend:local
else
  docker run --rm -p 3000:3000 equipchain-backend:local
fi
