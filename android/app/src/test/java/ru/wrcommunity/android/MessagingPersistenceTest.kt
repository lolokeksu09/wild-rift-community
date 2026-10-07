package ru.wrcommunity.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.MessagingViewModel
import kotlin.coroutines.CoroutineContext

@OptIn(ExperimentalCoroutinesApi::class)
class MessagingPersistenceTest {
    private lateinit var server:MockWebServer
    private var account:String?="self"
    private var boundary=1L
    private val room="chat/direct/one"
    private val pending=PendingMessage("persisted-client-id-123","Исходный текст",busy=true)
    @Before fun setup(){Dispatchers.setMain(Dispatchers.Unconfined);server=MockWebServer().apply{start()}}
    @After fun cleanup(){server.shutdown();Dispatchers.resetMain()}
    private fun model(store:MessageStore,storageDispatcher:CoroutineDispatcher=Dispatchers.Unconfined)=MessagingViewModel(FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"csrf"},{account},{boundary},{},{}),store,storageDispatcher)
    private fun stored()=MemoryMessageStore().apply{write("self",room,StoredMessageRoom("Продолжение",pending=listOf(pending)));write("self","chat/club/two",StoredMessageRoom("Другой клуб"))}
    private fun page(messages:String="[]")=MockResponse().setBody("""{"viewerId":"self","messages":$messages,"hasMore":false,"next":null}""")
    private suspend fun loaded(model:MessagingViewModel){withTimeout(5000){model.chatState.first{!it.busy&&it.accessValidated}}}
    private suspend fun failed(model:MessagingViewModel){withTimeout(5000){model.chatState.first{!it.busy&&it.error!=null}}}

    @Test fun bootstrapResetPreservesDiskAndRoomWaitsForServerAcl()=runBlocking {
        val store=stored();val model=model(store)
        model.reset();model.open(room)
        assertTrue(model.chatState.value.pending.isEmpty());assertEquals("",model.chatState.value.draft)
        model.retry(pending.clientId);assertEquals(0,server.requestCount)
        server.enqueue(page());model.refresh();loaded(model)
        assertEquals("Продолжение",model.chatState.value.draft)
        assertEquals(pending.clientId,model.chatState.value.pending.single().clientId)
        assertEquals(pending.body,model.chatState.value.pending.single().body)
        assertFalse(model.chatState.value.pending.single().busy)
        assertEquals("Другой клуб",store.read("self")["chat/club/two"]!!.draft)
    }
    @Test fun deniedRoomDeletesOnlyThatRoomsPrivateDraftAndQueue()=runBlocking {
        val store=stored();val model=model(store);model.open(room)
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"Доступ закрыт"}"""))
        model.refresh();failed(model)
        assertTrue(model.chatState.value.denied);assertFalse(model.chatState.value.accessValidated)
        assertTrue(model.chatState.value.pending.isEmpty());assertEquals("",model.chatState.value.draft)
        assertNull(store.read("self")[room]);assertEquals("Другой клуб",store.read("self")["chat/club/two"]!!.draft)
    }
    @Test fun deniedRoomStaysBusyUntilItsQueuedDiskRemovalCompletes():Unit=runBlocking {
        val tasks=Channel<Runnable>(Channel.UNLIMITED)
        val dispatcher=object:CoroutineDispatcher(){override fun dispatch(context:CoroutineContext,block:Runnable){check(tasks.trySend(block).isSuccess)}}
        val store=stored();val model=model(store,dispatcher);model.open(room)
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"Доступ закрыт"}"""))
        model.refresh()
        val remove=withTimeout(5000){tasks.receive()}
        assertTrue(model.chatState.value.denied);assertTrue(model.chatState.value.busy)
        assertTrue(model.chatState.value.pending.isEmpty());assertEquals("",model.chatState.value.draft)
        assertNotNull(store.read("self")[room])
        remove.run();failed(model)
        assertNull(store.read("self")[room]);assertEquals("Другой клуб",store.read("self")["chat/club/two"]!!.draft)
        tasks.close()
    }
    @Test fun temporaryServerFailureKeepsDiskHiddenUntilRoomIsValidated()=runBlocking {
        val store=stored();val model=model(store);model.open(room)
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"Временно недоступно"}"""));model.refresh();failed(model)
        assertTrue(model.chatState.value.pending.isEmpty());assertFalse(model.chatState.value.accessValidated)
        assertEquals(pending.clientId,store.read("self")[room]!!.pending.single().clientId)
        server.enqueue(page());model.refresh();loaded(model)
        assertEquals(pending.body,model.chatState.value.pending.single().body)
    }
    @Test fun restoredConfirmedSendReconcilesByOwnerAndIdentifier()=runBlocking {
        val store=stored();val model=model(store);model.open(room)
        val row=JSONObject().put("id",10).put("sender_id","self").put("sender_name","Я").put("client_id",pending.clientId).put("body",pending.body).put("created_at",1)
        server.enqueue(page("[$row]"));model.refresh();loaded(model)
        assertTrue(model.chatState.value.pending.isEmpty());assertTrue(store.read("self")[room]!!.pending.isEmpty())
        assertEquals("Продолжение",model.chatState.value.draft)
    }
    @Test fun writeRestrictionPreservesRoomAndFailedSendAfterFreshReadAcl()=runBlocking {
        val store=stored();val model=model(store);model.open(room)
        server.enqueue(page());model.refresh();loaded(model);server.takeRequest()
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"Сообщения временно ограничены. Чтение доступно."}"""))
        server.enqueue(page());model.retry(pending.clientId);failed(model)
        assertEquals("POST",server.takeRequest().method)
        assertEquals("/api/direct/one/messages",server.takeRequest().path)
        assertFalse(model.chatState.value.denied);assertTrue(model.chatState.value.accessValidated)
        assertEquals("Продолжение",model.chatState.value.draft)
        assertEquals(pending.clientId,model.chatState.value.pending.single().clientId)
        assertEquals(pending.body,store.read("self")[room]!!.pending.single().body)
        assertTrue(model.chatState.value.error!!.contains("ограничены"))
    }
    @Test fun rejectedSendWithRevokedReadAclDeletesRoomData()=runBlocking {
        val store=stored();val model=model(store);model.open(room)
        server.enqueue(page());model.refresh();loaded(model);server.takeRequest()
        repeat(2){server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"Беседа заблокирована."}"""))}
        model.retry(pending.clientId);failed(model)
        assertTrue(model.chatState.value.denied);assertFalse(model.chatState.value.accessValidated)
        assertTrue(model.chatState.value.pending.isEmpty());assertEquals("",model.chatState.value.draft)
        assertNull(store.read("self")[room]);assertEquals("Другой клуб",store.read("self")["chat/club/two"]!!.draft)
    }
    @Test fun rejectedSendWithUnavailableReadCheckHidesButRetainsDiskUntilFreshAcl()=runBlocking {
        val store=stored();val model=model(store);model.open(room)
        server.enqueue(page());model.refresh();loaded(model);server.takeRequest()
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"Отправка недоступна."}"""))
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"Нет связи."}"""))
        model.retry(pending.clientId);failed(model)
        assertFalse(model.chatState.value.accessValidated);assertTrue(model.chatState.value.pending.isEmpty())
        assertEquals("",model.chatState.value.draft);assertEquals(pending.clientId,store.read("self")[room]!!.pending.single().clientId)
        server.enqueue(page());model.refresh();loaded(model)
        assertEquals("Продолжение",model.chatState.value.draft)
        assertEquals(pending.clientId,model.chatState.value.pending.single().clientId)
    }
    @Test fun restoredRetrySendsTheExactOriginalIdentifierAndBody()=runBlocking {
        val store=stored();val model=model(store);model.open(room)
        server.enqueue(page());model.refresh();loaded(model);server.takeRequest()
        val row=JSONObject().put("id",10).put("sender_id","self").put("sender_name","Я").put("client_id",pending.clientId).put("body",pending.body).put("created_at",1)
        server.enqueue(MockResponse().setBody(JSONObject().put("message",row).toString()))
        model.retry(pending.clientId)
        val sent=server.takeRequest();assertEquals("POST",sent.method)
        val body=JSONObject(sent.body.readUtf8());assertEquals(pending.clientId,body.getString("clientId"));assertEquals(pending.body,body.getString("body"))
        withTimeout(5000){model.chatState.first{it.pending.isEmpty()}}
        assertEquals("Продолжение",model.chatState.value.draft)
    }
    @Test fun failedSendAndDraftSurviveANewViewModelWithoutAutomaticRetry()=runBlocking {
        val store=MemoryMessageStore();val first=model(store);first.open(room)
        server.enqueue(page());first.refresh();loaded(first);server.takeRequest()
        first.draft("Исходное сообщение")
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"Нет подтверждения"}"""))
        first.send()
        val sent=server.takeRequest();val original=JSONObject(sent.body.readUtf8())
        withTimeout(5000){first.chatState.first{it.pending.singleOrNull()?.let{p->!p.busy&&p.error!=null}==true}}
        first.draft("Следующий черновик")
        val restarted=model(store);restarted.reset();restarted.open(room)
        assertEquals("",restarted.chatState.value.draft);assertTrue(restarted.chatState.value.pending.isEmpty())
        server.enqueue(page());restarted.refresh();loaded(restarted);server.takeRequest()
        assertEquals("Следующий черновик",restarted.chatState.value.draft)
        assertEquals(original.getString("clientId"),restarted.chatState.value.pending.single().clientId)
        assertEquals(original.getString("body"),restarted.chatState.value.pending.single().body)
        assertEquals(3,server.requestCount)
    }
    @Test fun logoutAndAccountSwitchClearThePreviousOwnersRooms()=runBlocking {
        val store=stored();val model=model(store);model.open(room)
        server.enqueue(page());model.refresh();loaded(model)
        account="other";boundary++;model.reset()
        assertTrue(store.read("self").isEmpty());assertTrue(model.chatState.value.pending.isEmpty())
        model.open(room);assertEquals("",model.chatState.value.draft)
    }
    @Test fun reopenRequiresFreshAclButRetainsSameAccountDraft()=runBlocking {
        val store=stored();val model=model(store);model.open(room)
        server.enqueue(page());model.refresh();loaded(model)
        model.open("chat/club/two");model.open(room)
        assertTrue(model.chatState.value.pending.isEmpty());assertEquals("",model.chatState.value.draft)
        server.enqueue(page());model.refresh();loaded(model)
        assertEquals("Продолжение",model.chatState.value.draft);assertEquals(pending.clientId,model.chatState.value.pending.single().clientId)
    }
    @Test fun codecRoundTripPreservesRoomsAndRequestIdentityWithoutBusyFlag(){
        val rooms=mapOf(room to StoredMessageRoom("Черновик",pending=listOf(pending)),"chat/inbox" to StoredMessageRoom("Первый текст","handle",request=pending,signature="handle\u0000Первый текст"))
        val decoded=MessageStoreCodec.decode(MessageStoreCodec.encode("self",rooms))
        assertEquals("self",decoded.first);assertEquals(rooms.keys,decoded.second.keys)
        assertEquals(pending.body,decoded.second[room]!!.pending.single().body);assertEquals(pending.clientId,decoded.second["chat/inbox"]!!.request!!.clientId)
        assertFalse(decoded.second[room]!!.pending.single().busy)
        val store=MemoryMessageStore();store.write("self",room,rooms[room]!!);assertTrue(store.read("other").isEmpty());assertTrue(store.read("self").isEmpty())
    }
}
