# Yonda — ИИ-бот продаж в Instagram Direct

MVP: бот ведёт горячих лидов из рекламы Click-to-Direct до скриншота оплаты, ведёт воронку в Google Sheets и передаёт диалог менеджерам в группу Telegram.

| Файл | Что внутри |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Требования MVP: объём, архитектура, модель данных, план, риски |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Журнал решений с обоснованиями |
| [docs/PHASE0.md](docs/PHASE0.md) | Пошаговая инструкция Фазы 0 и таблица результатов |
| [templates/yonda_bot_template.xlsx](templates/yonda_bot_template.xlsx) | Шаблон Google-таблицы (загрузить в Google Sheets) |
| [n8n/phase0_echo_test.json](n8n/phase0_echo_test.json) | Тестовый сценарий n8n для Фазы 0 (импорт, токены вписать в n8n, не в git) |
| [n8n/tg_bot_skeleton.sdk.ts](n8n/tg_bot_skeleton.sdk.ts) | Каркас бота для теста в Telegram (код n8n Workflow SDK) |

Стек: n8n · Instagram Graph API · Claude Haiku 5.5 · Google Sheets · Supabase · Telegram Bot API.
