package ru.wrcommunity.android

import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import ru.wrcommunity.android.data.*
import java.util.concurrent.TimeUnit

class FeatureClientTest {
    @Test fun publicReadsDoNotRequireCsrfAndMutationCannotLeaveOrigin()=runBlocking {
        MockWebServer().use{server->server.start();server.enqueue(MockResponse().setBody("{\"ok\":true}"))
            val api=CommunityApi(server.url("/").toString(),allowLoopbackForTests=true)
            val client=FeatureClient(api,{null},{null},{0},{},{})
            assertTrue(client.get("api/clubs").getBoolean("ok"));assertEquals("/api/clubs",server.takeRequest().path)
            val denied=runCatching{client.post("api/clubs",JSONObject())}.exceptionOrNull()
            assertEquals(401,(denied as ApiException).status);assertEquals(1,server.requestCount)
            assertTrue(runCatching{api.community("api/../me")}.isFailure);assertEquals(1,server.requestCount)
        }
    }
    @Test fun lostOldAccountResponseCannotExpireNewAccount()=runBlocking {
        MockWebServer().use{server->server.start();server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":\"Expired\"}").setBodyDelay(250,TimeUnit.MILLISECONDS))
            var boundary=0L;var expired=0
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"csrf"},{"one"},{boundary},{expired++},{})
            val old=async{runCatching{client.get("api/saved")}.exceptionOrNull()}
            kotlinx.coroutines.delay(75);boundary++
            assertTrue(old.await() is kotlinx.coroutines.CancellationException);assertEquals(0,expired)
        }
    }
    @Test fun publicLinksRespectExactOriginAndKnownRoutes(){
        val origin="https://139.100.205.135"
        assertEquals("content/post/15",NativeLinks.route("$origin/posts/15",origin))
        assertEquals("content/club/club-1",NativeLinks.route("$origin/clubs/club-1",origin))
        assertNull(NativeLinks.route("https://139.100.205.135.attacker.test/posts/15",origin))
        assertNull(NativeLinks.route("$origin:8443/posts/15",origin))
        assertNull(NativeLinks.route("$origin/posts/-1",origin))
        assertNull(NativeLinks.route("$origin/api/me",origin))
    }
}
