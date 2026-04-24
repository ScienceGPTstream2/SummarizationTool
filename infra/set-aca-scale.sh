#!/usr/bin/env bash
set -euo pipefail

# Business-hours scaler for Azure Container Apps.
#
# IMPORTANT: Azure Container Apps does not allow maxReplicas=0.
# So our "night" mode is implemented as:
#   minReplicas=0, maxReplicas=1
# which allows true scale-to-zero when idle, while still permitting startup
# if someone intentionally hits the app after hours.

RG="${RG:-HcSx-ScienceGPT3-XerographicMockingbird-vNet-rg}"
SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-${SUBSCRIPTION_ID:-}}"
TIMEZONE="${TIMEZONE:-America/Toronto}"
MODE="${1:-auto}"

APPS=(
  "summarization-frontend"
  "summarization-backend"
  "docling-service"
  "vllm-service"
)

DAY_MIN="${DAY_MIN:-1}"
DAY_MAX="${DAY_MAX:-1}"
NIGHT_MIN="${NIGHT_MIN:-0}"
NIGHT_MAX="${NIGHT_MAX:-1}"

resolve_mode() {
  python3 - "$TIMEZONE" <<'PY'
from datetime import datetime
from zoneinfo import ZoneInfo
import sys

tz = ZoneInfo(sys.argv[1])
now = datetime.now(tz)
# Monday=0 ... Sunday=6
is_weekday = now.weekday() < 5
is_business_hours = 9 <= now.hour < 17
print("day" if (is_weekday and is_business_hours) else "night")
PY
}

case "$MODE" in
  auto)
    MODE="$(resolve_mode)"
    ;;
  day|night)
    ;;
  *)
    echo "Usage: $0 [auto|day|night]" >&2
    exit 2
    ;;
esac

if [[ "$MODE" == "day" ]]; then
  MIN_REPLICAS="$DAY_MIN"
  MAX_REPLICAS="$DAY_MAX"
else
  MIN_REPLICAS="$NIGHT_MIN"
  MAX_REPLICAS="$NIGHT_MAX"
fi

echo "Applying ACA scale mode='$MODE' timezone='$TIMEZONE' minReplicas=$MIN_REPLICAS maxReplicas=$MAX_REPLICAS"

for app in "${APPS[@]}"; do
  echo "→ Updating $app"
  cmd=(az containerapp update --name "$app" --resource-group "$RG" --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" --output none)
  if [[ -n "$SUBSCRIPTION_ID" ]]; then
    cmd+=(--subscription "$SUBSCRIPTION_ID")
  fi
  "${cmd[@]}"
done

query='[].{Name:name, Min:properties.template.scale.minReplicas, Max:properties.template.scale.maxReplicas, Status:properties.runningStatus}'
if [[ -n "$SUBSCRIPTION_ID" ]]; then
  az containerapp list --resource-group "$RG" --subscription "$SUBSCRIPTION_ID" --query "$query" --output table
else
  az containerapp list --resource-group "$RG" --query "$query" --output table
fi