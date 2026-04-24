# Закрытый мессенджер MVP

## Запуск

```bash
npm run dev
```

Приложение откроется на `http://localhost:3000`.

## Realtime

Realtime-слой работает через Socket.IO внутри custom Next server (`server.js`). REST API остаётся основным источником данных: сообщения, вложения и запросы создаются через API, а Socket.IO только уведомляет подключённых клиентов об изменениях.

Для деплоя realtime нужен long-running Node server: VPS, Railway, Render-like окружение или аналогичная платформа. Serverless-only деплой может не поддерживать этот realtime layer.
