#!/usr/bin/env bash
# External readiness probe for bertapp.life — no secrets.
set -euo pipefail

HOST="${1:-app.bertapp.life}"
IP="$(dig +short "$HOST" A | head -1 || true)"

echo "host=$HOST"
echo "a_record=${IP:-none}"

if [[ -z "$IP" ]]; then
  echo "status=dns_fail"
  exit 1
fi

for p in 80 443 3000; do
  if timeout 3 bash -c "echo >/dev/tcp/$IP/$p" 2>/dev/null; then
    echo "port_$p=open"
  else
    echo "port_$p=closed"
  fi
done

http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://$HOST/" || echo curl_fail)"
echo "http_80=$http_code"

if curl -fsS --max-time 15 "https://$HOST/api/health" >/tmp/berta-health.json 2>/tmp/berta-health.err; then
  echo "https_health=ok"
  cat /tmp/berta-health.json
  echo
  echo "status=green"
  exit 0
fi

echo "https_health=fail"
sed -n '1,5p' /tmp/berta-health.err || true
echo "status=not_green"
exit 2
