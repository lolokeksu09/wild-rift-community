package ru.wrcommunity.android

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.ContentViewModel
import ru.wrcommunity.android.ui.CommunityTheme
import ru.wrcommunity.android.ui.ContentSection

/** Production content UI/ViewModel against the generated, certificate-verified HTTPS fixture. */
class ContentRoleWalkTest {
    @get:Rule val rule=createComposeRule()

    @Test fun oldCommentFocusAndOwnerWriterControlsFollowRealPermissions():Unit=runBlocking {
        val owner=WalkthroughSupport.user("owner")
        val writer=WalkthroughSupport.user("writer")
        val postId=WalkthroughSupport.fixture.getLong("postId")
        val commentId=WalkthroughSupport.fixture.getLong("commentId")
        // Another walkthrough exercises blocking; isolate this reader scenario from class order.
        owner.client.delete("api/blocks",JSONObject().put("userId",writer.details.getString("id")))
        writer.client.delete("api/blocks",JSONObject().put("userId",owner.details.getString("id")))
        val latest=owner.client.get("api/posts/$postId/comments")
        assertEquals(50,latest.rows("comments").size)
        assertFalse(latest.rows("comments").any{it.getLong("id")==commentId})
        assertTrue(latest.getBoolean("canModerate"))
        val ownerModel=ContentViewModel(owner.client)
        val writerModel=ContentViewModel(writer.client)
        var active by mutableStateOf(ownerModel)
        var route by mutableStateOf(NativeRoutes.post(postId,commentId))
        try {
            rule.setContent { CommunityTheme { key(active.userId,route) { ContentSection(active,route,{route=it}) } } }
            val focused=WalkthroughSupport.await(ownerModel.state){
                !it.busy&&it.data?.optJSONObject("commentsPage")?.rows("comments")?.any{c->c.optLong("id")==commentId}==true
            }
            assertNull(focused.error)
            assertTrue(focused.data!!.getJSONObject("commentsPage").getBoolean("canModerate"))
            assertEquals("owner",focused.data!!.getJSONObject("club").getString("myRole"))
            // No performScrollTo: visibility must come from the production notification focus.
            rule.waitUntil(15000){
                runCatching {
                    rule.onNodeWithText("Walkthrough target comment").isDisplayed()&&
                        rule.onNodeWithText("Ответ из уведомления").isDisplayed()
                }.getOrDefault(false)
            }
            rule.onNodeWithTag("comment-$commentId").assertExists()
            rule.onNodeWithText("Walkthrough target comment").assertIsDisplayed()
            rule.onNodeWithText("Ответ из уведомления").assertIsDisplayed()
            rule.onNodeWithText("Удалить комментарий").assertIsEnabled()
            screenshot("content-owner-old-comment-ready")

            rule.onNodeWithText("Действия публикации").performScrollTo().performClick()
            rule.onNodeWithText("Удалить как модератор").performScrollTo().assertIsDisplayed().assertIsEnabled()
            rule.onNodeWithText("Редактировать").assertDoesNotExist()
            screenshot("content-owner-moderation-ready")

            // This button invokes ContentSection's actual navigation callback to the full post.
            rule.onNodeWithText("Показать последние комментарии").performScrollTo().performClick()
            WalkthroughSupport.await(ownerModel.state){
                !it.busy&&ownerModel.loadedRoute==NativeRoutes.post(postId)&&
                    it.data?.optJSONObject("commentsPage")?.rows("comments")?.size==50
            }
            rule.onNodeWithText("Ответ из уведомления").assertDoesNotExist()
            rule.onNodeWithText("Walkthrough target comment").assertDoesNotExist()

            rule.runOnIdle {active=writerModel}
            val own=WalkthroughSupport.await(writerModel.state){
                !it.busy&&it.data?.optJSONObject("post")?.optLong("id")==postId
            }
            assertNull(own.error)
            assertEquals(writer.details.getString("id"),own.data!!.getJSONObject("post").getString("author_id"))
            assertEquals("member",own.data!!.getJSONObject("club").getString("myRole"))
            assertFalse(own.data!!.getJSONObject("commentsPage").getBoolean("canModerate"))
            rule.onNodeWithText("Действия публикации").performScrollTo().performClick()
            rule.onNodeWithText("Редактировать").performScrollTo().assertIsDisplayed().assertIsEnabled()
            rule.onNodeWithText("Удалить публикацию").assertIsEnabled()
            rule.onNodeWithText("Удалить как модератор").assertDoesNotExist()
            rule.onNodeWithText("Удалить комментарий").assertDoesNotExist()
            screenshot("content-writer-own-controls-ready")
        }finally{rule.runOnIdle {ownerModel.reset();writerModel.reset()}}
    }

    private fun screenshot(name:String) {
        rule.waitForIdle()
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        listOf("mkdir -p /sdcard/Download/wr-community","screencap -p /sdcard/Download/wr-community/$name.png").forEach {command->
            automation.executeShellCommand(command).use {android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes()}
        }
    }
}
