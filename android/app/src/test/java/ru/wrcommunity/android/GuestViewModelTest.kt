package ru.wrcommunity.android

import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.*
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class GuestViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup(){Dispatchers.setMain(dispatcher)}
    @After fun cleanup(){Dispatchers.resetMain()}
    private class Repository:GuestRepository {
        var catalogAction:suspend (String,String?)->Catalog={_,_->Catalog(Page(emptyList(),null),emptyList(),0)}
        var commentAction:suspend (String?)->Page<Comment> = {Page(listOf(Comment(2,"Участник","Ответ",false)),"2")}
        override suspend fun catalog(q:String,tag:String,sort:String,after:String?)=catalogAction(q,after)
        override suspend fun club(id:String)=Club(id,"Клуб","Описание","open",null,"",emptyList(),1,0,false)
        override suspend fun posts(id:String,before:String?)=Page(listOf(fixturePost(1)),null)
        override suspend fun post(id:Long)=fixturePost(id)
        private fun fixturePost(id:Long)=Post(id,"club-1","Пост","Текст","Автор",null,1,false)
        override suspend fun comments(id:Long,before:String?)=commentAction(before)
    }
    @Test fun olderSearchCannotOverwriteLatestQuery()=runTest(dispatcher) {
        val repo=Repository();val pending=CompletableDeferred<Catalog>()
        repo.catalogAction={q,_->if(q.isEmpty())pending.await() else Catalog(Page(emptyList(),null),listOf(q),0)}
        val model=GuestViewModel(SavedStateHandle(),repo)
        runCurrent();model.query("лес");model.catalog();runCurrent()
        pending.complete(Catalog(Page(emptyList(),null),listOf("устарело"),0));advanceUntilIdle()
        assertEquals(listOf("лес"),model.state.value.catalog.data!!.tags)
    }
    @Test fun pageFailureRetainsResultsAndRetryUsesSameCursor()=runTest(dispatcher) {
        val repo=Repository()
        val club=repo.club("club-1");var fail=false;val cursors=mutableListOf<String?>()
        repo.catalogAction={_,after->cursors+=after;if(fail)throw IOException()
            Catalog(Page(listOf(club),if(after==null)"opaque" else null),emptyList(),1)}
        val model=GuestViewModel(SavedStateHandle(),repo);advanceUntilIdle()
        fail=true;model.catalog(more=true);advanceUntilIdle()
        assertEquals(1,model.state.value.catalog.data!!.page.items.size)
        assertNotNull(model.state.value.catalog.error)
        fail=false;model.catalog(more=true);advanceUntilIdle()
        assertEquals(listOf(null,"opaque","opaque"),cursors)
        assertEquals(1,model.state.value.catalog.data!!.page.items.size)
        assertNull(model.state.value.catalog.next)
    }
    @Test fun accessRevocationClearsPreviouslyLoadedPostAndComments()=runTest(dispatcher) {
        val repo=Repository();val model=GuestViewModel(SavedStateHandle(),repo);advanceUntilIdle()
        model.openClub("club-1");advanceUntilIdle();model.openPost(1);advanceUntilIdle()
        assertNotNull(model.state.value.post.data)
        repo.commentAction={throw ApiException(403,"Нет доступа")}
        model.loadPost(more=true);advanceUntilIdle()
        assertNull(model.state.value.post.data)
        assertTrue(model.state.value.post.error!!.denied)
    }
    @Test fun backCancelsPendingPostAndKeepsCatalog()=runTest(dispatcher) {
        val repo=Repository();val pending=CompletableDeferred<Page<Comment>>()
        repo.commentAction={pending.await()}
        val model=GuestViewModel(SavedStateHandle(),repo);advanceUntilIdle()
        model.openClub("club-1");advanceUntilIdle();model.openPost(1);runCurrent();model.back()
        pending.complete(Page(emptyList(),null));advanceUntilIdle()
        assertEquals(1,model.state.value.screen)
        assertNull(model.state.value.post.data)
        assertFalse(model.state.value.post.busy)
        model.back();assertEquals(0,model.state.value.screen)
        assertNotNull(model.state.value.catalog.data)
    }
}
