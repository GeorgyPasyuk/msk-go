# msk-go · контейнер бэкенд-пайплайна (KudaGo/Timepad/Telegram → events.json).
# Скрипты используют только стандартную библиотеку Python — slim достаточно.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 TZ=Europe/Moscow

COPY scripts/ /app/scripts/
# curated.json запекаем как seed — run_pipeline.sh восстановит его в пустой volume
COPY data/curated.json /app/seed/curated.json

# /app/data — точка монтирования рантайм-данных (bind-mount в compose)
RUN mkdir -p /app/data /app/logs

CMD ["sh", "/app/scripts/run_pipeline.sh"]
