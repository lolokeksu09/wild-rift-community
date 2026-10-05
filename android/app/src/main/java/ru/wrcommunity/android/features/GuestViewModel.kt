package ru.wrcommunity.android.features

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import ru.wrcommunity.android.data.*
import java.io.IOException

data class Failure(val message: String, val denied: Boolean = false)
data class Load<T>(val data: T? = null, val busy: Boolean = false, val error: Failure? = null,
                   val moreBusy: Boolean = false, val next: String? = null)
data class ClubContent(val club: Club, val posts: List<Post>)
data class PostContent(val post: Post, val comments: List<Comment>)
data class GuestState(val screen: Int = 0, val query: String = "", val tag: String = "", val sort: String = "name",
                      val catalog: Load<Catalog> = Load(), val club: Load<ClubContent> = Load(),
                      val post: Load<PostContent> = Load())
class GuestViewModel(private val saved: SavedStateHandle, private val repo: GuestRepository) : ViewModel() {
    private val mutable = MutableStateFlow(GuestState(
        screen = saved["screen"] ?: 0, query = saved["query"] ?: "",
        tag = saved["tag"] ?: "", sort = saved["sort"] ?: "name"))
    val state = mutable.asStateFlow()
    private var catalogJob: Job? = null
    private var clubJob: Job? = null
    private var postJob: Job? = null
    private var catalogVersion = 0
    private var clubVersion = 0
    private var postVersion = 0
    init {
        catalog()
        saved.get<String>("clubId")?.let { loadClub(it) }
        saved.get<Long>("postId")?.takeIf { mutable.value.screen == 2 }?.let { loadPost(it) }
    }
    private fun change(block: (GuestState) -> GuestState) { mutable.value = block(mutable.value) }
    private fun error(e: Throwable): Failure {
        if (e is CancellationException) throw e
        return when(e) {
            is ApiException -> when(e.status) {
                401,403 -> Failure("Для этого содержимого нужен вход или доступ к клубу.", true)
                404 -> Failure("Материал больше недоступен.", true)
                429 -> Failure("Слишком много запросов. Подожди немного и повтори.")
                else -> Failure("Не удалось загрузить данные. Попробуй ещё раз.")
            }
            is javax.net.ssl.SSLException -> Failure("Не удалось подтвердить защищённое соединение.")
            is IOException -> Failure("Нет связи с сервером. Проверь интернет и повтори.")
            else -> Failure("Сервер вернул неожиданный ответ. Попробуй позже.")
        }
    }
    fun query(value: String) { saved["query"] = value.take(100); change { it.copy(query = value.take(100)) } }
    fun filter(tag: String = mutable.value.tag, sort: String = mutable.value.sort) {
        saved["tag"]=tag; saved["sort"]=sort; change { it.copy(tag=tag,sort=sort) }; catalog()
    }
    fun catalog(more: Boolean = false) {
        val current = mutable.value
        if(more && (current.catalog.busy || current.catalog.moreBusy || current.catalog.next == null)) return
        catalogJob?.cancel()
        val version = ++catalogVersion
        val cursor = if(more) current.catalog.next else null
        change { it.copy(catalog = if(more) it.catalog.copy(moreBusy=true,error=null) else Load(busy=true)) }
        catalogJob = viewModelScope.launch {
            try {
                val result=repo.catalog(current.query,current.tag,current.sort,cursor)
                if(version != catalogVersion) return@launch
                val merged=if(more) result.copy(page=result.page.copy(
                    items=(current.catalog.data!!.page.items+result.page.items).distinctBy { it.id })) else result
                change { it.copy(catalog=Load(data=merged,next=result.page.next)) }
            } catch(e: Exception) {
                val failure=error(e)
                if(version == catalogVersion) change { it.copy(catalog=Load(
                    data=if(more && !failure.denied) current.catalog.data else null,
                    next=if(more && !failure.denied) cursor else null,error=failure)) }
            }
        }
    }
    fun openClub(id: String) { saved["clubId"]=id; saved["screen"]=1; change { it.copy(screen=1) }; loadClub(id) }
    fun loadClub(id: String = saved["clubId"] ?: "", more: Boolean = false) {
        if(id.isBlank()) return
        val current=mutable.value.club
        if(more && (current.busy || current.moreBusy || current.next==null)) return
        clubJob?.cancel(); val version=++clubVersion
        change { it.copy(club=if(more) current.copy(moreBusy=true,error=null) else Load(busy=true)) }
        clubJob=viewModelScope.launch {
            try {
                val club=if(more) current.data!!.club else repo.club(id)
                // Closed club descriptions never grant access to posts.
                val page=if(club.access=="open") repo.posts(id,if(more) current.next else null) else Page(emptyList(),null)
                if(version!=clubVersion) return@launch
                change { it.copy(club=Load(ClubContent(club,
                    (if(more) current.data!!.posts+page.items else page.items).distinctBy { post -> post.id }),next=page.next)) }
            } catch(e: Exception) {
                val failure=error(e)
                if(version==clubVersion) change { it.copy(club=Load(data=if(more&&!failure.denied) current.data else null,
                    error=failure,next=if(more&&!failure.denied) current.next else null)) }
            }
        }
    }
    fun openPost(id: Long) { saved["postId"]=id; saved["screen"]=2; change { it.copy(screen=2) }; loadPost(id) }
    fun loadPost(id: Long = saved["postId"] ?: 0L, more: Boolean = false) {
        if(id<=0) return
        val current=mutable.value.post
        if(more&&(current.busy||current.moreBusy||current.next==null)) return
        postJob?.cancel(); val version=++postVersion
        change { it.copy(post=if(more) current.copy(moreBusy=true,error=null) else Load(busy=true)) }
        postJob=viewModelScope.launch {
            try {
                // Revalidate the post before reading the next comments page.
                val post=repo.post(id)
                val page=repo.comments(id,if(more) current.next else null)
                if(version!=postVersion)return@launch
                change { it.copy(post=Load(PostContent(post,
                    (if(more) page.items+current.data!!.comments else page.items).distinctBy { comment -> comment.id }),next=page.next)) }
            } catch(e: Exception) {
                val failure=error(e)
                if(version==postVersion)change { it.copy(post=Load(data=if(more&&!failure.denied) current.data else null,
                    error=failure,next=if(more&&!failure.denied) current.next else null)) }
            }
        }
    }
    fun back() {
        val next=if(mutable.value.screen==2)1 else 0
        if(mutable.value.screen==2){postJob?.cancel();postVersion++;change { it.copy(post=Load()) };saved.remove<Long>("postId")}
        saved["screen"]=next;change { it.copy(screen=next) }
    }
}
