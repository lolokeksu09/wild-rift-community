package ru.wrcommunity.android.data

import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

data class ContentPagePlan(val path:String,val key:String,val container:String?=null,val cursorKey:String="before",val pages:Int=1)

/** Wire contracts from clubs, discussions, polls, guides and drafts; never caches private data. */
class ContentRepository(private val client: FeatureClient) {
    suspend fun screen(route: String, filters: Map<String,String> = emptyMap(),plans:List<ContentPagePlan> = emptyList()): JSONObject {
        val identity=client.identityKey
        suspend fun read(path:String,query:Map<String,String> = emptyMap())=authorizedGet(path,query,identity)
        val parts=route.removePrefix("content/").split('/')
        val id=parts.getOrNull(1).orEmpty()
        val result=when(parts[0]) {
            "club" -> {
                val data=read("api/clubs/$id/detail")
                val club=data.getJSONObject("club")
                if(club.optString("membership")!="banned" && (club.optString("access")=="open" || club.optString("membership")=="member")) {
                    data.put("postsPage",read("api/clubs/$id/posts"))
                    data.put("pinsPage",read("api/clubs/$id/pins"))
                }
                data
            }
            "post" -> {
                val data=read("api/posts/$id")
                val clubId=data.getJSONObject("post").getString("club_id")
                data.put("club",read("api/clubs/$clubId/detail").getJSONObject("club"))
                val focus=NativeRoutes.comment(route)
                var comments=read("api/posts/$id/comments")
                if(focus!=null&&comments.rows("comments").none{it.optLong("id")==focus})
                    comments=read("api/posts/$id/comments",mapOf("before" to (focus+1).toString()))
                data.put("commentsPage",comments)
                data.put("pinsPage",read("api/clubs/$clubId/pins"))
            }
            "members","audit","invites","settings" -> {
                val data=read("api/clubs/$id/detail")
                if(parts[0]!="settings")data.put("${parts[0]}Page",read("api/clubs/$id/${parts[0]}"))
                data
            }
            "draft" -> read("api/clubs/$id/draft")
            "edit" -> read("api/posts/$id")
            "clubs" -> read("api/clubs",filters)
            "feed" -> read("api/feed",filters)
            "guides" -> read("api/guides",filters)
            "search" -> if(filters["q"].isNullOrBlank())JSONObject().put("posts",JSONArray()).put("next",JSONObject.NULL).put("searchPending",true) else read("api/posts/search",filters)
            "saved" -> read("api/saved",filters)
            "drafts" -> read("api/drafts")
            "notifications" -> read("api/discussions/notifications",filters)
            else -> JSONObject()
        }
        return restorePages(result,plans,filters,identity)
    }
    /** Rebuild from freshly authorized responses; only page counts survive navigation. */
    suspend fun restorePages(fresh:JSONObject,plans:List<ContentPagePlan>,filters:Map<String,String> = emptyMap(),identity:Long=client.identityKey):JSONObject {
        checkIdentity(identity)
        val result=JSONObject(fresh.toString())
        for(plan in plans){
            var page=if(plan.container==null)result else result.optJSONObject(plan.container)?:continue
            repeat((plan.pages-1).coerceAtLeast(0)) {
                val cursor=next(page) ?: return@repeat
                val fetched=authorizedGet(plan.path,filters+mapOf(plan.cursorKey to cursor),identity)
                page=mergePage(page,fetched,plan.key,plan.key=="comments")
            }
            if(plan.container==null){result.put(plan.key,page.optJSONArray(plan.key)?:JSONArray());result.put("next",page.opt("next")?:JSONObject.NULL)}
            else result.put(plan.container,page)
        }
        checkIdentity(identity)
        return result
    }
    private fun checkIdentity(identity:Long){if(identity!=client.identityKey)throw CancellationException("Account changed")}
    private suspend fun authorizedGet(path:String,query:Map<String,String>,identity:Long):JSONObject {
        checkIdentity(identity)
        return client.get(path,query).also{checkIdentity(identity)}
    }
    companion object {
        fun next(page:JSONObject):String?=page.nullableString("next")
        fun mergePage(old:JSONObject, next:JSONObject, key:String, prepend:Boolean=false):JSONObject {
            val result=JSONObject(old.toString());val seen=mutableSetOf<String>()
            // Permissions and other response metadata must follow the latest authorized page.
            next.keys().forEach{field->if(field!=key)result.put(field,next.opt(field))}
            val items=if(prepend)next.rows(key)+old.rows(key) else old.rows(key)+next.rows(key)
            result.put(key,JSONArray(items.filter{seen.add(it.optString("id",it.optString("club_id")))}))
            result.put("next",next.opt("next")?:JSONObject.NULL)
            return result
        }
        fun postBody(title:String,body:String,image:String?,clientId:String)=JSONObject()
            .put("title",title).put("body",body).put("imageId",image?:JSONObject.NULL).put("clientId",clientId)
        fun editBody(title:String,body:String,version:Int,clientId:String)=JSONObject()
            .put("title",title).put("body",body).put("version",version).put("clientId",clientId)
        fun guideBody(title:String,body:String,topic:String,champion:String,gameVersion:String,summary:String,clientId:String,version:Int?=null)=JSONObject()
            .put("title",title).put("body",body).put("topic",topic).put("champion",champion)
            .put("gameVersion",gameVersion).put("summary",summary).put("clientId",clientId).apply{if(version!=null)put("version",version)}
    }
}
