package ru.wrcommunity.android

import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.*
import okhttp3.tls.*
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*
import java.util.concurrent.TimeUnit

class MemorySession:SessionStore {
    var value:String?=null
    override fun read()=value
    override fun write(value:String?){this.value=value}
}
class AccountContractTest {
    private val token="a".repeat(64)
    private fun response(user:Boolean=true)="""{"user":${if(user)"""{"id":"account-a","handle":"tester","name":"Имя","bio":"","profileVisible":false,"gameProfile":{},"avatarId":null}""" else "null"},"csrf":${if(user)"\"csrf-fixture\"" else "null"}}"""
    @Test fun sanctionIsOptionalAndPreservesServerDeadline(){
        assertNull(identity(org.json.JSONObject(response())).sanction)
        assertNull(identity(org.json.JSONObject(response()).put("sanction",org.json.JSONObject.NULL)).sanction)
        val json=org.json.JSONObject(response()).put("sanction",org.json.JSONObject().put("level","restricted").put("violations",2).put("until",1770000000123L))
        assertEquals(Sanction("restricted",2,1770000000123L),identity(json).sanction)
        json.put("sanction",org.json.JSONObject().put("level","warning").put("violations",1).put("until",org.json.JSONObject.NULL))
        assertEquals(Sanction("warning",1,null),identity(json).sanction)
    }
    @Test fun loginProfileRestoreLogoutUseExactHeadersAndEncryptedStoreBoundary()=runBlocking {
        val certificate=HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls=HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls=HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        val server=MockWebServer().apply{useHttps(serverTls.sslSocketFactory(),false);start()}
        try {
            val origin=server.url("/").newBuilder().host("localhost").build();val store=MemorySession();val cookies=SessionCookies(origin,store)
            val client=CommunityApi.defaultClient().newBuilder().sslSocketFactory(clientTls.sslSocketFactory(),clientTls.trustManager).build()
            val api=CommunityApi(origin.toString(),client,sessions=cookies);val repo=AccountRepository(api,cookies)
            server.enqueue(MockResponse().setBody(response()).addHeader("Set-Cookie","wr_session=$token; Path=/; HttpOnly; Secure; Max-Age=3600"))
            assertEquals("account-a",repo.signIn("tester","test-password-123",null).user!!.id)
            val login=server.takeRequest(2,TimeUnit.SECONDS)!!
            assertEquals("/api/login",login.path);assertEquals(origin.toString().removeSuffix("/"),login.getHeader("Origin"))
            assertEquals("1",login.getHeader("X-Community-Request"));assertNull(login.getHeader("Cookie"))
            assertFalse(store.value!!.contains("test-password"));assertFalse(store.value!!.contains("csrf-fixture"))
            val restored=SessionCookies(origin,store).apply{initialize()}
            assertTrue(restored.hasCookie())
            server.enqueue(MockResponse().setBody(response()))
            assertEquals("account-a",repo.restore().user!!.id)
            assertEquals("wr_session=$token",server.takeRequest().getHeader("Cookie"))
            server.enqueue(MockResponse().setBody("""{"user":{"id":"account-a","handle":"tester","name":"Новое имя","bio":"Текст","gameProfile":{},"profileVisible":true}}"""))
            repo.update("Новое имя","Текст",true,emptyMap(),"csrf-fixture")
            val patch=server.takeRequest();assertEquals("PATCH",patch.method);assertEquals("csrf-fixture",patch.getHeader("X-CSRF-Token"))
            server.enqueue(MockResponse().setBody("{\"ok\":true}").addHeader("Set-Cookie","wr_session=; Path=/; HttpOnly; Secure; Max-Age=0"))
            repo.logout("csrf-fixture",false)
            assertEquals("/api/logout",server.takeRequest().path);assertNull(store.value);assertFalse(cookies.hasCookie())
        }finally{server.shutdown()}
    }
    @Test fun foreignOriginPortCleartextAndLateResponsesCannotReceiveOrRestoreCookie() {
        val origin="https://example.com/".toHttpUrl();val store=MemorySession();val cookies=SessionCookies(origin,store)
        val old=cookies.client(CommunityApi.defaultClient()).cookieJar
        val parsed=Cookie.parse(origin,"wr_session=$token; Path=/; HttpOnly; Secure; Max-Age=3600")!!
        old.saveFromResponse(origin,listOf(parsed));assertTrue(cookies.hasCookie())
        assertTrue(old.loadForRequest("https://example.com:444/api/me".toHttpUrl()).isEmpty())
        assertTrue(old.loadForRequest("http://example.com/api/me".toHttpUrl()).isEmpty())
        assertTrue(old.loadForRequest("https://other.example.com/api/me".toHttpUrl()).isEmpty())
        cookies.clear();old.saveFromResponse(origin,listOf(parsed))
        assertNull(store.value);assertFalse(cookies.hasCookie());assertTrue(old.loadForRequest(origin).isEmpty())
        cookies.client(CommunityApi.defaultClient()).cookieJar.saveFromResponse(origin,listOf(Cookie.parse(origin,"wr_session=$token; Domain=example.com; Path=/; HttpOnly; Secure; Max-Age=3600")!!))
        assertFalse(cookies.hasCookie())
    }
    @Test fun invalidOrExpiredStoredCookieIsDiscarded() {
        val origin="https://example.com/".toHttpUrl()
        for(raw in listOf("wr_session=$token; Path=/; HttpOnly; Max-Age=3600","wr_session=bad; Path=/; HttpOnly; Secure; Max-Age=3600",
            "wr_session=$token; Path=/; HttpOnly; Secure; Max-Age=0")){
            val store=MemorySession().apply{value=raw};val cookies=SessionCookies(origin,store);cookies.initialize()
            assertFalse(cookies.hasCookie());assertNull(store.value)
        }
    }
    @Test fun storageFailureDoesNotLeaveAuthenticatedCookieInMemory() {
        val origin="https://example.com/".toHttpUrl()
        val cookies=SessionCookies(origin,object:SessionStore{
            override fun read():String?=null
            override fun write(value:String?){throw IllegalStateException("storage unavailable")}
        })
        val jar=cookies.client(CommunityApi.defaultClient()).cookieJar
        try{jar.saveFromResponse(origin,listOf(Cookie.parse(origin,"wr_session=$token; Path=/; HttpOnly; Secure; Max-Age=3600")!!));fail()}
        catch(_:java.io.IOException){}
        assertFalse(cookies.hasCookie());assertTrue(jar.loadForRequest(origin).isEmpty())
    }
}
