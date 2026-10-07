package ru.wrcommunity.android

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.*

class MessageStorageTest {
    @Test fun encryptedQueueSurvivesNewStoreAndSeparatesRoomsAndAccounts() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val original=EncryptedMessageStore(context)
        val pending=PendingMessage("private-client-identifier-123","Личный неподтверждённый текст",busy=true)
        try {
            original.clearAll()
            original.write("private-account", "chat/direct/private-room",StoredMessageRoom("Приватный черновик",pending=listOf(pending)))
            original.write("private-account", "chat/club/another-room",StoredMessageRoom("Черновик клуба"))
            val encoded=context.getSharedPreferences("message_outbox",0).getString("sealed",null)!!
            listOf(pending.clientId,pending.body,"private-account","private-room","Приватный черновик").forEach{assertFalse(encoded.contains(it))}
            val restored=EncryptedMessageStore(context)
            val rooms=restored.read("private-account")
            assertEquals("Приватный черновик",rooms["chat/direct/private-room"]!!.draft)
            assertEquals(pending.clientId,rooms["chat/direct/private-room"]!!.pending.single().clientId)
            assertEquals(pending.body,rooms["chat/direct/private-room"]!!.pending.single().body)
            assertFalse(rooms["chat/direct/private-room"]!!.pending.single().busy)
            assertEquals("Черновик клуба",rooms["chat/club/another-room"]!!.draft)
            restored.clear("unrelated-account");assertEquals(2,restored.read("private-account").size)
            restored.clear("private-account");assertTrue(original.read("private-account").isEmpty())
            restored.write("private-account","chat/direct/private-room",StoredMessageRoom(pending=listOf(pending)))
            assertTrue(restored.read("other-account").isEmpty());assertTrue(restored.read("private-account").isEmpty())
            context.getSharedPreferences("message_outbox",0).edit().putString("sealed","corrupted:fixture").commit()
            assertTrue(restored.read("private-account").isEmpty());assertNull(context.getSharedPreferences("message_outbox",0).getString("sealed",null))
        }finally{original.clearAll()}
    }
}
