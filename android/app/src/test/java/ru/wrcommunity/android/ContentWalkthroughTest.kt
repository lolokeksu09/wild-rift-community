package ru.wrcommunity.android

import java.net.InetAddress
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*

/** Walks actual server routes and account/access boundaries without production requests. */
class ContentWalkthroughTest {
    @Test fun initialSearchWaitsForUserInputAndDoesNotSendAnInventedQuery()=runBlocking {
        withServer { server ->
            val repo=ContentRepository(client(server))
            for(filters in listOf(emptyMap(),mapOf("q" to "  ","club" to "club-1"))){
                val data=repo.screen("content/search",filters)
                assertTrue(data.getBoolean("searchPending"))
                assertTrue(data.rows("posts").isEmpty())
                assertNull(ContentRepository.next(data))
            }
            assertEquals(0,server.requestCount)
        }
    }

    @Test fun filtersAndOpaqueCatalogCursorReachTheirExistingEndpoints()=runBlocking {
        withServer { server ->
            server.enqueue(json("""{"clubs":[{"id":"c1"}],"next":"opaque_+/="}"""))
            server.enqueue(json("""{"clubs":[{"id":"c2"}],"next":null}"""))
            val data=ContentRepository(client(server)).screen("content/clubs",mapOf("scope" to "mine","tag" to "ранкед","sort" to "discussion"),listOf(ContentPagePlan("api/clubs","clubs",cursorKey="after",pages=2)))
            assertEquals(listOf("c1","c2"),data.rows("clubs").map{it.getString("id")})
            val first=server.takeRequest().requestUrl!!
            assertEquals("/api/clubs",first.encodedPath)
            assertEquals("mine",first.queryParameter("scope"))
            assertEquals("ранкед",first.queryParameter("tag"))
            val second=server.takeRequest().requestUrl!!
            assertEquals("opaque_+/=",second.queryParameter("after"))
            assertEquals("discussion",second.queryParameter("sort"))
        }
    }

    @Test fun searchAndGuideClubFiltersAreServerParameters()=runBlocking {
        withServer { server ->
            val repo=ContentRepository(client(server))
            server.enqueue(json("""{"posts":[],"next":null}"""))
            repo.screen("content/search/club-1",mapOf("q" to "макро","club" to "club-1"))
            val search=server.takeRequest().requestUrl!!
            assertEquals("/api/posts/search",search.encodedPath)
            assertEquals("макро",search.queryParameter("q"))
            assertEquals("club-1",search.queryParameter("club"))
            server.enqueue(json("""{"posts":[],"next":null}"""))
            repo.screen("content/guides/club-2",mapOf("club" to "club-2","topic" to "macro","gameVersion" to "7.0"))
            val guides=server.takeRequest().requestUrl!!
            assertEquals("/api/guides",guides.encodedPath)
            assertEquals("club-2",guides.queryParameter("club"))
            assertEquals("7.0",guides.queryParameter("gameVersion"))
        }
    }

    @Test fun freshBanPreventsRestoringPreviouslyVisitedPrivatePages()=runBlocking {
        withServer { server ->
            server.enqueue(json("""{"club":{"id":"club-1","access":"open","membership":"banned"},"transfer":null}"""))
            val plans=listOf(ContentPagePlan("api/clubs/club-1/posts","posts","postsPage",pages=3))
            val data=ContentRepository(client(server)).screen("content/club/club-1",plans=plans)
            assertFalse(data.has("postsPage"))
            assertFalse(data.has("pinsPage"))
            assertEquals(1,server.requestCount)
        }
    }

    @Test fun revocationDuringPostLoadStopsBeforeCommentsAndPins()=runBlocking {
        withServer { server ->
            server.enqueue(json("""{"post":{"id":1,"club_id":"club-1","body":"private"}}"""))
            server.enqueue(json("""{"error":"Нет доступа"}""").setResponseCode(403))
            try{ContentRepository(client(server)).screen("content/post/1");fail("Must not return a partial private screen")}
            catch(e:ApiException){assertEquals(403,e.status)}
            assertEquals(2,server.requestCount)
            assertEquals("/api/posts/1",server.takeRequest().path)
            assertEquals("/api/clubs/club-1/detail",server.takeRequest().path)
        }
    }

    @Test fun latestCommentPageRevokesStaleModerationControls() {
        val first=JSONObject("""{"clubId":"club-1","canModerate":true,"comments":[{"id":5}],"next":5}""")
        val older=JSONObject("""{"clubId":"club-1","canModerate":false,"comments":[{"id":4}],"next":null}""")
        val merged=ContentRepository.mergePage(first,older,"comments",prepend=true)
        assertFalse(merged.getBoolean("canModerate"))
        assertEquals(listOf(4,5),merged.rows("comments").map{it.getInt("id")})
        assertNull(ContentRepository.next(merged))
    }

    @Test fun accountChangeRejectsRestoringOldScreenBeforeAnyRequest()=runBlocking {
        withServer { server ->
            val identity=2L
            val repo=ContentRepository(client(server){identity})
            val old=JSONObject("""{"posts":[{"id":2,"body":"old account"}],"next":2}""")
            try{repo.restorePages(old,listOf(ContentPagePlan("api/saved","posts",pages=2)),identity=1L);fail("Old account screen must be discarded")}
            catch(_:CancellationException){}
            assertEquals(0,server.requestCount)
        }
    }

    private fun json(body:String)=MockResponse().setBody(body)
    private fun client(server:MockWebServer,boundary:()->Long={1L})=FeatureClient(
        CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"csrf"},{"viewer"},boundary,{},{})
    private suspend fun withServer(action:suspend (MockWebServer)->Unit){
        val server=MockWebServer()
        server.start(InetAddress.getByName("127.0.0.1"),0)
        try{action(server)}finally{server.shutdown()}
    }
}
