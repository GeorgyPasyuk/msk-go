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
PAST_DAYS = 45             # горизонт назад (вкладка «Прошлые события»)
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


def paginate(params):
    url = API + "?" + urllib.parse.urlencode(params)
    raw, page = [], 1
    while url and page <= MAX_PAGES:
        req = urllib.request.Request(url, headers={"User-Agent": "msk-go/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = json.loads(r.read().decode("utf-8"))
        raw.extend(payload.get("results", []))
        url = payload.get("next")
        page += 1
    return raw


def kudago_base(ev):
    """Общая часть события (без дат). None — если детское."""
    cats = ev.get("categories") or []
    if "kids" in cats:
        return None
    slug = next((c for c in cats if c in LABELS), (cats[0] if cats else "other"))
    place = ev.get("place") or {}
    place_title = place.get("title") if isinstance(place, dict) else None
    address = place.get("address") if isinstance(place, dict) else None
    coords = place.get("coords") if isinstance(place, dict) else None
    price = (ev.get("price") or "").strip()
    if ev.get("is_free"):
        price = "бесплатно"
    elif price:
        price = price[0].upper() + price[1:]
    desc = (ev.get("description") or "").strip()
    if len(desc) > 400:
        desc = desc[:397].rstrip() + "…"
    return {
        "title": ev.get("title", "Без названия").strip().capitalize(),
        "place": place_title,
        "address": address,
        "lat": coords.get("lat") if isinstance(coords, dict) else None,
        "lon": coords.get("lon") if isinstance(coords, dict) else None,
        "category": slug,
        "category_label": LABELS.get(slug, "Событие"),
        "price": price or "уточняется",
        "url": ev.get("site_url"),
        "source": "kudago",
        "featured": False,
        "description": desc,
    }


BASE_FIELDS = "id,title,dates,place,site_url,categories,price,is_free,description"


def fetch_past():
    """Прошедшие события за последние PAST_DAYS дней."""
    now = datetime.now()
    since_ts = int((now - timedelta(days=PAST_DAYS)).timestamp())
    now_ts = int(now.timestamp())
    raw = paginate({
        "lang": "ru", "location": LOCATION,
        "actual_since": since_ts, "actual_until": now_ts,
        "categories": ",".join(FUN_CATEGORIES), "page_size": PAGE_SIZE,
        "fields": BASE_FIELDS, "expand": "place", "text_format": "text", "order_by": "dates",
    })
    events, seen = [], set()
    for ev in raw:
        occ = []
        for d in ev.get("dates") or []:
            s, e = d.get("start") or 0, d.get("end") or 0
            if s <= 0:
                continue
            if e <= 0:
                e = s
            if e >= now_ts or e < since_ts:   # только завершившиеся в окне
                continue
            occ.append((s, e))
        if not occ:
            continue
        base = kudago_base(ev)
        if base is None:
            continue
        for s, e in sorted(occ, reverse=True)[:3]:
            key = (base["title"], s)
            if key in seen:
                continue
            seen.add(key)
            events.append({**base, "id": f"kudago-past-{ev.get('id')}-{s}",
                           "start": ts_to_local_iso(s), "end": ts_to_local_iso(e),
                           "allDay": False, "season_long": False})
    events.sort(key=lambda x: x["start"], reverse=True)
    return events[:70]


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
    raw = paginate(params)

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

        base = kudago_base(ev)
        if base is None:             # детские события не нужны
            continue

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

    past = []
    try:
        past = fetch_past()
        print(f"KudaGo прошлые: {len(past)} событий")
    except Exception as e:  # noqa: BLE001
        print(f"⚠ Прошлые недоступны ({e})", file=sys.stderr)

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
            "past": len(past),
        },
        "events": all_events,
        "past": past,
    }
    (DATA / "events.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Записано data/events.json: всего {len(all_events)} "
          f"(curated {len(curated)} + kudago {len(kudago)}) + прошлых {len(past)}")


if __name__ == "__main__":
    main()
