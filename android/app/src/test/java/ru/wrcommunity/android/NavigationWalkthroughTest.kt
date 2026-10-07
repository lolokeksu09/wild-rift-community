package ru.wrcommunity.android

import java.net.InetAddress
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*

class NavigationWalkthroughTest {
    @Test fun authReturnPreservesSelectedObjectAndCreationIntent() {
        assertEquals(AuthDestination("discovery/event/42"),NativeRoutes.auth("auth/discovery/event/42"))
        assertEquals(AuthDestination("discovery/lfg",true),NativeRoutes.auth("auth/create/discovery/lfg"))
        assertNull(NativeRoutes.auth("auth/https://other.example"))
        assertNull(NativeRoutes.auth("auth/create/content/post/1"))
        assertTrue(NativeRoutes.requiresAccount("discovery/event/42"))
        assertTrue(NativeRoutes.requiresAccount("chat/inbox"))
        assertTrue(NativeRoutes.requiresAccount("discovery/players"))
        assertTrue(NativeRoutes.requiresAccount("content/invite"))
        assertFalse(NativeRoutes.requiresAccount("discovery/events"))
        assertFalse(NativeRoutes.requiresAccount("content/post/42/comment/8"))
        assertEquals("clubs",NativeRoutes.tab("content/post/42/comment/8"))
        assertEquals("clubs",NativeRoutes.tab("chat/club/club-1"))
        assertEquals("home",NativeRoutes.tab("discovery/event/42"))
        assertEquals("chat",NativeRoutes.tab("chat/direct/42"))
    }
    @Test fun commentLinksUseOnlySafePositiveIdentifiers() {
        assertEquals("content/post/42/comment/8",NativeRoutes.post(42,8))
        assertEquals(8L,NativeRoutes.comment(NativeRoutes.post(42,8)))
        assertEquals("content/post/42",NativeRoutes.post(42,0))
        assertNull(NativeRoutes.comment("content/post/42/comment/9007199254740991"))
        assertNull(NativeRoutes.comment("content/post/42/comment/0"))
    }
    @Test fun oldNotificationLoadsItsActualPageAndKeepsPostIdSeparate():Unit=runBlocking {
        val server=MockWebServer();server.start(InetAddress.getByName("127.0.0.1"),0)
        try {
            listOf("""{"post":{"id":42,"club_id":"c1"}}""","""{"club":{"id":"c1"}}""","""{"comments":[{"id":90}],"next":90,"canModerate":true}""","""{"comments":[{"id":8}],"next":null,"canModerate":false}""","""{"pins":[]}""").forEach{server.enqueue(MockResponse().setBody(it))}
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"csrf"},{"owner"},{1L},{},{})
            val page=ContentRepository(client).screen(NativeRoutes.post(42,8))
            assertEquals(8L,page.getJSONObject("commentsPage").rows("comments").single().getLong("id"))
            assertFalse(page.getJSONObject("commentsPage").getBoolean("canModerate"))
            assertEquals("/api/posts/42",server.takeRequest().path)
            assertEquals("/api/clubs/c1/detail",server.takeRequest().path)
            assertEquals("/api/posts/42/comments",server.takeRequest().path)
            assertEquals("/api/posts/42/comments?before=9",server.takeRequest().path)
            assertEquals("/api/clubs/c1/pins",server.takeRequest().path)
        }finally{server.shutdown()}
    }
}
