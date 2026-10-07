package ru.wrcommunity.android.data

import kotlinx.coroutines.CancellationException
import org.json.JSONObject

/** Uses the existing origin, cookie jar and CSRF protection for every feature. */
class FeatureClient(val api:CommunityApi, private val csrf:()->String?,
    private val user:()->String?, private val boundary:()->Long,
    private val expired:()->Unit, private val denied:()->Unit) {
    val userId:String? get()=user()
    val identityKey:Long get()=boundary()
    suspend fun call(path:String, method:String="GET", body:JSONObject=JSONObject(),
                     query:Map<String,String> = emptyMap()):JSONObject {
        val key=identityKey
        val token=if(method=="GET")null else csrf()?.takeIf{it.isNotBlank()}
            ?: throw ApiException(401,"Сначала войди в аккаунт.")
        try {
            val result=api.community(path,query,method,body,token)
            if(key!=identityKey)throw CancellationException("Account changed")
            return result
        } catch(e:ApiException) {
            if(key!=identityKey)throw CancellationException("Account changed")
            if(e.status==401)expired() else if(e.status==403)denied()
            throw e
        }
    }
    suspend fun get(path:String,query:Map<String,String> = emptyMap())=call(path,query=query)
    suspend fun post(path:String,body:JSONObject=JSONObject())=call(path,"POST",body)
    suspend fun patch(path:String,body:JSONObject)=call(path,"PATCH",body)
    suspend fun delete(path:String,body:JSONObject=JSONObject())=call(path,"DELETE",body)
    suspend fun upload(bytes:ByteArray,mime:String,id:String):JSONObject {
        val key=identityKey
        val token=csrf() ?: throw ApiException(401,"Сначала войди в аккаунт.")
        try {
            val result=api.upload(bytes,mime,id,token)
            if(key!=identityKey)throw CancellationException("Account changed")
            return result
        }catch(e:ApiException){
            if(key!=identityKey)throw CancellationException("Account changed")
            if(e.status==401)expired() else if(e.status==403)denied()
            throw e
        }
    }
}

fun JSONObject.rows(name:String):List<JSONObject> = optJSONArray(name)?.let{a->
    List(a.length()){i->a.optJSONObject(i)}.filterNotNull()} ?: emptyList()
fun JSONObject.nullableString(name:String):String? = if(isNull(name))null else optString(name).takeIf{it.isNotBlank()}
