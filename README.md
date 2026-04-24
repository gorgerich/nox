# Закрытый мессенджер MVP

## Запуск

```bash
npm run dev
```

Приложение откроется на `http://localhost:3000`.

## Realtime

Realtime-слой работает через Socket.IO внутри custom Next server (`server.js`). REST API остаётся основным источником данных: сообщения, вложения и запросы создаются через API, а Socket.IO только уведомляет подключённых клиентов об изменениях.

Для деплоя realtime нужен long-running Node server: VPS, Railway, Render-like окружение или аналогичная платформа. Serverless-only деплой может не поддерживать этот realtime layer.

## Переменные окружения (Production)

- `DATABASE_URL`: Строка подключения к PostgreSQL.
- `AUTH_SECRET`: Секретный ключ для подписи JWT (минимум 32 символа).
- `APP_URL`: Публичный URL приложения.
- `NODE_ENV`: Должно быть `production`.
- `OWNER_LOGIN`: Логин для автоматического создания владельца.
- `OWNER_EMAIL`: Email владельца.
- `OWNER_PASSWORD`: Пароль владельца.
- `OWNER_USERNAME`: Username владельца.
- `OWNER_DISPLAY_NAME`: Отображаемое имя владельца.
- `UPLOAD_DIR`: Путь к папке для приватных вложений (например, `/app/private_uploads`).
- `DEBUG_REALTIME`: (Опционально) `true` для включения подробных логов сокетов на сервере.

## Безопасность

- Вложения хранятся в `private_uploads` и доступны только авторизованным участникам соответствующих чатов через защищённый API.
- Куки сессии защищены флагами `httpOnly` и `secure` (в production).
- Публичные отладочные эндпоинты удалены.
- Логирование в production минимизировано для предотвращения утечки метаданных.

## Постоянное хранилище (Railway Volume)

Чтобы вложения (файлы и голосовые сообщения) не удалялись при каждом деплое на Railway:
1. В панели Railway перейдите в **Settings** проекта.
2. Выберите **Volumes** -> **Create Volume**.
3. Настройте Volume:
   - **Mount Path**: `/app/private_uploads`
4. В переменных окружения (**Variables**) установите:
   - `UPLOAD_DIR`: `/app/private_uploads`
5. Примените изменения. Теперь все загруженные файлы будут сохраняться на постоянном диске.

