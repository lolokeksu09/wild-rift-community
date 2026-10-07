package ru.wrcommunity.android

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*

class DiscoveryContractTest {
    @Test fun guestHomeUsesOnlyPublicResourcesAndKeepsRealCounts()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        val paths=java.util.Collections.synchronizedList(mutableListOf<String>())
        var expired=false
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){
            override fun dispatch(request:okhttp3.mockwebserver.RecordedRequest):MockResponse {
                paths.add(request.requestUrl!!.encodedPath)
                val body=when(request.requestUrl!!.encodedPath){
                    "/api/feed"->"""{"posts":[{"id":17,"title":"Новое обсуждение","isBot":true}],"next":null}"""
                    "/api/clubs"->"""{"viewerId":null,"total":6,"clubs":[{"id":"club","name":"Наш клуб","members":9,"bots":8}],"next":null}"""
                    "/api/community-members"->"""{"viewerId":null,"total":24,"bots":24,"members":[{"id":"bot","name":"Бот","isBot":true}],"next":"bot_next"}"""
                    else->return MockResponse().setResponseCode(401).setBody("""{"error":"Сначала войди"}""")
                }
                return MockResponse().setBody(body)
            }
        }
        try {
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{null},{null},{1L},{expired=true},{})
            val home=DiscoveryRepository(client).home()
            assertEquals(setOf("/api/feed","/api/clubs","/api/community-members"),paths.toSet())
            assertEquals(3,paths.size);assertFalse(expired);assertFalse(home.getBoolean("personalLoaded"))
            assertFalse(home.has("myClubs"));assertNull(home.nullableString("viewerId"))
            assertEquals(6,home.getJSONObject("catalog").getInt("total"))
            assertEquals(24,home.getJSONObject("people").getInt("bots"))
            assertEquals(17,home.getJSONObject("feed").rows("posts").single().getInt("id"))
            val requests=List(3){server.takeRequest()}
            assertTrue(requests.all{it.getHeader("X-CSRF-Token")==null})
            val catalog=requests.single{it.requestUrl!!.encodedPath=="/api/clubs"}.requestUrl!!
            assertEquals("open",catalog.queryParameter("scope"));assertEquals("discussion",catalog.queryParameter("sort"))
        }finally{server.shutdown()}
    }
    @Test fun authenticatedHomeIncludesPersonalDataAndPublicPreviews()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        val paths=java.util.Collections.synchronizedList(mutableListOf<String>())
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){
            override fun dispatch(request:okhttp3.mockwebserver.RecordedRequest):MockResponse {
                paths.add(request.requestUrl!!.encodedPath)
                val body=when(request.requestUrl!!.encodedPath){
                    "/api/home"->"""{"viewerId":"viewer","clubCount":7,"myClubs":[{"id":"mine"}],"events":[{"id":2}],"myGroups":[{"id":4}],"groups":[{"id":5}],"preferences":{"region":"EU"}}"""
                    "/api/feed"->"""{"posts":[{"id":10}],"next":null}"""
                    "/api/clubs"->"""{"viewerId":"viewer","total":3,"clubs":[],"next":null}"""
                    "/api/community-members"->"""{"viewerId":"viewer","total":2,"bots":0,"members":[{"id":"peer"}],"next":null}"""
                    else->return MockResponse().setResponseCode(404)
                }
                return MockResponse().setBody(body)
            }
        }
        try {
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"token"},{"viewer"},{1L},{},{})
            val home=DiscoveryRepository(client).home()
            assertEquals(setOf("/api/home","/api/feed","/api/clubs","/api/community-members"),paths.toSet())
            assertEquals(4,paths.size);assertTrue(home.getBoolean("personalLoaded"));assertEquals("viewer",home.getString("viewerId"))
            assertEquals(7,home.getInt("clubCount"));assertEquals("mine",home.rows("myClubs").single().getString("id"))
            assertEquals(2,home.rows("events").single().getInt("id"));assertEquals(4,home.rows("myGroups").single().getInt("id"))
            assertEquals("EU",home.getJSONObject("preferences").getString("region"));assertTrue(home.has("feed"));assertTrue(home.has("people"))
        }finally{server.shutdown()}
    }
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    @Test fun homeViewModelShowsAvailablePublicSectionsWhenFeedFails()=runBlocking {
        kotlinx.coroutines.Dispatchers.setMain(kotlinx.coroutines.test.UnconfinedTestDispatcher())
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        var forbiddenHome=false
        val feedUnavailable=java.util.concurrent.atomic.AtomicBoolean(true)
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){
            override fun dispatch(request:okhttp3.mockwebserver.RecordedRequest):MockResponse=when(request.requestUrl!!.encodedPath){
                "/api/feed"->if(feedUnavailable.get())MockResponse().setResponseCode(503).setBody("""{"error":"Лента временно недоступна"}""")
                    else MockResponse().setBody("""{"posts":[{"id":18}],"next":null}""")
                "/api/clubs"->MockResponse().setBody("""{"viewerId":null,"total":1,"clubs":[{"id":"club"}]}""")
                "/api/community-members"->MockResponse().setBody("""{"viewerId":null,"total":1,"bots":0,"members":[{"id":"peer"}]}""")
                else->{forbiddenHome=true;MockResponse().setResponseCode(401)}
            }
        }
        val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{null},{null},{1L},{},{})
        val model=ru.wrcommunity.android.features.DiscoveryViewModel(client)
        try {
            model.open("discovery/home")
            kotlinx.coroutines.withTimeout(5000){while(model.state.value.busy)kotlinx.coroutines.delay(10)}
            val state=model.state.value
            assertNull(state.error);assertFalse(forbiddenHome);assertEquals(1L,state.revision)
            val home=state.data!!
            assertFalse(home.has("feed"));assertEquals(1,home.getJSONObject("catalog").getInt("total"))
            assertEquals("peer",home.getJSONObject("people").rows("members").single().getString("id"))
            assertEquals("Лента временно недоступна",home.getJSONObject("homeWarnings").getString("feed"))
            feedUnavailable.set(false);model.refresh()
            kotlinx.coroutines.withTimeout(5000){while(model.state.value.revision<=state.revision)kotlinx.coroutines.delay(10)}
            assertEquals(18,model.state.value.data!!.getJSONObject("feed").rows("posts").single().getInt("id"))
            assertFalse(model.state.value.data!!.getJSONObject("homeWarnings").has("feed"))
        }finally{model.reset();server.shutdown();kotlinx.coroutines.Dispatchers.resetMain()}
    }
    @Test fun homeWithNoAvailableSourcesRemainsAnError()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){
            override fun dispatch(request:okhttp3.mockwebserver.RecordedRequest)=MockResponse().setResponseCode(503).setBody("""{"error":"Сервер временно недоступен"}""")
        }
        try {
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{null},{null},{1L},{},{})
            try{DiscoveryRepository(client).home();fail("Unavailable Home shown as empty success")}
            catch(e:ApiException){assertEquals(503,e.status)}
        }finally{server.shutdown()}
    }
    @Test fun homeAccessFailureInvalidatesAllPreviews()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){
            override fun dispatch(request:okhttp3.mockwebserver.RecordedRequest):MockResponse {
                if(request.requestUrl!!.encodedPath=="/api/community-members")return MockResponse().setBody("""{"viewerId":"another-account","members":[]}""")
                return MockResponse().setBody("""{"viewerId":"viewer","posts":[],"clubs":[]}""")
            }
        }
        try {
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"token"},{"viewer"},{1L},{},{})
            try{DiscoveryRepository(client).home();fail("Foreign preview accepted as partial success")}
            catch(e:ApiException){assertEquals(403,e.status)}
        }finally{server.shutdown()}
    }
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
    @Test fun refreshedChatDrainsEveryAfterPageAndRevalidatesWholeDisplayedHistory()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        val requests=java.util.Collections.synchronizedList(mutableListOf<String>())
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){
            override fun dispatch(request:okhttp3.mockwebserver.RecordedRequest):MockResponse {
                requests.add(request.path.orEmpty())
                val url=request.requestUrl!!
                val after=url.queryParameter("after")?.toLongOrNull()
                val before=url.queryParameter("before")?.toLongOrNull()?:Long.MAX_VALUE
                val accessible=(1L..155L).filter{it!=1L && it!=70L}
                val eligible=accessible.filter{if(after!=null)it>after else it<before}
                val more=eligible.size>50
                val selected=if(after!=null)eligible.take(50)else eligible.takeLast(50)
                val rows=org.json.JSONArray(selected.map{JSONObject().put("id",it).put("body","Свежий текст $it")})
                val data=JSONObject().put("viewerId","viewer").put("messages",rows).put("blockVersion",7)
                    .put("canSend",true).put("hasMore",more)
                    .put("next",if(more)(if(after!=null)selected.last()else selected.first())else JSONObject.NULL)
                return MockResponse().setBody(data.toString())
            }
        }
        try {
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"token"},{"viewer"},{1L},{},{})
            val previous=JSONObject().put("blockVersion",7).put("messages",org.json.JSONArray((1L..55L).map{JSONObject().put("id",it).put("body","Старый текст")}))
            val result=DiscoveryRepository(client).chatHistory("api/events/4/messages",previous)
            val ids=result.rows("messages").map{it.getLong("id")}
            assertEquals((2L..155L).filter{it!=70L},ids)
            assertTrue(requests.contains("/api/events/4/messages?after=55"))
            assertTrue(requests.contains("/api/events/4/messages?after=106"))
            assertTrue(result.rows("messages").all{it.getString("body").startsWith("Свежий")})
            assertNull(result.nullableString("next"))
        }finally{server.shutdown()}
    }
    @Test fun notificationRefreshRetainsOlderPagesByFreshAccessChecks()=runBlocking {
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){
            override fun dispatch(request:okhttp3.mockwebserver.RecordedRequest):MockResponse {
                if(request.requestUrl!!.encodedPath=="/api/notifications/summary")return MockResponse().setBody("""{"viewerId":"viewer","lfg":{"unread":4}}""")
                val before=request.requestUrl!!.queryParameter("before")?.toLongOrNull()?:Long.MAX_VALUE
                val available=(1L..135L).reversed().filter{it<before && it!=1L && it!=15L && it!=90L}
                val selected=available.take(50)
                return MockResponse().setBody(JSONObject().put("viewerId","viewer").put("notifications",org.json.JSONArray(selected.map{JSONObject().put("id",it).put("seen",1)}))
                    .put("next",if(available.size>50)selected.last()else JSONObject.NULL).toString())
            }
        }
        try {
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"token"},{"viewer"},{1L},{},{})
            val old=JSONObject().put("notifications",org.json.JSONArray((1L..90L).reversed().map{JSONObject().put("id",it).put("seen",0)}))
            val result=DiscoveryRepository(client).notificationPage("lfg",previous=old)
            assertEquals((1L..135L).reversed().filter{it!=1L&&it!=15L&&it!=90L},result.rows("notifications").map{it.getLong("id")})
            assertTrue(result.rows("notifications").all{it.getInt("seen")==1})
            assertEquals(4,result.getJSONObject("summary").getJSONObject("lfg").getInt("unread"))
        }finally{server.shutdown()}
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    @Test fun explicitFilterResetClearsQueryAndQuietRefreshKeepsMutationWarning()=runBlocking {
        val dispatcher=kotlinx.coroutines.test.UnconfinedTestDispatcher()
        kotlinx.coroutines.Dispatchers.setMain(dispatcher)
        val server=MockWebServer();server.start(java.net.InetAddress.getByName("127.0.0.1"),0)
        val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"token"},{"viewer"},{1L},{},{})
        val model=ru.wrcommunity.android.features.DiscoveryViewModel(client)
        suspend fun revisionAfter(previous:Long){kotlinx.coroutines.withTimeout(5000){while(model.state.value.revision<=previous)kotlinx.coroutines.delay(10)}}
        fun response()=MockResponse().setBody("""{"viewerId":"viewer","players":[],"next":null}""")
        try {
            server.enqueue(response());model.open("discovery/players",mapOf("q" to "лес"));revisionAfter(0)
            assertEquals("лес",server.takeRequest().requestUrl!!.queryParameter("q"))
            model.formError("Отправка не подтверждена. Проверь историю перед повтором.")
            val revision=model.state.value.revision
            server.enqueue(response());model.refresh(quiet=true);revisionAfter(revision)
            assertEquals("Отправка не подтверждена. Проверь историю перед повтором.",model.state.value.error)
            server.takeRequest()
            server.enqueue(response());model.open("discovery/players",emptyMap());revisionAfter(0)
            assertNull(server.takeRequest().requestUrl!!.queryParameter("q"))
            assertTrue(model.filters.isEmpty())
        }finally{model.reset();server.shutdown();kotlinx.coroutines.Dispatchers.resetMain()}
    }

}
