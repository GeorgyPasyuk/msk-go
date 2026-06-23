#!/usr/bin/env python3
"""
msk-go · лента из телеграм-каналов.

Тянет публичный веб-превью t.me/s/<channel> (без авторизации и ключей),
парсит последние посты и пишет data/telegram.json. Приоритет — полнота:
забираем все посты за окно; дату/место распознаём best-effort регулярками
(может не находиться — это ок). Каждый пост ссылается на оригинал в канале.

Только стандартная библиотека. Сетевые ошибки не валят сборку.
"""

import json
import os
import re
import sys
import html
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Площадки каналов: место известно по каналу → координаты хардкодим (карта работает без парсинга места)
VENUES = {
    "club_dex":     {"venue": "DEX",         "address": "Шарикоподшипниковская ул., 13с32", "lat": 55.7160, "lon": 37.6720},
    "Hlebozavod9":  {"venue": "Хлебозавод",  "address": "Новодмитровская ул., 1",           "lat": 55.8079, "lon": 37.5873},
    "supermetall":  {"venue": "Supermetall", "address": "2-я Бауманская ул., 9",            "lat": 55.7698, "lon": 37.6840},
    "cca_winzavod": {"venue": "Винзавод",    "address": "4-й Сыромятнический пер., 1/8",     "lat": 55.7556, "lon": 37.6648},
}

OPENROUTER_KEY = os.environ.get("OPENROUTER_KEY")
OR_MODELS = [
    "openai/gpt-oss-120b:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "google/gemma-4-31b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
]


def llm_extract(text, post_date):
    """Один пост → dict с полями события, или None. Не валит сборку."""
    prompt = (
        f"Сегодня {post_date[:10]}. Разбери пост телеграм-канала площадки о событиях. "
        "Верни ТОЛЬКО JSON без markdown и пояснений: "
        '{"is_event":bool,"is_ad":bool,"title":str,"datetime_iso":str|null,"price":str|null,"url":str|null}. '
        "is_event=true только если это анонс конкретного мероприятия с датой/временем. "
        "is_ad=true если это реклама товара/услуги/розыгрыш/коллаборация бренда. "
        "datetime_iso — момент начала YYYY-MM-DDTHH:MM (относительные «завтра/в субботу» вычисли от сегодня); null если даты нет. "
        "title — короткое название. price — как в тексте или null.\n"
        f'Пост:\n"""{text}"""'
    )
    for model in OR_MODELS:
        body = json.dumps({"model": model, "temperature": 0,
                           "messages": [{"role": "user", "content": prompt}]}).encode()
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions", data=body,
            headers={"Authorization": "Bearer " + OPENROUTER_KEY, "Content-Type": "application/json",
                     "HTTP-Referer": "https://georgypasyuk.github.io/msk-go", "X-Title": "msk-go"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=45).read().decode())
            content = d["choices"][0]["message"]["content"]
            a, b = content.find("{"), content.rfind("}")
            if a < 0 or b < 0:
                continue
            return json.loads(content[a:b + 1])
        except Exception:
            continue
    return None


CACHE_FILE = DATA / "tg_cache.json"


def build_events(posts):
    if not OPENROUTER_KEY:
        print("OpenRouter: ключ не задан — события из ТГ не извлекаю", file=sys.stderr)
        return []
    cache = {}
    if CACHE_FILE.exists():
        try:
            cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    now = datetime.now()
    events, calls = [], 0
    for p in posts:
        if len(p["text"]) < 40:
            continue
        slug = p["channel_url"].rsplit("/", 1)[-1]
        link = p["link"]
        if link in cache:                 # уже разбирали — LLM не зовём
            res = cache[link]
        else:
            res = llm_extract(p["text"], p["datetime"])
            calls += 1
            if res is None:               # сбой API — не кэшируем, повторим в след. раз
                continue
            cache[link] = res
        if not res or not res.get("is_event") or res.get("is_ad"):
            continue
        dt = res.get("datetime_iso")
        if not dt:
            continue
        try:
            d = datetime.fromisoformat(str(dt)[:16])
        except ValueError:
            continue
        if d < now - timedelta(hours=12):
            continue
        v = VENUES.get(slug, {})
        mid = p["link"].rstrip("/").split("/")[-1]
        events.append({
            "id": f"tg-{slug}-{mid}",
            "title": (res.get("title") or p["text"][:50]).strip(),
            "start": str(dt)[:16], "end": None, "allDay": False, "season_long": False,
            "place": v.get("venue") or p["channel"], "address": v.get("address"),
            "lat": v.get("lat"), "lon": v.get("lon"),
            "category": "tg", "category_label": v.get("venue") or p["channel"],
            "price": res.get("price") or "",
            "url": res.get("url") or p["link"],
            "source": "telegram", "featured": False, "description": p["text"][:280],
        })
    # ограничим рост кэша
    if len(cache) > 1000:
        keep = {p["link"] for p in posts}
        cache = {k: v for k, v in cache.items() if k in keep}
    try:
        CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        print(f"⚠ кэш не записан ({e})", file=sys.stderr)
    print(f"ТГ→события (LLM): {len(events)} событий; новых LLM-запросов: {calls}")
    return events


# Каналы отобраны по реальному контенту: рейвы/опен-эйры, андеграунд-вечеринки,
# вело-комьюнити, новые места, спорт. Без бумерщины/рекламы (старые афиши выкинуты).
CHANNELS = [
    ("club_dex", "DEX"),
    ("Hlebozavod9", "Хлебозавод"),
    ("supermetall", "Supermetall"),
    ("cca_winzavod", "Винзавод"),
]

# Реклама/мусор и бумерские темы — посты с этими маркерами выкидываем.
JUNK = [
    "кодовое слово", "промокод", "розыгрыш", "разыгрыва", "скидк", "подпишись",
    "подписывайтесь чтобы", "qr-код", "erid", "реклама", "казино", "букмекер",
    "1win", "#маркетинг", "летуаль", "fix price", "вебинар", "реферальн",
    # бумер-темы
    "дискотека 80", "авторадио", "шансон", "филармони", "шостакович",
    "оперетт", "фольклор", "русское поле", "для тех кому за", "ретро-вечер",
]

WINDOW_DAYS = 21
PER_CHANNEL = 12
TOTAL_CAP = 90

MONTHS_RE = r"(?:январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)"
DATE_RE = re.compile(rf"\b\d{{1,2}}\s+{MONTHS_RE}\w*", re.I)
DATE_NUM_RE = re.compile(r"\b\d{1,2}[.\/]\d{1,2}(?:[.\/]\d{2,4})?\b")
METRO_RE = re.compile(r"м\.?\s?[«\"]?[А-ЯЁ][а-яё]+(?:[ -][А-ЯЁ]?[а-яё]+)?", re.U)
ADDR_RE = re.compile(r"(?:ул\.|улица|пр-т|проспект|наб\.|набережная|пл\.|площадь|парк|сад|шоссе)\s?[А-ЯЁ][^,.\n]{2,40}", re.U)


def clean_text(t):
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"</p>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t


def fetch_channel(slug):
    url = f"https://t.me/s/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; msk-go/1.0)"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "ignore")


def parse_channel(slug, name, since_ts):
    html_raw = fetch_channel(slug)
    blocks = html_raw.split('tgme_widget_message_wrap')[1:]
    posts = []
    for b in blocks:
        m_post = re.search(r'data-post="([^"]+)"', b)
        m_time = re.search(r'datetime="([^"]+)"', b)
        m_text = re.search(r'tgme_widget_message_text[^>]*>(.*?)</div>', b, re.S)
        if not (m_post and m_time):
            continue
        try:
            dt = datetime.fromisoformat(m_time.group(1))
        except ValueError:
            continue
        if dt.timestamp() < since_ts:
            continue
        text = clean_text(m_text.group(1)) if m_text else ""
        if not text:
            continue
        low = text.lower()
        if any(k in low for k in JUNK):     # реклама/мусор/бумерщина
            continue
        m_photo = re.search(r"background-image:url\('([^']+)'\)", b)
        date_hint = (DATE_RE.search(text) or DATE_NUM_RE.search(text))
        place_hint = (METRO_RE.search(text) or ADDR_RE.search(text))
        posts.append({
            "channel": name,
            "channel_url": f"https://t.me/{slug}",
            "link": "https://t.me/" + m_post.group(1),
            "datetime": dt.astimezone(timezone.utc).replace(microsecond=0).isoformat(),
            "text": text[:600] + ("…" if len(text) > 600 else ""),
            "photo": m_photo.group(1) if m_photo else None,
            "date_hint": date_hint.group(0) if date_hint else None,
            "place_hint": (place_hint.group(0).strip() if place_hint else None),
        })
    posts.sort(key=lambda p: p["datetime"], reverse=True)
    return posts[:PER_CHANNEL]


def main():
    since_ts = (datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)).timestamp()
    all_posts, ok = [], 0
    for slug, name in CHANNELS:
        try:
            got = parse_channel(slug, name, since_ts)
            all_posts.extend(got)
            ok += 1
            print(f"{name}: {len(got)} постов")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            print(f"⚠ {name} недоступен ({e})", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"⚠ {name} ошибка разбора ({e})", file=sys.stderr)

    all_posts.sort(key=lambda p: p["datetime"], reverse=True)
    all_posts = all_posts[:TOTAL_CAP]

    events = build_events(all_posts)

    out = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "channels_ok": ok,
        "count": len(all_posts),
        "posts": all_posts,
        "events": events,
    }
    tmp = DATA / "telegram.json.tmp"
    dst = DATA / "telegram.json"
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(dst)
    print(f"Записано data/telegram.json: {len(all_posts)} постов, {len(events)} событий, из {ok}/{len(CHANNELS)} каналов")


if __name__ == "__main__":
    main()
