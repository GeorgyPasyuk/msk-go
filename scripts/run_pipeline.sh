#!/bin/sh
# msk-go · один прогон пайплайна (для cron на VPS / Docker).
# Порядок как в GitHub Actions: ТГ → события (fetch_events вливает ТГ-события).
# Любой источник деградирует без ключа, KudaGo бескейный. Сетевые сбои не валят.
set -u

STAMP() { date -u +%Y-%m-%dT%H:%M:%SZ; }
echo "=== msk-go pipeline START $(STAMP) ==="

# self-heal: curated.json обязателен; если volume пуст — берём запечённую копию
if [ ! -f /app/data/curated.json ] && [ -f /app/seed/curated.json ]; then
  mkdir -p /app/data
  cp /app/seed/curated.json /app/data/curated.json
  echo "seed: curated.json восстановлен из образа"
fi

rc=0
echo "--- fetch_telegram $(STAMP) ---"
python3 /app/scripts/fetch_telegram.py || { echo "⚠ fetch_telegram exit=$?"; rc=1; }
echo "--- fetch_events $(STAMP) ---"
python3 /app/scripts/fetch_events.py || { echo "⚠ fetch_events exit=$?"; rc=1; }

echo "=== msk-go pipeline END $(STAMP) rc=$rc ==="
exit $rc
