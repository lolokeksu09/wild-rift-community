package ru.wrcommunity.android.data

import org.json.JSONObject
import java.util.UUID

data class ChatMessage(val id:Long,val senderId:String,val sender:String,val clientId:String,val body:String,val time:Long)
data class Conversation(val id:String,val peerId:String,val peer:String,val handle:String,val status:String,val requester:String,val firstBody:String,val firstId:Long,val unread:Int)
data class ContactBudget(val remaining:Int,val limit:Int,val used:Int,val waitSeconds:Long,val newAccount:Boolean)
data class MessagePage(val messages:List<ChatMessage>,val more:Boolean,val next:Long?,val blockVersion:Long?)
data class InboxPage(val conversations:List<Conversation>,val next:String?,val unread:Int,val requests:Int,val budget:ContactBudget?)
data class PendingMessage(val clientId:String,val body:String,val busy:Boolean=false,val error:String?=null)
object MessagingContract {
    fun message(o:JSONObject)=ChatMessage(o.getLong("id"),o.getString("sender_id"),o.optString("sender_name"),o.getString("client_id"),o.getString("body"),o.getLong("created_at"))
    fun page(o:JSONObject)=MessagePage(o.rows("messages").map(::message),o.optBoolean("hasMore"),if(o.isNull("next"))null else o.optLong("next"),if(o.has("blockVersion"))o.getLong("blockVersion") else null)
    fun inbox(o:JSONObject)=InboxPage(o.rows("conversations").map{Conversation(it.getString("id"),it.getString("peer_id"),it.getString("peer_name"),it.getString("peer_handle"),it.getString("status"),it.getString("requester_id"),it.optString("first_body"),it.optLong("first_message_id"),it.optInt("unread"))},o.nullableString("next"),o.optInt("unread"),o.optInt("requests"),budget(o))
    fun budget(o:JSONObject):ContactBudget?=o.optJSONObject("contactBudget")?.let{ContactBudget(it.optInt("remaining"),it.optInt("limit"),it.optInt("used"),it.optLong("retryAfterSeconds"),it.optBoolean("newAccount"))}
    fun pending(body:String)=PendingMessage(UUID.randomUUID().toString(),body.trim())
    fun payload(p:PendingMessage)=JSONObject().put("clientId",p.clientId).put("body",p.body)
    fun endpoint(route:String):String { val parts=route.split('/');require(parts.size==3&&parts[1] in listOf("club","direct"));return if(parts[1]=="club")"api/clubs/${parts[2]}/messages" else "api/direct/${parts[2]}/messages" }
    fun reconcile(pending:List<PendingMessage>,messages:List<ChatMessage>,viewer:String)=pending.filter{p->messages.none{it.senderId==viewer&&it.clientId==p.clientId}}
}
class MessagingRepository(private val client:FeatureClient) {
    suspend fun inbox(cursor:String?=null):InboxPage {
        val raw=client.get("api/direct",cursor?.let{mapOf("after" to it)}?:emptyMap())
        verifyViewer(raw)
        return MessagingContract.inbox(raw)
    }
    private fun verifyViewer(raw:JSONObject){if(raw.optString("viewerId")!=client.userId)throw ApiException(403,"Сеанс изменился. Открой беседу заново.")}
    suspend fun messages(route:String,query:Map<String,String> = emptyMap()):MessagePage {
        val raw=client.get(MessagingContract.endpoint(route),query)
        verifyViewer(raw)
        return MessagingContract.page(raw)
    }
    suspend fun send(route:String,pending:PendingMessage):ChatMessage {
        val message=MessagingContract.message(client.post(MessagingContract.endpoint(route),MessagingContract.payload(pending)).getJSONObject("message"))
        if(message.senderId!=client.userId)throw ApiException(403,"Сеанс изменился. Открой беседу заново.")
        return message
    }
}
