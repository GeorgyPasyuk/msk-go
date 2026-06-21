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
import re
import sys
import html
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

CHANNELS = [
    ("afishams", "Москва. Афиша"),
    ("moscowafishi", "Бесплатная Москва"),
    ("Mosgul", "Московские Гуляки"),
    ("msk4free", "Бесплатно в Москве"),
    ("MosTrips", "MosTrips"),
    ("moscowes", "Вечерняя Москва"),
]
WINDOW_DAYS = 21
PER_CHANNEL = 12
TOTAL_CAP = 80

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

    out = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "channels_ok": ok,
        "count": len(all_posts),
        "posts": all_posts,
    }
    (DATA / "telegram.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Записано data/telegram.json: {len(all_posts)} постов из {ok}/{len(CHANNELS)} каналов")


if __name__ == "__main__":
    main()
