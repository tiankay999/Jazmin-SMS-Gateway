#!/usr/bin/env bash
# =============================================================================
# send-sms.sh — one-liner smoke test for the Jasmin HTTP API
#
# Usage: ./scripts/send-sms.sh <recipient> "<message>"
# Example: ./scripts/send-sms.sh +233244123456 "Hello from Qrollix"
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [[ ! -f .env ]]; then
  echo "❌  No .env file. Copy .env.example to .env first."
  exit 1
fi
set -a; source .env; set +a

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <recipient-e164> <message>"
  exit 1
fi

TO="$1"
MESSAGE="$2"

curl -sS --get \
  --data-urlencode "username=${JASMIN_USER}" \
  --data-urlencode "password=${JASMIN_PASSWORD}" \
  --data-urlencode "to=${TO}" \
  --data-urlencode "from=${SMPP_SOURCE_ADDR}" \
  --data-urlencode "content=${MESSAGE}" \
  "${JASMIN_HTTP_URL}/send"
echo
