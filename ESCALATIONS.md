# Эскалации и решения

Обновлено: 2026-06-22 (3-я сессия). ✅ решено · ⏳ ждёт · ▶️ решение принято.

---

## ✅ 1. Секреты VPS-пайплайна — РЕШЕНО
Ключи владельца в `/root/repos/msk-go/.env` (OPENROUTER_KEY, TIMEPAD_TOKEN). VPS даёт
полные данные: **total 22 = как на Pages** (Timepad заработал).

## ✅ 2. Доступ к Paperclip UI — РЕШЕНО (авто-туннель на маке)
LaunchAgent `~/Library/LaunchAgents/com.mskgo.paperclip-tunnel.plist` поднимает SSH-
туннель `localhost:3100 → VPS:3100` при входе в систему и переподключается сам.
Владелец просто открывает **http://localhost:3100**. Управление:
`launchctl unload|load ~/Library/LaunchAgents/com.mskgo.paperclip-tunnel.plist`,
лог `/tmp/paperclip-tunnel.log`. Публичный доступ НЕ открывали (control-plane безопаснее в туннеле).

## ▶️ 3. Telegram на VPS — РЕШЕНИЕ: остаётся на GitHub Actions
WARP (бесплатный) из РФ НЕ работает (проверено: `warp=off`, регистрация Cloudflare
режется). Решение владельца: ТГ-скрейп остаётся на **GitHub Actions** (US-раннеры
видят t.me), коммитит `telegram.json` → Pages. **Следствие:** полностью уйти с
Pages/Actions нельзя — они держат Telegram-источник. Альтернатива на будущее
(если захочется VPS-only): дешёвый внешний relay вне РФ (~пара $/мес).

## ⏳ 4. Paperclip — агенты на OpenRouter (следующий шаг)
UI поднят и доступен. Чтобы агенты РЕАЛЬНО работали (а не только настраивались в UI),
нужен OpenRouter-адаптер (дефолт Paperclip = Claude Code/Anthropic, которого нет).
Решение владельца: пока гонять на уже выданном `OPENROUTER_KEY`, позже — платный ключ.
- **Что делает агент дальше:** установить OpenRouter-адаптер
  (`talhamahmood666/paperclip-adapter-openrouter`), прокинуть `OPENROUTER_API_KEY`,
  перезапустить сервис. После этого в UI при найме агента выбирается модель OpenRouter.
- **От владельца позже:** платный ключ + желаемая модель (когда натестит на free).

## ⏳ 5. Яндекс-ключ карт по referer
Ограничить JS-ключ карт по referer в кабинете Яндекса (нет доступа к кабинету владельца).

---

### Заметка: уход с GitHub Pages
Владелец хочет VPS-only (домен/TLS не нужны, прод по `http://155.212.166.15:8090/`).
Блокер — п.3 (Telegram на Actions). Пока НЕ отключаем Pages/Actions.
