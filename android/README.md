# Android · гостевой клиент 0.1.0-preview

Один app-модуль Kotlin/Compose. Реальные HTTPS-запросы к существующему серверу: каталог открытых клубов → клуб → пост и комментарии. Поиск, темы, сортировка, страницы, изображения/просмотр фото, состояния ошибок и возврат.

Вход, отправка, личные сообщения и push ещё не реализованы. Название временное; applicationId ru.wrcommunity.android.preview предназначен для пилота.

## Сборка

JDK 17, Gradle Wrapper 8.14.3, AGP 8.11.1, Kotlin/Compose compiler 2.2.0, Compose BOM 2025.06.01; compile/target SDK 36, minSdk 26 (Android 8). Выбрана стабильная совместимая матрица, а не динамические latest: [требования AGP](https://developer.android.com/build/releases/agp-8-11-0-release-notes). Обновления библиотек и lint-предупреждения отслеживаются отдельно.

Указать SDK через ANDROID_HOME либо локальный local.properties с sdk.dir (не коммитить). Из android/:

```text
gradlew.bat assembleDebug assembleDebugAndroidTest lintDebug testDebugUnitTest
```

Linux/macOS: ./gradlew вместо gradlew.bat. Gradle distributionSha256Sum и SHA-256 Wrapper JAR закреплены по официальным контрольным суммам.

APK: app/build/outputs/apk/debug/app-debug.apk. Debug-подпись временная, не постоянная релизная. После подключения своего устройства: adb install -r app/build/outputs/apk/debug/app-debug.apk.

## Проверки

8 unit-тестов: курсоры/демо-маркеры/null поля, кодирование поисковых запросов, запрет cleartext и чужого redirect, устаревший поиск, повтор страницы, отзыв доступа и возврат во время загрузки.

[Android CI](../.github/workflows/android.yml) собирает APK, lint/tests и запускает инструментальный гостевой сценарий на API 35. Smoke-тест читает настоящий сервер, выбирает существующий открытый клуб с постом, проверяет путь и возврат, снимает экраны и проверяет 200% текста. Он зависит от доступности сервера и публичного контента; не изменяет пользовательские данные.

Локальная установка пока не подтверждена: Windows-эмулятор не загрузился в этой среде. Итог CI/установки и ограничения отражаются в [STATUS](../docs/android/STATUS.md). TalkBack, реальный телефон, minimum API 26 и плавность движения ещё требуют ручной проверки.

## Устройство кода

MainActivity создаёт зависимости. ui/ содержит Compose/тему, features/ — ViewModel/UiState, data/ — модели/парсер/API/Repository. Сеансов и приватного дискового кеша в A01 нет. Только GET; TLS проверяется штатно, переходы HTTP запрещены.

Следующий этап после проверки A01 — [A02](../docs/android/ROADMAP.md): безопасный вход и общий аккаунт.

## APK в GitHub Releases

Владелец 05.10.2026 поручил сразу выкладывать готовые новые APK в Releases без повторного подтверждения. Пилотные сборки публикуются как prerelease; это не перевод сервера в новую версию и не подтверждение проверки на устройстве.

[Скачать 0.1.0-preview](https://github.com/lolokeksu09/wild-rift-community/releases/tag/android-v0.1.0-preview): APK в Assets. Репозиторий приватный; требуется GitHub-аккаунт с доступом. SHA256 и ограничения записаны в описании версии.

После сборки, lint и существенных тестов создать уникальные versionName/versionCode и тег `android-v<версия>-preview`, подготовить честные release notes с исходным commit и фактическими проверками. До постоянной подписи публиковать только preview. Для PowerShell из корня репозитория:

```powershell
.\tools\publish-android-preview.ps1 -ApkPath <путь-к-APK> -Tag <android-vX.Y.Z-preview> -SourceCommit <полный-SHA-кода-APK> -NotesPath <путь-к-описанию>
```

Скрипт использует существующий GitHub-вход через Git credential helper, не сохраняет и не печатает токен. Создаёт draft, загружает APK, сверяет серверный SHA256 и размер, затем публикует prerelease. Другой файл под существующим тегом не заменяет. При сбое проверять оставшийся draft; не создавать дубль и не удалять предыдущие версии. После публикации дать пользователю ссылку и обновить STATUS.md. Новая публикация preview сама по себе не запускает deployment сервера.
