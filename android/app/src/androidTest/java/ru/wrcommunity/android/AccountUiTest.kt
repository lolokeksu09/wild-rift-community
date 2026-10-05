package ru.wrcommunity.android

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.AccountViewModel
import ru.wrcommunity.android.ui.AccountScreen
import ru.wrcommunity.android.ui.CommunityTheme

class AccountUiTest {
    @get:Rule val rule=createComposeRule()
    private class Fixture:Accounts {
        var current:Account?=null
        override suspend fun restore()=Identity(current,if(current==null)null else "fixture")
        override suspend fun signIn(handle:String,password:String,name:String?):Identity {
            current=Account("ui-account",handle,name ?: "Игрок","",false,emptyMap(),null);return restore()
        }
        override suspend fun update(name:String,bio:String,visible:Boolean,game:Map<String,String>,csrf:String):Account {
            current=current!!.copy(name=name,bio=bio,visible=visible,game=game);return current!!
        }
        override suspend fun logout(csrf:String,all:Boolean){current=null}
        override suspend fun forget(){current=null}
        override suspend fun recover(handle:String,code:String,password:String){}
        override suspend fun password(old:String,new:String,csrf:String)=restore()
        override suspend fun codes(password:String,csrf:String)=listOf("fixture")
        override suspend fun sessions()=emptyList<DeviceSession>()
        override suspend fun revoke(id:String,csrf:String)=true
    }
    @Test fun formLoginSaveProfileLogoutAndPasswordDisposal() {
        val fixture=Fixture()
        rule.setContent{
            val model=remember{AccountViewModel(fixture)}
            val state by model.state.collectAsStateWithLifecycle()
            CommunityTheme{AccountScreen(state,model)}
        }
        rule.waitUntil(10_000){rule.onAllNodesWithText("Логин").fetchSemanticsNodes().isNotEmpty()}
        rule.onNodeWithText("Логин").performTextInput("ui_tester")
        rule.onNodeWithText("Пароль").performTextInput("test-password-123")
        rule.onNodeWithText("Войти").performScrollTo().performClick()
        rule.waitUntil(10_000){rule.onAllNodesWithText("@ui_tester").fetchSemanticsNodes().isNotEmpty()}
        rule.onNodeWithText("Имя").performScrollTo().performTextReplacement("Новое имя")
        rule.onNodeWithTag("account-list").performScrollToNode(hasText("Сохранить профиль"))
        rule.onNodeWithText("Сохранить профиль").performScrollTo().performClick()
        rule.waitUntil(10_000){fixture.current?.name=="Новое имя"}
        rule.onNodeWithTag("account-list").performScrollToNode(hasText("Выйти",substring=false))
        rule.onNodeWithText("Выйти").performScrollTo().performClick()
        rule.waitUntil(10_000){fixture.current==null}
        rule.onNodeWithTag("account-list").performScrollToNode(hasText("Твой аккаунт"))
        rule.onNodeWithText("Пароль").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText,AnnotatedString("")))
        assertNull(fixture.current)
    }
}
