package ru.wrcommunity.android.data

import org.json.JSONObject

/** Exact server moderation contract; target IDs for profiles and clubs remain strings. */
class ModerationRepository(private val client: FeatureClient) {
    suspend fun own(before: String? = null): JSONObject {
        val page = client.get("api/reports", cursor(before))
        if(page.optString("viewerId") != client.userId) throw ApiException(403,"Обнови сеанс.")
        return page
    }
    suspend fun queue(before: String? = null) = client.get("api/moderation/reports", cursor(before))
    suspend fun summary() = client.get("api/reports/summary")
    suspend fun identity() = client.get("api/me")
    companion object {
        val kinds = mapOf("direct" to "Личное сообщение", "club" to "Сообщение клуба", "post" to "Публикация", "comment" to "Комментарий", "profile" to "Профиль", "lfg" to "Объявление о группе", "event" to "Игровой вечер", "club_page" to "Страница клуба")
        val actions = mapOf("post" to "remove-post", "comment" to "remove-comment", "profile" to "hide-profile", "club_page" to "remove-club", "lfg" to "close-group", "event" to "cancel-event", "club" to "remove-chat-message")
        fun cursor(before: String?) = before?.let { mapOf("before" to it) } ?: emptyMap()
        fun reasonValid(text: String) = text.trim().length in 3..1000
        fun reportBody(kind: String, target: String, reason: String): JSONObject {
            require(kind in kinds && reasonValid(reason))
            val id: Any = if (kind in listOf("profile", "club_page")) {
                require(target.isNotBlank() && target.length <= 80); target
            } else {
                val number = target.toLongOrNull(); require(number != null && number in 1..9007199254740991L); number
            }
            return JSONObject().put("kind", kind).put("targetId", id).put("reason", reason.trim())
        }
        fun status(value: String) = when(value) { "pending" -> "Ожидает рассмотрения"; "upheld" -> "Нарушение подтверждено"; "dismissed" -> "Нарушение не подтверждено"; else -> "Неизвестный статус" }
        fun independent(r: JSONObject, user: String?, appeal: Boolean = false): Boolean = user != null &&
            listOfNotNull(r.nullableString("reporter_id"), r.nullableString("sender_id"), if(appeal) r.nullableString("moderator_id") else null).none { it == user } &&
            r.nullableString("reporter_id") != null && r.nullableString("sender_id") != null
        fun actionAvailable(r: JSONObject, user: String?): String? = actions[r.optString("kind")]?.takeIf {
            independent(r, user) && r.nullableString("applied_action") == null &&
                (r.nullableString("appeal_status") ?: r.optString("status")) == "upheld"
        }
        fun impact(action: String) = when(action) {
            "remove-club" -> "Клуб будет удалён полностью: публикации, комментарии, реакции, сохранения, опросы, руководства, закрепления, приглашения, передачи, чат, членства, роли, черновики, журнал и обложка. Непривязанные изображения удалятся. Участники потеряют доступ без уведомления. Удаление необратимо в приложении; резервные копии сохраняют данные до ротации."
            "remove-post" -> "Публикация и её обсуждение будут удалены, связанные реакции и сохранения исчезнут. Непривязанное изображение удалится."
            "remove-comment" -> "Комментарий будет удалён. Ответы сохранятся без ссылки на родительский комментарий и его контекст."
            "hide-profile" -> "Публичный профиль исчезнет из каталога. Аккаунт не блокируется."
            "close-group" -> "Объявление закроется, заголовок заменится на «[Удалено модерацией]», описание и чат очистятся. Ожидающим и принятым участникам придёт уведомление о закрытии."
            "cancel-event" -> "Событие отменится, заголовок заменится на «[Удалено модерацией]», описание и чат очистятся. Участникам, занявшим места, придёт уведомление об отмене."
            "remove-chat-message" -> "Сообщение клуба будет удалено."
            else -> "Действие недоступно."
        } + " Снимок жалобы сохраняется. Апелляция не отменяет удаление."
        fun actionLabel(action: String) = when(action) { "remove-club" -> "Удалить клуб со всем содержимым"; "remove-post" -> "Удалить публикацию и обсуждение"; "remove-comment" -> "Удалить комментарий"; "hide-profile" -> "Скрыть публичный профиль"; "close-group" -> "Закрыть объявление и очистить чат"; "cancel-event" -> "Отменить событие и очистить чат"; "remove-chat-message" -> "Удалить сообщение клуба"; else -> "Действие" }
        fun snapshot(r: JSONObject): String {
            val raw = r.optString("snapshot")
            if(r.optString("kind") != "profile") return raw
            return try {
                val p = JSONObject(raw)
                val lines = mutableListOf<String>()
                listOf("name" to "Имя", "handle" to "Ник", "bio" to "О себе").forEach { (key,label) -> p.nullableString(key)?.let { lines += "$label: $it" } }
                p.optJSONObject("gameProfile")?.let { game ->
                    val labels = mapOf("riotId" to "Riot ID", "rank" to "Ранг", "roles" to "Роли", "champions" to "Чемпионы", "region" to "Регион", "playStyle" to "Стиль игры", "schedule" to "Время игры", "playTime" to "Время игры", "language" to "Язык", "voice" to "Голосовая связь", "voiceChat" to "Голосовая связь", "microphone" to "Микрофон", "rankVerified" to "Ранг подтверждён", "riotVisible" to "Riot ID виден")
                    fun display(value: Any?): String = when(value) { true -> "Да"; false -> "Нет"; "baron" -> "Барон"; "jungle" -> "Лес"; "mid" -> "Центр"; "dragon" -> "Дракон"; "support" -> "Поддержка"; "yes" -> "Есть"; "no" -> "Нет"; "unknown" -> "Не указан"; else -> value?.toString().orEmpty() }
                    game.keys().forEach { key ->
                        val value = game.opt(key)
                        val readable = when(value) { is org.json.JSONArray -> (0 until value.length()).mapNotNull { i -> value.opt(i)?.takeUnless { it is JSONObject || it is org.json.JSONArray || it == JSONObject.NULL }?.let { display(it) } }.joinToString(", "); is JSONObject -> ""; JSONObject.NULL -> ""; else -> display(value) }
                        if(readable.isNotBlank()) lines += "${labels[key] ?: "Игровое поле ($key)"}: $readable"
                    }
                }
                lines.joinToString("\n").ifBlank { "Снимок профиля не содержит читаемых полей." }
            } catch(_: Exception) { "Снимок профиля недоступен для чтения." }
        }
        fun contentRoute(r: JSONObject): String? {
            if(r.nullableString("applied_action") != null) return null
            val id = r.nullableString("target_id") ?: r.nullableString("message_id") ?: return null
            return when(r.optString("kind")) { "post" -> "content/post/$id"; "club_page" -> "content/club/$id"; "profile" -> "discovery/player/$id"; "lfg" -> "discovery/group/$id"; "event" -> "discovery/event/$id"; else -> null }
        }
    }
}
