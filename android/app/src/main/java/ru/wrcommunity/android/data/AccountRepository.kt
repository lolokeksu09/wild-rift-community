package ru.wrcommunity.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.json.JSONObject

data class Account(val id:String,val handle:String,val name:String,val bio:String,val visible:Boolean,
                   val game:Map<String,String>,val avatarId:String?,val coverId:String?=null,val roles:List<String> = emptyList(),
                   val champions:List<String> = emptyList(),val riotVisible:Boolean=false,val microphone:String="unknown",val moderator:Boolean=false)
data class Sanction(val level:String,val violations:Int,val until:Long?)
data class Identity(val user:Account?,val csrf:String?,val sanction:Sanction?=null)
data class DeviceSession(val id:String,val expiresAt:Long,val current:Boolean)
fun accountUser(o:JSONObject)=Account(o.getString("id"),o.getString("handle"),o.getString("name"),o.optString("bio"),
    o.optBoolean("profileVisible"),o.optJSONObject("gameProfile")?.let{g->
        listOf("riotId","rank","region","language","playTime").associateWith{g.optString(it)}} ?: emptyMap(),
    if(o.isNull("avatarId"))null else o.getString("avatarId"),
    o.nullableString("coverId"),o.optJSONObject("gameProfile")?.optJSONArray("roles")?.let{a->List(a.length()){a.getString(it)}} ?: emptyList(),
    o.optJSONObject("gameProfile")?.optJSONArray("champions")?.let{a->List(a.length()){a.getString(it)}} ?: emptyList(),
    o.optJSONObject("gameProfile")?.optBoolean("riotVisible") ?: false,o.optJSONObject("gameProfile")?.optString("microphone","unknown") ?: "unknown",o.optBoolean("isModerator"))
internal fun identity(o:JSONObject)=Identity(if(o.isNull("user"))null else accountUser(o.getJSONObject("user")),
    if(o.isNull("csrf"))null else o.getString("csrf"),
    o.optJSONObject("sanction")?.let{Sanction(it.getString("level"),it.getInt("violations"),if(it.isNull("until"))null else it.getLong("until"))})

interface Accounts {
    suspend fun restore():Identity
    suspend fun signIn(handle:String,password:String,name:String?):Identity
    suspend fun update(name:String,bio:String,visible:Boolean,game:Map<String,String>,csrf:String):Account
    suspend fun updateExtra(payload:JSONObject,csrf:String):Account {throw UnsupportedOperationException("Extended profile unavailable")}
    suspend fun logout(csrf:String,all:Boolean)
    suspend fun forget()
    suspend fun recover(handle:String,code:String,password:String)
    suspend fun password(old:String,new:String,csrf:String):Identity
    suspend fun codes(password:String,csrf:String):List<String>
    suspend fun sessions():List<DeviceSession>
    suspend fun revoke(id:String,csrf:String):Boolean
}
class AccountRepository(private val api:CommunityApi,private val cookies:SessionCookies):Accounts {
    override suspend fun restore():Identity {
        withContext(Dispatchers.IO){cookies.initialize()}
        val result=identity(api.account())
        if(result.user==null)forget()
        return result
    }
    override suspend fun signIn(handle:String,password:String,name:String?):Identity {
        forget()
        try {
            val payload=JSONObject().put("handle",handle).put("password",password)
            if(name!=null)payload.put("name",name)
            val result=identity(api.account(if(name==null)"api/login" else "api/register","POST",payload))
            check(result.user!=null && !result.csrf.isNullOrBlank() && cookies.hasCookie())
            return result
        } catch(e:Exception){withContext(NonCancellable){forget()};throw e}
    }
    override suspend fun update(name:String,bio:String,visible:Boolean,game:Map<String,String>,csrf:String)=
        accountUser(api.account("api/me","PATCH",JSONObject().put("name",name).put("bio",bio)
            .put("profileVisible",visible).put("gameProfile",JSONObject(game)),csrf).getJSONObject("user"))
    override suspend fun updateExtra(payload:JSONObject,csrf:String)=accountUser(api.account("api/me","PATCH",payload,csrf).getJSONObject("user"))
    override suspend fun logout(csrf:String,all:Boolean){api.account(if(all)"api/logout-all" else "api/logout","POST",csrf=csrf);forget()}
    override suspend fun forget(){withContext(Dispatchers.IO){cookies.clear()}}
    override suspend fun recover(handle:String,code:String,password:String){
        api.account("api/recover","POST",JSONObject().put("handle",handle).put("code",code).put("password",password))
    }
    override suspend fun password(old:String,new:String,csrf:String):Identity {
        val result=identity(api.account("api/me/password","POST",JSONObject().put("currentPassword",old).put("newPassword",new),csrf))
        check(result.user!=null && !result.csrf.isNullOrBlank())
        return result
    }
    override suspend fun codes(password:String,csrf:String)=api.account("api/recovery-codes","POST",JSONObject().put("password",password),csrf)
        .getJSONArray("codes").let{a->List(a.length()){a.getString(it)}}
    override suspend fun sessions():List<DeviceSession> {
        val data=api.account("api/sessions")
        // No hidden cursor reconstruction: accounts with >100 sessions can revoke all.
        return data.getJSONArray("sessions").let{a->List(a.length()){i->a.getJSONObject(i).let{DeviceSession(it.getString("id"),it.getLong("expiresAt"),it.getBoolean("current"))}}}
    }
    override suspend fun revoke(id:String,csrf:String)=api.account("api/sessions/$id","DELETE",csrf=csrf).getBoolean("loggedOut")
}
