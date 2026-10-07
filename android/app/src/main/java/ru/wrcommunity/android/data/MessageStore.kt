package ru.wrcommunity.android.data

import org.json.JSONArray
import org.json.JSONObject

/** Only drafts and unconfirmed sends; server history is never cached on disk. */
data class StoredMessageRoom(val draft:String="", val handle:String="", val pending:List<PendingMessage> = emptyList(), val request:PendingMessage?=null, val signature:String="")

/** Implementations are called serially on IO; owner IDs and room routes stay inside encryption. */
interface MessageStore {
    fun read(owner:String):Map<String,StoredMessageRoom>
    fun write(owner:String,route:String,room:StoredMessageRoom)
    fun clear(owner:String)
    fun clearAll()
}

class MemoryMessageStore:MessageStore {
    private var owner:String?=null
    private val rooms=mutableMapOf<String,StoredMessageRoom>()
    override fun read(owner:String):Map<String,StoredMessageRoom> { if(this.owner!=owner){rooms.clear();this.owner=owner};return rooms.toMap() }
    override fun write(owner:String,route:String,room:StoredMessageRoom){read(owner);if(room==StoredMessageRoom())rooms.remove(route)else rooms[route]=room.copy(pending=room.pending.map{it.copy(busy=false)})}
    override fun clear(owner:String){if(this.owner==owner)clearAll()}
    override fun clearAll(){owner=null;rooms.clear()}
}

internal object MessageStoreCodec {
    fun encode(owner:String,rooms:Map<String,StoredMessageRoom>):String {
        val rows=JSONObject()
        rooms.forEach{(route,room)->rows.put(route,JSONObject().put("draft",room.draft).put("handle",room.handle)
            .put("pending",JSONArray(room.pending.take(20).map{MessagingContract.payload(it)}))
            .put("request",room.request?.let{MessagingContract.payload(it)}?:JSONObject.NULL).put("signature",room.signature))}
        return JSONObject().put("owner",owner).put("rooms",rows).toString()
    }
    fun decode(value:String):Pair<String,Map<String,StoredMessageRoom>> {
        val raw=JSONObject(value);val rows=raw.getJSONObject("rooms")
        fun pending(o:JSONObject)=PendingMessage(o.getString("clientId"),o.getString("body"),error="Отправка не подтверждена. Проверь историю перед повтором.")
        return raw.getString("owner") to rows.keys().asSequence().associateWith{route->
            val room=rows.getJSONObject(route)
            StoredMessageRoom(room.optString("draft").take(2000),room.optString("handle").take(24),room.rows("pending").take(20).map(::pending),room.optJSONObject("request")?.let(::pending),room.optString("signature"))
        }
    }
}
