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

/** Called on IO threads. Passwords, CSRF and user data never enter this store. */
class EncryptedSessionStore(context: Context): SessionStore {
    private val preferences=context.applicationContext.getSharedPreferences("account_session",Context.MODE_PRIVATE)
    private val alias="wr-community-session-v1"
    private fun key(): SecretKey {
        val keys=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (keys.getKey(alias,null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }
    override fun read(): String? {
        val encoded=preferences.getString("sealed",null) ?: return null
        return try {
            val parts=encoded.split(':'); require(parts.size==2)
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)))
            cipher.updateAAD(alias.toByteArray())
            cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)).toString(Charsets.UTF_8)
        } catch(_:Exception) { write(null); null }
    }
    override fun write(value: String?) {
        val editor=preferences.edit()
        if(value==null) editor.remove("sealed") else {
            val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE,key());updateAAD(alias.toByteArray()) }
            val bytes=cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            editor.putString("sealed",Base64.encodeToString(cipher.iv,Base64.NO_WRAP)+":"+Base64.encodeToString(bytes,Base64.NO_WRAP))
        }
        check(editor.commit()) { "Unable to persist the encrypted session" }
    }
}
