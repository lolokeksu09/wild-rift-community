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
import ru.wrcommunity.android.features.MessagingViewModel
import ru.wrcommunity.android.ui.MessagingSection
import ru.wrcommunity.android.ui.CommunityTheme
import java.util.UUID

/** Real TLS/SQLite fixture. Only initial request preparation uses the API directly. */
class MessagingRoleWalkTest {
    @get:Rule val rule=createComposeRule()
    @Test fun recipientAcceptsWriterSendsAndRecipientBlockRevokesRoom():Unit=runBlocking {
        val writer=WalkthroughSupport.user("writer")
        val owner=WalkthroughSupport.user("owner")
        try {
        val first="Первое знакомство ${UUID.randomUUID()}"
        val conversation=writer.client.post("api/direct",JSONObject().put("handle",owner.details.getString("handle")).put("body",first).put("clientId",UUID.randomUUID().toString())).getString("id")
        val writerModel=MessagingViewModel(writer.client)
        val ownerModel=MessagingViewModel(owner.client)
        var active by mutableStateOf(ownerModel)
        var route by mutableStateOf("chat/inbox")
        rule.setContent { CommunityTheme { key(active.userId,route) { MessagingSection(active,route,{route=it}) } } }
        WalkthroughSupport.await(ownerModel.chatState){!it.busy&&it.accessValidated&&it.conversations.any{c->c.id==conversation&&c.status=="pending"}}
        rule.onNodeWithText("Принять").performScrollTo().performClick()
        WalkthroughSupport.await(ownerModel.chatState){!it.busy&&it.conversations.any{c->c.id==conversation&&c.status=="accepted"}}
        rule.runOnIdle { active=writerModel;route="chat/direct/$conversation" }
        rule.waitForIdle()
        WalkthroughSupport.await(writerModel.chatState){!it.busy&&it.accessValidated&&it.messages.any{m->m.body==first}}
        val sent="Сообщение после согласия ${UUID.randomUUID()}"
        rule.onNodeWithText("Сообщение").performTextInput(sent)
        rule.onNodeWithContentDescription("Отправить сообщение").performClick()
        WalkthroughSupport.await(writerModel.chatState){!it.busy&&it.pending.isEmpty()&&it.messages.any{m->m.body==sent}}
        screenshot("messaging-writer-delivered")
        rule.runOnIdle { active=ownerModel }
        rule.waitForIdle()
        WalkthroughSupport.await(ownerModel.chatState){!it.busy&&it.accessValidated&&it.messages.any{m->m.body==sent}}
        rule.onNodeWithText(sent).assertIsDisplayed()
        screenshot("messaging-recipient-history")
        rule.onAllNodesWithContentDescription("Действия с сообщением").onLast().performClick()
        rule.onNodeWithText("Блокировать").performClick()
        rule.onNodeWithText("Подтвердить").performClick()
        WalkthroughSupport.await(ownerModel.chatState){!it.busy&&it.denied&&!it.accessValidated}
        assertTrue(ownerModel.chatState.value.messages.isEmpty())
        assertTrue(ownerModel.chatState.value.pending.isEmpty())
        try { writer.client.get("api/direct/$conversation/messages");fail("Blocked peer can still read") }
        catch(e:ApiException){assertEquals(403,e.status)}
        try { writer.client.post("api/direct/$conversation/messages",MessagingContract.payload(MessagingContract.pending("Запрет")));fail("Blocked peer can still send") }
        catch(e:ApiException){assertEquals(403,e.status)}
        assertFalse(writer.client.get("api/direct").rows("conversations").any{it.getString("id")==conversation})
        screenshot("messaging-block-revoked")
        rule.runOnIdle { writerModel.stop();ownerModel.stop() }
        } finally {owner.client.delete("api/blocks",JSONObject().put("userId",writer.details.getString("id")))}
    }
    private fun screenshot(name:String) {
        rule.waitForIdle()
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        listOf("mkdir -p /sdcard/Download/wr-community","screencap -p /sdcard/Download/wr-community/$name.png").forEach { command ->
            automation.executeShellCommand(command).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        }
    }
}
