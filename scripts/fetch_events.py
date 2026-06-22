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
import os
import re
import sys
import html
import time
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
        "price": price,
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


# --- Timepad: активности (спорт, экскурсии, еда, вечеринки, хобби, игры, здоровье) ---
TIMEPAD_TOKEN = os.environ.get("TIMEPAD_TOKEN")
# Только Спорт (376): пробежки, йога, сап, беговые клубы. Гастро=алкоголь,
# Вечеринки=позор/знакомства, Игры=мафия-клубы — отброшены после инспекции.
TIMEPAD_CATS = "376"
TIMEPAD_LABELS = {"376": "Спорт"}
TIMEPAD_CAP = 40


def fetch_timepad():
    if not TIMEPAD_TOKEN:
        print("Timepad: токен не задан, пропуск", file=sys.stderr)
        return []
    now = datetime.now()
    # старт с ближайшей пятницы (или сейчас, если уже пт–вс), иначе в первые 100
    # результатов попадают только будни и выходных не видно
    wd = now.weekday()
    min_dt = now if wd in (4, 5, 6) else (now + timedelta(days=(4 - wd)))
    params = {
        "cities": "Москва", "limit": 100, "sort": "starts_at",
        "starts_at_min": min_dt.strftime("%Y-%m-%dT00:00:00"),
        "category_ids": TIMEPAD_CATS,
        "fields": "id,name,starts_at,ends_at,location,categories,url,price_min",
    }
    url = "https://api.timepad.ru/v1/events?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + TIMEPAD_TOKEN, "User-Agent": "msk-go"})
    data = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    out, seen = [], set()
    for e in data.get("values", []):
        start = (e.get("starts_at") or "")[:19]
        if not start:
            continue
        # только выходные (пт–вс) — будний коммерческий спам отсекаем (ДО дедупа,
        # чтобы у рекуррентных событий оставить именно выходную сессию)
        try:
            if datetime.fromisoformat(start).weekday() not in (4, 5, 6):
                continue
        except ValueError:
            continue
        # схлопываем рекуррентные одинаковые (идут каждые выходные)
        tkey = html.unescape(e.get("name", "")).strip().lower()[:32]
        if tkey in seen:
            continue
        seen.add(tkey)
        loc = e.get("location") or {}
        coords = loc.get("coordinates")
        lat = lon = None
        cats = e.get("categories") or []
        slug_id = str(cats[0].get("id")) if cats else ""
        end = (e.get("ends_at") or "")[:19] or None
        if isinstance(coords, list) and len(coords) == 2:
            try:
                lat, lon = float(coords[0]), float(coords[1])
            except (TypeError, ValueError):
                lat = lon = None
        pmin = e.get("price_min")
        price = "бесплатно" if pmin == 0 else (f"от {pmin} ₽" if pmin else "")
        out.append({
            "id": f"timepad-{e.get('id')}",
            "title": html.unescape(e.get("name", "").strip()),
            "start": start, "end": end, "allDay": False, "season_long": False,
            "place": html.unescape(loc.get("name") or "") or loc.get("city") or "Москва",
            "address": loc.get("address"),
            "lat": lat, "lon": lon,
            "category": "timepad", "category_label": TIMEPAD_LABELS.get(slug_id, "Активность"),
            "price": price, "url": e.get("url"),
            "source": "timepad", "featured": False, "description": "",
        })
    return out[:TIMEPAD_CAP]


GEO_CACHE_FILE = DATA / "geo_cache.json"


def geocode_missing(events, limit=25):
    """Проставляет lat/lon событиям с адресом, но без координат — через Nominatim (OSM, бесплатно).
    Кэш в geo_cache.json; вежливый rate-limit 1 req/sec; не валит сборку."""
    cache = {}
    if GEO_CACHE_FILE.exists():
        try:
            cache = json.loads(GEO_CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    calls = 0
    for e in events:
        if e.get("lat") and e.get("lon"):
            continue
        q = e.get("address") or e.get("place")
        if not q:
            continue
        if not q.lower().startswith(("москва", "moscow")):
            q = "Москва, " + q
        if q in cache:
            hit = cache[q]
        elif calls < limit:
            hit = None
            try:
                url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
                    {"format": "json", "q": q, "limit": 1, "accept-language": "ru"})
                req = urllib.request.Request(url, headers={"User-Agent": "msk-go/1.0 (github.com/GeorgyPasyuk/msk-go)"})
                res = json.loads(urllib.request.urlopen(req, timeout=15).read().decode())
                if res:
                    hit = [round(float(res[0]["lat"]), 6), round(float(res[0]["lon"]), 6)]
            except Exception:
                hit = None
            cache[q] = hit
            calls += 1
            time.sleep(1.1)
        else:
            continue
        if hit:
            e["lat"], e["lon"] = hit[0], hit[1]
    try:
        GEO_CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass
    print(f"Геокодинг: новых запросов {calls}, событий с координатами стало "
          f"{sum(1 for e in events if e.get('lat'))}/{len(events)}")


# --- Кросс-источниковый дедуп (KudaGo + Timepad + curated + Telegram) ---
# Один фестиваль приходит из нескольких источников → группируем по
# (нормализованное название + день) и оставляем одну запись, добивая её
# недостающими полями (координаты/цена/ссылка) из дублей. Разные площадки
# с одинаковым названием в один день (франшизы) разводим по близости меток.
SOURCE_PRIORITY = {"curated": 3, "kudago": 2, "timepad": 1, "telegram": 0}
_TITLE_JUNK = re.compile(r"[^a-zа-я0-9 ]+")


def _norm_title(t):
    t = (t or "").lower().replace("ё", "е")
    t = _TITLE_JUNK.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def _dup_score(ev):
    """Насколько запись «богатая» — чем больше ценных полей, тем выше."""
    s = 0
    if ev.get("lat") and ev.get("lon"):
        s += 4
    if ev.get("price"):
        s += 2
    if ev.get("url"):
        s += 2
    if ev.get("description"):
        s += 1
    if ev.get("address"):
        s += 1
    return s


def _far_apart(a, b):
    """True, если у обоих есть координаты и они дальше ~2 км (разные площадки)."""
    if not (a.get("lat") and a.get("lon") and b.get("lat") and b.get("lon")):
        return False
    d = ((a["lat"] - b["lat"]) ** 2 + (a["lon"] - b["lon"]) ** 2) ** 0.5
    return d > 0.02   # ~2 км в градусах для широты Москвы


def _backfill(primary, other):
    for f in ("lat", "lon", "price", "url", "address", "description", "place"):
        if not primary.get(f) and other.get(f):
            primary[f] = other[f]
    primary["featured"] = primary.get("featured") or other.get("featured")
    return primary


def dedupe(events):
    groups, order, singles = {}, [], []
    for ev in events:
        key = (_norm_title(ev.get("title")), (ev.get("start") or "")[:10])
        if not key[0] or not key[1]:        # без названия/даты не трогаем
            singles.append(ev)
            continue
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(ev)

    out, removed = [], 0
    for key in order:
        grp = sorted(groups[key],
                     key=lambda e: (_dup_score(e), SOURCE_PRIORITY.get(e.get("source"), 0)),
                     reverse=True)
        clusters = []                       # разводим одноимённые на разных площадках
        for ev in grp:
            for c in clusters:
                if not _far_apart(c[0], ev):
                    c.append(ev)
                    break
            else:
                clusters.append([ev])
        for c in clusters:
            primary = c[0]
            for other in c[1:]:
                _backfill(primary, other)
            removed += len(c) - 1
            out.append(primary)
    out.extend(singles)
    if removed:
        print(f"Кросс-дедуп: убрано {removed} дублей ({len(events)} → {len(out)})")
    return out


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

    timepad = []
    try:
        timepad = fetch_timepad()
        print(f"Timepad: получено {len(timepad)} событий")
    except Exception as e:  # noqa: BLE001
        print(f"⚠ Timepad недоступен ({e})", file=sys.stderr)

    past = []
    try:
        past = fetch_past()
        print(f"KudaGo прошлые: {len(past)} событий")
    except Exception as e:  # noqa: BLE001
        print(f"⚠ Прошлые недоступны ({e})", file=sys.stderr)

    all_events = curated + kudago + timepad
    try:
        geocode_missing(all_events)
    except Exception as e:  # noqa: BLE001
        print(f"⚠ геокодинг пропущен ({e})", file=sys.stderr)
    try:
        all_events = dedupe(all_events)     # координаты уже проставлены — точнее разводим площадки
    except Exception as e:  # noqa: BLE001
        print(f"⚠ дедуп пропущен ({e})", file=sys.stderr)
    all_events.sort(key=lambda x: (x.get("season_long", False), x.get("start", "")))

    out = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "kudago_ok": ok,
        "counts": {
            "total": len(all_events),
            "curated": len(curated),
            "kudago": len(kudago),
            "timepad": len(timepad),
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
