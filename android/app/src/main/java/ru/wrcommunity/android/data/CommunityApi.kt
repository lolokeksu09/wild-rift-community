package ru.wrcommunity.android.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class ApiException(val status: Int, message: String) : IOException(message)
class CommunityApi(origin: String, private val client: OkHttpClient = defaultClient(),
                   allowLoopbackForTests: Boolean = false, private val sessions: SessionCookies? = null) {
    private val base: HttpUrl = origin.toHttpUrl().also {
        require(it.username.isEmpty() && it.password.isEmpty() && it.encodedPath == "/" && it.query == null && it.fragment == null)
        require(it.scheme == "https" || (allowLoopbackForTests && it.scheme == "http" && it.host in listOf("localhost", "127.0.0.1")))
    }
    companion object {
        fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS)
            .callTimeout(25, TimeUnit.SECONDS).retryOnConnectionFailure(false)
            .followRedirects(false).followSslRedirects(false).build()
    }
    private fun identifier(id: String): String {
        require(Regex("[-a-zA-Z0-9_]{1,80}").matches(id))
        return id
    }
    private suspend fun request(path: String, query: Map<String, String> = emptyMap(),
                                method: String = "GET", payload: JSONObject? = null, csrf: String? = null): ByteArray {
        val url = base.newBuilder().addPathSegments(path).apply { query.forEach { (k,v) -> addQueryParameter(k,v) } }.build()
        val request = Request.Builder().url(url).header("Accept", if(path.startsWith("api/media/")) "image/webp" else "application/json").apply {
            if(method=="GET") get() else {
                header("Origin",base.toString().removeSuffix("/"));header("X-Community-Request","1")
                if(csrf!=null) header("X-CSRF-Token",csrf)
                method(method,(payload ?: JSONObject()).toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            }
        }.build()
        return suspendCancellableCoroutine { continuation ->
            val call = (sessions?.client(client) ?: client).newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { if (!continuation.isCancelled) continuation.resumeWithException(e) }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        response.use {
                            val body = it.body ?: throw IOException("Пустой ответ")
                            val limit = if(path.startsWith("api/media/")) 1024 * 1024 else 2 * 1024 * 1024
                            val bytes = body.byteStream().use { input ->
                                val data = java.io.ByteArrayOutputStream()
                                val buffer = ByteArray(8192)
                                while(true) { val count = input.read(buffer); if(count < 0) break
                                    if(data.size() + count > limit) throw IOException("Ответ слишком большой")
                                    data.write(buffer, 0, count)
                                }
                                data.toByteArray()
                            }
                            if (!it.isSuccessful) {
                                val message = runCatching { JSONObject(bytes.toString(Charsets.UTF_8)).optString("error") }.getOrNull()
                                throw ApiException(it.code, message?.takeIf { text -> text.isNotBlank() } ?: "Запрос не выполнен")
                            }
                            if (!continuation.isCancelled) continuation.resume(bytes)
                        }
                    } catch (error: Exception) { if (!continuation.isCancelled) continuation.resumeWithException(error) }
                }
            })
        }
    }
    suspend fun catalog(q: String, tag: String, sort: String, after: String?) =
        JsonModels.catalog(request("api/clubs", buildMap {
            put("scope", "open"); put("sort", sort); if(q.isNotBlank()) put("q",q); if(tag.isNotBlank()) put("tag",tag)
            if(after != null) put("after",after)
        }).toString(Charsets.UTF_8))
    suspend fun club(id: String) = JsonModels.clubDetail(request("api/clubs/${identifier(id)}/detail").toString(Charsets.UTF_8))
    suspend fun posts(id: String, before: String?) = JsonModels.posts(request("api/clubs/${identifier(id)}/posts",
        before?.let { mapOf("before" to it) } ?: emptyMap()).toString(Charsets.UTF_8))
    suspend fun post(id: Long): Post { require(id > 0); return JsonModels.postDetail(request("api/posts/$id").toString(Charsets.UTF_8)) }
    suspend fun comments(id: Long, before: String?) = JsonModels.comments(request("api/posts/$id/comments",
        before?.let { mapOf("before" to it) } ?: emptyMap()).toString(Charsets.UTF_8))
    suspend fun image(id: String) = request("api/media/${identifier(id)}")
    suspend fun account(path:String="api/me",method:String="GET",payload:JSONObject?=null,csrf:String?=null):JSONObject {
        require(path in setOf("api/me","api/login","api/register","api/logout","api/logout-all","api/recover",
            "api/me/password","api/recovery-codes","api/sessions") || Regex("api/sessions/[a-f0-9]{64}").matches(path))
        return JSONObject(request(path,method=method,payload=payload,csrf=csrf).toString(Charsets.UTF_8))
    }
}
