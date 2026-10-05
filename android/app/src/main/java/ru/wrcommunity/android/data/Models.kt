package ru.wrcommunity.android.data

import org.json.JSONArray
import org.json.JSONObject

data class Club(val id: String, val name: String, val description: String, val access: String,
                val coverId: String?, val rules: String, val tags: List<String>, val members: Int,
                val bots: Int, val isDemo: Boolean)
data class Post(val id: Long, val clubId: String, val title: String, val body: String,
                val author: String, val imageId: String?, val createdAt: Long, val isBot: Boolean)
data class Comment(val id: Long, val author: String, val body: String, val isBot: Boolean)
data class Page<T>(val items: List<T>, val next: String?)
data class Catalog(val page: Page<Club>, val tags: List<String>, val total: Int)

object JsonModels {
    private fun JSONObject.optional(key: String): String? =
        if (isNull(key)) null else get(key).toString().takeIf { it.isNotBlank() }
    private fun JSONArray.strings() = List(length()) { getString(it) }
    private fun <T> JSONArray.mapObjects(parse: (JSONObject) -> T): List<T> =
        List(length()) { parse(getJSONObject(it)) }
    private fun club(o: JSONObject) = Club(
        o.getString("id"), o.getString("name"), o.getString("description"), o.getString("access"),
        o.optional("cover_id"), o.optString("rules"), o.getJSONArray("tags").strings(),
        o.getInt("members"), o.optInt("bots"), o.optBoolean("isDemoClub"))
    private fun post(o: JSONObject) = Post(
        o.getLong("id"), o.getString("club_id"), o.getString("title"), o.getString("body"),
        o.getString("author_name"), o.optional("image_id"), o.getLong("created_at"), o.optBoolean("isBot"))
    fun catalog(raw: String): Catalog {
        val o = JSONObject(raw)
        return Catalog(Page(o.getJSONArray("clubs").mapObjects(::club), o.optional("next")),
            o.getJSONArray("tags").strings(), o.getInt("total"))
    }
    fun clubDetail(raw: String) = club(JSONObject(raw).getJSONObject("club"))
    fun posts(raw: String): Page<Post> {
        val o = JSONObject(raw)
        return Page(o.getJSONArray("posts").mapObjects(::post), o.optional("next"))
    }
    fun postDetail(raw: String) = post(JSONObject(raw).getJSONObject("post"))
    fun comments(raw: String): Page<Comment> {
        val o = JSONObject(raw)
        return Page(o.getJSONArray("comments").mapObjects {
            Comment(it.getLong("id"), it.getString("author_name"), it.getString("body"), it.optBoolean("isBot"))
        }, o.optional("next"))
    }
}
