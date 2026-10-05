package ru.wrcommunity.android

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*

class GuestContractTest {
    @Test fun cursorTypesAndNullMediaMatchServer() {
        val page=JsonModels.posts("""{"posts":[{"id":25,"club_id":"club-1","title":"Тема","body":"Текст","author_name":"Имя","image_id":null,"created_at":1791049600822,"isBot":true}],"next":25}""")
        assertEquals("25",page.next)
        assertNull(page.items.single().imageId)
        assertTrue(page.items.single().isBot)
        assertNull(JsonModels.posts("""{"posts":[],"next":null}""").next)
        val catalog=JsonModels.catalog("""{"clubs":[{"id":"club-1","name":"Клуб","description":"Описание","access":"open","cover_id":null,"rules":"Правила","tags":["Советы"],"members":13,"bots":12,"isDemoClub":true}],"tags":["Советы"],"total":1,"next":"opaque_+/="}""")
        assertEquals("opaque_+/=",catalog.page.next)
        assertEquals(12,catalog.page.items.single().bots)
        assertTrue(catalog.page.items.single().isDemo)
    }
    @Test fun unicodeQueryAndOpaqueCursorAreEncodedWithoutCredentialHeaders()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        try {
            server.enqueue(MockResponse().setBody("""{"clubs":[],"tags":[],"total":0,"next":null}"""))
            val api=CommunityApi(server.url("/").newBuilder().host("127.0.0.1").build().toString(),allowLoopbackForTests=true)
            api.catalog("роль & лес","Советы","name","opaque_+/=")
            val request=server.takeRequest()
            assertEquals("роль & лес",request.requestUrl!!.queryParameter("q"))
            assertEquals("opaque_+/=",request.requestUrl!!.queryParameter("after"))
            assertEquals("open",request.requestUrl!!.queryParameter("scope"))
            assertNull(request.getHeader("Cookie"));assertNull(request.getHeader("Authorization"))
        } finally {server.shutdown()}
    }
    @Test fun forbiddenNeverBecomesSuccessAndRedirectDoesNotEscapeOrigin()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        try {
            val api=CommunityApi(server.url("/").newBuilder().host("127.0.0.1").build().toString(),allowLoopbackForTests=true)
            server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"Нет доступа"}"""))
            try {api.post(1);fail("403 must fail")}catch(e:ApiException){assertEquals(403,e.status)}
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location","https://example.invalid/private"))
            try {api.post(1);fail("Redirect must fail")}catch(e:ApiException){assertEquals(302,e.status)}
            assertEquals(2,server.requestCount)
        } finally {server.shutdown()}
    }
    @Test fun productionCannotUseCleartextOrPathAsOrigin() {
        for(origin in listOf("http://139.100.205.135","https://example.com/path","https://user:password@example.com")) {
            try {CommunityApi(origin);fail("Unsafe origin accepted")} catch(_:IllegalArgumentException) {}
        }
    }
}
