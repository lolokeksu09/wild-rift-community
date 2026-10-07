package ru.wrcommunity.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.DiscoveryViewModel

/** Wire-level regressions discovered by following the website's saved and discovery flows. */
@OptIn(ExperimentalCoroutinesApi::class)
class DiscoveryWalkthroughTest {
    private suspend fun waitUntil(done:()->Boolean) = withTimeout(5000) {
        while(!done())delay(10)
    }
    private fun client(server:MockWebServer,user:()->String?={"viewer"},boundary:()->Long={1L}) =
        FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"csrf"},user,boundary,{},{})
    private fun response(json:String)=MockResponse().setBody(json)

    @Test fun compactHomeCardsUseServerClockAndCapacityForState()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){
            override fun dispatch(request:okhttp3.mockwebserver.RecordedRequest):MockResponse =
                if(request.requestUrl!!.encodedPath=="/api/home")response("""{"viewerId":"viewer","generatedAt":100,
                    "events":[{"id":1,"starts_at":50,"members":2,"capacity":2},{"id":2,"starts_at":200,"members":2,"capacity":2},{"id":3,"starts_at":200,"members":1,"capacity":2}],
                    "myGroups":[{"id":4,"members":2,"capacity":2,"membership":"accepted"}],"groups":[{"id":5,"members":1,"capacity":2}]}""")
                else response("""{"viewerId":"viewer","posts":[],"clubs":[],"members":[]}""")
        }
        try {
            val home=DiscoveryRepository(client(server)).home()
            assertEquals(listOf("started","full","open"),home.rows("events").map{it.getString("state")})
            assertEquals("full",home.rows("myGroups").single().getString("state"))
            assertEquals("accepted",home.rows("myGroups").single().getString("membership"))
            assertEquals("open",home.rows("groups").single().getString("state"))
        }finally{server.shutdown()}
    }

    @Test fun guestAnnouncementListsUsePublicAllowlistWithoutProtectedRequests()=runBlocking {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        val model=DiscoveryViewModel(client(server,{null}))
        try {
            for(route in listOf("discovery/lfg","discovery/events")) {
                server.enqueue(response("""{"groups":[{"id":1,"available":2}],"events":[{"id":2,"available":0}]}"""))
                model.open(route);waitUntil{model.state.value.revision>0 && !model.state.value.busy}
                val request=server.takeRequest()
                assertEquals("/api/community-preview",request.path)
                assertNull(request.getHeader("X-CSRF-Token"))
                assertFalse(model.state.value.data!!.has("members"))
                assertFalse(model.state.value.data!!.has("chat"))
                assertNull(model.state.value.error)
            }
        }finally{model.reset();server.shutdown();Dispatchers.resetMain()}
    }

    @Test fun removingSavedPostUsesDeleteAndRefreshesAccessCheckedList()=runBlocking {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        val model=DiscoveryViewModel(client(server))
        try {
            server.enqueue(response("""{"viewerId":"viewer","posts":[{"id":7}],"next":null}"""))
            model.open("discovery/saved");waitUntil{model.state.value.revision>0}
            assertEquals("/api/saved",server.takeRequest().path)
            server.enqueue(response("""{"ok":true}"""))
            server.enqueue(response("""{"viewerId":"viewer","posts":[],"next":null}"""))
            val revision=model.state.value.revision
            model.unsave("7");waitUntil{model.state.value.revision>revision}
            val removal=server.takeRequest()
            assertEquals("DELETE",removal.method);assertEquals("/api/posts/7/saved",removal.path)
            assertEquals("csrf",removal.getHeader("X-CSRF-Token"))
            assertEquals("/api/saved",server.takeRequest().path)
            assertTrue(model.state.value.data!!.rows("posts").isEmpty())
        }finally{model.reset();server.shutdown();Dispatchers.resetMain()}
    }

    @Test fun newBlockVersionRestartsPlayerDirectoryWithoutSkippingEarlierProfiles()=runBlocking {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        val model=DiscoveryViewModel(client(server))
        try {
            server.enqueue(response("""{"viewerId":"viewer","blockVersion":1,"players":[{"id":"hidden"}],"next":"middle"}"""))
            model.open("discovery/players",mapOf("region" to "eu"));waitUntil{model.state.value.revision>0}
            server.takeRequest()
            server.enqueue(response("""{"viewerId":"viewer","blockVersion":2,"players":[{"id":"later"}],"next":null}"""))
            server.enqueue(response("""{"viewerId":"viewer","blockVersion":2,"players":[{"id":"early"}],"next":"middle"}"""))
            val revision=model.state.value.revision
            model.more("players","middle",cursorName="after");waitUntil{model.state.value.revision>revision}
            val continuation=server.takeRequest();val restart=server.takeRequest()
            assertEquals("middle",continuation.requestUrl!!.queryParameter("after"))
            assertNull(restart.requestUrl!!.queryParameter("after"))
            assertEquals("eu",restart.requestUrl!!.queryParameter("region"))
            assertEquals(listOf("early"),model.state.value.data!!.rows("players").map{it.getString("id")})
            assertEquals("middle",model.state.value.data!!.getString("next"))
        }finally{model.reset();server.shutdown();Dispatchers.resetMain()}
    }

    @Test fun successfulCreationKeepsOtherRouteDraftAndUsesStableClientId()=runBlocking {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        val model=DiscoveryViewModel(client(server))
        try {
            server.enqueue(response("""{"viewerId":"viewer","groups":[],"next":null}"""))
            model.open("discovery/lfg");waitUntil{model.state.value.revision>0};server.takeRequest()
            model.setDraft("create.discovery/lfg.title","Группа")
            model.setDraft("editor.discovery/lfg","1")
            model.setDraft("create.discovery/events.title","Вечер")
            model.setDraft("editor.discovery/events","1")
            val body=JSONObject().put("title","Группа")
            server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"Временно недоступно"}"""))
            model.create(body){};waitUntil{!model.state.value.busy}
            val first=JSONObject(server.takeRequest().body.readUtf8())
            assertEquals("Группа",model.drafts.value["create.discovery/lfg.title"])
            server.enqueue(response("""{"id":8,"replayed":true}"""))
            var created:String?=null
            model.create(body){created=it};waitUntil{created!=null}
            val second=server.takeRequest()
            assertEquals("/api/lfg",second.path)
            assertEquals(first.getString("clientId"),JSONObject(second.body.readUtf8()).getString("clientId"))
            assertEquals("discovery/group/8",created)
            assertFalse(model.drafts.value.containsKey("create.discovery/lfg.title"))
            assertFalse(model.drafts.value.containsKey("editor.discovery/lfg"))
            assertEquals("Вечер",model.drafts.value["create.discovery/events.title"])
            assertEquals("1",model.drafts.value["editor.discovery/events"])
        }finally{model.reset();server.shutdown();Dispatchers.resetMain()}
    }

    @Test fun accountBoundaryClearsRememberedFiltersBeforeReopeningSameRoute()=runBlocking {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        var identity=1L;var viewer="viewer"
        val model=DiscoveryViewModel(client(server,{viewer},{identity}))
        try {
            server.enqueue(response("""{"viewerId":"viewer","players":[],"next":null}"""))
            model.open("discovery/players",mapOf("q" to "Private query"));waitUntil{model.state.value.revision>0}
            server.takeRequest();model.setDraft("filter.discovery/players.q","Private query")
            viewer="another";identity++
            server.enqueue(response("""{"viewerId":"another","players":[],"next":null}"""))
            model.open("discovery/players");waitUntil{model.state.value.revision>0}
            assertNull(server.takeRequest().requestUrl!!.queryParameter("q"))
            assertTrue(model.filters.isEmpty());assertTrue(model.drafts.value.isEmpty())
        }finally{model.reset();server.shutdown();Dispatchers.resetMain()}
    }
}
