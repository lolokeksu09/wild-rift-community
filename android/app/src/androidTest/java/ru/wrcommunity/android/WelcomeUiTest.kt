package ru.wrcommunity.android

import androidx.test.platform.app.InstrumentationRegistry
import java.io.FileInputStream
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
    private fun capture(name:String) {
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        // Shared Download storage survives AGP uninstalling the test application.
        for(command in listOf("mkdir -p /sdcard/Download/wr-onboarding","screencap -p /sdcard/Download/wr-onboarding/$name.png")) {
            automation.executeShellCommand(command).use { descriptor ->
                FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
            }
        }
    }
    @Test fun guestActionsSelectTheirDestination(){
        var destination=""
        compose.setContent { CommunityTheme { WelcomeScreen(null,{destination="clubs"},{destination=it}) } }
        compose.onNodeWithTag("welcome-explore").performClick()
        compose.runOnIdle { assertEquals("clubs",destination) }
        compose.onNodeWithTag("welcome-login").performClick()
        compose.runOnIdle { assertEquals("login",destination) }
        compose.onNodeWithTag("welcome-register").performClick()
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
        val screen=compose.onNodeWithTag("welcome-fullscreen").getUnclippedBoundsInRoot()
        val cover=compose.onNodeWithTag("welcome-cover-0").getUnclippedBoundsInRoot()
        assertEquals((screen.right-screen.left).value,(cover.right-cover.left).value,1f)
        assertEquals((screen.bottom-screen.top).value,(cover.bottom-cover.top).value,1f)
        compose.onNodeWithTag("welcome-step-0").assertIsSelected()
        compose.onNodeWithTag("welcome-previous").assertIsNotEnabled()
        capture("intro-0")
        compose.onNodeWithTag("welcome-pager").performTouchInput {
            swipeLeft(startX=width*.8f,endX=width*.2f,durationMillis=500)
        }
        compose.waitUntil(10_000) { compose.onAllNodes(hasTestTag("welcome-step-1") and isSelected()).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        compose.onNodeWithTag("welcome-step-1").assertIsSelected()
        capture("intro-1")
        compose.onNodeWithTag("welcome-next").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("welcome-step-2").assertIsSelected()
        capture("intro-2")
        compose.onNodeWithTag("welcome-step-3").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("welcome-step-3").assertIsSelected()
        capture("intro-3")
        compose.onNodeWithTag("welcome-next").assertIsNotEnabled()
        compose.onNodeWithTag("welcome-previous").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("welcome-step-2").assertIsSelected()
    }
    @Test fun selectedCardSurvivesRestoration(){
        val restoration=StateRestorationTester(compose)
        restoration.setContent { CommunityTheme { WelcomeScreen(null,{},{}) } }
        compose.onNodeWithTag("welcome-step-2").performClick()
        compose.waitForIdle()
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag("welcome-step-2").assertIsSelected()
    }
}
