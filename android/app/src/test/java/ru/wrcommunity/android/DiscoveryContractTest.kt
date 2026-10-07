package ru.wrcommunity.android

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*

class DiscoveryContractTest {
    @Test fun dateConversionRejectsBothDSTEdges() {
        assertEquals(1791378000000L,DiscoveryContract.instant("2026-10-07T13:00","UTC"))
        for(local in listOf("2026-03-29T02:30","2026-10-25T02:30")) {
            try{DiscoveryContract.instant(local,"Europe/Berlin");fail("Ambiguous/nonexistent wall clock accepted")}
            catch(_:IllegalArgumentException){}
        }
    }
    @Test fun retryKeepsIdUntilExactBodyChanges() {
        val draft=DiscoverySubmission()
        val first=draft.body(JSONObject().put("body","Текст"))
        assertEquals(first.getString("clientId"),draft.body(JSONObject().put("body","Текст")).getString("clientId"))
        assertNotEquals(first.getString("clientId"),draft.body(JSONObject().put("body","Новый текст")).getString("clientId"))
        draft.clear()
        assertNotEquals(first.getString("clientId"),draft.body(JSONObject().put("body","Текст")).getString("clientId"))
        assertTrue(first.getString("clientId").matches(Regex("[A-Za-z0-9_-]{16,80}")))
    }
    @Test fun changedBlockVersionDiscardsOldPrivatePage() {
        val old=JSONObject("""{"players":[{"id":"hidden"}],"blockVersion":3,"next":"old"}""")
        val page=JSONObject("""{"players":[{"id":"allowed"}],"blockVersion":4,"next":null}""")
        val merged=DiscoveryContract.merge(old,page,"players")
        assertEquals(listOf("allowed"),merged.rows("players").map{it.getString("id")})
        assertNull(merged.nullableString("next"))
        val unchanged=JSONObject("""{"players":[{"id":"allowed"},{"id":"other"}],"blockVersion":4,"next":"next_handle"}""")
        assertEquals(listOf("allowed","other"),DiscoveryContract.merge(page,unchanged,"players").rows("players").map{it.getString("id")})
    }
    @Test fun earlierMessagePagesKeepChronologicalOrder() {
        val current=JSONObject("""{"messages":[{"id":10},{"id":11}],"next":10}""")
        val earlier=JSONObject("""{"messages":[{"id":8},{"id":9}],"next":8}""")
        assertEquals(listOf(8L,9L,10L,11L),DiscoveryContract.merge(current,earlier,"messages").rows("messages").map{it.getLong("id")})
    }
    @Test fun memberDetailFetchesProtectedChatAndOutsiderDoesNot()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        try {
            val api=CommunityApi(server.url("/").toString(),allowLoopbackForTests=true)
            val client=FeatureClient(api,{"csrf"},{"viewer"},{1L},{},{})
            val repo=DiscoveryRepository(client)
            server.enqueue(MockResponse().setBody("""{"viewerId":"viewer","group":{"id":4,"membership":"pending"},"members":[]}"""))
            assertFalse(repo.detail("discovery/group/4").has("chat"))
            assertEquals("/api/lfg/4",server.takeRequest().path)
            server.enqueue(MockResponse().setBody("""{"viewerId":"viewer","event":{"id":5,"myRole":"mid"},"members":[]}"""))
            server.enqueue(MockResponse().setBody("""{"viewerId":"viewer","messages":[],"canSend":false,"next":null}"""))
            assertFalse(repo.detail("discovery/event/5").getJSONObject("chat").getBoolean("canSend"))
            assertEquals("/api/events/5",server.takeRequest().path)
            assertEquals("/api/events/5/messages",server.takeRequest().path)
        }finally{server.shutdown()}
    }
    @Test fun serverFiltersUnicodeCursorAndMutationIdReachExactWire()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        try {
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"token"},{"viewer"},{1L},{},{})
            server.enqueue(MockResponse().setBody("""{"players":[],"next":null}"""))
            DiscoveryRepository(client).page("api/players",mapOf("q" to "Имя & лес","rank" to "Мастер","after" to "last_handle"))
            val search=server.takeRequest();assertEquals("Имя & лес",search.requestUrl!!.queryParameter("q"));assertEquals("last_handle",search.requestUrl!!.queryParameter("after"))
            assertNull(search.getHeader("X-CSRF-Token"))
            val body=DiscoverySubmission().body(JSONObject().put("body","Привет"))
            server.enqueue(MockResponse().setBody("""{"message":{"id":7},"replayed":false}"""))
            client.post("api/lfg/4/messages",body)
            val sent=server.takeRequest();assertEquals("/api/lfg/4/messages",sent.path);assertEquals("token",sent.getHeader("X-CSRF-Token"))
            assertEquals(body.getString("clientId"),JSONObject(sent.body.readUtf8()).getString("clientId"))
        }finally{server.shutdown()}
    }
    @Test fun deniedChatIsNeverShownAsEmptySuccess()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        try {
            var denied=false
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"token"},{"viewer"},{1L},{},{denied=true})
            server.enqueue(MockResponse().setBody("""{"event":{"id":5,"myRole":"mid"},"members":[]}"""))
            server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"Чат недоступен"}"""))
            try{DiscoveryRepository(client).detail("discovery/event/5");fail("Forbidden chat accepted")}catch(e:ApiException){assertEquals(403,e.status)}
            assertTrue(denied)
        }finally{server.shutdown()}
    }
}
