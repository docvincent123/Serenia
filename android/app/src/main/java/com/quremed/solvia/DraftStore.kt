package com.quremed.solvia

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Account/server-scoped encrypted data; non-exportable AES key lives in Android Keystore. */
class DraftStore(context: Context, server: String, userId: Long) {
    private val prefs = context.getSharedPreferences("solvia_encrypted_drafts", Context.MODE_PRIVATE)
    private val scope = MessageDigest.getInstance("SHA-256").digest("$server|$userId".toByteArray()).joinToString("") { "%02x".format(it) }
    private val alias = "solvia-draft-$scope"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(alias)) {
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
                generateKey()
            }
        }
        return store.getKey(alias, null) as SecretKey
    }
    fun read(patient: Long): JSONObject? {
        val stored = prefs.getString("$scope|$patient", null) ?: return null
        val envelope = JSONObject(stored)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)))
        cipher.updateAAD("$scope|$patient".toByteArray())
        return JSONObject(String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), Charsets.UTF_8))
    }
    fun save(patient: Long, value: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD("$scope|$patient".toByteArray())
        val envelope = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(value.toString().toByteArray()), Base64.NO_WRAP))
        check(prefs.edit().putString("$scope|$patient", envelope.toString()).commit()) { "Не вдалося зберегти локальну чернетку" }
    }
    fun remove(patient: Long) { check(prefs.edit().remove("$scope|$patient").commit()) }
}
