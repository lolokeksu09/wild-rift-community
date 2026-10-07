package ru.wrcommunity.android

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*

class ModerationContractTest {

    @Test fun ownPagesRejectAnotherViewerBeforeDetailLookup()=runBlocking {
        val server=MockWebServer().apply { start() }
        try {
            val client=FeatureClient(CommunityApi(server.url("/").toString(),allowLoopbackForTests=true),{"csrf"},{"self"},{1L},{},{})
            server.enqueue(MockResponse().setBody("""{"viewerId":"other","reports":[{"id":17,"reason":"Private report"}],"next":null}"""))
            try { ModerationRepository(client).own("20"); fail("Another viewer's reports accepted") }
            catch(e: ApiException) { assertEquals(403,e.status) }
            assertEquals("/api/reports?before=20",server.takeRequest().path)
        } finally { server.shutdown() }
    }
    @Test fun reportTargetTypesMatchEveryServerKind() {
        ModerationRepository.kinds.keys.forEach { kind ->
            val textual=kind in listOf("profile","club_page")
            val body=ModerationRepository.reportBody(kind,if(textual) "uuid-account-or-club" else "17"," Причина ")
            assertEquals("Причина",body.getString("reason"))
            if(textual) assertTrue(body.get("targetId") is String) else assertEquals(17L,body.getLong("targetId"))
        }
        listOf("0","-1","1.2","9007199254740992","not-id").forEach { target ->
            try { ModerationRepository.reportBody("post",target,"Причина"); fail("Invalid target $target accepted") } catch(_: IllegalArgumentException) { }
        }
    }
    @Test fun pendingAppealPreventsRemovalAndIndependentReviewExcludesFirstModerator() {
        val r=JSONObject().put("kind","club_page").put("status","upheld").put("reporter_id","reporter").put("sender_id","author").put("moderator_id","first")
        assertEquals("remove-club",ModerationRepository.actionAvailable(r,"second"))
        assertFalse(ModerationRepository.independent(r,"first",true))
        assertTrue(ModerationRepository.independent(r,"second",true))
        assertNull(ModerationRepository.actionAvailable(r,"author"))
        r.put("appeal_status","pending"); assertNull(ModerationRepository.actionAvailable(r,"second"))
        r.put("appeal_status","dismissed"); assertNull(ModerationRepository.actionAvailable(r,"second"))
        r.put("appeal_status","upheld").put("applied_action","remove-club"); assertNull(ModerationRepository.actionAvailable(r,"second"))
        assertFalse(ModerationRepository.independent(JSONObject(),"moderator"))
    }
    @Test fun directMessagesHaveNoRemovalOrInventedConversationRoute() {
        val r=JSONObject().put("kind","direct").put("target_id","12").put("status","upheld").put("reporter_id","a").put("sender_id","b")
        assertNull(ModerationRepository.actionAvailable(r,"c")); assertNull(ModerationRepository.contentRoute(r))
        assertEquals("remove-chat-message",ModerationRepository.actions["club"])
        assertEquals("close-group",ModerationRepository.actions["lfg"])
        assertEquals("cancel-event",ModerationRepository.actions["event"])
    }
    @Test fun profileEvidenceIsReadableTextWithoutJsonDumpOrHiddenNestedData() {
        val snapshot=JSONObject().put("name","<b>Игрок</b>").put("bio","Описание").put("gameProfile",JSONObject().put("roles",org.json.JSONArray(listOf("support","mid"))).put("unknown",JSONObject().put("secret","value")))
        val text=ModerationRepository.snapshot(JSONObject().put("kind","profile").put("snapshot",snapshot.toString()))
        assertTrue(text.contains("Имя: <b>Игрок</b>")); assertTrue(text.contains("Поддержка, Центр")); assertFalse(text.contains("secret")); assertFalse(text.contains("{"))
        assertEquals("Снимок профиля недоступен для чтения.",ModerationRepository.snapshot(JSONObject().put("kind","profile").put("snapshot","{bad")))
    }
    @Test fun validationAndDestructiveImpactAreSpecific() {
        assertFalse(ModerationRepository.reasonValid("  a  ")); assertTrue(ModerationRepository.reasonValid("abc")); assertFalse(ModerationRepository.reasonValid("a".repeat(1001)))
        assertTrue(ModerationRepository.impact("remove-club").contains("без уведомления")); assertTrue(ModerationRepository.impact("remove-comment").contains("Ответы сохранятся"))
    }
    @Test fun repositoryRequestsExactPagesSummaryAndIdentityWithoutMutation()=runBlocking {
        val certificate=HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls=HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls=HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        val server=MockWebServer().apply { useHttps(serverTls.sslSocketFactory(),false); start() }
        try {
            val origin=server.url("/").newBuilder().host("localhost").build()
            val api=CommunityApi(origin.toString(),CommunityApi.defaultClient().newBuilder().sslSocketFactory(clientTls.sslSocketFactory(),clientTls.trustManager).build())
            val client=FeatureClient(api,{"csrf"},{"viewer"},{0L},{},{})
            val repository=ModerationRepository(client)
            listOf("/api/reports?before=100","/api/moderation/reports?before=50","/api/reports/summary","/api/me").forEachIndexed { index,path ->
                server.enqueue(MockResponse().setBody(if(index==0) """{"viewerId":"viewer"}""" else "{}"))
                when(index) { 0 -> repository.own("100"); 1 -> repository.queue("50"); 2 -> repository.summary(); else -> repository.identity() }
                val request=server.takeRequest(); assertEquals(path,request.path); assertEquals("GET",request.method); assertNull(request.getHeader("X-CSRF-Token"))
            }
        } finally { server.shutdown() }
    }
}
