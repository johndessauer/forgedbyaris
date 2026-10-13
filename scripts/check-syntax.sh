#!/usr/bin/env bash
# Wrapper so `scripts/check-syntax.sh` works too. Same as `npm run check`.
exec node "$(dirname "$0")/check-syntax.js"
