# Деплой бэкенд-пайплайна на VPS (GEO-97/99)

Прод-фронт пока на GitHub Pages, данные обновляет GitHub Actions (cron 09:37 МСК).
VPS-стек поднят параллельно как новый дом пайплайна (self-healing / event-driven /
логи / в перспективе Postgres). Перенос фронта на VPS и переключение источника
данных — отдельный шаг (GEO-103), до него прод не трогаем.

## Что где

- Код: `/root/repos/msk-go` (git-клон, обновляется `git pull`).
- Рантайм-данные и логи: `/root/repos/msk-go/runtime/` (gitignored).
- Секреты: `/root/repos/msk-go/.env` (gitignored, из `.env.example`).
- Образ: `msk-go-pipeline` (см. `Dockerfile`), запуск `docker compose run --rm pipeline`.

## Первый запуск

```sh
cd /root/repos/msk-go
git pull --ff-only
cp -n .env.example .env        # заполнить OPENROUTER_KEY / TIMEPAD_TOKEN (опц.)
docker compose build
docker compose run --rm pipeline
ls -la runtime/data            # events.json, telegram.json должны появиться
```

Без ключей пайплайн деградирует: KudaGo (бескейный) + curated работают всегда;
Telegram-извлечение и Timepad включатся, когда ключи появятся в `.env`.

## Ежечасный cron

`crontab -e`:

```
# msk-go: пайплайн раз в час (в :07, чтобы не толкаться на ровном часе)
7 * * * * cd /root/repos/msk-go && /usr/bin/docker compose run --rm pipeline >> /root/repos/msk-go/runtime/logs/cron.log 2>&1
```

Логи: `runtime/logs/cron.log` + `docker logs` (json-file, 3×5 МБ ротация).

## Event-driven (задел, GEO-99)

Сейчас триггер — только cron. Точка расширения под event-driven: watcher на новые
ТГ-посты (`t.me/s/<channel>` опрос дешёвый, бескейный) → при новом посте сразу
дёргать `fetch_events`. Реализуется поверх этого же образа отдельным сервисом
`watcher` в compose; пока не включено.
