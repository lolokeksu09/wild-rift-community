package ru.wrcommunity.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
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
    @Test fun swipeAndButtonsNavigateFourCards(){
        compose.setContent { CommunityTheme { WelcomeScreen(null,{},{}) } }
        compose.onNodeWithTag("welcome-step-0").assertIsSelected()
        compose.onNodeWithTag("welcome-previous").assertIsNotEnabled()
        compose.onNodeWithTag("welcome-pager").performScrollTo().performTouchInput {
            swipeLeft(startX=width*.8f,endX=width*.2f,durationMillis=500)
        }
        compose.waitUntil(10_000) { compose.onAllNodes(hasTestTag("welcome-step-1") and isSelected()).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        compose.onNodeWithTag("welcome-step-1").assertIsSelected()
        compose.onNodeWithTag("welcome-next").performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("welcome-step-2").assertIsSelected()
        compose.onNodeWithTag("welcome-step-3").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("welcome-step-3").assertIsSelected()
        compose.onNodeWithTag("welcome-next").assertIsNotEnabled()
        compose.onNodeWithTag("welcome-previous").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("welcome-step-2").assertIsSelected()
    }
    @Test fun selectedCardSurvivesRestoration(){
        val restoration=StateRestorationTester(compose)
        restoration.setContent { CommunityTheme { WelcomeScreen(null,{},{}) } }
        compose.onNodeWithTag("welcome-step-2").performScrollTo().performClick()
        compose.waitForIdle()
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag("welcome-step-2").assertIsSelected()
    }
}
