package ru.wrcommunity.android.data

import org.json.JSONArray
import org.json.JSONObject

data class ContentPagePlan(val path:String,val key:String,val container:String?=null,val cursorKey:String="before",val pages:Int=1)

/** Wire contracts from clubs, discussions, polls, guides and drafts; never caches private data. */
class ContentRepository(private val client: FeatureClient) {
    suspend fun screen(route: String, filters: Map<String,String> = emptyMap(),plans:List<ContentPagePlan> = emptyList()): JSONObject {
        val parts=route.removePrefix("content/").split('/')
        val id=parts.getOrNull(1).orEmpty()
        val result=when(parts[0]) {
            "club" -> {
                val data=client.get("api/clubs/$id/detail")
                val club=data.getJSONObject("club")
                if(club.optString("membership")!="banned" && (club.optString("access")=="open" || club.optString("membership")=="member")) {
                    data.put("postsPage",client.get("api/clubs/$id/posts"))
                    data.put("pinsPage",client.get("api/clubs/$id/pins"))
                }
                data
            }
            "post" -> {
                val data=client.get("api/posts/$id")
                val clubId=data.getJSONObject("post").getString("club_id")
                data.put("club",client.get("api/clubs/$clubId/detail").getJSONObject("club"))
                data.put("commentsPage",client.get("api/posts/$id/comments"))
                data.put("pinsPage",client.get("api/clubs/$clubId/pins"))
            }
            "members","audit","invites","settings" -> {
                val data=client.get("api/clubs/$id/detail")
                if(parts[0]!="settings")data.put("${parts[0]}Page",client.get("api/clubs/$id/${parts[0]}"))
                data
            }
            "draft" -> client.get("api/clubs/$id/draft")
            "edit" -> client.get("api/posts/$id")
            "clubs" -> client.get("api/clubs",filters)
            "feed" -> client.get("api/feed",filters)
            "guides" -> client.get("api/guides",filters)
            "search" -> client.get("api/posts/search",filters)
            "saved" -> client.get("api/saved",filters)
            "drafts" -> client.get("api/drafts")
            "notifications" -> client.get("api/discussions/notifications",filters)
            else -> JSONObject()
        }
        return restorePages(result,plans,filters)
    }
    /** Rebuild from freshly authorized responses; only page counts survive navigation. */
    suspend fun restorePages(fresh:JSONObject,plans:List<ContentPagePlan>,filters:Map<String,String> = emptyMap()):JSONObject {
        val result=JSONObject(fresh.toString())
        for(plan in plans){
            var page=if(plan.container==null)result else result.optJSONObject(plan.container)?:continue
            repeat((plan.pages-1).coerceAtLeast(0)) {
                val cursor=next(page) ?: return@repeat
                val fetched=client.get(plan.path,filters+mapOf(plan.cursorKey to cursor))
                page=mergePage(page,fetched,plan.key,plan.key=="comments")
            }
            if(plan.container==null){result.put(plan.key,page.optJSONArray(plan.key)?:JSONArray());result.put("next",page.opt("next")?:JSONObject.NULL)}
            else result.put(plan.container,page)
        }
        return result
    }
    companion object {
        fun next(page:JSONObject):String?=page.nullableString("next")
        fun mergePage(old:JSONObject, next:JSONObject, key:String, prepend:Boolean=false):JSONObject {
            val result=JSONObject(old.toString());val seen=mutableSetOf<String>()
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
