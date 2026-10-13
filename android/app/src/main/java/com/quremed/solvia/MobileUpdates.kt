package com.quremed.solvia

import android.app.Activity
import android.app.AlertDialog
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.provider.Settings
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/** Authenticated, same-server updates; only the installed package and signer may be replaced. */
class MobileUpdates(private val activity: Activity, private val server: () -> String,
                    private val token: () -> String, private val canPrompt: () -> Boolean) {
    private val io = Executors.newSingleThreadExecutor()
    private val prefs = activity.getSharedPreferences("solvia_updates", 0)
    private var checking = false
    private var downloading = false
    private var lastCheck = 0L
    private var pendingInstall: JSONObject? = null
    private fun message(text: String) = Toast.makeText(activity, text, Toast.LENGTH_LONG).show()
    fun close() { io.shutdownNow() }
    fun check(manual: Boolean = false) {
        if(checking || downloading || token().isBlank() || server().isBlank()) return
        val now = System.currentTimeMillis()
        if(!manual && (now-lastCheck < 15*60*1000 || !canPrompt())) return
        checking = true; lastCheck = now
        val base = server(); val auth = token()
        io.execute {
            try {
                val c = connection(base, auth, "/api/mobile-update")
                val info = try { require(c.responseCode == 200) { "Сервер не надав інформацію про оновлення" }
                    val bytes = c.inputStream.use { stream ->
                        val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
                        while(out.size() <= 65536) { val n=stream.read(buffer); if(n<0) break; out.write(buffer,0,n) }
                        require(out.size() <= 65536); out.toByteArray()
                    }; JSONObject(String(bytes, Charsets.UTF_8))
                } finally { c.disconnect() }
                activity.runOnUiThread {
                    checking = false
                    if(activity.isDestroyed || server()!=base || token()!=auth) return@runOnUiThread
                    if(!available(info, activity.packageName, BuildConfig.VERSION_CODE)) {
                        if(manual) message(if(info.optBoolean("available")) "Оновлення для цього пакета відсутнє" else "Адміністратор ще не завантажив новий APK на сервер")
                        return@runOnUiThread
                    }
                    val key = "$base|${info.getInt("version_code")}"
                    if(!manual && (now-prefs.getLong(key,0) < 24*60*60*1000L || !canPrompt())) return@runOnUiThread
                    prefs.edit().putLong(key,now).apply()
                    AlertDialog.Builder(activity).setTitle("Доступне оновлення SOLVIA")
                        .setMessage("Версія ${info.getString("version_name")}\n\n${info.optString("release_notes")}\n\nДані та адреса сервера зберігаються.")
                        .setNegativeButton("Пізніше",null).setPositiveButton("Оновити") { _,_ -> download(base,auth,info) }.show()
                }
            } catch(e: Exception) { activity.runOnUiThread { checking=false; if(manual && !activity.isDestroyed) message(e.message ?: "Не вдалося перевірити оновлення") } }
        }
    }
    private fun connection(base: String, auth: String, path: String) = (URL(base+path).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects=false; connectTimeout=10000; readTimeout=30000
        setRequestProperty("Authorization","Bearer $auth"); setRequestProperty("Accept","application/json")
    }
    private fun download(base: String, auth: String, info: JSONObject) {
        if(downloading) return
        if(!canPrompt()) { message("Закрийте форму консультації перед оновленням"); return }
        downloading=true; message("Завантажуємо оновлення…")
        io.execute {
            val dir = File(activity.cacheDir,"updates").apply { mkdirs() }; val part=File(dir,"candidate.part")
            try {
                val expected=info.getLong("size_bytes"); require(expected in 1..MAX_BYTES)
                val hash=info.getString("sha256"); require(hash.matches(Regex("[a-f0-9]{64}")))
                val c=connection(base,auth,"/api/mobile-update/apk?sha=$hash")
                val digest=MessageDigest.getInstance("SHA-256"); var size=0L
                try {
                    require(c.responseCode==200) { "Не вдалося завантажити APK" }
                    c.inputStream.use { input -> part.outputStream().use { output ->
                        val buffer=ByteArray(32768)
                        while(true) { val n=input.read(buffer); if(n<0) break; size+=n; require(size<=expected && size<=MAX_BYTES) { "Некоректний розмір APK" }; digest.update(buffer,0,n); output.write(buffer,0,n) }
                    } }
                } finally { c.disconnect() }
                require(size==expected && hex(digest.digest())==hash) { "Файл оновлення пошкоджений" }
                verifyArchive(activity,part,info.getInt("version_code"))
                val apk=File(dir,"candidate.apk"); if(apk.exists()) check(apk.delete()); check(part.renameTo(apk))
                activity.runOnUiThread {
                    downloading=false
                    if(activity.isDestroyed || server()!=base || token()!=auth) return@runOnUiThread
                    pendingInstall=info; install()
                }
            } catch(e: Exception) { part.delete(); activity.runOnUiThread { downloading=false; if(!activity.isDestroyed) message(e.message ?: "Оновлення не встановлено") } }
        }
    }
    fun resume() { if(pendingInstall!=null && activity.packageManager.canRequestPackageInstalls()) install() }
    private fun install() {
        val info=pendingInstall ?: return
        if(!canPrompt()) { message("Закрийте форму консультації перед оновленням"); return }
        if(!activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${activity.packageName}"))); return
        }
        try {
            val apk=File(activity.cacheDir,"updates/candidate.apk")
            verifyArchive(activity,apk,info.getInt("version_code"))
            pendingInstall=null
            activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://${activity.packageName}.updates/update.apk"),"application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        } catch(e: Exception) { pendingInstall=null; message(e.message ?: "Android не відкрив встановлення") }
    }
    companion object {
        const val MAX_BYTES=8*1024*1024L
        fun hex(bytes: ByteArray)=bytes.joinToString("") { "%02x".format(it) }
        fun available(info: JSONObject, packageName: String, current: Int)=info.optBoolean("available") && info.optString("package_name")==packageName && info.optInt("version_code")>current
        @Suppress("DEPRECATION") private fun certificates(info: PackageInfo): Set<String> =
            (if(Build.VERSION.SDK_INT>=28) info.signingInfo?.apkContentsSigners else info.signatures)?.map { hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) }?.toSet().orEmpty()
        @Suppress("DEPRECATION") fun verifyArchive(c: android.content.Context, apk: File, code: Int) {
            val flags=if(Build.VERSION.SDK_INT>=28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            val candidate=c.packageManager.getPackageArchiveInfo(apk.absolutePath,flags) ?: throw IllegalArgumentException("Некоректний APK")
            val installed=c.packageManager.getPackageInfo(c.packageName,flags)
            val version=if(Build.VERSION.SDK_INT>=28) candidate.longVersionCode else candidate.versionCode.toLong()
            require(candidate.packageName==c.packageName && version==code.toLong() && version>BuildConfig.VERSION_CODE) { "APK не відповідає цій програмі або версії" }
            val own=certificates(installed); require(own.isNotEmpty() && own==certificates(candidate)) { "APK підписаний іншим ключем" }
        }
    }
}

/** Only the already verified private update file can be granted to Android's installer. */
class UpdateFileProvider : ContentProvider() {
    override fun onCreate()=true
    private fun file(uri: Uri): File {
        if(uri.path!="/update.apk") throw FileNotFoundException()
        return File(context!!.cacheDir,"updates/candidate.apk").also { if(!it.isFile) throw FileNotFoundException() }
    }
    override fun getType(uri: Uri)="application/vnd.android.package-archive"
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor { if(mode!="r") throw FileNotFoundException(); return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.MODE_READ_ONLY) }
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
        val apk=file(uri); return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE)).apply { addRow(arrayOf("SOLVIA-update.apk",apk.length())) }
    }
    override fun insert(uri: Uri, values: ContentValues?): Uri?=throw UnsupportedOperationException()
    override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?): Int=throw UnsupportedOperationException()
    override fun delete(uri: Uri, selection: String?, args: Array<out String>?): Int=throw UnsupportedOperationException()
}
