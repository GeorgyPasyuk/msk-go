# msk-go 🎈

Движ Москвы в одном месте — интерактивный календарь прикольных активностей: фестивали, забеги, вода, опен-эйры, ярмарки. **Без филармонии и выставок книг.**

→ **Сайт:** https://georgypasyuk.github.io/msk-go/

Открываешь ссылку с телефона или компа — всегда свежий список. Клик по событию в календаре → детали и кнопка «Записаться». Отдельная вкладка «Всё лето» — то, что доступно весь сезон (бассейны, сап, городская программа).

---

## Зачем

Чтобы узнавать о крутых событиях **до**, а не после. Один экран вместо десяти афиш и ТГ-каналов.

## Как это устроено

```
KudaGo API ─┐
            ├─► scripts/fetch_events.py ─► data/events.json ─► index.html (календарь)
curated.json┘            ▲
                    GitHub Actions (раз в день)
```

1. **Раз в день** GitHub Actions (`.github/workflows/update.yml`) запускает `scripts/fetch_events.py`.
2. Скрипт тянет **[KudaGo API](https://docs.kudago.com/api/)** (Москва, «прикольные» категории) и мёрджит ручной список `data/curated.json`.
3. Пишет `data/events.json` и коммитит. GitHub Pages раздаёт статику — страница обновляется сама.

Никакого сервера, ключей и своей инфры. Всё внутри GitHub.

## Источники

| Источник | Тип | Что даёт |
|---|---|---|
| **KudaGo API** | машинный, открытый, без ключа | структурные события (даты/места/ссылки). Фильтруем категории: `festival, party, holiday, recreation, entertainment, quest, tour, fashion, yarmarki`. |
| **curated.json** | ручной | то, чего нет в KudaGo: спорт и веломассы (Color Run, Ночной забег, **Ночной велофестиваль**), городские программы (mos.ru / leto.mos.ru). |
| **ТГ-каналы** | глазами (пока) | быстрый поток анонсов: `@afishams`, `@moscowafishi`, `@Mosgul`, `@msk4free`, `@MosTrips`, `@moscowes`. Автосбор — в планах. |

> KudaGo по будущим датам бывает жидким — поэтому заголовочные события держим в `curated.json`. Это нормально: гибрид «машина + руки».

## Добавить событие руками

Открой `data/curated.json` и добавь объект в массив `events`:

```json
{
  "id": "curated-уникальный-id",
  "title": "🚲 Название",
  "start": "2026-07-04T21:00:00",   // ISO без таймзоны = московское время
  "end":   "2026-07-05T01:00:00",
  "allDay": false,
  "season_long": false,             // true => уедет во вкладку «Всё лето»
  "place": "Где",
  "address": "Адрес",
  "category": "festival",           // festival|party|holiday|recreation|entertainment|quest|tour|fashion|yarmarki-razvlecheniya-yarmarki
  "category_label": "Велозаезд",    // как подписать
  "price": "бесплатно",
  "url": "https://...",             // куда ведёт кнопка «Записаться»
  "source": "curated",
  "featured": true,                 // ⭐ выделить
  "description": "Короткое описание"
}
```

Закоммить — Actions при следующем прогоне (или запусти вручную) пересоберёт `events.json`.

## Локально

```bash
python3 scripts/fetch_events.py     # собрать data/events.json
python3 -m http.server 8799         # открыть http://127.0.0.1:8799
```
> KudaGo режет некоторые иностранные дата-центры. Из России (и из GitHub Actions) API доступен; если запускаешь из-за рубежа и KudaGo недоступен — скрипт не падает, страница живёт на курируемых событиях.

## Стек

Чистый стол: Python (stdlib, без зависимостей) + статичный HTML/CSS/JS + [FullCalendar](https://fullcalendar.io/) с CDN. Хостинг — GitHub Pages. Обновление — GitHub Actions.
