package ru.wrcommunity.android

import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*

class AccountStorageTest {
    @Test fun keystoreCookieSurvivesNewRepositoryAndPlaintextIsNotStored() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val storage=EncryptedSessionStore(context)
        val origin="https://example.com/".toHttpUrl()
        val token="b".repeat(64)
        try {
            storage.write(null)
            val original=SessionCookies(origin,storage).apply{initialize()}
            original.client(CommunityApi.defaultClient()).cookieJar.saveFromResponse(origin,
                listOf(Cookie.parse(origin,"wr_session=$token; Path=/; Secure; HttpOnly; Max-Age=3600")!!))
            val sealed=context.getSharedPreferences("account_session",0).getString("sealed",null)!!
            assertFalse(sealed.contains(token));assertFalse(sealed.contains("wr_session"))
            val restored=SessionCookies(origin,EncryptedSessionStore(context)).apply{initialize()}
            assertTrue(restored.hasCookie())
            restored.clear();assertNull(storage.read())
            context.getSharedPreferences("account_session",0).edit().putString("sealed","corrupted:fixture").commit()
            assertNull(storage.read())
        }finally{storage.write(null)}
    }
}
