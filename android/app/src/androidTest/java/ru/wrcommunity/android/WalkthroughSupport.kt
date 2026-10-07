package ru.wrcommunity.android

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import ru.wrcommunity.android.data.*
import java.security.KeyStore
import java.security.cert.CertificateFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/** Generated fixture assets exist only in the test APK; no production users are involved. */
object WalkthroughSupport {
    val fixture:JSONObject by lazy {
        JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("walkthrough.json").bufferedReader().use{it.readText()})
    }
    private fun api(cookies:SessionCookies):CommunityApi {
        val context=InstrumentationRegistry.getInstrumentation().context
        val certificate=context.assets.open("contract-ca.pem").use{CertificateFactory.getInstance("X.509").generateCertificate(it)}
        val keys=KeyStore.getInstance(KeyStore.getDefaultType()).apply{load(null);setCertificateEntry("isolated-fixture",certificate)}
        val managers=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply{init(keys)}
        val trust=managers.trustManagers.filterIsInstance<X509TrustManager>().single()
        val tls=SSLContext.getInstance("TLS").apply{init(null,arrayOf(trust),null)}
        val client=CommunityApi.defaultClient().newBuilder().sslSocketFactory(tls.socketFactory,trust).build()
        val origin=fixture.getString("origin")
        require(origin=="https://localhost:5032")
        return CommunityApi(origin,client,sessions=cookies)
    }
    class User(val role:String) {
        private val store=object:SessionStore {
            @Volatile private var value:String?=null
            override fun read()=value
            override fun write(value:String?){this.value=value}
        }
        private val cookies=SessionCookies(fixture.getString("origin").toHttpUrl(),store)
        val api=api(cookies)
        val accounts=AccountRepository(api,cookies)
        var identity=Identity(null,null);private set
        var boundary=1L;private set
        val client=FeatureClient(api,{identity.csrf},{identity.user?.id},{boundary},{identity=Identity(null,null);boundary++},{})
        val details get()=fixture.getJSONObject("users").getJSONObject(role)
        suspend fun signIn(){identity=accounts.signIn(details.getString("handle"),fixture.getString("password"),null)}
    }
    fun user(role:String)=User(role).also{runBlocking{it.signIn()}}
    fun <T> await(state:StateFlow<T>,predicate:(T)->Boolean):T {
        val caller=Throwable().stackTrace.firstOrNull{it.className.contains("RoleWalkTest")}
        return try {runBlocking{withTimeout(15000){state.first(predicate)}}}
        catch(error:TimeoutCancellationException){
            throw AssertionError("Expected state not reached at $caller; actual=${state.value}").also{it.initCause(error)}
        }
    }
}
