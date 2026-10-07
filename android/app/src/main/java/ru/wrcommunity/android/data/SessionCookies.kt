package ru.wrcommunity.android.data

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

interface SessionStore { fun read(): String?; fun write(value: String? ) }

/** Each request captures an epoch: old responses cannot restore a logged-out cookie. */
class SessionCookies(private val origin: HttpUrl, private val store: SessionStore) {
    private var cookie: Cookie? = null
    private var initialized = false
    private val mutableEpoch = MutableStateFlow(0L)
    val epoch = mutableEpoch.asStateFlow()
    @Synchronized fun initialize() {
        if (initialized) return
        initialized = true
        cookie = store.read()?.let { Cookie.parse(origin,it) }?.takeIf(::accepted)
        if(cookie==null) store.write(null)
    }
    private fun sameOrigin(url: HttpUrl) = url.scheme==origin.scheme && url.host==origin.host && url.port==origin.port
    private fun accepted(value: Cookie) = value.name=="wr_session" && value.secure && value.httpOnly &&
        value.hostOnly && value.domain==origin.host && value.path=="/" && value.expiresAt>System.currentTimeMillis() &&
        Regex("[a-f0-9]{64}").matches(value.value)
    @Synchronized fun clear() {
        cookie=null; mutableEpoch.value++; store.write(null)
    }
    @Synchronized fun hasCookie(): Boolean = cookie?.let(::accepted)==true
    @Synchronized fun client(base: OkHttpClient): OkHttpClient {
        val captured=mutableEpoch.value
        return base.newBuilder().cookieJar(object: CookieJar {
            override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(this@SessionCookies) {
                if(captured!=mutableEpoch.value || !sameOrigin(url)) emptyList()
                else cookie?.takeIf(::accepted)?.let{listOf(it)} ?: emptyList()
            }
            override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = synchronized(this@SessionCookies) {
                if(captured!=mutableEpoch.value || !sameOrigin(url)) return@synchronized
                cookies.lastOrNull{it.name=="wr_session"}?.let {
                    cookie=it.takeIf(::accepted)
                    try{store.write(cookie?.toString())}catch(error:Exception){
                        cookie=null;mutableEpoch.value++
                        throw java.io.IOException("Unable to store session",error)
                    }
                }
                Unit
            }
        }).build()
    }
}
