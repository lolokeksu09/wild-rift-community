package ru.wrcommunity.android

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*

class ContentContractTest {
    @Test fun paginationUsesServerCursorAndDeduplicatesIncludingReplies() {
        val old=JSONObject("""{"comments":[{"id":8},{"id":9}],"next":8,"canModerate":true}""")
        val next=JSONObject("""{"comments":[{"id":6},{"id":8}],"next":null}""")
        val merged=ContentRepository.mergePage(old,next,"comments",prepend=true)
        assertEquals(listOf(6,8,9),merged.rows("comments").map{it.getInt("id")})
        assertTrue(merged.getBoolean("canModerate"));assertNull(ContentRepository.next(merged))
        assertEquals("opaque_+/=",ContentRepository.next(JSONObject("""{"next":"opaque_+/="}""")))
    }
    @Test fun editingNeverSendsImageAndGuidesUseVersionAndStructuredFields() {
        val post=ContentRepository.editBody("Название","Текст",3,"stable-client-id")
        assertFalse(post.has("imageId"));assertEquals(3,post.getInt("version"))
        val guide=ContentRepository.guideBody("Макро","Текст","macro","","7.0","Кратко","stable-client-id",4)
        assertEquals("7.0",guide.getString("gameVersion"));assertEquals(4,guide.getInt("version"));assertFalse(guide.has("imageId"))
        assertTrue(ContentRepository.postBody("Название","Текст",null,"stable-client-id").isNull("imageId"))
    }
    @Test fun closedClubDoesNotRequestPrivatePostsOrPins()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        try {
            server.enqueue(MockResponse().setBody("""{"club":{"id":"club-1","access":"request","membership":"pending"},"transfer":null}"""))
            val client=client(server)
            val data=ContentRepository(client).screen("content/club/club-1")
            assertFalse(data.has("postsPage"));assertFalse(data.has("pinsPage"))
            assertEquals(1,server.requestCount);assertEquals("/api/clubs/club-1/detail",server.takeRequest().path)
        }finally{server.shutdown()}
    }
    @Test fun signedMutationUsesCsrfAndDoesNotRepeatDeniedRequest()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        try {
            server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"Нет полномочий"}"""))
            val client=client(server)
            try{client.call("api/clubs/club-1/moderators","PUT",JSONObject().put("userId","player-1"));fail("Must reject")}
            catch(e:ApiException){assertEquals(403,e.status)}
            val request=server.takeRequest();assertEquals("PUT",request.method);assertEquals("csrf",request.getHeader("X-CSRF-Token"))
            assertEquals("player-1",JSONObject(request.body.readUtf8()).getString("userId"));assertEquals(1,server.requestCount)
        }finally{server.shutdown()}
    }
    @Test fun attemptIdsRetainSamePayloadButChangeForChangedPayloadOrReset() {
        val server=MockWebServer()
        server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        try {
            val model=ru.wrcommunity.android.features.ContentViewModel(client(server))
            val first=model.attempt("comment:1","same")
            assertEquals(first,model.attempt("comment:1","same"))
            assertNotEquals(first,model.attempt("comment:1","different"))
            model.reset()
            assertNotEquals(first,model.attempt("comment:1","same"))
        }finally{server.shutdown()}
    }
    private fun client(server:MockWebServer)=FeatureClient(CommunityApi(server.url("/").newBuilder().host("127.0.0.1").build().toString(),allowLoopbackForTests=true),{"csrf"},{"viewer"},{1L},{},{})
}
