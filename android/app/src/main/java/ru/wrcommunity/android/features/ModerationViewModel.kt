package ru.wrcommunity.android.features

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.wrcommunity.android.data.*

class ModerationViewModel(client: FeatureClient) : FeatureViewModel(client) {
    private val repository = ModerationRepository(client)
    private var fetch: Job? = null
    private var currentRoute = "moderation/reports"
    override fun reset() { fetch?.cancel(); fetch=null; super.reset() }
    fun prepareCreate() { reset() }
    fun open(route: String, more: Boolean = false) {
        if(state.value.busy && fetch?.isActive != true) return
        currentRoute = route
        val old = if(more) state.value.data else null
        val identity = client.identityKey
        fetch?.cancel()
        mutable.value = mutable.value.copy(busy=true, error=null, data=old)
        fetch = viewModelScope.launch {
            try {
                val me = repository.identity()
                val moderator = me.optJSONObject("user")?.optBoolean("isModerator", false) == true
                val queue = route == "moderation/queue"
                val requested = route.removePrefix("moderation/item/").takeIf { route.startsWith("moderation/item/") }
                var page = if(queue) repository.queue(old?.nullableString("next")) else repository.own(old?.nullableString("next"))
                var isQueue = queue
                if(requested != null) {
                    var found = page.rows("reports").find { it.optString("id") == requested }
                    while(found == null && page.nullableString("next") != null) {
                        page = repository.own(page.nullableString("next")); found = page.rows("reports").find { it.optString("id") == requested }
                    }
                    if(found == null && moderator) {
                        isQueue = true; page = repository.queue(); found = page.rows("reports").find { it.optString("id") == requested }
                        while(found == null && page.nullableString("next") != null) { page=repository.queue(page.nullableString("next")); found=page.rows("reports").find { it.optString("id") == requested } }
                    }
                    page = JSONObject().put("reports", JSONArray().apply { found?.let { put(it) } }).put("next", JSONObject.NULL)
                } else if(more) {
                    val all = old?.rows("reports").orEmpty() + page.rows("reports")
                    page.put("reports", JSONArray(all.distinctBy { it.optString("id") }))
                }
                if(!isQueue && page.nullableString("viewerId") != null && page.optString("viewerId") != userId) throw ApiException(403,"Обнови сеанс.")
                val summary = repository.summary()
                if(summary.optString("viewerId") != userId) throw ApiException(403,"Обнови сеанс.")
                page.put("queue", isQueue).put("isModerator", moderator).put("unread", summary.optInt("unread"))
                if(client.identityKey == identity) mutable.value = FeatureState(page, revision=state.value.revision+1)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(client.identityKey == identity) mutable.value=mutable.value.copy(busy=false,error=message(e,false),data=if(e is ApiException && e.status in listOf(401,403,404)) null else old) }
        }
    }
    fun create(kind: String, target: String, reason: String, onSuccess: (String)->Unit) {
        val body = try { ModerationRepository.reportBody(kind,target,reason) } catch(_: IllegalArgumentException) { mutable.value=mutable.value.copy(error="Проверь объект и причину: от 3 до 1000 символов."); return }
        act("api/reports", body=body, onSuccess={ onSuccess("moderation/item/${it.optLong("id")}") })
    }
    fun submit(id: String, stage: String, text: String, decision: String? = null, action: String? = null) {
        if(!id.matches(Regex("[1-9][0-9]*"))) return
        if(stage !in listOf("read", "appeal/read") && !ModerationRepository.reasonValid(text)) { mutable.value=mutable.value.copy(error="Объяснение: от 3 до 1000 символов."); return }
        val prefix = if(stage in listOf("decision","appeal-decision","action")) "api/moderation/reports" else "api/reports"
        val body = JSONObject()
        if(stage == "appeal") body.put("reason",text.trim())
        else if(stage !in listOf("read","appeal/read")) body.put("note",text.trim())
        decision?.let { body.put("decision",it) }; action?.let { body.put("action",it) }
        act("$prefix/$id/$stage",body=body,onSuccess={ open(currentRoute) })
    }
}
