package ru.wrcommunity.android

import android.graphics.Bitmap
import android.os.Environment
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import ru.wrcommunity.android.data.CommunityApi
import ru.wrcommunity.android.data.rows
import java.io.File

class GuestHomeTest {
    @get:Rule val rule=createAndroidComposeRule<MainActivity>()
    @Test fun guestHomeShowsRealPublicPostsAndOpensTheSameClubScreen() {
        val post=runBlocking{CommunityApi(BuildConfig.API_ORIGIN).community("api/feed").rows("posts").first()}
        rule.onNodeWithTag("welcome-explore").performClick()
        rule.onNodeWithText("Главная").performClick()
        rule.waitUntil(45_000){rule.onAllNodesWithText(post.getString("title")).fetchSemanticsNodes().isNotEmpty()}
        rule.onNodeWithText("Своя компания.\nТвоя игра.").assertIsDisplayed()
        val dir=File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),"wr-community").apply{mkdirs()}
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()?.let{bitmap->
            File(dir,"05-home.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
        }
        rule.onNodeWithText(post.getString("title")).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Люди сообщества").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Найти свой клуб").performScrollTo().performClick()
        rule.waitUntil(20_000){rule.onAllNodesWithTag("catalog-list").fetchSemanticsNodes().isNotEmpty()}
        rule.onNodeWithText("Найди свою компанию").assertIsDisplayed()
        rule.onNodeWithContentDescription("Назад").performClick()
        rule.waitUntil(20_000){rule.onAllNodesWithText("Своя компания.\nТвоя игра.").fetchSemanticsNodes().isNotEmpty()}
    }
}
