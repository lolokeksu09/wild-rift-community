package ru.wrcommunity.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test

class NativeNavigationTest {
    @get:Rule val rule=createAndroidComposeRule<MainActivity>()
    @Test fun nativeSectionsAreReachableAndRulesReturnToMenu(){
        rule.onNodeWithTag("welcome-explore").performClick()
        rule.waitUntil(45_000){rule.onAllNodesWithContentDescription("Все разделы").fetchSemanticsNodes().isNotEmpty()}
        rule.onNodeWithContentDescription("Все разделы").performClick()
        rule.onNodeWithTag("native-menu").performScrollToNode(hasText("Игровые вечера"))
        rule.onNodeWithText("Игровые вечера").assertIsDisplayed()
        rule.onNodeWithTag("native-menu").performScrollToNode(hasText("Мои жалобы и обжалования"))
        rule.onNodeWithText("Мои жалобы и обжалования").assertIsDisplayed()
        rule.onNodeWithTag("native-menu").performScrollToNode(hasText("Правила сообщества"))
        rule.onNodeWithText("Правила сообщества").performClick()
        rule.waitUntil(10_000){rule.onAllNodesWithText("Уважай свою компанию").fetchSemanticsNodes().isNotEmpty()}
        rule.onNodeWithText("Уважай свою компанию").assertIsDisplayed()
        rule.onNodeWithContentDescription("Назад").performClick()
        rule.onNodeWithTag("native-menu").assertExists()
    }
}
