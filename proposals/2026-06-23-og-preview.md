# GST-11: Ссылка на сайт разворачивается некрасиво

## Product Direction

**Mode:** Scope expansion

**The problem:** Sharing msk-go links in Telegram/WhatsApp/etc. yields a blank/minimal preview — no image, weak or missing description. Kills click-through. Makes the site look unfinished.

**The 10-star insight:** Every share is free brand marketing. The preview should feel like an extension of the site itself — bold, clean, orange-accented. When someone shares "Выходные в Москве", the card should make the recipient *want* to visit: оранжевый квадрат, название, теглайн, количество событий.

**Plan:**
1. Full OG metadata in `<head>` (og:*, twitter:card), brand preview image
2. Pipeline-generated OG image with live event count (1200×630)
3. QA verification for tags + image availability

---

## Issues Created

### GST-11 (lead) — assigned to **CTO**
- Lead issue: Ссылка на сайт разворачивается некрасиво
- **Assignee:** CTO — lock the technical execution plan
- **Children:**
  - GST-14 → Implementer (OG tags + brand preview)
  - GST-16 → Release Engineer (pipeline OG image)
  - GST-18 → QA Engineer (verification)

### GST-14 — OG-теги + превью-картинка в index.html
**Assignee:** Implementer

**AC:**
1. Full set of OG and Twitter Card meta tags in `<head>` — og:title, og:description, og:image, og:url, og:type, og:locale, og:site_name, twitter:card, twitter:title, twitter:description, twitter:image
2. og:title = "Выходные в Москве", og:description = "Фестивали, забеги, вода, опен-эйры. Куда сходить на выходных в Москве.", og:url = https://georgypasyuk.github.io/msk-go/, og:type = website, og:locale = ru_RU
3. Brand preview image 1200×630 saved as assets/og-image.png (black bg, orange square, site name, tagline)
4. All image URLs absolute (https://georgypasyuk.github.io/msk-go/assets/og-image.png)
5. twitter:card = summary_large_image

### GST-16 — Пайплайн-генерация OG-картинки с данными событий
**Assignee:** Release Engineer

**AC:**
1. Script scripts/generate_og_image.py reads data/events.json, renders 1200×630 PNG
2. Image shows: black bg, orange square, "Выходные в Москве", event count for upcoming weekend
3. Empty/null events.json → renders brand-only version
4. Script runs in GitHub Actions workflow before deploy step
5. Uses Pillow (add to requirements.txt or GA image)
6. Output: assets/og-image.png

### GST-18 — QA-проверка OG-тегов и превью
**Assignee:** QA Engineer

**AC:**
1. Browser test (Puppeteer/Playwright) opens index.html, checks all OG tags in `<head>`
2. Verifies og:title, og:description, og:image are non-empty
3. Verifies og:image is absolute URL and image is accessible (HTTP 200)
4. Verifies twitter:card = summary_large_image
5. Test added to tests/ dir, runnable via npm test or equivalent
6. Docs: how to verify preview in Telegram (https://t.me/WebpageBot)
