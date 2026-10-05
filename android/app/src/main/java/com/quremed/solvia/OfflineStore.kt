package com.quremed.solvia

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Atomic encrypted account/server journal. No clinical text or session tokens in plaintext. */
class OfflineStore(context: Context, server: String, userId: Long) {
    private val prefs = context.getSharedPreferences("solvia_offline_v1", Context.MODE_PRIVATE)
    private val scope = MessageDigest.getInstance("SHA-256").digest("$server|$userId".toByteArray()).joinToString("") { "%02x".format(it) }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "solvia-offline-$scope"
        if (!store.containsAlias(alias)) KeyGenerator.getInstance("AES", "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
            generateKey()
        }
        return store.getKey(alias, null) as SecretKey
    }
    private fun read(name: String): JSONObject? {
        val data = prefs.getString("$scope|$name", null) ?: return null
        val box = JSONObject(data); val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(box.getString("iv"), Base64.NO_WRAP)))
        cipher.updateAAD("$scope|$name".toByteArray())
        return JSONObject(String(cipher.doFinal(Base64.decode(box.getString("data"), Base64.NO_WRAP)), Charsets.UTF_8))
    }
    private fun write(name: String, value: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD("$scope|$name".toByteArray())
        val box = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(value.toString().toByteArray()), Base64.NO_WRAP))
        check(prefs.edit().putString("$scope|$name", box.toString()).commit()) { "Не вдалося зберегти дані на телефоні" }
    }
    fun saveCache(path: String, value: Any, now: Long = System.currentTimeMillis()) = synchronized(lock) {
        write("cache:$path", JSONObject().put("time", now).put("value", value))
    }
    fun cache(path: String, now: Long = System.currentTimeMillis()): Any? = synchronized(lock) {
        val box = read("cache:$path") ?: return@synchronized null
        if (now - box.getLong("time") !in 0..CACHE_TTL) return@synchronized null
        box.get("value")
    }
    fun cacheTime(path: String): Long = synchronized(lock) { read("cache:$path")?.optLong("time") ?: 0 }
    fun forgetCache(path: String) = synchronized(lock) { check(prefs.edit().remove("$scope|cache:$path").commit()) }
    fun saveSession(user: JSONObject, token: String, now: Long = System.currentTimeMillis()) = synchronized(lock) {
        write("session", JSONObject().put("user", user).put("token", token).put("expires", now + SESSION_TTL))
    }
    fun session(now: Long = System.currentTimeMillis()): JSONObject? = synchronized(lock) {
        read("session")?.takeIf { it.optLong("expires") > now && it.optLong("expires") <= now + SESSION_TTL }
    }
    fun revokeSession() = synchronized(lock) { check(prefs.edit().remove("$scope|session").commit()) }
    fun queue(): JSONArray = synchronized(lock) { read("queue")?.optJSONArray("items") ?: JSONArray() }
    fun enqueue(payload: JSONObject, patientName: String) = synchronized(lock) {
        require(payload.getString("client_key").isNotBlank())
        val rows = queue(); val key = payload.getString("client_key")
        for(i in 0 until rows.length()) if(rows.getJSONObject(i).getJSONObject("payload").getString("client_key") == key) {
            check(rows.getJSONObject(i).getJSONObject("payload").toString() == payload.toString()) { "Запис уже в черзі. Перевірте синхронізацію." }
            return@synchronized
        }
        rows.put(JSONObject().put("payload", JSONObject(payload.toString())).put("patient_name", patientName)
            .put("state", "pending").put("queued_at", System.currentTimeMillis()).put("error", ""))
        write("queue", JSONObject().put("items", rows))
    }
    fun mark(key: String, state: String, error: String = "", serverId: Long = 0) = synchronized(lock) {
        val rows = queue()
        for(i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            if(row.getJSONObject("payload").getString("client_key") == key) {
                row.put("state", state).put("error", error).put("server_id", serverId)
                if(state == "sent") row.put("sent_at", System.currentTimeMillis())
            }
        }
        write("queue", JSONObject().put("items", rows))
    }
    fun pendingFor(patientId: Long): JSONObject? = synchronized(lock) {
        val rows = queue()
        (0 until rows.length()).map { rows.getJSONObject(it) }.firstOrNull {
            it.getJSONObject("payload").optLong("patient_id") == patientId && it.optString("state") in listOf("pending", "blocked")
        }
    }
    companion object {
        private val lock = Any()
        const val SESSION_TTL = 12 * 60 * 60 * 1000L
        const val CACHE_TTL = 7 * 24 * 60 * 60 * 1000L
        fun cacheable(path: String) = path == "/api/shift-day" || path == "/api/settings/center" ||
            path.startsWith("/api/appointments?") || path == "/api/patients" || path.startsWith("/api/patients?") ||
            path.matches(Regex("/api/patients/[0-9]+(?:/(?:documents|courses|referrals))?"))
    }
}

class SyncFailure(val status: Int, message: String) : Exception(message)

/** A lost response retries the same immutable payload/key; only an acknowledged response marks sent. */
class ConsultationSync(private val store: OfflineStore, private val send: (JSONObject) -> JSONObject) {
    fun run(): Boolean = synchronized(syncLock) {
        val rows = store.queue()
        for(i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            if(row.optString("state") != "pending") continue
            val payload = row.getJSONObject("payload"); val key = payload.getString("client_key")
            try {
                val result = send(JSONObject(payload.toString()))
                store.mark(key, "sent", serverId = result.getLong("id"))
            } catch(error: SyncFailure) {
                if(error.status == 401) return@synchronized false
                if(error.status in 400..499 && error.status != 408 && error.status != 429) store.mark(key, "blocked", error.message ?: "Сервер відхилив запис")
                else { store.mark(key, "pending", error.message ?: "Спробуємо пізніше"); return@synchronized true }
            } catch(error: Exception) {
                store.mark(key, "pending", error.message ?: "Немає зв’язку із сервером"); return@synchronized true
            }
        }
        true
    }
    companion object { private val syncLock = Any() }
}
