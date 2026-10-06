# Обложки Android-приветствия

Источник: [Riot Games — Wild Rift Desktop and Mobile Wallpapers](https://wildrift.leagueoflegends.com/en-sg/news/community/wild-rift-desktop-and-mobile-wallpapers/), публикация 12.11.2020. Иллюстрации принадлежат Riot Games; приложение — независимое сообщество Wild Rift.

| Ресурс | Исходный файл |
|---|---|
| intro_community.webp | https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/75118d28842ce7d508c569bd43334a09e766f563-1440x2960.jpg |
| intro_players.webp | https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/7d938c685d5bb3859775e2e522722520e6cba187-1800x3200.jpg |
| intro_clubs.webp | https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/4750a9246211b0c9b5ace5d5d63bd7005a004723-1800x3200.jpg |
| intro_profile.webp | https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/4c7b63aed33621b3d4b09eec1dfd7d501204082f-1800x3200.jpg |

Локальная обработка: центральное кадрирование/масштабирование до 900×1600, WebP quality 87. Персонажи не перерисованы, изображения не генерировались. Затемнение реализовано поверх изображения в Compose, исходный ресурс не затемнялся. Ресурсы в drawable-nodpi; приветствие не загружает их из сети. ContentScale.Crop заполняет фактический экран, текст и кнопки находятся в безопасной области системных панелей.

Графика декоративная, contentDescription=null. Значимое объяснение приложения остаётся текстом; индикаторы доступны для TalkBack.
