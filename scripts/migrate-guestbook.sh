#!/usr/bin/env bash
#
# One-off guestbook migration. Posts old entries to /v2/guestbook/import,
# which assigns each a fresh UID (and current timestamp). Entries are sent
# OLDEST-FIRST so that, with newest-first insertion, the final display order
# matches the original export. Clove's own entry is intentionally omitted.
#
# Usage:
#   BASE_URL="https://doughmination.uk" BATTERY_KEY="your-key" ./migrate-guestbook.sh
#
set -euo pipefail

BASE_URL="${BASE_URL:-https://doughmination.uk}"
BATTERY_KEY="${BATTERY_KEY:?Set BATTERY_KEY to a valid X-Battery-Key}"

URL="${BASE_URL%/}/v2/guestbook/import"

post() {
  curl -sS --fail-with-body \
    -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "X-Battery-Key: ${BATTERY_KEY}" \
    -d "$1"
  echo
}

# Oldest -> newest.
post '{"name":"aureal","message":"Blehhh","website":"https://aureal.dev/"}' && \
post '{"name":"catcatcat","message":"cool I like it","website":"https://assumi.ng/"}' && \
post '{"name":"Cammy the Kitty >:3","message":"boop","website":"https://cammy-the-cat.com/"}' && \
post '{"name":"schuh","message":"very awesome website :3","website":"https://schuh.wtf/"}' && \
post '{"name":"mae","message":"hello cool website yes !","website":"https://milproject.xyz/"}' && \
post '{"name":"Ari","message":"girls kissing","website":"https://a.stupid.cat/"}' && \
post '{"name":"bitethekiwi","message":"this kitten is this cute patootie !!! love this indi-website, mine is not existing jet, but will be on goonen.org 🫰","website":"https://goonen.org/"}' && \
post '{"name":"BloxForLife","message":"my names blox and I block","website":"https://bloxforlife.github.io/BloxForLife/"}' && \
post '{"name":"akryst","message":":3","website":"https://akryst.moe/"}' && \
post '{"name":"aaaaaaaaaaaa","message":"aaaaaaaaaaaaaaa","website":""}' && \
post '{"name":"animosity","message":"hi","website":"https://0c6a.site/"}'

echo "Done — 11 entries imported."
