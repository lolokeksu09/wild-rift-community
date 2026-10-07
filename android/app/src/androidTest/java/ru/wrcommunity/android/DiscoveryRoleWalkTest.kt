package ru.wrcommunity.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.DiscoveryViewModel
import ru.wrcommunity.android.features.FeatureState
import ru.wrcommunity.android.ui.CommunityTheme
import ru.wrcommunity.android.ui.DiscoverySection
import java.io.FileInputStream

/** Production UI/ViewModels against the isolated HTTPS fixture; setup/owner decisions use API. */
class DiscoveryRoleWalkTest {
    @get:Rule val compose=createComposeRule()

    private fun ready(model:DiscoveryViewModel,predicate:(JSONObject)->Boolean):FeatureState =
        WalkthroughSupport.await(model.state){!it.busy && it.data?.let(predicate)==true}

    private suspend fun denied(user:WalkthroughSupport.User,path:String) {
        try {user.client.get(path);fail("Private chat remained available: $path")}
        catch(error:ApiException){assertEquals(403,error.status)}
    }

    private fun capture(name:String) {
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        for(command in listOf("mkdir -p /sdcard/Download/wr-community","screencap -p /sdcard/Download/wr-community/$name.png")) {
            automation.executeShellCommand(command).use { descriptor ->
                FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
            }
        }
    }

    @Test fun writerAppliesInUiOwnerAcceptsAndLeavingRevokesGroupChat():Unit=runBlocking {
        val writer=WalkthroughSupport.user("writer")
        val owner=WalkthroughSupport.user("owner")
        val outsider=WalkthroughSupport.user("outsider")
        val id=WalkthroughSupport.fixture.getString("groupId")
        val path="api/lfg/$id"
        val route="discovery/group/$id"
        val model=DiscoveryViewModel(writer.client)
        val ownerModel=DiscoveryViewModel(owner.client)
        try {
            // Read the actual initial outsider state before mounting the production UI.
            val before=writer.client.get(path)
            assertTrue(before.rows("members").isEmpty())
            denied(writer,"$path/messages");denied(outsider,"$path/messages")
            compose.setContent {CommunityTheme {DiscoverySection(model,route,{})}}
            ready(model){it.getJSONObject("group").optString("state")=="open"}
            compose.onNodeWithText("Подать заявку").performScrollTo().performClick()
            ready(model){it.getJSONObject("group").optString("membership")=="pending"}
            assertFalse(model.state.value.data!!.has("chat"))
            assertEquals("pending",writer.client.get(path).getJSONObject("group").getString("membership"))

            // Owner decision through the real production ViewModel, not a second mounted UI.
            compose.runOnIdle {ownerModel.open(route)}
            ready(ownerModel){it.rows("members").any{p->p.optString("id")==writer.details.getString("id") && p.optString("status")=="pending"}}
            compose.runOnIdle {ownerModel.action("decision",JSONObject().put("userId",writer.details.getString("id")).put("decision","accept"))}
            ready(ownerModel){it.rows("members").any{p->p.optString("id")==writer.details.getString("id") && p.optString("status")=="accepted"}}
            assertTrue(writer.client.get("$path/messages").getBoolean("canSend"))
            compose.runOnIdle {model.refresh()}
            ready(model){it.getJSONObject("group").optString("membership")=="accepted" && it.has("chat")}
            compose.onNodeWithText("Чат состава").performScrollTo().assertIsDisplayed()
            capture("08-lfg-accepted-ready")

            val text="Android role walkthrough group message"
            compose.runOnIdle {model.send(text)}
            ready(model){it.optJSONObject("chat")?.rows("messages")?.any{m->m.optString("body")==text}==true}
            assertTrue(owner.client.get("$path/messages").rows("messages").any{it.optString("body")==text})
            compose.onNodeWithText("Покинуть состав").performScrollTo().performClick()
            compose.onNodeWithText("Подтвердить").performClick()
            ready(model){it.getJSONObject("group").optString("membership")=="cancelled" && !it.has("chat")}
            denied(writer,"$path/messages")
            assertTrue(writer.client.get(path).rows("members").isEmpty())
            compose.onNodeWithText("Подать заявку").performScrollTo().assertIsDisplayed()
            capture("09-lfg-left-ready")
        }finally{compose.runOnIdle {model.reset();ownerModel.reset()}}
    }

    @Test fun writerJoinsEventInUiOwnerRemovesAndCancelledChatIsReadOnly():Unit=runBlocking {
        val writer=WalkthroughSupport.user("writer")
        val owner=WalkthroughSupport.user("owner")
        val outsider=WalkthroughSupport.user("outsider")
        val id=WalkthroughSupport.fixture.getString("eventId")
        val path="api/events/$id"
        val model=DiscoveryViewModel(writer.client)
        try {
            assertTrue(writer.client.get(path).rows("members").isEmpty())
            denied(writer,"$path/messages");denied(outsider,"$path/messages")
            compose.setContent {CommunityTheme {DiscoverySection(model,"discovery/event/$id",{})}}
            ready(model){it.getJSONObject("event").optString("state")=="open"}
            // Fixture slots are baron(owner), jungle, mid; the first free slot is jungle.
            compose.onAllNodesWithText("Занять место")[0].performScrollTo().performClick()
            ready(model){it.getJSONObject("event").nullableString("myRole")=="jungle" && it.has("chat")}
            val roster=owner.client.get(path).rows("members")
            assertTrue(roster.any{it.optString("id")==writer.details.getString("id") && it.optString("role")=="jungle"})
            compose.onNodeWithText("Чат состава").performScrollTo().assertIsDisplayed()
            capture("10-event-joined-ready")

            // Owner removal/cancellation are actual API operations; participation above was UI.
            owner.client.post("$path/remove",JSONObject().put("userId",writer.details.getString("id")))
            assertFalse(owner.client.get(path).rows("members").any{it.optString("id")==writer.details.getString("id")})
            denied(writer,"$path/messages")
            compose.runOnIdle {model.refresh()}
            ready(model){it.getJSONObject("event").nullableString("myRole")==null && !it.has("chat")}
            try {
                writer.client.post("$path/join",JSONObject().put("role","jungle"))
                fail("Excluded player rejoined")
            }catch(error:ApiException){assertEquals(403,error.status)}
            owner.client.post("$path/cancel")
            assertFalse(owner.client.get("$path/messages").getBoolean("canSend"))
            assertEquals("cancelled",owner.client.get(path).getJSONObject("event").getString("state"))
            compose.runOnIdle {model.refresh()}
            ready(model){it.getJSONObject("event").optString("state")=="cancelled" && !it.has("chat")}
            compose.onNodeWithText("Обычная · Отменено").performScrollTo().assertIsDisplayed()
            capture("11-event-removed-cancelled-ready")
        }finally{compose.runOnIdle {model.reset()}}
    }
}
