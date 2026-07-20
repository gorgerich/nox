# Android push (FCM) — что осталось сделать вручную

Код готов: клиент регистрирует FCM-токен, сервер шлёт через Firebase Admin,
токены хранятся в `PushSubscription` (kind="fcm"), миграция в
`prisma/deploy.sql` применится при деплое автоматически.

Без шагов ниже пуши на Android не заработают — это доступы, которых нет у кода.

## 1. Firebase console (~5 минут)

1. https://console.firebase.google.com → Add project (аналитика не нужна).
2. В проекте: Add app → Android → package name **`ru.nox.messenger`**.
3. Скачать **`google-services.json`** → положить в **`android/app/google-services.json`**.
   Gradle подхватит автоматически (сборка без него просто не включит пуши).

## 2. Ключ сервера → Railway

1. Firebase console → Project settings → Service accounts →
   **Generate new private key** (скачается JSON).
2. Railway → сервис nox → Variables → добавить
   **`FIREBASE_SERVICE_ACCOUNT`** = всё содержимое JSON одной строкой.
3. Redeploy.

Без переменной сервер молча шлёт только web-push (ничего не ломается).

## 3. Сборка APK

```bash
npm run build          # веб-бандл
npx cap sync android   # скопировать в android/
cd android && ./gradlew assembleDebug   # или открыть в Android Studio
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

## 4. Проверка

1. Установить APK, войти, Профиль → Push-уведомления → «Включить»
   (появится системный запрос разрешения Android 13+).
2. С другого аккаунта написать сообщение при свёрнутом приложении.
3. Уведомление пришло, тап открывает чат.

## Как это устроено

- Клиент: `src/hooks/usePushNotifications.ts` — при `Capacitor.isNativePlatform()`
  использует `@capacitor/push-notifications` (каналы `messages`/`calls`),
  токен POST-ится в `/api/push/subscribe` как `{fcmToken}`.
- Сервер: `src/lib/fcm.ts` (API-роуты) и `sendFcmNotification` в `server.js`
  (пуши о звонках). Мёртвые токены отключаются автоматически.
- Тап по уведомлению: `pushNotificationActionPerformed` → переход по `data.url`.
