package ru.wrcommunity.android.data

interface GuestRepository {
    suspend fun catalog(q: String, tag: String, sort: String, after: String?): Catalog
    suspend fun club(id: String): Club
    suspend fun posts(id: String, before: String?): Page<Post>
    suspend fun post(id: Long): Post
    suspend fun comments(id: Long, before: String?): Page<Comment>
}
class CommunityRepository(private val api: CommunityApi) : GuestRepository {
    override suspend fun catalog(q: String, tag: String, sort: String, after: String?) = api.catalog(q, tag, sort, after)
    override suspend fun club(id: String) = api.club(id)
    override suspend fun posts(id: String, before: String?) = api.posts(id, before)
    override suspend fun post(id: Long) = api.post(id)
    override suspend fun comments(id: Long, before: String?) = api.comments(id, before)
}
