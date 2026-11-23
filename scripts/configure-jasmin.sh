#!/usr/bin/env bash
# =============================================================================
# configure-jasmin.sh
#
# One-shot bootstrap script that configures a freshly booted Jasmin gateway:
#   1. Creates a group + HTTP API user (what your backend authenticates as)
#   2. Creates an SMPP connector pointing at your upstream provider
#   3. Starts the connector
#   4. Creates a default MT (mobile-terminated) route sending everything
#      through that connector
#
# Jasmin is managed through jCli — a telnet-style interactive shell on port
# 8990. Rather than scripting telnet by hand, we pipe commands into it with
# `nc` and use the "persist" command at the end so config survives restarts.
#
# Requires: nc (netcat), a running docker-compose stack, and a filled-in .env
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Load .env
if [[ ! -f .env ]]; then
  echo "❌  No .env file found. Copy .env.example to .env and fill it in first."
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

JCLI_HOST="${JCLI_HOST:-localhost}"
JCLI_PORT="${JCLI_PORT:-8990}"
JCLI_USER="${JCLI_USER:-jcliadmin}"
JCLI_PASS="${JCLI_PASS:-jclipwd}"

echo "▶  Waiting for jCli on ${JCLI_HOST}:${JCLI_PORT} ..."
for i in {1..30}; do
  if (echo > /dev/tcp/${JCLI_HOST}/${JCLI_PORT}) >/dev/null 2>&1; then
    echo "✓  jCli is up"
    break
  fi
  sleep 2
done

CONNECTOR_ID="${DEFAULT_CONNECTOR_ID:-gh_provider}"

echo "▶  Sending configuration to jCli ..."

# Heredoc piped to nc. The leading blank lines after 'login/password' prompts
# are consumed by jCli. We use 'persist' at the end so changes survive a
# container restart.
{
  echo "${JCLI_USER}"
  sleep 0.5
  echo "${JCLI_PASS}"
  sleep 0.5

  # ---- 1. Group + user for the HTTP API ----
  echo "group -a"
  echo "gid ${JASMIN_USER}_grp"
  echo "ok"

  echo "user -a"
  echo "uid ${JASMIN_USER}"
  echo "gid ${JASMIN_USER}_grp"
  echo "username ${JASMIN_USER}"
  echo "password ${JASMIN_PASSWORD}"
  echo "ok"

  # ---- 2. SMPP client connector pointing at your provider ----
  echo "smppccm -a"
  echo "cid ${CONNECTOR_ID}"
  echo "host ${SMPP_PROVIDER_HOST}"
  echo "port ${SMPP_PROVIDER_PORT}"
  echo "username ${SMPP_PROVIDER_USERNAME}"
  echo "password ${SMPP_PROVIDER_PASSWORD}"
  echo "systype ${SMPP_PROVIDER_SYSTEM_TYPE}"
  echo "src_addr ${SMPP_SOURCE_ADDR}"
  echo "src_ton 5"           # Alphanumeric sender ID
  echo "src_npi 0"
  echo "dst_ton 1"           # International
  echo "dst_npi 1"
  echo "bind_to 30"
  echo "elink_interval 30"
  echo "submit_throughput 50"
  echo "ok"

  # ---- 3. Start the connector ----
  echo "smppccm -1 ${CONNECTOR_ID}"

  # ---- 4. Default MT route — sends everything through this connector ----
  echo "mtrouter -a"
  echo "type defaultroute"
  echo "connector smppc(${CONNECTOR_ID})"
  echo "rate 0.0"
  echo "ok"

  # ---- Persist so settings survive restart ----
  echo "persist"
  sleep 1
  echo "quit"
} | nc -q 2 "${JCLI_HOST}" "${JCLI_PORT}"

echo ""
echo "✓  Jasmin configured."
echo ""
echo "   HTTP API:    ${JASMIN_HTTP_URL}"
echo "   Username:    ${JASMIN_USER}"
echo "   Connector:   ${CONNECTOR_ID}  →  ${SMPP_PROVIDER_HOST}:${SMPP_PROVIDER_PORT}"
echo ""
echo "   Test it:     ./scripts/send-sms.sh +233244000000 'Hello from Jasmin'"
