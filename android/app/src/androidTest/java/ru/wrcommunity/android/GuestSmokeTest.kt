package ru.wrcommunity.android

import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import ru.wrcommunity.android.data.CommunityApi
import java.io.File

class GuestSmokeTest {
    @get:Rule val rule=createAndroidComposeRule<MainActivity>()
    private fun awaitText(text:String) {
        rule.waitUntil(45_000) { rule.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }
    private fun capture(name:String) {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val directory=File(instrumentation.targetContext.getExternalFilesDir(null),"screenshots").apply{mkdirs()}
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            File(directory,"$name.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
            bitmap.recycle()
        }
    }
    private fun shell(command:String) {
        val descriptor=InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        ParcelFileDescriptor.AutoCloseInputStream(descriptor).use{it.readBytes()}
    }
    @Test fun realGuestCatalogClubPostBackAndLargeText() {
        val api=CommunityApi(BuildConfig.API_ORIGIN)
        val selection=runBlocking {
            api.catalog("","","name",null).page.items.firstNotNullOfOrNull { club ->
                api.posts(club.id,null).items.firstOrNull()?.let{club to it}
            } ?: error("The real server needs an accessible club and post for guest smoke testing.")
        }
        rule.onNodeWithTag("welcome-explore").performClick()
        rule.waitUntil(45_000) { rule.onAllNodesWithText("Открытые клубы ·", substring=true).fetchSemanticsNodes().isNotEmpty() }
        awaitText("Найди свою компанию")
        capture("01-catalog")
        rule.onNodeWithText("Поиск клубов").performTextInput(selection.first.name)
        rule.onNodeWithContentDescription("Найти клубы").performClick()
        rule.waitUntil(45_000) { rule.onAllNodesWithText("Открытые клубы ·", substring=true).fetchSemanticsNodes().isNotEmpty() }
        val selectedClub = hasText(selection.first.name) and hasClickAction()
        rule.onNodeWithTag("catalog-list").performScrollToNode(selectedClub)
        rule.onNode(selectedClub).performClick()
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("club-list").fetchSemanticsNodes().isNotEmpty() }
        awaitText(selection.first.name)
        capture("02-club")
        rule.onNodeWithTag("club-list").performScrollToNode(hasText(selection.second.title))
        rule.onNodeWithText(selection.second.title).performClick()
        awaitText(selection.second.title)
        capture("03-post")
        rule.onNodeWithTag("post-list").performScrollToNode(hasText("Обсуждение"))
        rule.onNodeWithText("Обсуждение").assertIsDisplayed()
        rule.onNodeWithContentDescription("Назад").performClick()
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("club-list").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithContentDescription("Назад").performClick()
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("catalog-list").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("catalog-list").performScrollToNode(hasText("Найди свою компанию"))
        awaitText("Найди свою компанию")
        try {
            shell("settings put system font_scale 2.0")
            rule.waitUntil(20_000) { rule.activity.resources.configuration.fontScale >= 1.9f }
            awaitText("Найди свою компанию")
            rule.waitForIdle()
            rule.onNodeWithText("Найди свою компанию").assertIsDisplayed()
            capture("04-large-text")
        } finally { shell("settings put system font_scale 1.0") }
    }
}
