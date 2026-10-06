package ru.wrcommunity.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.wrcommunity.android.ui.CommunityTheme
import ru.wrcommunity.android.ui.WelcomeScreen

class WelcomeUiTest {
    @get:Rule val compose=createComposeRule()
    @Test fun guestActionsSelectTheirDestination(){
        var destination=""
        compose.setContent { CommunityTheme { WelcomeScreen(null,{destination="clubs"},{destination=it}) } }
        compose.onNodeWithTag("welcome-explore").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("clubs",destination) }
        compose.onNodeWithTag("welcome-login").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("login",destination) }
        compose.onNodeWithTag("welcome-register").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("register",destination) }
    }
    @Test fun signedSessionOffersContinue(){
        compose.setContent { CommunityTheme { WelcomeScreen("Игрок",{},{}) } }
        compose.onNodeWithText("С возвращением, Игрок").assertExists()
        compose.onNodeWithText("Продолжить").assertExists()
        compose.onNodeWithTag("welcome-login").assertDoesNotExist()
        compose.onNodeWithTag("welcome-register").assertDoesNotExist()
    }
}
