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
    fun read(patient: Long): JSONObject? = synchronized(lock) {
        val stored = prefs.getString("$scope|$patient", null) ?: return null
        val envelope = JSONObject(stored)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)))
        cipher.updateAAD("$scope|$patient".toByteArray())
        return JSONObject(String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), Charsets.UTF_8))
    }
    fun save(patient: Long, value: JSONObject) = synchronized(lock) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD("$scope|$patient".toByteArray())
        val envelope = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(value.toString().toByteArray()), Base64.NO_WRAP))
        check(prefs.edit().putString("$scope|$patient", envelope.toString()).commit()) { "Не вдалося зберегти локальну чернетку" }
    }
    fun patients(): List<Long> = synchronized(lock) { prefs.all.keys.filter { it.startsWith("$scope|") }.mapNotNull { it.substringAfter('|').toLongOrNull() } }
    fun remove(patient: Long) = synchronized(lock) { check(prefs.edit().remove("$scope|$patient").commit()) }
    fun saveEditing(patient: Long, value: JSONObject): JSONObject = synchronized(lock) {
        val current = read(patient)
        if(current?.optString("client_key") == value.optString("client_key")) {
            for(key in listOf("server_version", "synced_hash", "sync_error", "sync_blocked", "attempt_hash"))
                if(current.has(key)) value.put(key, current.get(key))
        }
        save(patient, value); value
    }
    fun acknowledge(patient: Long, clientKey: String, hash: String, revision: Int) = synchronized(lock) {
        val current = read(patient)
        if(current != null && current.optString("client_key") == clientKey) {
            current.put("server_version", revision).put("synced_hash", hash).remove("sync_error")
            current.remove("sync_blocked"); current.remove("attempt_hash"); save(patient, current)
        }
    }
    fun prepareTransfer(patient: Long, clientKey: String, hash: String) = synchronized(lock) {
        val current = read(patient)
        if(current != null && current.optString("client_key") == clientKey) save(patient, current.put("attempt_hash", hash))
    }
    fun transferError(patient: Long, clientKey: String, message: String, blocked: Boolean) = synchronized(lock) {
        val current = read(patient)
        if(current != null && current.optString("client_key") == clientKey)
            save(patient, current.put("sync_error", message).put("sync_blocked", blocked))
    }
    fun removeRecovered(patient: Long, source: JSONObject): Boolean = synchronized(lock) {
        val current = read(patient) ?: return@synchronized false
        if(current.optString("client_key") != source.optString("client_key") ||
            current.optLong("appointment_id") != source.optLong("appointment_id")) return@synchronized false
        if(DraftSync.fingerprint(current) != DraftSync.fingerprint(source)) {
            save(patient,current.put("sync_blocked",true).put("sync_error",
                "Цю консультацію вже проведено на сервері. Нові локальні правки збережені: звірте їх з історією й додайте уточнення."))
            return@synchronized false
        }
        remove(patient); true
    }
    companion object { private val lock = Any() }

}
