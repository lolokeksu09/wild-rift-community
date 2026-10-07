package ru.wrcommunity.android.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.UUID

/** Exact server contracts; local times that overlap or disappear at DST are refused. */
object DiscoveryContract {
    val roles=listOf("baron","jungle","mid","dragon","support")
    fun instant(local:String,zone:String):Long {
        val wall=LocalDateTime.parse(local)
        val id=ZoneId.of(zone)
        val offsets=id.rules.getValidOffsets(wall)
        require(offsets.size==1){"Время попало на перевод часов. Выбери другое время или UTC."}
        return wall.toInstant(offsets.single()).toEpochMilli()
    }
    fun routePath(route:String):String=when {
        route=="discovery/home" -> "api/home"
        route=="discovery/players" -> "api/players"
        route=="discovery/members" -> "api/community-members"
        route=="discovery/lfg" -> "api/lfg"
        route=="discovery/events" -> "api/events"
        route=="discovery/saved" -> "api/saved"
        route.startsWith("discovery/player/") -> "api/profiles/"+route.substringAfterLast('/')
        route.startsWith("discovery/group/") -> "api/lfg/"+route.substringAfterLast('/')
        route.startsWith("discovery/event/") -> "api/events/"+route.substringAfterLast('/')
        else -> "api/notifications/summary"
    }
    fun merge(old:JSONObject,page:JSONObject,key:String):JSONObject {
        if(old.has("blockVersion")&&page.has("blockVersion")&&old.optLong("blockVersion")!=page.optLong("blockVersion"))return page
        val result=JSONObject(page.toString());val rows=JSONArray()
        val combined=(old.rows(key)+page.rows(key)).distinctBy{it.optString("id")}
        (if(key=="messages")combined.sortedBy{it.optLong("id")} else combined).forEach{rows.put(it)}
        result.put(key,rows);return result
    }
}

/** A retry keeps its ID only when its exact body is unchanged. Never retries automatically. */
class DiscoverySubmission {
    private var signature:String?=null
    private var id:String?=null
    fun body(input:JSONObject):JSONObject {
        val copy=JSONObject(input.toString());copy.remove("clientId")
        val value=copy.toString()
        if(value!=signature){signature=value;id=UUID.randomUUID().toString()}
        return copy.put("clientId",id)
    }
    fun clear(){signature=null;id=null}
}

class DiscoveryRepository(private val client:FeatureClient) {
    suspend fun page(path:String,query:Map<String,String> = emptyMap())=verified(client.get(path,query))
    /** Guests compose only public resources; each preview is freshly checked for this account. */
    suspend fun home():JSONObject=coroutineScope {
        val viewer=client.userId
        val boundary=client.identityKey
        val sources=listOf("feed" to "api/feed","catalog" to "api/clubs","people" to "api/community-members")+
            (if(viewer!=null)listOf("personal" to "api/home")else emptyList())
        val pages=sources.map{(key,path)->async {
            try { Triple(key,page(path,if(key=="catalog")mapOf("scope" to "open","sort" to "discussion")else emptyMap()),null) }
            catch(e:CancellationException){throw e}
            catch(e:Exception){
                // Access failures invalidate all displayed data instead of looking like empty sections.
                if(e is ApiException && e.status in listOf(401,403,404))throw e
                Triple(key,null,e)
            }
        }}.awaitAll()
        if(boundary!=client.identityKey)throw CancellationException("Account changed")
        if(pages.none{it.second!=null})throw pages.firstNotNullOf{it.third}
        val personal=pages.firstOrNull{it.first=="personal"}?.second
        val result=JSONObject(personal?.toString()?:"{}").put("viewerId",viewer?:JSONObject.NULL)
            .put("personalLoaded",personal!=null)
        val warnings=JSONObject()
        pages.forEach{(key,data,error)->
            if(data!=null && key!="personal")result.put(key,data)
            if(error!=null)warnings.put(key,when(error){
                is javax.net.ssl.SSLException->"Не удалось подтвердить защищённое соединение."
                is ApiException->error.message?.take(300)?:"Не удалось загрузить раздел."
                is IOException->"Нет связи с сервером. Обнови главную позже."
                else->"Не удалось загрузить раздел. Обнови главную."
            })
        }
        // /api/home returns compact rows without the state field from full list cards.
        // Use its server clock, rather than the device clock, for the same visible labels.
        personal?.let {
            val now=it.optLong("generatedAt")
            result.rows("events").forEach { event->
                event.put("state",if(event.optLong("starts_at")<=now)"started"
                    else if(event.optInt("members")>=event.optInt("capacity"))"full" else "open")
            }
            (result.rows("myGroups")+result.rows("groups")).forEach { group->
                group.put("state",if(group.optInt("members")>=group.optInt("capacity"))"full" else "open")
            }
        }
        result.put("homeWarnings",warnings)
    }
    private fun verified(raw:JSONObject):JSONObject {
        if(raw.has("viewerId") && raw.nullableString("viewerId")!=client.userId)
            throw ApiException(403,"Сеанс изменился. Обнови данные после входа.")
        return raw
    }
    suspend fun detail(route:String,previousChat:JSONObject?=null,historyFloor:Long?=null):JSONObject {
        val d=verified(client.get(DiscoveryContract.routePath(route)))
        val entity=d.optJSONObject("group")?:d.optJSONObject("event")
        val member=entity!=null && (entity.optString("membership")=="accepted" || entity.nullableString("myRole")!=null)
        if(member)d.put("chat",chatHistory(DiscoveryContract.routePath(route)+"/messages",previousChat,historyFloor))
        return d
    }
    /** Drain every newer page, then re-read the displayed interval with current access checks.
     * A peer's block need not increment our blockVersion, so cached rows are never unioned in. */
    suspend fun chatHistory(path:String,previous:JSONObject?=null,historyFloor:Long?=null):JSONObject {
        val prior=previous?.rows("messages").orEmpty()
        var newer=prior.maxOfOrNull{it.optLong("id")}
        if(newer!=null) {
            do {
                val page=verified(client.get(path,mapOf("after" to newer.toString())))
                val next=page.nullableString("next")?.toLongOrNull()
                if(!page.optBoolean("hasMore"))break
                require(next!=null && next>newer!!){"Не удалось продолжить загрузку сообщений."}
                newer=next
            }while(true)
        }
        val floor=historyFloor?:prior.minOfOrNull{it.optLong("id")}
        var fresh=verified(client.get(path))
        while(floor!=null && fresh.rows("messages").minOfOrNull{it.optLong("id")}?.let{it>floor}==true) {
            val next=fresh.nullableString("next")?:break
            val page=verified(client.get(path,mapOf("before" to next)))
            if(page.optLong("blockVersion")!=fresh.optLong("blockVersion")) {
                // A local block changed mid-read; discard all pages and retry on the next refresh.
                return verified(client.get(path))
            }
            fresh=DiscoveryContract.merge(fresh,page,"messages")
            if(page.nullableString("next")==next)throw ApiException(422,"Не удалось продолжить загрузку истории.")
        }
        return fresh
    }
    suspend fun notificationPage(category:String,query:Map<String,String> = emptyMap(),previous:JSONObject?=null):JSONObject {
        val path=notificationPath(category);val key=notificationKey(category)
        val target=previous?.rows(key)?.lastOrNull()
        var fresh=verified(client.get(path,query))
        // Reload the entire displayed prefix; removed or blocked rows cannot survive a poll.
        while(target!=null && !frontierReached(category,fresh.rows(key),target)) {
            val next=fresh.nullableString("next")?:break
            val page=verified(client.get(path,mapOf((if(category=="direct")"after" else "before") to next)))
            fresh=DiscoveryContract.merge(fresh,page,key)
            if(page.nullableString("next")==next)throw ApiException(422,"Не удалось продолжить загрузку уведомлений.")
        }
        return fresh.put("summary",verified(client.get("api/notifications/summary")))
    }
    private fun frontierReached(category:String,rows:List<JSONObject>,target:JSONObject):Boolean {
        val last=rows.lastOrNull()?:return true
        return if(category=="direct")last.optLong("created_at")<target.optLong("created_at") ||
            (last.optLong("created_at")==target.optLong("created_at") && last.optString("id")>=target.optString("id"))
        else last.optLong("id")<=target.optLong("id")
    }
    companion object {
        fun notificationPath(category:String)=when(category){
            "direct"->"api/direct";"reports"->"api/reports"
            else->"api/$category/notifications"
        }
        fun notificationKey(category:String)=when(category){"direct"->"conversations";"reports"->"reports";else->"notifications"}
    }
}
