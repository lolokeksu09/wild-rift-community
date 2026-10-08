# Архитектура и данные · проектное решение

## Границы

Предложение: адаптивный web-клиент + единое серверное приложение с модулями + реляционная база + файловое хранилище + фоновые задачи. Текстовые события доставляются в реальном времени. Технологии, версии и поставщики не выбраны; сначала определить бюджет и размещение. На старте микросервисы не требуются.

Модули: Identity, Profiles, Feed, Clubs, Messaging, Matchmaking, Notifications, Moderation. Каждый отвечает за собственные правила и проверяемые операции. Клиент не выдаёт себе роли и не определяет итоговый доступ.

## Сущности

| Сущность | Основные поля / ограничения |
|---|---|
| User | id, handle_normalized UNIQUE, display_name, status, created_at |
| Profile | user_id UNIQUE, bio, region, languages, roles, riot_id_visibility |
| Session | user_id, expires_at, revoked_at; механизм зависит от авторизации |
| Follow | follower_id, target_id, UNIQUE pair; запрет self-follow |
| Block | blocker_id, target_id, UNIQUE pair |
| Club | owner_id, name, visibility, status |
| Membership | club_id, user_id, role, status; UNIQUE pair |
| Post | author_id, club_id nullable, body, status, edited_at |
| Comment | post_id, author_id, parent_id nullable, status |
| Reaction / Bookmark | user_id, target_id; уникальность по типу операции |
| Media | owner_id, object_key, type, size, status, audience |
| Conversation | type: direct / club / lfg, related_id |
| Participant | conversation_id, user_id, role, last_read_seq |
| Message | conversation_id, sender_id, client_id, seq, body, status |
| Group | host_id, region, mode, capacity, starts_at, expires_at, status |
| Application | group_id, user_id, status; UNIQUE pair |
| Notification | recipient_id, type, target_id, read_at, dedupe_key |
| Report | reporter_id, target_type, target_id, reason, status |
| ModerationAction | actor_id, scope, reason, expires_at, report_id |
| AuditEvent | actor_id, action, target, time; ограниченный доступ |

Время UTC. Внешние ID непредсказуемы, но это не заменяет авторизацию. Каскадное удаление переписок и доказательств нельзя применять без политики хранения.

## Критичные операции

Принятие в группу — транзакционная проверка свободных мест и состояния. Сообщение — серверный ID, уникальный client_id на отправителя/беседу, повтор возвращает существующий результат. Реакции, вступление и заявки имеют уникальные ограничения. События уведомлений должны быть согласованы с фиксацией данных; сбой доставки не теряет основную операцию.

## Доступ

Приватные файлы хранятся непублично. Выдача доступа проверяется сервером; кеширование и срок жизни ссылок учитывают отзыв членства. Поиск фильтрует по текущим правам; приватное содержимое не уходит в публичный индекс. Подписки на чат повторно проверяются при отзыве доступа. Логи не содержат паролей, токенов и полных личных сообщений.

## Эксплуатация

Раздельные окружения разработки, проверки и production. Изменения схемы — миграции с планом отката или восстановления. Резервные копии и проверка восстановления. Метрики ошибок, задержек и очередей. Затраты разделяются на сервер, БД, файлы, трафик, письма и последующую обработку видео. Числовую смету составить после выбора поставщика и нагрузки.
