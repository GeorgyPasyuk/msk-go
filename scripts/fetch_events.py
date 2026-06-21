#!/usr/bin/env python3
"""
msk-go · сборщик событий Москвы.

Тянет открытый KudaGo API (ключ не нужен), фильтрует «прикольные» категории
(не филармония/выставки), мёрджит с ручным data/curated.json и пишет
data/events.json, который читает фронт.

Только стандартная библиотека — в GitHub Actions ничего ставить не нужно.
Любая сетевая ошибка KudaGo НЕ валит сборку: страница останется жить
на курируемых событиях.
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

API = "https://kudago.com/public-api/v1.4/events/"
LOCATION = "msk"
WINDOW_DAYS = 180          # горизонт вперёд
SEASON_END = "2026-09-30T23:59:00"
SEASON_SPAN_DAYS = 25      # длиннее => «Всё лето», а не точечное событие
PAGE_SIZE = 100
MAX_PAGES = 12

# Категории KudaGo, которые нам интересны (активности, не филармония).
# Slug'и сверены с /event-categories/ — иначе API отдаёт 400 Bad categories.
FUN_CATEGORIES = [
    "festival", "party", "holiday", "recreation", "entertainment",
    "quest", "tour", "fashion",
    "yarmarki-razvlecheniya-yarmarki",
]

# slug -> человекочитаемый ярлык
LABELS = {
    "festival": "Фестиваль", "party": "Вечеринка", "holiday": "Праздник",
    "recreation": "Отдых", "entertainment": "Развлечения", "quest": "Квест",
    "tour": "Экскурсия", "fashion": "Мода", "concert": "Концерт",
    "yarmarki-razvlecheniya-yarmarki": "Ярмарка",
    "exhibition": "Выставка", "kids": "Детям", "education": "Лекция",
    "theater": "Театр", "cinema": "Кино", "other": "Другое",
}


def ts_to_local_iso(ts):
    """KudaGo-таймстемп -> московское «настенное» время, naive ISO."""
    dt = datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None)
    return dt.replace(microsecond=0).isoformat()


def fetch_kudago():
    now = datetime.now()
    since = int(now.timestamp())
    until = int((now + timedelta(days=WINDOW_DAYS)).timestamp())
    window_end_ts = until
    # «эндлесс» события KudaGo помечает огромным end — порог отсечки
    endless_ts = int((now + timedelta(days=365 * 3)).timestamp())

    params = {
        "lang": "ru",
        "location": LOCATION,
        "actual_since": since,
        "actual_until": until,
        "categories": ",".join(FUN_CATEGORIES),
        "page_size": PAGE_SIZE,
        "fields": "id,title,dates,place,site_url,categories,price,is_free,description",
        "expand": "place",
        "text_format": "text",
        "order_by": "dates",
    }
    url = API + "?" + urllib.parse.urlencode(params)

    raw = []
    page = 1
    while url and page <= MAX_PAGES:
        req = urllib.request.Request(url, headers={"User-Agent": "msk-go/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = json.loads(r.read().decode("utf-8"))
        raw.extend(payload.get("results", []))
        url = payload.get("next")
        page += 1

    season_end = datetime.fromisoformat(SEASON_END)
    today_start = int(datetime(now.year, now.month, now.day).timestamp())

    events = []
    seen = set()
    for ev in raw:
        dates = ev.get("dates") or []
        valid = []
        endless = False
        for d in dates:
            s = d.get("start") or 0
            e = d.get("end") or 0
            if e <= 0 and s <= 0:
                continue
            if e <= 0:
                e = s
            # Отрицательный start = бессрочное/непрерывное событие (sentinel KudaGo)
            if s <= 0:
                endless = True
                s_eff = today_start
            else:
                s_eff = s
            if e < today_start or s_eff > window_end_ts:
                continue
            valid.append((max(s_eff, today_start), e))
        if not valid:
            continue

        cats = ev.get("categories") or []
        if "kids" in cats:           # детские события не нужны
            continue
        slug = next((c for c in cats if c in LABELS), (cats[0] if cats else "other"))
        label = LABELS.get(slug, "Событие")

        place = ev.get("place") or {}
        place_title = place.get("title") if isinstance(place, dict) else None
        address = place.get("address") if isinstance(place, dict) else None

        price = (ev.get("price") or "").strip()
        if ev.get("is_free"):
            price = "бесплатно"
        elif price:
            price = price[0].upper() + price[1:]

        desc = (ev.get("description") or "").strip()
        if len(desc) > 400:
            desc = desc[:397].rstrip() + "…"

        base = {
            "title": ev.get("title", "Без названия").strip().capitalize(),
            "place": place_title,
            "address": address,
            "category": slug,
            "category_label": label,
            "price": price or "уточняется",
            "url": ev.get("site_url"),
            "source": "kudago",
            "featured": False,
            "description": desc,
        }

        starts = [s for s, _ in valid]
        ends = [e for _, e in valid]
        span_days = (max(ends) - min(starts)) / 86400
        endless = endless or max(ends) >= endless_ts

        if endless or span_days > SEASON_SPAN_DAYS:
            key = (base["title"], "season")
            if key in seen:
                continue
            seen.add(key)
            end_ts = min(max(ends), int(season_end.timestamp()))
            events.append({
                **base,
                "id": f"kudago-{ev.get('id')}-season",
                "start": ts_to_local_iso(max(min(starts), today_start)),
                "end": ts_to_local_iso(end_ts),
                "allDay": True,
                "season_long": True,
            })
        else:
            for s, e in sorted(valid)[:6]:
                key = (base["title"], s)
                if key in seen:
                    continue
                seen.add(key)
                events.append({
                    **base,
                    "id": f"kudago-{ev.get('id')}-{s}",
                    "start": ts_to_local_iso(s),
                    "end": ts_to_local_iso(e),
                    "allDay": False,
                    "season_long": False,
                })
    return events


def load_curated():
    path = DATA / "curated.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("events", [])


def main():
    curated = load_curated()
    kudago, ok = [], False
    try:
        kudago = fetch_kudago()
        ok = True
        print(f"KudaGo: получено {len(kudago)} событий")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        print(f"⚠ KudaGo недоступен ({e}). Пишу только курируемые.", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — не валим сборку ни на чём
        print(f"⚠ Ошибка разбора KudaGo ({e}). Пишу только курируемые.", file=sys.stderr)

    all_events = curated + kudago
    all_events.sort(key=lambda x: (x.get("season_long", False), x.get("start", "")))

    out = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "kudago_ok": ok,
        "counts": {
            "total": len(all_events),
            "curated": len(curated),
            "kudago": len(kudago),
            "season_long": sum(1 for e in all_events if e.get("season_long")),
        },
        "events": all_events,
    }
    (DATA / "events.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Записано data/events.json: всего {len(all_events)} "
          f"(curated {len(curated)} + kudago {len(kudago)})")


if __name__ == "__main__":
    main()
