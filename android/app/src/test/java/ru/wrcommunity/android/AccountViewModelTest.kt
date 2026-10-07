package ru.wrcommunity.android

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.*
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun start(){Dispatchers.setMain(dispatcher)}
    @After fun stop(){Dispatchers.resetMain()}
    private class FakeAccounts:Accounts {
        val user=Account("a","tester","Имя","",false,emptyMap(),null)
        var me=Identity(null,null);var logins=0;var failLogout=false;var revoked=false
        var loginWait:CompletableDeferred<Unit>?=null
        var forgetWait:CompletableDeferred<Unit>?=null
        override suspend fun restore()=me
        override suspend fun signIn(handle:String,password:String,name:String?):Identity{logins++;loginWait?.await();me=Identity(user,"csrf");return me}
        override suspend fun update(name:String,bio:String,visible:Boolean,game:Map<String,String>,csrf:String):Account {
            if(revoked)throw ApiException(401,"Сначала войди в аккаунт.")
            return user.copy(name=name,bio=bio,visible=visible,game=game)
        }
        override suspend fun logout(csrf:String,all:Boolean){if(failLogout)throw IOException();me=Identity(null,null)}
        override suspend fun forget(){forgetWait?.await();me=Identity(null,null)}
        override suspend fun recover(handle:String,code:String,password:String){}
        override suspend fun password(old:String,new:String,csrf:String)=me
        override suspend fun codes(password:String,csrf:String)=listOf("test-code")
        override suspend fun sessions()=emptyList<DeviceSession>()
        override suspend fun revoke(id:String,csrf:String)=true
    }
    @Test fun duplicateLoginIsBlockedAndNoPasswordIsSaved()=runTest(dispatcher){
        val repo=FakeAccounts();val model=AccountViewModel(repo);advanceUntilIdle()
        repo.loginWait=CompletableDeferred();model.signIn("tester","long-password-123");model.signIn("tester","long-password-123");runCurrent()
        assertEquals(1,repo.logins);repo.loginWait!!.complete(Unit);advanceUntilIdle()
        assertEquals("a",model.state.value.user!!.id);assertEquals(1,model.state.value.boundary)
        assertFalse(model.state.value.toString().contains("password-123"))
    }
    @Test fun failedLogoutKeepsIdentityUntilExplicitLocalForget()=runTest(dispatcher){
        val repo=FakeAccounts().apply{me=Identity(user,"csrf")};val model=AccountViewModel(repo);advanceUntilIdle()
        repo.failLogout=true;model.logout();advanceUntilIdle();assertNotNull(model.state.value.user);assertNotNull(model.state.value.error)
        model.forget();advanceUntilIdle();assertNull(model.state.value.user);assertEquals(2,model.state.value.boundary)
    }
    @Test fun revokedSessionClearsProfileCodesAndCrossAccountContentBoundary()=runTest(dispatcher){
        val repo=FakeAccounts().apply{me=Identity(user,"csrf")};val model=AccountViewModel(repo);advanceUntilIdle()
        model.codes("long-password-123");advanceUntilIdle();assertEquals(1,model.state.value.codes.size)
        repo.revoked=true;repo.me=Identity(null,null);model.update("Имя","",false,emptyMap());advanceUntilIdle()
        assertNull(model.state.value.user);assertTrue(model.state.value.codes.isEmpty());assertEquals(2,model.state.value.boundary)
    }
    @Test fun expiryBlocksNewLoginUntilCookieCleanupFinishes()=runTest(dispatcher){
        val repo=FakeAccounts().apply{me=Identity(user,"csrf")}
        val model=AccountViewModel(repo);advanceUntilIdle()
        repo.loginWait=CompletableDeferred();model.signIn("tester","long-password-123");runCurrent()
        repo.forgetWait=CompletableDeferred();model.expireSession();runCurrent()
        assertTrue(model.state.value.busy);assertNull(model.state.value.user)
        model.signIn("tester","long-password-123");runCurrent();assertEquals(1,repo.logins)
        repo.forgetWait!!.complete(Unit);advanceUntilIdle();assertFalse(model.state.value.busy)
        repo.loginWait=null;model.signIn("tester","long-password-123");advanceUntilIdle()
        assertEquals(2,repo.logins);assertEquals("a",model.state.value.user?.id)
    }

}
