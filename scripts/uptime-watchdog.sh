#!/usr/bin/env bash
# uptime-watchdog.sh — external HTTP uptime check, independent of the box it watches.
#
# Why this exists: on 2026-07-30 prod wedged (process alive, event loop dead) for
# 1h45m and nobody found out until a human noticed. `restart: unless-stopped` never
# acts on health status, so a hung-but-running container stays dark forever. This
# script is the detection half of the fix (autoheal is the recovery half) — see
# docs/PROD-RESILIENCE-BRIEF.md. It must run off the box it monitors: a monitor
# that dies with the box it watches is not a monitor.
#
# Usage:
#   scripts/uptime-watchdog.sh [--dry-run]
#
# Config (env, nothing hardcoded):
#   WATCHDOG_TARGETS    space-separated URLs to check
#                        (default: prod + stage /login)
#   WATCHDOG_ALERT_TO   alert recipient. REQUIRED — script fails loudly if unset,
#                        both because a silently-dropped alert defeats the whole
#                        point, and because the address must never be guessed
#                        (see brief §1.3 — do not use any address found elsewhere).
#   RESEND_API_KEY       alert transport (same provider the app already uses).
#                        Required unless --dry-run / WATCHDOG_DRY_RUN=1.
#   WATCHDOG_STATE_DIR   default /var/lib/edgex-watchdog — per-target failure
#                        count + alert-sent flag, so repeat cron runs know
#                        whether an outage is new, ongoing, or just recovered.
#   WATCHDOG_TIMEOUT     curl timeout in seconds (default 10)
#
# Behavior:
#   - Two consecutive failures before alerting (one blip must not page anyone).
#   - Alert once per outage, not once per check (state file suppresses repeats).
#   - Sends a recovery notice once a target that alerted returns to 200.
#   - Always exits 0 — this runs from cron; a nonzero exit just spams cron mail
#     and tells nobody anything useful. Real signal goes out via the alert email
#     and stdout (journalctl/cron mail), not the exit code.
set -u

DRY_RUN=false
for arg in "$@"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN=true
done
[ "${WATCHDOG_DRY_RUN:-0}" = "1" ] && DRY_RUN=true

WATCHDOG_TARGETS="${WATCHDOG_TARGETS:-https://edgex.zunkireelabs.com/login https://dev-lead-crm.zunkireelabs.com/login}"
STATE_DIR="${WATCHDOG_STATE_DIR:-/var/lib/edgex-watchdog}"
TIMEOUT="${WATCHDOG_TIMEOUT:-10}"

log() {
  echo "$(date -u +%FT%TZ) $*"
}

if [ -z "${WATCHDOG_ALERT_TO:-}" ]; then
  log "FATAL: WATCHDOG_ALERT_TO is not set. Refusing to run silently unalerted — set it explicitly, do not guess it."
  exit 0
fi

if ! $DRY_RUN && [ -z "${RESEND_API_KEY:-}" ]; then
  log "FATAL: RESEND_API_KEY is not set (and --dry-run/WATCHDOG_DRY_RUN=1 not given). Cannot send alerts."
  exit 0
fi

mkdir -p "$STATE_DIR" 2>/dev/null
if [ ! -w "$STATE_DIR" ]; then
  log "FATAL: state dir $STATE_DIR is not writable."
  exit 0
fi

send_email() {
  # send_email <subject> <body>
  subject="$1"
  body="$2"

  if $DRY_RUN; then
    log "[dry-run] would send email to $WATCHDOG_ALERT_TO"
    log "[dry-run] subject: $subject"
    log "[dry-run] body:"
    printf '%s\n' "$body" | sed 's/^/[dry-run]   /'
    return 0
  fi

  payload=$(printf '{"from":"EdgeX Watchdog <alerts@zunkireelabs.com>","to":["%s"],"subject":"%s","text":"%s"}' \
    "$WATCHDOG_ALERT_TO" \
    "$(printf '%s' "$subject" | sed 's/"/\\"/g')" \
    "$(printf '%s' "$body" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')")

  http_code=$(curl -s -o /tmp/watchdog-resend-response.$$ -w '%{http_code}' \
    --max-time "$TIMEOUT" \
    -X POST 'https://api.resend.com/emails' \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$payload")

  if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
    log "WARN: Resend send failed (HTTP $http_code): $(cat /tmp/watchdog-resend-response.$$ 2>/dev/null)"
  else
    log "alert email sent to $WATCHDOG_ALERT_TO (HTTP $http_code)"
  fi
  rm -f /tmp/watchdog-resend-response.$$
}

state_file_for() {
  # deterministic, filesystem-safe key per target URL
  echo "$STATE_DIR/$(printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_')"
}

check_target() {
  url="$1"
  state_file="$(state_file_for "$url")"

  fail_count=0
  alerted=0
  if [ -f "$state_file" ]; then
    # format: "<fail_count> <alerted>"
    read -r fail_count alerted < "$state_file" 2>/dev/null || { fail_count=0; alerted=0; }
  fi

  http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$url" 2>/dev/null)
  [ -z "$http_code" ] && http_code="000"
  now="$(date -u +%FT%TZ)"

  if [ "$http_code" = "200" ]; then
    if [ "$alerted" = "1" ]; then
      log "RECOVERY: $url is back (HTTP $http_code)"
      send_email \
        "[EdgeX Watchdog] RECOVERED: $url" \
        "Target: $url
Status: RECOVERED (HTTP $http_code)
Time (UTC): $now"
    else
      log "OK: $url (HTTP $http_code)"
    fi
    echo "0 0" > "$state_file"
    return 0
  fi

  fail_count=$((fail_count + 1))
  log "FAIL #$fail_count: $url (HTTP $http_code)"

  if [ "$fail_count" -ge 2 ] && [ "$alerted" != "1" ]; then
    send_email \
      "[EdgeX Watchdog] DOWN: $url" \
      "Target: $url
Status: HTTP $http_code
Consecutive failures: $fail_count
Time (UTC): $now"
    alerted=1
  elif [ "$fail_count" -ge 2 ]; then
    log "suppressing duplicate alert for $url (already alerted this outage)"
  fi

  echo "$fail_count $alerted" > "$state_file"
  return 0
}

for target in $WATCHDOG_TARGETS; do
  check_target "$target"
done

exit 0
