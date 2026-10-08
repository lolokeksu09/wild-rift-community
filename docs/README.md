# Карта документации сайта

Текущий продукт — адаптивный сайт Wild Rift Community. Согласованное оформление — этап 24; схема SQLite — 22. Установка этой версии на VDS не подтверждена.

## Основные документы

| Вопрос | Документ |
| --- | --- |
| Что создаём | [Техническое задание](SPEC.md) |
| Текущая база и следующие задачи | [Паспорт этапа 24](DESIGN_BASELINE_STAGE24.md), [дорожная карта](ROADMAP.md) |
| Оформление и экраны | [План дизайна](WEB_REDESIGN_PLAN.md), [экраны](SCREENS.md), [приветствие](ONBOARDING.md) |
| Архитектура и API | [Архитектура](ARCHITECTURE.md), [сервер](SERVER.md) |
| Решения | [DECISIONS.md](DECISIONS.md) |
| Эксплуатация | [Развёртывание](DEPLOYMENT.md), [копии](BACKUP.md) |
| Проверки | [QA](QA.md), [серверные проверки](SERVER_QA.md) |

## Реализованные серверные области

- Аккаунты: [восстановление](ACCOUNT_RECOVERY.md), [пароль и сеансы](ACCOUNT_SECURITY.md).
- Сообщество: [дизайн сайта](COMMUNITY_DESIGN.md), [каталог и люди](COMMUNITY_REFINEMENT.md), [демо-данные](DEMO_COMMUNITY.md), [публичные ссылки](PUBLIC_LINKS.md).
- Клубы и контент: [управление клубом](CLUB_MANAGEMENT.md), [посты](POST_MANAGEMENT.md), [редактор](POST_EDITOR.md), [обсуждения](DISCUSSIONS.md), [опросы](POLLS.md), [профили и изображения](PROFILES_MEDIA.md).
- Общение: [личные сообщения](DIRECT_MESSAGES.md), [лимиты знакомств](CONTACT_LIMITS.md), [чат клуба](CHAT.md).
- Игра вместе: [объявления](LFG.md), [события](EVENTS.md), [поиск игроков](PLAYER_FINDER.md), [гайды](GUIDES.md).
- Безопасность: [модерация](MODERATION.md), [аудит](AUDIT_2026-10-04.md), [исправления](AUDIT_FIXES_2026-10-04.md), [внешние копии](OFFSITE_BACKUP.md).

## История и дополнительные материалы

[История](history/README.md) содержит ранние документы сайта. [prototype.html](prototype.html) сохранён для исторического DOM-теста. Актуальные серверные возможности описаны в [CHANGELOG.md](CHANGELOG.md).

[BACKLOG.md](BACKLOG.md), [GITHUB.md](GITHUB.md) и тематические QA-отчёты — справочные материалы. При противоречии фактический контракт определяет исполняемый код, продуктовые решения — [DECISIONS.md](DECISIONS.md).
