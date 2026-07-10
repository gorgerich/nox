# UX/UI audit — 2026-07-09

Цель: сохранить текущую спокойную премиальную айдентику Nox, но сделать интерфейс быстрее, плотнее, чище и ближе к качеству Apple: меньше случайной тяжести, стабильная геометрия, понятная иерархия, аккуратные переходы.

## Главные выводы

| Before | After | Why |
| --- | --- | --- |
| Разные длительности `150/300/500ms` без общей системы | Единые motion-токены и короткие переходы `160–220ms` | Интерфейс ощущается цельным и быстрым |
| Много `shadow-2xl`, `rounded-[2rem]`, тяжёлых blur-оверлеев | Мягкие малые тени, радиусы ближе к контексту, меньше blur | Liquid glass должен быть лёгким, не грязным |
| `font-black uppercase tracking-widest` в служебных местах | Нормальный регистр, `font-semibold`, спокойные подписи | Apple-like UI читает текст, а не кричит |
| Emoji/composer имеют blob-ощущение и sticky hover на touch | Чёткая панель, focus/active states, hover только для pointer | Меньше визуальных багов на iPhone |
| Профильные подэкраны открываются медленно | Быстрее slide/fade, меньше задержки | Настройки часто открывают короткими сессиями |
| Контекстное меню сообщений выглядит как тяжёлая модалка | Меню прикреплено к сообщению, меньше радиус и тень | Пользователь понимает источник действия |
| Медиа viewer/crop overlays тяжелые | Быстрее fade/zoom, спокойнее типографика | Медиа должно открываться почти мгновенно |
| Админ-панель анимируется как маркетинговый экран | Ускоренный вход блоков | Админка нужна для сканирования и действий |

## По разделам

### Onboarding / login

| Before | After | Why |
| --- | --- | --- |
| Вторичные действия конкурируют с основным входом | Ясный первичный путь: логин/пароль, затем username/профиль | Меньше когнитивной нагрузки |
| Тексты местами выглядят как placeholder-дизайн | Короткие, полезные, русские микрокопии | Ускоряет регистрацию |

### Chats

| Before | After | Why |
| --- | --- | --- |
| Список красивый, но местами слишком воздушный | Чуть выше плотность строк без скученности | Больше чатов видно за один экран |
| Статусы и превью иногда слабые | Статус, отправитель, вложение и unread должны быть различимы | Пользователь сканирует список за секунду |
| Search сверху дублирует нижний search-flow | Один сильный search entry-point | Меньше лишней иерархии |

### Chat detail

| Before | After | Why |
| --- | --- | --- |
| Header может занимать слишком много места | Компактный glass header, только нужные действия | Больше пространства сообщениям |
| Контекстные меню тяжёлые | Меньше тени, быстрее вход, origin-aware scale | Меню чувствуется локальным действием |
| Date/unread pills слишком декоративные | Спокойная типографика, меньше капса | Служебные элементы не спорят с сообщениями |

### Message composer

| Before | After | Why |
| --- | --- | --- |
| Recording strip постоянно пульсирует | Статичный strip + живой индикатор записи | Меньше отвлечения |
| Emoji picker визуально нестабилен | Стабильная сетка, focus/active состояния | Точнее на touch-экране |
| Capture menu открывается как обычный блок | Origin-aware popover от кнопки | Действие ощущается связанным с источником |

### Calls

| Before | After | Why |
| --- | --- | --- |
| Видео overlay местами тяжёлый | Меньше тень локального preview, быстрее opacity | Звонок должен быть максимально незаметным UI |
| Call log требует точных тапов | Вся строка звонка должна быть действием, `i` отдельно | Быстрее повторить звонок |

### Contacts

| Before | After | Why |
| --- | --- | --- |
| Верхние действия местами не совпадают с намерением | `+` для добавления, search как отдельный поток | Яснее модель действий |
| Add contact screen ещё требует финальной плотности | Компактная форма, меньше декоративных иконок | Экран должен быть утилитарным |

### Profile / settings

| Before | After | Why |
| --- | --- | --- |
| Подэкраны настроек медленные | 220ms экран, 200ms контент | Быстрее ежедневное использование |
| Папки чатов требуют больше управления | Удаление, reorder, настройка видимости | Масштабирование под 100+ чатов |
| Storage/cache смешан с общими настройками | Данные и кэш как отдельный раздел | Информационная архитектура чище |

### Admin

| Before | After | Why |
| --- | --- | --- |
| Переходы слишком медленные для рабочей панели | Ускоренные блоки | Админка должна быть плотной и быстрой |
| Слепые зоны и nav overlap надо проверять отдельно | Safe-area и bottom clearance на всех admin screens | Безопасная эксплуатация с mobile nav |

### Media viewer / wallpapers

| Before | After | Why |
| --- | --- | --- |
| Viewer/crop имеют тяжелые 300ms переходы | 200ms fade/zoom | Медиа должно ощущаться нативно |
| Wallpapers нужны как полноценный personalization flow | Preview, apply all, color/pattern controls | Это повышает ощущение собственности продукта |

## Что начато сейчас

- Добавлены глобальные motion-токены.
- Смягчены контекстные меню сообщений.
- Ускорены профильные подэкраны.
- Почищена типографика служебных плашек.
- Улучшены emoji picker и capture menu.
- Смягчены медиа/call/admin overlays.

## Следующий пакет

1. Довести chat list: плотность, статусы, unread/important hierarchy.
2. Проверить bottom nav на всех deep screens и admin.
3. Довести contacts/add-contact и admin safe areas.
4. Полностью пройти onboarding/login copy and layout.
5. Снять локальные скриншоты ключевых экранов и убрать визуальные артефакты.

## Liquid Glass + security pass — 10 July 2026

| Before | After | Why |
| --- | --- | --- |
| Glass applied to controls and content cards alike | Strong glass reserved for dock, headers, composer, sheets and menus; content cards use standard material | Matches Apple hierarchy and reduces visual noise/GPU blur work |
| `22–28px` blur plus specular pseudo-layers on nearly every surface | `16–22px` adaptive blur; specular layers only on functional chrome | Cleaner edges, less muddy scrolling |
| Reduced motion supported, increased contrast incomplete | Added reduced-transparency fallback and high-contrast tokens | Better accessibility on iOS/macOS settings |
| Password reset claimed to invalidate sessions, but JWT stayed valid for seven days | Session carries signed credential stamp derived from current password hash | Any password reset invalidates every previously issued session without DB migration |
| Auth endpoints had no application-level throttling | Added scoped login/register/recovery/reset rate limits and `Retry-After` | Slows credential stuffing and recovery abuse |
| Avatar upload trusted client MIME and serving forced `image/jpeg` | JPEG/PNG/WebP signatures validated and correct MIME returned | Blocks SVG/script payloads and fixes PNG/WebP rendering with `nosniff` |
| Global browser hardening absent | Added clickjacking, MIME, referrer, permissions and service-worker CSP headers | Smaller browser attack surface |

Remaining high-priority architecture work:

1. Replace process-local auth throttling with shared Redis/Postgres limiter before horizontal scaling.
2. Change “clear dialog” from global message deletion to a per-member `clearedAt` cursor. Current API clears history for every participant.
3. Add a nonce-based global CSP. Current inline theme bootstrap needs nonce plumbing before strict CSP can be enabled safely.
4. Migrate from Capacitor `WKWebView` shell to SwiftUI navigation if native iOS 26 `glassEffect` is required. Current app has no SwiftUI view hierarchy.
