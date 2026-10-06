# Android · клиент 0.5.0-preview

Один app-модуль Kotlin/Compose. Реальные HTTPS-запросы к существующему серверу: каталог открытых клубов → клуб → пост и комментарии. Поиск, темы, сортировка, страницы, изображения/просмотр фото, состояния ошибок и возврат.

В Профиле доступны вход/регистрация/восстановление, редактирование данных, пароль/коды/сеансы и выход. [Устройство A02](../docs/android/A02_ACCOUNT_CLIENT.md). Отправка контента, личные сообщения и push ещё не реализованы. Название временное; applicationId ru.wrcommunity.android.preview предназначен для пилота.

Новый [APK 0.3.0-preview](https://github.com/lolokeksu09/wild-rift-community/releases/tag/android-v0.3.0-preview) добавляет стартовый экран. Временная CI-подпись отличается от локальных 0.1/0.2; обновление поверх них может потребовать переустановки и повторного входа. Проверки и ограничения — [release notes](../docs/android/RELEASE_0_3.md).

## Сборка

JDK 17, Gradle Wrapper 8.14.3, AGP 8.11.1, Kotlin/Compose compiler 2.2.0, Compose BOM 2025.06.01; compile/target SDK 36, minSdk 26 (Android 8). Выбрана стабильная совместимая матрица, а не динамические latest: [требования AGP](https://developer.android.com/build/releases/agp-8-11-0-release-notes). Обновления библиотек и lint-предупреждения отслеживаются отдельно.

Указать SDK через ANDROID_HOME либо локальный local.properties с sdk.dir (не коммитить). Из android/:

```text
gradlew.bat assembleDebug assembleDebugAndroidTest lintDebug testDebugUnitTest
```

Linux/macOS: ./gradlew вместо gradlew.bat. Gradle distributionSha256Sum и SHA-256 Wrapper JAR закреплены по официальным контрольным суммам.

APK: app/build/outputs/apk/debug/app-debug.apk. Debug-подпись временная, не постоянная релизная. После подключения своего устройства: adb install -r app/build/outputs/apk/debug/app-debug.apk.

## Проверки

16 unit-тестов: гостевые курсоры/демо-маркеры/null, кодирование/redirect/отзыв/возврат; HTTPS-вход и заголовки, cookie/restore/logout, чужой origin/порт/cleartext и поздние ответы, двойной вход, отказ хранилища, очистка профиля и старого контента. node tools/check-android-account-contract.mjs проверяет account JSON на изолированном сервере.

[Android CI](../.github/workflows/android.yml) собирает APK, lint/tests и запускает инструментальный гостевой сценарий на API 35. Smoke-тест читает настоящий сервер, выбирает существующий открытый клуб с постом, проверяет путь и возврат, снимает экраны и проверяет 200% текста. Он зависит от доступности сервера и публичного контента; не изменяет пользовательские данные.

Владелец подтвердил установку/открытие 0.1.0 на телефоне; проверка аккаунта 0.2.0 на устройстве ещё не подтверждена. Добавлены инструментальные UI/Keystore тесты. Итог CI/установки и ограничения — [STATUS](../docs/android/STATUS.md). TalkBack, minimum API 26 и плавность движения ещё требуют ручной проверки.

## Устройство кода

MainActivity создаёт зависимости. ui/ содержит Compose/тему, features/ — ViewModel/UiState, data/ — модели/парсер/API/Repository и зашифрованный cookie. Приватного дискового кеша контента нет. Мутации добавляют Origin/X-Community-Request/CSRF; TLS проверяется штатно, переходы HTTP запрещены.

Следующий этап после проверки аккаунта — [A03](../docs/android/ROADMAP.md): участие в клубах и запись контента.

## APK в GitHub Releases

Владелец 05.10.2026 поручил сразу выкладывать готовые новые APK в Releases без повторного подтверждения. Пилотные сборки публикуются как prerelease; это не перевод сервера в новую версию и не подтверждение проверки на устройстве.

[Скачать 0.1.0-preview](https://github.com/lolokeksu09/wild-rift-community/releases/tag/android-v0.1.0-preview): APK в Assets. Репозиторий приватный; требуется GitHub-аккаунт с доступом. SHA256 и ограничения записаны в описании версии.

Текущий [APK 0.2.0-preview](https://github.com/lolokeksu09/wild-rift-community/releases/tag/android-v0.2.0-preview) добавляет аккаунт и профиль. Оба выпуска сохраняются; сертификат локальных APK совпадает, фактическое обновление телефона ещё требует проверки.

После сборки, lint и существенных тестов создать уникальные versionName/versionCode и тег `android-v<версия>-preview`, подготовить честные release notes с исходным commit и фактическими проверками. До постоянной подписи публиковать только preview. Для PowerShell из корня репозитория:

```powershell
.\tools\publish-android-preview.ps1 -ApkPath <путь-к-APK> -Tag <android-vX.Y.Z-preview> -SourceCommit <полный-SHA-кода-APK> -NotesPath <путь-к-описанию>
```

Скрипт использует существующий GitHub-вход через Git credential helper, не сохраняет и не печатает токен. Создаёт draft, загружает APK, сверяет серверный SHA256 и размер, затем публикует prerelease. Другой файл под существующим тегом не заменяет. При сбое проверять оставшийся draft; не создавать дубль и не удалять предыдущие версии. После публикации дать пользователю ссылку и обновить STATUS.md. Новая публикация preview сама по себе не запускает deployment сервера.


## Карточки 0.4.0-preview

Четыре большие карточки знакомства с сообществом: свайп, стрелки, индикаторы страниц и восстановление выбранной страницы. Гостевые переходы и действующий сеанс сохранены. [Release notes](../docs/android/RELEASE_0_4.md). Публикация APK выполняется CI после сборки, lint/JVM и WelcomeUiTest на API 35; фактический статус — [Releases](https://github.com/lolokeksu09/wild-rift-community/releases).

## Полноэкранные обложки 0.5.0-preview

Приветствие занимает весь экран, содержит четыре встроенные иллюстрации Wild Rift, короткое объяснение и компактное управление. [Описание выпуска](../docs/android/RELEASE_0_5.md), [источники арта](../docs/android/ARTWORK.md). Подтверждённые APK, commit и SHA256 доступны в Releases; наличие исходников не считается завершённой публикацией.
