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
import ru.wrcommunity.android.features.ModerationViewModel
import ru.wrcommunity.android.ui.ModerationSection
import ru.wrcommunity.android.ui.CommunityTheme
import java.util.UUID

/** API prepares isolated evidence; production Compose forms perform both reviews and appeal. */
class ModerationRoleWalkTest {
    @get:Rule val rule=createComposeRule()
    @Test fun reportDecisionAppealRequiresAnotherIndependentReviewer():Unit=runBlocking {
        val writer=WalkthroughSupport.user("writer")
        val owner=WalkthroughSupport.user("owner")
        val first=WalkthroughSupport.user("moderator")
        val second=WalkthroughSupport.user("moderator2")
        val outsider=WalkthroughSupport.user("outsider")
        val club=WalkthroughSupport.fixture.getString("clubId")
        val evidence="Снимок жалобы ${UUID.randomUUID()}"
        val message=writer.client.post("api/clubs/$club/messages",MessagingContract.payload(MessagingContract.pending(evidence))).getJSONObject("message").getLong("id")
        val id=owner.client.post("api/reports",ModerationRepository.reportBody("club",message.toString(),"Проверить материал и обстоятельства")).getLong("id").toString()
        val route="moderation/item/$id"
        val firstModel=ModerationViewModel(first.client)
        val ownerModel=ModerationViewModel(owner.client)
        val secondModel=ModerationViewModel(second.client)
        var active by mutableStateOf(firstModel)
        rule.setContent { CommunityTheme { key(active.userId) { ModerationSection(active,route,{}) } } }
        WalkthroughSupport.await(firstModel.state){!it.busy&&it.data?.rows("reports")?.any{r->r.optString("id")==id&&r.optString("status")=="pending"}==true}
        rule.onNodeWithText(evidence).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Объяснение для заявителя").performScrollTo().performTextInput("Первое независимое решение")
        rule.onNodeWithText("Сохранить решение").performScrollTo().performClick()
        rule.onNodeWithText("Подтвердить").performClick()
        WalkthroughSupport.await(firstModel.state){!it.busy&&it.data?.rows("reports")?.any{r->r.optString("id")==id&&r.optString("status")=="upheld"}==true}
        screenshot("moderation-first-decision")
        rule.runOnIdle { active=ownerModel }
        rule.waitForIdle()
        WalkthroughSupport.await(ownerModel.state){!it.busy&&it.data?.rows("reports")?.any{r->r.optString("id")==id&&r.optString("status")=="upheld"}==true}
        rule.onNodeWithText("Обоснование пересмотра").performScrollTo().performTextInput("Прошу пересмотреть контекст сообщения")
        rule.onNodeWithText("Подать апелляцию").performScrollTo().performClick()
        WalkthroughSupport.await(ownerModel.state){!it.busy&&it.data?.rows("reports")?.any{r->r.optString("id")==id&&r.optString("appeal_status")=="pending"}==true}
        try { first.client.post("api/moderation/reports/$id/appeal-decision",JSONObject().put("decision","dismissed").put("note","Повтор первого модератора"));fail("First moderator reviewed their own decision") }
        catch(e:ApiException){assertEquals(403,e.status)}
        try { outsider.client.get("api/moderation/reports");fail("Outsider read moderator snapshots") }
        catch(e:ApiException){assertEquals(403,e.status)}
        assertFalse(outsider.client.get("api/reports").rows("reports").any{it.optString("id")==id})
        rule.runOnIdle { active=secondModel }
        rule.waitForIdle()
        WalkthroughSupport.await(secondModel.state){!it.busy&&it.data?.rows("reports")?.any{r->r.optString("id")==id&&r.optString("appeal_status")=="pending"}==true}
        rule.onNodeWithText("Нарушение не подтверждено").performScrollTo().performClick()
        rule.onNodeWithText("Объяснение для заявителя").performScrollTo().performTextInput("Независимый пересмотр отменил нарушение")
        rule.onNodeWithText("Завершить пересмотр").performScrollTo().performClick()
        rule.onNodeWithText("Подтвердить").performClick()
        WalkthroughSupport.await(secondModel.state){!it.busy&&it.data?.rows("reports")?.any{r->r.optString("id")==id&&r.optString("appeal_status")=="dismissed"}==true}
        rule.runOnIdle { active=ownerModel }
        rule.waitForIdle()
        WalkthroughSupport.await(ownerModel.state){!it.busy&&it.data?.rows("reports")?.any{r->r.optString("id")==id&&r.optString("appeal_status")=="dismissed"}==true}
        rule.onNodeWithText("Независимый пересмотр отменил нарушение").performScrollTo().assertIsDisplayed()
        screenshot("moderation-independent-appeal")
        val result=owner.client.get("api/reports").rows("reports").single{it.optString("id")==id}
        assertEquals("dismissed",result.getString("appeal_status"))
        assertNull(result.nullableString("applied_action"))
        assertTrue(writer.client.get("api/clubs/$club/messages").rows("messages").any{it.getLong("id")==message})
    }
    private fun screenshot(name:String) {
        rule.waitForIdle()
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        listOf("mkdir -p /sdcard/Download/wr-community","screencap -p /sdcard/Download/wr-community/$name.png").forEach { command ->
            automation.executeShellCommand(command).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        }
    }
}
