package ru.wrcommunity.android.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** AES-GCM key remains in AndroidKeyStore; backup rules exclude all preferences. */
class EncryptedMessageStore(context:Context):MessageStore {
    private val preferences=context.applicationContext.getSharedPreferences("message_outbox",Context.MODE_PRIVATE)
    private val alias="wr-community-messages-v1"
    private fun key():SecretKey {
        val keys=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (keys.getKey(alias,null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{
            init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }
    private fun snapshot():Pair<String,Map<String,StoredMessageRoom>>? {
        val encoded=preferences.getString("sealed",null)?:return null
        return try {
            val parts=encoded.split(':');require(parts.size==2)
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)))
            cipher.updateAAD(alias.toByteArray())
            MessageStoreCodec.decode(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)).toString(Charsets.UTF_8))
        }catch(_:Exception){clearAll();null}
    }
    override fun read(owner:String):Map<String,StoredMessageRoom> {
        val stored=snapshot()?:return emptyMap()
        if(stored.first!=owner){clearAll();return emptyMap()}
        return stored.second
    }
    override fun write(owner:String,route:String,room:StoredMessageRoom) {
        val rooms=read(owner).toMutableMap()
        if(room==StoredMessageRoom())rooms.remove(route) else rooms[route]=room.copy(pending=room.pending.map{it.copy(busy=false)})
        if(rooms.isEmpty()){clearAll();return}
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,key());updateAAD(alias.toByteArray())}
        val bytes=cipher.doFinal(MessageStoreCodec.encode(owner,rooms).toByteArray(Charsets.UTF_8))
        check(preferences.edit().putString("sealed",Base64.encodeToString(cipher.iv,Base64.NO_WRAP)+":"+Base64.encodeToString(bytes,Base64.NO_WRAP)).commit()) { "Unable to persist encrypted messages" }
    }
    override fun clear(owner:String){if(snapshot()?.first==owner)clearAll()}
    override fun clearAll(){check(preferences.edit().remove("sealed").commit()){ "Unable to clear encrypted messages" }}
}
