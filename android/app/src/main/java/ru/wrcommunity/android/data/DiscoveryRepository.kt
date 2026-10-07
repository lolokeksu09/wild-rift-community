package ru.wrcommunity.android.data

import org.json.JSONArray
import org.json.JSONObject
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
    suspend fun page(path:String,query:Map<String,String> = emptyMap())=client.get(path,query)
    suspend fun detail(route:String):JSONObject {
        val d=client.get(DiscoveryContract.routePath(route))
        val entity=d.optJSONObject("group")?:d.optJSONObject("event")
        val member=entity!=null && (entity.optString("membership")=="accepted" || entity.nullableString("myRole")!=null)
        if(member){d.put("chat",client.get(DiscoveryContract.routePath(route)+"/messages"))}
        return d
    }
    suspend fun notificationPage(category:String,query:Map<String,String> = emptyMap()):JSONObject {
        val path=notificationPath(category)
        return client.get(path,query).put("summary",client.get("api/notifications/summary"))
    }
    companion object {
        fun notificationPath(category:String)=when(category){
            "direct"->"api/direct";"reports"->"api/reports"
            else->"api/$category/notifications"
        }
        fun notificationKey(category:String)=when(category){"direct"->"conversations";"reports"->"reports";else->"notifications"}
    }
}
