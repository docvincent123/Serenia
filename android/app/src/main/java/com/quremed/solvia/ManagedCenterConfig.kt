package com.quremed.solvia

import android.content.Context
import android.content.RestrictionsManager
import java.net.URI
import java.util.Locale

/** Non-secret center identity injected by an Android Enterprise management policy.
 * The clinical cache and employee login are never included in managed settings.
 */
data class ManagedCenterProfile(val httpsUrl: String, val serverId: String)

object ManagedCenterConfig {
    const val URL_KEY = "solvia_https_url"
    const val ID_KEY = "solvia_server_id"
    private val hexIdentity = Regex("^[a-f0-9]{64}$")

    fun validate(rawUrl: String, rawId: String): ManagedCenterProfile {
        val url = URI(rawUrl.trim())
        require(url.scheme?.lowercase(Locale.ROOT) == "https") { "Для корпоративного підключення потрібен HTTPS" }
        require(url.host != null && url.userInfo == null && url.rawQuery == null && url.rawFragment == null) {
            "Невірна адреса сервера в корпоративній політиці"
        }
        require(url.rawPath.isNullOrEmpty() || url.rawPath == "/") {
            "Вкажіть лише HTTPS адресу сервера, без шляху"
        }
        require(url.port == -1 || url.port in 1..65535) { "Неправильний порт сервера" }
        require(hexIdentity.matches(rawId)) { "Некоректний server_id у корпоративній політиці" }
        val normalized = URI("https", null, url.host.lowercase(Locale.ROOT),
            if (url.port == -1) 443 else url.port, null, null, null).toString()
        return ManagedCenterProfile(normalized, rawId)
    }

    /** An EMM or work-profile controller holds these settings outside the app's
     * normal private storage, so it can apply them again after reinstall.
     */
    fun read(context: Context): ManagedCenterProfile? {
        val manager = context.getSystemService(Context.RESTRICTIONS_SERVICE) as? RestrictionsManager ?: return null
        val restrictions = manager.applicationRestrictions ?: return null
        val endpoint = restrictions.getString(URL_KEY, "").trim()
        val serverId = restrictions.getString(ID_KEY, "").trim()
        if (endpoint.isBlank() && serverId.isBlank()) return null
        return validate(endpoint, serverId)
    }
}
