package ru.wrcommunity.android
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.MockResponse
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*
class MessagingContractTest {
 @Test fun repositoryUsesCursorAndExactIdempotentPayload()=runBlocking {
  val server=MockWebServer().apply{start()}
  try {
   val api=CommunityApi(server.url("/").toString(),allowLoopbackForTests=true)
   val client=FeatureClient(api,{"csrf-test"},{"self"},{1L},{},{})
   val repo=MessagingRepository(client)
   server.enqueue(MockResponse().setBody("""{"viewerId":"self","messages":[],"hasMore":false,"next":null,"blockVersion":2}"""))
   repo.messages("chat/club/room",mapOf("after" to "12"))
   assertEquals("/api/clubs/room/messages?after=12",server.takeRequest().path)
   val pending=MessagingContract.pending("Сообщение")
   repeat(2){
    server.enqueue(MockResponse().setBody(JSONObject().put("message",JSONObject().put("id",13).put("sender_id","self").put("sender_name","Я").put("client_id",pending.clientId).put("body",pending.body).put("created_at",2)).toString()))
    assertEquals(13L,repo.send("chat/club/room",pending).id)
    val request=server.takeRequest();assertEquals("POST",request.method);assertEquals("/api/clubs/room/messages",request.path);assertEquals("csrf-test",request.getHeader("X-CSRF-Token"));assertEquals("1",request.getHeader("X-Community-Request"));assertEquals(pending.clientId,JSONObject(request.body.readUtf8()).getString("clientId"))
   }
  }finally{server.shutdown()}
 }
 @Test fun repositoryRejectsWrongViewerBeforeReturningPrivateHistory()=runBlocking {
  val server=MockWebServer().apply{start()}
  try{val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"csrf"},{"self"},{1L},{},{})
   server.enqueue(MockResponse().setBody("""{"viewerId":"other","messages":[],"hasMore":false,"next":null}"""))
   try{MessagingRepository(client).messages("chat/direct/room");fail("Wrong viewer accepted")}catch(e:ApiException){assertEquals(403,e.status)}
  }finally{server.shutdown()}
 }

 @Test fun refreshReplacesWholeLoadedRangeIncludingDeletedMessages()=runBlocking {
  val server=MockWebServer().apply{start()}
  try {
   val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"csrf"},{"self"},{1L},{},{})
   fun row(id:Long)=JSONObject().put("id",id).put("sender_id","peer").put("sender_name","Другой").put("client_id","history-identifier-$id").put("body","Текст $id").put("created_at",id)
   fun page(ids:List<Long>,more:Boolean)=JSONObject().put("viewerId","self").put("blockVersion",2).put("messages",org.json.JSONArray(ids.map(::row))).put("hasMore",more).put("next",if(more)ids.first() else JSONObject.NULL)
   server.enqueue(MockResponse().setBody(page(listOf(61,62),true).toString()))
   server.enqueue(MockResponse().setBody(page(listOf(11,13),false).toString()))
   val result=MessagingRepository(client).history("chat/club/room",11)
   assertEquals(listOf(11L,13L,61L,62L),result.messages.map{it.id})
   assertFalse(result.more);assertEquals(2L,result.blockVersion)
   assertEquals("/api/clubs/room/messages",server.takeRequest().path)
   assertEquals("/api/clubs/room/messages?before=61",server.takeRequest().path)
  }finally{server.shutdown()}
 }
 @Test fun refreshRestartsWhenBlockVersionChangesBetweenHistoryPages()=runBlocking {
  val server=MockWebServer().apply{start()}
  try {
   val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"csrf"},{"self"},{1L},{},{})
   fun page(id:Long,version:Long,more:Boolean)=JSONObject().put("viewerId","self").put("blockVersion",version).put("messages",org.json.JSONArray().put(JSONObject().put("id",id).put("sender_id","peer").put("sender_name","Другой").put("client_id","history-identifier-$id").put("body","Текст").put("created_at",id))).put("hasMore",more).put("next",if(more)id else JSONObject.NULL)
   server.enqueue(MockResponse().setBody(page(61,2,true).toString()))
   server.enqueue(MockResponse().setBody(page(11,3,false).toString()))
   server.enqueue(MockResponse().setBody(page(62,3,false).toString()))
   val result=MessagingRepository(client).history("chat/club/room",11)
   assertEquals(listOf(62L),result.messages.map{it.id});assertEquals(3L,result.blockVersion)
   assertEquals(3,server.requestCount)
  }finally{server.shutdown()}
 }
 @Test fun pageAndSendConfirmationAreIndependent(){val p=MessagingContract.page(JSONObject("""{"messages":[{"id":8,"sender_id":"peer","sender_name":"Имя","client_id":"incoming-identifier","body":"<& текст","created_at":123}],"hasMore":true,"next":8,"blockVersion":4}"""));assertEquals(8L,p.next);assertEquals(4L,p.blockVersion);assertTrue(p.more);assertEquals("<& текст",p.messages.single().body);val m=MessagingContract.message(JSONObject("""{"id":20,"sender_id":"self","sender_name":"Я","client_id":"outgoing-identifier","body":"Ответ","created_at":124}"""));assertEquals(20L,m.id);assertEquals(8L,p.next)}
 @Test fun retryPreservesIdentifierAndBody(){val p=MessagingContract.pending(" текст ");assertEquals(MessagingContract.payload(p).toString(),MessagingContract.payload(p.copy(error="Нет связи")).toString());assertEquals("текст",p.body);assertTrue(p.clientId.matches(Regex("[A-Za-z0-9_-]{16,80}")));assertNotEquals(p.clientId,MessagingContract.pending("текст").clientId)}
 @Test fun confirmationCannotRemoveAnotherAccountsPending(){val p=MessagingContract.pending("Текст");val other=ChatMessage(1,"peer","Другой",p.clientId,"Текст",1);assertEquals(listOf(p),MessagingContract.reconcile(listOf(p),listOf(other),"self"));assertTrue(MessagingContract.reconcile(listOf(p),listOf(other.copy(senderId="self")),"self").isEmpty())}
 @Test fun inboxCountersIncludeAllPagesAndBudget(){val p=MessagingContract.inbox(JSONObject("""{"conversations":[],"next":"opaque-cursor","unread":91,"requests":15,"contactBudget":{"remaining":0,"limit":3,"used":3,"retryAfterSeconds":299,"newAccount":true}}"""));assertEquals(91,p.unread);assertEquals(15,p.requests);assertEquals("opaque-cursor",p.next);assertEquals(299L,p.budget!!.waitSeconds);assertTrue(p.budget!!.newAccount)}
 @Test fun pathsSeparateRooms(){assertEquals("api/direct/room/messages",MessagingContract.endpoint("chat/direct/room"));assertEquals("api/clubs/room/messages",MessagingContract.endpoint("chat/club/room"))}
 @Test(expected=IllegalArgumentException::class) fun invalidRouteCannotBecomeApiPath(){MessagingContract.endpoint("chat/inbox")}
}
