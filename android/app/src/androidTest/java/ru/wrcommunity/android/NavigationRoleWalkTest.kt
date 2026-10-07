package ru.wrcommunity.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.*
import ru.wrcommunity.android.ui.CommunityTheme
import ru.wrcommunity.android.ui.NativeCommunityApp

/** Guest preview → actual account form → selected group; each lower tab retains its page. */
class NavigationRoleWalkTest {
    @get:Rule val rule=createComposeRule()
    @Test fun signingInReturnsToSelectedGroupAndTabsRestoreTheirDetail() {
        val user=WalkthroughSupport.User("outsider")
        val account=AccountViewModel(user.accounts)
        val client=FeatureClient(user.api,account::csrfToken,{account.state.value.user?.id},{account.state.value.boundary},account::expireSession,account::refresh)
        val guest=GuestViewModel(SavedStateHandle(),CommunityRepository(user.api))
        val content=ContentViewModel(client)
        val messaging=MessagingViewModel(client)
        val discovery=DiscoveryViewModel(client)
        val moderation=ModerationViewModel(client)
        val notifications=NotificationViewModel(client)
        try {
            WalkthroughSupport.await(account.state){it.ready&&!it.busy}
            assertNull(account.state.value.user)
            val restoration=StateRestorationTester(rule)
            restoration.setContent {CommunityTheme {NativeCommunityApp(guest,account,client,content,messaging,discovery,moderation,notifications,"discovery/lfg")}}
            WalkthroughSupport.await(discovery.state){!it.busy&&it.data?.rows("groups")?.any{g->g.optString("title")=="Walkthrough group"}==true}
            rule.onNodeWithText("Войти и участвовать").performScrollTo().performClick()
            rule.onNodeWithText("Логин").performScrollTo().performTextInput(user.details.getString("handle"))
            rule.onNodeWithText("Пароль").performScrollTo().performTextInput(WalkthroughSupport.fixture.getString("password"))
            rule.onNodeWithText("Войти").performScrollTo().performClick()
            WalkthroughSupport.await(account.state){it.user!=null&&!it.busy}
            val group=WalkthroughSupport.fixture.getLong("groupId")
            WalkthroughSupport.await(discovery.state){!it.busy&&it.data?.optJSONObject("group")?.optLong("id")==group}
            assertEquals("discovery/group/$group",discovery.currentRoute)
            rule.onNodeWithText("Walkthrough group").performScrollTo().assertIsDisplayed()
            rule.onNode(hasText("Клубы") and hasClickAction()).performClick()
            WalkthroughSupport.await(content.state){!it.busy&&it.data?.rows("clubs")?.any{c->c.optString("name")=="Walkthrough club"}==true}
            rule.onNodeWithTag("catalog-list").performScrollToNode(hasText("Walkthrough club"))
            rule.onNodeWithText("Walkthrough club").performClick()
            val club=WalkthroughSupport.fixture.getString("clubId")
            WalkthroughSupport.await(content.state){!it.busy&&it.data?.optJSONObject("club")?.optString("id")==club}
            rule.onNode(hasText("Главная") and hasClickAction()).performClick()
            WalkthroughSupport.await(discovery.state){!it.busy&&it.data?.optJSONObject("group")?.optLong("id")==group}
            rule.onNode(hasText("Клубы") and hasClickAction()).performClick()
            WalkthroughSupport.await(content.state){!it.busy&&it.data?.optJSONObject("club")?.optString("id")==club}
            rule.onNodeWithTag("club-list").assertExists()
            restoration.emulateSavedInstanceStateRestore()
            WalkthroughSupport.await(content.state){!it.busy&&it.data?.optJSONObject("club")?.optString("id")==club}
            rule.onNode(hasText("Главная") and hasClickAction()).performClick()
            WalkthroughSupport.await(discovery.state){!it.busy&&it.data?.optJSONObject("group")?.optLong("id")==group}
            assertEquals("discovery/group/$group",discovery.currentRoute)
        }finally{rule.runOnIdle {content.reset();messaging.reset();discovery.reset();moderation.reset();notifications.reset()}}
    }
}
