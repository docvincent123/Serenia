package com.quremed.solvia

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Build
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ImageView
import android.widget.ScrollView
import android.widget.Space
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.time.LocalDate
import java.util.concurrent.Executors

private class ApiError(val status: Int, message: String) : Exception(message)

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("solvia_settings", MODE_PRIVATE) }
    private val io = Executors.newSingleThreadExecutor()
    private val cacheIo = Executors.newSingleThreadExecutor()
    private var cachePreparing = false
    private val openConfigRequest = 4101

    private val bg = MobileUi.background
    private val ink = Color.rgb(25, 48, 62)
    private val muted = Color.rgb(104, 124, 137)
    private val forest = Color.rgb(16, 111, 117)
    private val forestDark = Color.rgb(13, 83, 91)
    private val forestSoft = Color.rgb(224, 240, 243)
    private val line = Color.rgb(213, 226, 232)

    private var server = ""
    private var token = ""
    private var role = ""
    private var userName = ""
    private var userId = 0L
    private var consultationWindow: AlertDialog? = null
    private var backAction: (() -> Unit)? = null
    private var workspaceReady = false
    private var selectedNavigation = "home"
    private var sceneEpoch = 0L
    private var pdfPreview: NativePdfPreview? = null
    private var pendingPdf: java.io.File? = null
    private val exportPdfRequest = 4102
    private val offlineUnlockRequest = 4103
    private var pendingOfflineSession: JSONObject? = null
    private var offlineMode = false
    private var syncRunning = false
    private var statusView: TextView? = null
    private var lastCacheTime = 0L
    private val syncHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val syncTick = object : Runnable {
        override fun run() { syncNow(); syncHandler.postDelayed(this, 60000) }
    }
    private var networkCallback: android.net.ConnectivityManager.NetworkCallback? = null
    private fun offlineStore() = OfflineStore(this, server, userId)
    override fun onResume() { super.onResume(); syncHandler.removeCallbacks(syncTick); syncHandler.post(syncTick) }
    override fun onPause() { syncHandler.removeCallbacks(syncTick); super.onPause() }
    override fun onDestroy() {
        syncHandler.removeCallbacks(syncTick)
        networkCallback?.let { runCatching { (getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).unregisterNetworkCallback(it) } }
        consultationWindow?.dismiss(); consultationWindow = null
        pdfPreview?.close(); pdfPreview = null
        io.shutdown(); cacheIo.shutdown(); super.onDestroy()
    }
    private fun unavailable(error: Exception) = error is java.io.IOException && error !is javax.net.ssl.SSLException
    private fun updateConnectionStatus() {
        if(token.isBlank()) return
        val count = runCatching { val q = offlineStore().queue(); (0 until q.length()).count { q.getJSONObject(it).optString("state") in listOf("pending", "blocked") } }.getOrDefault(0)
        statusView?.text = (if(offlineMode) "Офлайн · копія " + if(lastCacheTime > 0) java.text.SimpleDateFormat("dd.MM HH:mm", java.util.Locale.getDefault()).format(java.util.Date(lastCacheTime)) else "на телефоні" else "Онлайн") +
            (if(count > 0) " · у черзі: $count" else "") + (if(cachePreparing) " · завантаження карток…" else "")
    }
    private fun syncNow(refresh: Boolean = false) {
        if(token.isBlank() || role != "psychologist" || syncRunning || isDestroyed) return
        syncRunning = true
        val base = server; val sessionToken = token; val uid = userId
        val store = OfflineStore(this, base, uid)
        io.execute {
            var authExpired = false
            var connected = false
            try {
                val shift = requestAt(base, "GET", "/api/shift-day", authToken = sessionToken)
                connected = true; store.saveCache("/api/shift-day", shift)
                val authorized = ConsultationSync(store) { payload ->
                    try { requestAt(base, "POST", "/api/consultations", payload, sessionToken) as JSONObject }
                    catch(e: ApiError) { throw SyncFailure(e.status, e.message ?: "Помилка сервера") }
                }.run()
                authExpired = !authorized
                if(authorized && refresh) runOnUiThread { prepareOfflineCache(base, sessionToken, store) }
            } catch(e: ApiError) { authExpired = e.status == 401 }
            catch(_: Exception) { }
            runOnUiThread {
                syncRunning = false
                if(token != sessionToken || server != base || isDestroyed) return@runOnUiThread
                offlineMode = !connected; updateConnectionStatus()
                if(authExpired) { store.revokeSession(); logout() }
                else if(refresh) syncScreen()
            }
        }
    }
    private fun prepareOfflineCache(base: String, auth: String, store: OfflineStore) {
        if(cachePreparing) return
        cachePreparing = true; updateConnectionStatus()
        cacheIo.execute {
            var message = "Офлайн-копії оновлено"
            var denied = false
            try { warmCache(base, auth, store) }
            catch(e: Exception) { denied = e is ApiError && e.status == 401; message = "Завантаження перервано. Уже завантажені копії збережено." }
            runOnUiThread {
                cachePreparing = false
                if(token == auth && server == base && !isDestroyed) {
                    updateConnectionStatus()
                    if(denied) logout() else Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                }
            }
        }
    }
    private fun warmCache(base: String, auth: String, store: OfflineStore) {
        val paths = mutableListOf("/api/patients", "/api/patients?status=active", "/api/patients?status=completed", "/api/patients?status=archived", "/api/settings/center")
        for(day in 0..7) paths.add("/api/appointments?date=" + LocalDate.now().plusDays(day.toLong()))
        for(path in paths) {
            try {
                val result = requestAt(base, "GET", path, authToken = auth); store.saveCache(path, result)
                if(path == "/api/patients") {
                    val patients = result as JSONArray
                    for(i in 0 until patients.length()) {
                        val id = patients.getJSONObject(i).getLong("id")
                        for(suffix in listOf("", "/documents", "/courses", "/referrals")) {
                            val detailPath = "/api/patients/$id$suffix"
                            try { store.saveCache(detailPath, requestAt(base, "GET", detailPath, authToken = auth)) }
                            catch(e: ApiError) { if(e.status == 401) throw e; store.forgetCache(detailPath) }
                        }
                    }
                }
            } catch(e: ApiError) { if(e.status == 401) throw e; store.forgetCache(path) }
        }
    }
    private fun syncScreen() {
        backAction = { moreScreen() }; val body = root(); body.addView(topBar("Синхронізація", ::moreScreen))
        body.addView(caption("Завершені записи зберігаються зашифрованими. Передавання запускається при поверненні мережі. Android також повторює спроби у фоні та після перезавантаження телефона. Якщо сесія закінчилася, увійдіть знову — черга збережеться."))
        body.addView(primary("Синхронізувати й оновити офлайн-копії") { syncNow(refresh = true) })
        val rows = runCatching { offlineStore().queue() }.getOrElse { showError("Не вдалося прочитати чергу. Дані не видалені."); JSONArray() }
        if(rows.length() == 0) body.addView(caption("Черга порожня"))
        for(i in rows.length()-1 downTo 0) {
            val row = rows.getJSONObject(i); val payload = row.getJSONObject("payload"); val state = row.optString("state")
            val item = card(); item.addView(title(row.optString("patient_name"), 18f))
            item.addView(caption(when(state) { "sent" -> "Передано на сервер · №${row.optLong("server_id")}"; "blocked" -> "Потрібна перевірка · ${row.optString("error")}"; "reviewed" -> "Відновлено як чернетку для виправлення"; else -> "Збережено на телефоні · очікує передавання" }))
            item.addView(secondary("Переглянути збережений запис") {
                AlertDialog.Builder(this).setTitle(row.optString("patient_name")).setMessage(
                    listOf("note" to "Нотатка", "request_text" to "Запит", "state_text" to "Стан", "work_done" to "Проведена робота", "goals" to "Цілі", "result_text" to "Результат", "next_plan" to "Подальший план", "homework" to "Домашнє завдання", "recommendations" to "Рекомендації").joinToString("\n\n") { (key, label) -> label + ": " + payload.optString(key) }
                ).setPositiveButton("Закрити", null).show()
            })
            if(state == "blocked") item.addView(secondary("Повторити після перевірки на сервері") {
                offlineStore().mark(payload.getString("client_key"), "pending"); syncNow(refresh = true)
            })
            if(state == "blocked") item.addView(secondary("Відновити текст як чернетку") {
                AlertDialog.Builder(this).setTitle("Відновити для виправлення?")
                    .setMessage("Перевірте історію пацієнта, щоб не створити повторну консультацію. Поточна чернетка цього пацієнта, якщо є, буде замінена збереженим текстом.")
                    .setNegativeButton("Скасувати", null).setPositiveButton("Відновити") { _, _ ->
                        val restored = JSONObject(payload.toString()).put("client_key", java.util.UUID.randomUUID().toString())
                        restored.remove("draft_version"); restored.put("server_version", 0)
                        DraftStore(this, server, userId).save(payload.getLong("patient_id"), restored)
                        offlineStore().mark(payload.getString("client_key"), "reviewed")
                        consultationDialog(payload.getLong("patient_id"), row.optString("patient_name"))
                    }.show()
            })
            body.addView(item); body.addView(spacer())
        }
        mount(scroll(body))
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        java.io.File(cacheDir, "documents").deleteRecursively()
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        if (prefs.getBoolean("keep_screen_on", false)) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        server = prefs.getString("server", "") ?: ""
        if (server.isNotBlank()) {
            try {
                server = normalize(server)
            } catch (_: Exception) {
                server = ""
                prefs.edit().remove("server").apply()
                Toast.makeText(this, "Збережена адреса сервера більше не відповідає політиці SOLVIA. Підключіть сервер повторно.", Toast.LENGTH_LONG).show()
            }
        }
        if (Build.VERSION.SDK_INT >= 33) onBackInvokedDispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT) {
            if(backAction != null) backAction?.invoke() else if(token.isNotBlank()) moreScreen() else finish()
        }
        val connectivity = getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        networkCallback = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) { runOnUiThread { syncNow() } }
        }
        connectivity.registerNetworkCallback(android.net.NetworkRequest.Builder().build(), networkCallback!!)
        if (intent?.data != null) {
            importServerConfig(intent.data!!)
        } else if (server.isBlank()) setupScreen() else loginScreen()
    }

    private fun mount(content: View) {
        sceneEpoch++
        pdfPreview?.close(); pdfPreview = null
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            fitsSystemWindows = true
        }
        shell.setOnApplyWindowInsetsListener { view, insets ->
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
        statusView = null
        if(token.isNotBlank() && workspaceReady) {
            statusView = caption("").apply { setPadding(dp(16), dp(6), dp(16), dp(6)); setOnClickListener { syncScreen() } }
            shell.addView(statusView); updateConnectionStatus()
        }
        shell.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        if (token.isNotBlank() && workspaceReady) {
            val bar = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
                setBackgroundColor(Color.WHITE); elevation = dp(6).toFloat()
            }
            val links = listOf(Triple("home", "Головна", R.drawable.ic_home), Triple("calendar", "Розклад", R.drawable.ic_calendar),
                Triple("patients", "Пацієнти", R.drawable.ic_patients), Triple("more", "Меню", R.drawable.ic_menu))
            links.forEach { (key, label, icon) ->
                bar.addView(Button(this).apply {
                    text = label; isAllCaps = false; textSize = 11f; contentDescription = label
                    setTextColor(if (selectedNavigation == key) forest else muted)
                    backgroundTintList = null; stateListAnimator = null; elevation = 0f
                    background = rounded(if (selectedNavigation == key) forestSoft else Color.WHITE, 18)
                    val drawable = getDrawable(icon)?.mutate()
                    drawable?.setTint(if(selectedNavigation == key) forest else muted)
                    drawable?.setBounds(0, 0, dp(22), dp(22)); setCompoundDrawables(null, drawable, null, null)
                    setPadding(dp(3), dp(8), dp(3), dp(5)); minWidth = 0; minimumWidth = 0
                    setOnClickListener {
                        val navigate = { when(key) {
                            "home" -> homeScreen(); "calendar" -> calendarScreen(); "patients" -> patientsScreen()
                            else -> moreScreen()
                        } }
                        val child = if(content is ScrollView && content.childCount > 0) content.getChildAt(0) else content
                        if(child.tag == "unsaved_form") AlertDialog.Builder(this@MainActivity).setTitle("Залишити форму?")
                            .setMessage("Незбережені зміни буде втрачено.").setNegativeButton("Продовжити", null)
                            .setPositiveButton("Залишити") { _, _ -> navigate() }.show()
                        else navigate()
                    }
                }, LinearLayout.LayoutParams(0, dp(68), 1f))
            }
            shell.addView(bar)
        }
        setContentView(shell)
    }

    private fun mobileApi(): MobileApi = object : MobileApi {
        override fun call(method: String, path: String, body: JSONObject?, success: (Any) -> Unit, failure: (String) -> Unit) {
            apiAsync(method, path, body, onError = failure) { result ->
                if(method == "GET" && path.matches(Regex("/api/patients/[0-9]+")) && result is JSONObject) {
                    val patient = JSONObject(result.toString())
                    val history = patient.optJSONArray("consultations") ?: JSONArray()
                    val queue = offlineStore().queue()
                    for(i in queue.length()-1 downTo 0) {
                        val row = queue.getJSONObject(i); val payload = row.getJSONObject("payload")
                        if(payload.optLong("patient_id") != patient.optLong("id") || row.optString("state") == "reviewed") continue
                        val serverId = row.optLong("server_id")
                        if((0 until history.length()).any { history.getJSONObject(it).optString("client_key") == payload.optString("client_key") || (serverId > 0 && history.getJSONObject(it).optLong("id") == serverId) }) continue
                        val local = JSONObject(payload.toString()).put("created", payload.optString("consult_date"))
                            .put("psychologist", userName).put("sync_status", when(row.optString("state")) {
                                "sent" -> "Передано на сервер"; "blocked" -> "Не передано: " + row.optString("error"); else -> "Збережено на телефоні · очікує передавання"
                            })
                        history.put(local)
                    }
                    patient.put("consultations", history); success(patient)
                } else success(result)
            }
        }
    }

    private fun moreScreen() {
        selectedNavigation = "more"; backAction = { homeScreen() }
        val body = root(); body.addView(title("Мій кабінет", 28f)); body.addView(caption(userName))
        val work = card(); work.addView(title("Робота", 18f)); body.addView(work)
        val personal = card(); personal.addView(title("Особисте", 18f))
        work.addView(secondary("Документи пацієнтів") { patientsScreen(documentLibrary = true) })
        work.addView(secondary("Мої чернетки") { draftsScreen() })
        work.addView(secondary("Синхронізація та офлайн-доступ") { syncScreen() })
        work.addView(secondary("Звіт за зміну") { reportScreen() })
        work.addView(secondary("Мої супервізії") { supervisionsScreen() })
        personal.addView(secondary("Мої налаштування") { settingsScreen() }); body.addView(personal)
        body.addView(caption("SOLVIA ${BuildConfig.VERSION_NAME}"))
        body.addView(secondary("Вийти") {
            AlertDialog.Builder(this).setTitle("Вийти з облікового запису?")
                .setMessage("Зашифровані чернетки залишаться для наступного входу цього психолога.")
                .setNegativeButton("Залишитися", null).setPositiveButton("Вийти") { _, _ -> logout() }.show()
        }); mount(scroll(body))
    }

    private fun draftsScreen() {
        backAction = { moreScreen() }; val body = root(); body.addView(topBar("Чернетки", ::moreScreen))
        body.addView(caption("Локальні зашифровані чернетки цього облікового запису та сервера.")); mount(scroll(body))
        apiAsync("GET", "/api/patients") { result ->
            val patients = result as JSONArray; val store = DraftStore(this, server, userId); var count = 0
            for (i in 0 until patients.length()) {
                val p = patients.getJSONObject(i); val id = p.getLong("id")
                try {
                    val draft = store.read(id) ?: continue; count++
                    val row = card(); row.addView(title(p.optString("name"), 18f))
                    row.addView(caption("Чернетка від ${draft.optString("consult_date")}"))
                    row.addView(secondary("Продовжити консультацію") { consultationDialog(id, p.optString("name")) })
                    body.addView(row); body.addView(spacer())
                } catch (_: Exception) { body.addView(caption("Не вдалося прочитати чернетку №$id. Вона не видалена.")) }
            }
            if (count == 0) body.addView(caption("Збережених локальних чернеток поки немає."))
        }
    }

    private fun previewDocument(document: NativeDocument, back: () -> Unit) {
        val session = token; val epoch = sceneEpoch
        Toast.makeText(this, "Готуємо PDF…", Toast.LENGTH_SHORT).show()
        io.execute {
            try {
                val file = NativePdf.create(this, document)
                runOnUiThread {
                    if (isDestroyed || token != session || sceneEpoch != epoch) { file.delete(); return@runOnUiThread }
                    val viewer = NativePdfPreview(this, file) { exportPdf(it) }
                    val body = root(); body.addView(topBar(document.title, back)); body.addView(viewer.view(document.title))
                    backAction = back; mount(scroll(body)); pdfPreview = viewer
                }
            } catch (error: Exception) { runOnUiThread { if(token == session && sceneEpoch == epoch) showError(error.message ?: "Не вдалося сформувати PDF") } }
        }
    }

    private fun exportPdf(file: java.io.File) {
        pendingPdf = file
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "application/pdf"; putExtra(Intent.EXTRA_TITLE, "SOLVIA-document.pdf")
        }, exportPdfRequest)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun rounded(color: Int, radius: Int = 16, stroke: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
            stroke?.let { setStroke(dp(1), it) }
        }


    private fun root(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(bg)
        setPadding(dp(16), dp(16), dp(16), dp(24))
    }

    private fun logo(size: Int = 82): ImageView = ImageView(this).apply {
        setImageResource(R.drawable.solvia_icon)
        adjustViewBounds = true
        scaleType = ImageView.ScaleType.CENTER_CROP
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size)).apply { bottomMargin = dp(12) }
    }

    private fun title(value: String, size: Float = 28f): TextView = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(ink)
        setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(8), 0, dp(10))
    }

    private fun caption(value: String): TextView = TextView(this).apply {
        text = value
        textSize = 13f
        setTextColor(muted)
        setPadding(0, 0, 0, dp(12))
    }

    private fun edit(hintText: String, password: Boolean = false): EditText = EditText(this).apply {
        hint = hintText
        textSize = 16f
        setTextColor(ink)
        setHintTextColor(Color.GRAY)
        setPadding(dp(14), dp(13), dp(14), dp(13))
        if (password) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        MobileUi.input(this)
    }

    private fun Button.minimalIcon(label: String, color: Int) {
        val icon = when {
            label.startsWith("+") -> R.drawable.ic_plus
            label.contains("Назад", true) -> R.drawable.ic_back
            label.contains("Вийти", true) -> R.drawable.ic_logout
            label.contains("Налаштування", true) -> R.drawable.ic_settings
            label.contains("Супервіз", true) -> R.drawable.ic_supervisions
            label.contains("Календар", true) -> R.drawable.ic_calendar
            label.contains("Пацієнт", true) -> R.drawable.ic_patients
            label.contains("Статист", true) || label.contains("Звіт", true) -> R.drawable.ic_reports
            else -> null
        }
        if (icon != null) {
            val drawable = getDrawable(icon)?.mutate()
            drawable?.setTint(color)
            drawable?.setBounds(0, 0, dp(20), dp(20))
            setCompoundDrawablesRelative(drawable, null, null, null)
            compoundDrawablePadding = dp(8)
            text = label.removePrefix("+").trim()
        }
    }

    private fun primary(label: String, action: () -> Unit): Button = MobileUi.button(this, label, primary = true, action = action).apply { minimalIcon(label, Color.WHITE) }
    private fun secondary(label: String, action: () -> Unit): Button = MobileUi.button(this, label, action = action).apply { minimalIcon(label, forest) }
    private fun card(): LinearLayout = MobileUi.card(this)

    private fun scroll(content: View): ScrollView = ScrollView(this).apply {
        isFillViewport = true
        addView(content)
    }

    private fun spacer(h: Int = 10): Space = Space(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(h))
    }

    private fun showError(message: String) {
        AlertDialog.Builder(this)
            .setTitle("SOLVIA")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    private fun normalize(value: String): String {
        var raw = value.trim()
        require(raw.isNotBlank()) { "Вкажіть адресу сервера" }
        if (!raw.contains("://")) {
            val hostGuess = raw.substringBefore(':').trim()
            raw = if (isPrivateIpv4(hostGuess)) "http://$raw" else "https://$raw"
        }
        val uri = URI(raw)
        val scheme = uri.scheme?.lowercase()
        val host = uri.host ?: throw IllegalArgumentException("Не знайдено IP/host")
        require(scheme == "http" || scheme == "https") { "Підтримуються тільки HTTP/HTTPS адреси" }
        require(uri.userInfo == null && uri.query == null && uri.fragment == null)
        require(uri.path.isNullOrEmpty() || uri.path == "/")
        require(uri.port == -1 || uri.port in 1..65535)
        if (scheme == "http") {
            require(isPrivateIpv4(host)) { "HTTP дозволений тільки для приватної локальної IP-адреси центру" }
        }
        val port = when {
            uri.port != -1 -> uri.port
            scheme == "http" && isPrivateIpv4(host) -> 8765
            scheme == "https" && isPrivateIpv4(host) -> 8443
            else -> -1
        }
        return URI(scheme, null, host.lowercase(), port, null, null, null).toString().trimEnd('/')
    }

    private fun isPrivateIpv4(host: String): Boolean {
        val parts = host.split(".")
        if (parts.size != 4) return false
        val nums = parts.mapNotNull { it.toIntOrNull() }
        if (nums.size != 4 || nums.any { it !in 0..255 }) return false
        return nums[0] == 10 ||
            (nums[0] == 192 && nums[1] == 168) ||
            (nums[0] == 172 && nums[1] in 16..31)
    }

    private fun requestAt(base: String, method: String, path: String, body: JSONObject? = null, authToken: String = token): Any {
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
        connection.instanceFollowRedirects = false
        connection.requestMethod = method
        connection.connectTimeout = 6000
        connection.readTimeout = 12000
        connection.setRequestProperty("Accept", "application/json")
        if (authToken.isNotBlank() && path != "/api/health" && path != "/api/login") connection.setRequestProperty("Authorization", "Bearer " + authToken)
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val parsed: Any = if (text.isBlank()) JSONObject() else JSONTokener(text).nextValue()
        if (code !in 200..299) {
            val message = (parsed as? JSONObject)?.optString("error")?.takeIf { it.isNotBlank() }
                ?: "Помилка сервера $code"
            throw ApiError(code, message)
        }
        return parsed
        } finally { connection.disconnect() }
    }

    private fun request(method: String, path: String, body: JSONObject? = null): Any =
        requestAt(server, method, path, body)

    private fun apiAsync(method: String, path: String, body: JSONObject? = null, onError: ((String) -> Unit)? = null, ok: (Any) -> Unit) {
        val requestToken = token
        val requestServer = server
        val requestEpoch = sceneEpoch
        val requestUser = userId
        val store = if(requestToken.isNotBlank() && requestUser > 0) OfflineStore(this, requestServer, requestUser) else null
        io.execute {
            try {
                val result = if(offlineMode && method == "GET" && OfflineStore.cacheable(path) && store?.session() != null) {
                    store.cache(path) ?: requestAt(requestServer, method, path, body, requestToken)
                } else requestAt(requestServer, method, path, body, requestToken)
                if(!offlineMode && method == "GET" && OfflineStore.cacheable(path)) store?.saveCache(path, result)
                runOnUiThread { if (!isFinishing && !isDestroyed && token == requestToken && server == requestServer && sceneEpoch == requestEpoch) {
                    if(offlineMode && method == "GET" && OfflineStore.cacheable(path)) { lastCacheTime = store?.cacheTime(path) ?: 0; updateConnectionStatus() }
                    ok(result)
                } }
            } catch (e: Exception) {
                if(method == "GET" && store != null && OfflineStore.cacheable(path) && unavailable(e) && store.session() != null) {
                    val cached = runCatching { store.cache(path) }.getOrNull()
                    if(cached != null) {
                        runOnUiThread {
                            if(!isDestroyed && token == requestToken && server == requestServer && sceneEpoch == requestEpoch) {
                                offlineMode = true; lastCacheTime = store.cacheTime(path); updateConnectionStatus(); ok(cached)
                            }
                        }
                        return@execute
                    }
                }
                if(e is ApiError && e.status in listOf(403,404)) store?.forgetCache(path)
                runOnUiThread {
                    if (isFinishing || isDestroyed || token != requestToken || server != requestServer || sceneEpoch != requestEpoch) return@runOnUiThread
                    val message = e.message ?: "Помилка підключення"
                    if (e is ApiError && e.status == 401 && requestToken.isNotBlank()) {
                        consultationWindow?.dismiss(); consultationWindow = null
                        Toast.makeText(this, "Сесію завершено. Увійдіть знову.", Toast.LENGTH_LONG).show()
                        logout()
                    } else {
                        if (onError != null) onError(message) else showError(message)
                    }
                }
            }
        }
    }

    private fun openServerConfigFile() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(intent, openConfigRequest)
    }

    private fun importServerConfig(uri: android.net.Uri) {
        io.execute {
            try {
                val text = contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                    ?: throw IllegalStateException("Не вдалося прочитати файл")
                val json = JSONObject(text)
                require(json.optString("format") == "quremed.solvia.mobile") { "Це не файл підключення SOLVIA" }

                val preferred = json.optString("preferred", "https")
                val httpsSource = json.optString("https_url").ifBlank {
                    json.optString("api_url").takeIf { it.startsWith("https://", true) }.orEmpty()
                }
                val httpSource = json.optString("http_url").ifBlank {
                    json.optString("api_url").takeIf { it.startsWith("http://", true) }.orEmpty()
                }
                val firstSource = if (preferred == "http" && httpSource.isNotBlank()) httpSource
                    else httpsSource.ifBlank { json.optString("api_url").ifBlank { httpSource } }
                val candidate = normalize(firstSource)

                try {
                    val health = requestAt(candidate, "GET", "/api/health", authToken = "") as JSONObject
                    require(health.optBoolean("ok")) { "Сервер не підтвердив готовність" }
                    server = candidate
                    prefs.edit().putString("server", server).apply()
                    runOnUiThread {
                        Toast.makeText(this, "Сервер SOLVIA підключено: $server", Toast.LENGTH_LONG).show()
                        loginScreen()
                    }
                } catch (primary: Exception) {
                    if (candidate.startsWith("https://", true) && httpSource.isNotBlank()) {
                        val localHttp = normalize(httpSource)
                        val health = requestAt(localHttp, "GET", "/api/health", authToken = "") as JSONObject
                        require(health.optBoolean("ok")) { "Локальний HTTP сервер не готовий" }
                        runOnUiThread {
                            AlertDialog.Builder(this)
                                .setTitle("Доступний локальний HTTP")
                                .setMessage("HTTPS не вдалося відкрити, але сервер доступний через $localHttp. Використовувати HTTP лише у приватній Wi-Fi/LAN мережі центру? Для VPS та інтернету використовуйте HTTPS.")
                                .setNegativeButton("Ні") { _, _ -> setupScreen() }
                                .setPositiveButton("Підключити локально") { _, _ ->
                                    server = localHttp
                                    prefs.edit().putString("server", server).apply()
                                    Toast.makeText(this, "Підключено локально: $server", Toast.LENGTH_LONG).show()
                                    loginScreen()
                                }
                                .show()
                        }
                    } else throw primary
                }
            } catch (e: Exception) {
                runOnUiThread {
                    showError("Не вдалося імпортувати підключення: " + (e.message ?: "невідома помилка"))
                    setupScreen()
                }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if(requestCode == offlineUnlockRequest) {
            val session = pendingOfflineSession; pendingOfflineSession = null
            if(resultCode == RESULT_OK && session != null) {
                val user = session.getJSONObject("user")
                val store = OfflineStore(this, server, user.getLong("id"))
                if(store.session() == null) { showError("Офлайн-доступ закінчився. Увійдіть із сервером."); return }
                token = session.getString("token"); role = "psychologist"; userId = user.getLong("id"); userName = user.getString("name")
                offlineMode = true; OfflineSyncJob.schedule(this, server, userId); renderHomeScreen(); syncNow()
            }
            return
        }
        if (requestCode == exportPdfRequest) {
            val file = pendingPdf; pendingPdf = null
            if (resultCode == RESULT_OK && data?.data != null && file != null && token.isNotBlank()) {
                val uri = data.data!!
                io.execute {
                    try {
                        contentResolver.openOutputStream(uri)?.use { output -> file.inputStream().use { it.copyTo(output) } }
                            ?: throw IllegalStateException("Не вдалося відкрити файл")
                        runOnUiThread { Toast.makeText(this, "PDF збережено", Toast.LENGTH_LONG).show() }
                    } catch (error: Exception) { runOnUiThread { showError(error.message ?: "Помилка збереження PDF") } }
                }
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == openConfigRequest && resultCode == RESULT_OK && data?.data != null) {
            importServerConfig(data.data!!)
        }
    }

    private fun setupScreen() {
        backAction = null
        val body = root()
        body.addView(logo())
        body.addView(title("Підключення до SOLVIA", 27f))
        body.addView(caption("Найпростіше — відкрити файл SOLVIA-Mobile.solvia, створений серверним ПК. IP і порт підтягнуться автоматично."))

        val importCard = card()
        importCard.background = rounded(forestSoft, 17, line)
        importCard.addView(title("Автоматичне підключення", 18f))
        importCard.addView(caption("Отримайте файл підключення в адміністратора центру й відкрийте його на телефоні."))
        importCard.addView(primary("Відкрити файл SOLVIA-Mobile.solvia") { openServerConfigFile() })
        body.addView(importCard)
        body.addView(spacer(14))

        body.addView(title("Або введіть адресу вручну", 18f))
        body.addView(caption("Локально можна ввести 192.168.1.100 або http://192.168.1.100:8765. Для захищеного LAN/VPS використовуйте https://192.168.1.100:8443 або HTTPS-домен."))
        val address = edit("192.168.1.100").apply {
            setText(server)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }
        body.addView(address)
        body.addView(spacer(8))
        body.addView(primary("Перевірити та підключитися") {
            val previous = server
            try {
                val candidate = normalize(address.text.toString())
                io.execute {
                    try {
                        val health = requestAt(candidate, "GET", "/api/health") as JSONObject
                        require(health.optBoolean("ok")) { "Сервер не готовий" }
                        server = candidate
                        prefs.edit().putString("server", server).apply()
                        runOnUiThread {
                            Toast.makeText(this, "Підключено · SOLVIA " + health.optString("version", "2.0"), Toast.LENGTH_LONG).show()
                            loginScreen()
                        }
                    } catch (e: Exception) {
                        server = previous
                        runOnUiThread { showError(e.message ?: "Немає зв’язку із сервером") }
                    }
                }
            } catch (e: Exception) {
                showError(e.message ?: "Вкажіть коректну адресу сервера")
            }
        })
        body.addView(spacer(10))
        body.addView(caption("HTTPS рекомендований. HTTP дозволяється тільки для приватної локальної IP-мережі центру; для VPS/інтернету застосунок приймає лише HTTPS."))
        mount(scroll(body))
    }

    private fun loginScreen() {
        backAction = { setupScreen() }
        val body = root()
        body.addView(logo(56))
        body.addView(title("SOLVIA", 32f))
        body.addView(caption("Кабінет психолога"))
        body.addView(title("Вхід", 24f))
        val login = edit("Логін")
        val password = edit("Пароль", true)
        body.addView(caption("Логін")); body.addView(login)
        body.addView(caption("Пароль")); body.addView(password)
        body.addView(spacer())
        body.addView(primary("Увійти") {
            val payload = JSONObject()
                .put("login", login.text.toString())
                .put("password", password.text.toString())
                .put("platform", "Android")
                .put("device_id", Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "")
                .put("device_name", (Build.MANUFACTURER + " " + Build.MODEL).trim())
            apiAsync("POST", "/api/login", payload) { result ->
                acceptLogin(result as JSONObject)
            }
        })
        body.addView(secondary("Відкрити офлайн-кабінет") {
            val uid = prefs.getLong("offline_user:$server", 0)
            val saved = if(uid > 0) runCatching { OfflineStore(this, server, uid).session() }.getOrNull() else null
            if(saved == null) showError("Спочатку увійдіть із сервером і завантажте картки. Офлайн-доступ діє 12 годин після входу.")
            else {
                val guard = getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager
                if(!guard.isDeviceSecure) showError("Для офлайн-карток установіть PIN або пароль блокування Android.")
                else {
                    pendingOfflineSession = saved
                    val unlock = guard.createConfirmDeviceCredentialIntent("SOLVIA", "Підтвердьте доступ до зашифрованого кабінету психолога")
                    if(unlock != null) startActivityForResult(unlock, offlineUnlockRequest)
                }
            }
        })
        body.addView(spacer(12)); body.addView(secondary("Підключення до центру") { setupScreen() })
        body.addView(caption("SOLVIA ${BuildConfig.VERSION_NAME}"))
        mount(scroll(body))
    }

    private fun acceptLogin(response: JSONObject) {
        val user = response.getJSONObject("user")
        val receivedToken = response.getString("token")
        if (user.optString("role") != "psychologist") {
            val base = server
            io.execute { try { requestAt(base, "POST", "/api/logout", JSONObject(), receivedToken) } catch (_: Exception) { } }
            token = ""; role = ""; userId = 0; workspaceReady = false
            showError("Цей мобільний застосунок призначений тільки для психологів. Для адміністрації використовуйте програму центру.")
            return
        }
        token = receivedToken; role = "psychologist"; userName = user.getString("name"); userId = user.getLong("id")
        offlineMode = false
        offlineStore().saveSession(user, token)
        prefs.edit().putLong("offline_user:$server", userId).apply()
        OfflineSyncJob.schedule(this, server, userId)
        homeScreen()
        syncNow(refresh = false)
        val base = server; val auth = token; val store = offlineStore()
        prepareOfflineCache(base, auth, store)
    }

    private fun homeScreen() {
        selectedNavigation = "home"
        workspaceReady = false
        backAction = null
        val checking = root()
        checking.addView(logo(64))
        checking.addView(title("SOLVIA " + BuildConfig.VERSION_NAME, 20f))
        checking.addView(caption("Перевіряємо відкриття зміни…"))
        mount(scroll(checking))
        apiAsync("GET", "/api/shift-day") { result ->
            val shift = result as JSONObject
            if (shift.optBoolean("open", false)) renderHomeScreen()
            else renderShiftGate(shift)
        }
    }

    private fun renderShiftGate(shift: JSONObject) {
        val body = root(); body.addView(logo()); body.addView(title("Зміна ще не відкрита"))
        body.addView(caption("Дата: " + shift.optString("shift_date", LocalDate.now().toString())))
        body.addView(caption("Адміністратор має відкрити зміну в програмі центру."))
        body.addView(secondary("Перевірити ще раз") { homeScreen() }); body.addView(secondary("Вийти") { logout() })
        mount(scroll(body))
    }

    private fun renderHomeScreen() {
        workspaceReady = true; selectedNavigation = "home"; backAction = null
        val body = root()
        body.addView(title("Сьогодні", 30f))
        body.addView(caption(userName + " · " + LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("d MMMM", java.util.Locale.forLanguageTag("uk")))))
        val today = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; body.addView(today)
        val quick = card(); quick.addView(title("Продовжити роботу", 18f))
        quick.addView(secondary("Продовжити чернетку") { draftsScreen() })
        quick.addView(secondary("Документи та виписки") { patientsScreen(documentLibrary = true) })
        body.addView(quick)
        mount(scroll(body))
        if(role != "director") apiAsync("GET", "/api/appointments?date=" + LocalDate.now()) { value ->
            val entries = value as JSONArray; today.addView(title("Прийоми · " + entries.length(), 18f))
            if(entries.length() == 0) today.addView(caption("Сьогодні записів поки немає."))
            val ordered = (0 until entries.length()).map { entries.getJSONObject(it) }.sortedWith(compareBy<JSONObject> { it.optString("status") !in listOf("scheduled", "confirmed") }.thenBy { it.optString("start") })
            for(item in ordered) {
                val row = card()
                row.addView(title(item.optString("start").takeLast(5) + " — " + item.optString("end").takeLast(5), 18f))
                row.addView(caption(item.optString("room") + " · " + statusLabel(item.optString("status"))))
                val patients = item.optJSONArray("patients") ?: JSONArray()
                for(j in 0 until patients.length()) { val patient = patients.getJSONObject(j)
                    row.addView(title(patient.optString("name"), 19f))
                    if(item.optString("status") in listOf("scheduled", "confirmed")) row.addView(primary("Почати консультацію") {
                        consultationDialog(patient.getLong("id"), patient.optString("name"), item.getLong("id"))
                    })
                    row.addView(secondary("Картка пацієнта") { patientScreen(patient.getLong("id")) })
                }
                today.addView(row); today.addView(spacer())
            }
        }
    }

    private fun topBar(label: String, back: () -> Unit): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(secondary("Назад") { back() }.apply {
            text = "‹"; contentDescription = "Назад"; textSize = 28f; setCompoundDrawablesRelative(null, null, null, null)
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        addView(TextView(this@MainActivity).apply {
            text = label
            textSize = 20f
            setTextColor(ink)
            setPadding(dp(8), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun calendarScreen(date: String = LocalDate.now().toString()) {
        selectedNavigation = "calendar"
        backAction = { homeScreen() }
        val body = root()
        body.addView(topBar(if (role == "psychologist") "Мій календар" else "Календар центру", ::homeScreen))
        val dateInput = edit("Оберіть дату").apply {
            setText(date); isFocusable = false
            setOnClickListener {
                val current = runCatching { LocalDate.parse(text.toString()) }.getOrDefault(LocalDate.now())
                android.app.DatePickerDialog(this@MainActivity, { _, y, m, d -> calendarScreen(LocalDate.of(y, m + 1, d).toString()) },
                    current.year, current.monthValue - 1, current.dayOfMonth).show()
            }
        }
        body.addView(dateInput)
        val days = LinearLayout(this)
        days.addView(secondary("‹") { calendarScreen(LocalDate.parse(date).minusDays(1).toString()) }, LinearLayout.LayoutParams(0, dp(48), 1f))
        days.addView(secondary("Сьогодні") { calendarScreen() }, LinearLayout.LayoutParams(0, dp(48), 1f))
        days.addView(secondary("›") { calendarScreen(LocalDate.parse(date).plusDays(1).toString()) }, LinearLayout.LayoutParams(0, dp(48), 1f))
        body.addView(days)
        body.addView(spacer(12))
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(list)
        mount(scroll(body))

        apiAsync("GET", "/api/appointments?date=" + date) { result ->
            list.removeAllViews()
            val rows = result as JSONArray
            if (rows.length() == 0) list.addView(caption("На цей день записів немає."))
            for (i in 0 until rows.length()) {
                val item = rows.getJSONObject(i)
                val patients = item.optJSONArray("patients") ?: JSONArray()
                val box = card()
                box.background = rounded(if (item.optString("status") == "completed") Color.rgb(235, 245, 239) else Color.WHITE, 17, line)
                box.addView(title(item.optString("start").takeLast(5) + " — " + item.optString("end").takeLast(5), 18f))
                box.addView(caption(
                    item.optString("psychologist") + " · " +
                    item.optString("room") + " · " +
                    statusLabel(item.optString("status"))
                ))
                if (item.optString("note").isNotBlank()) box.addView(caption("Примітка: " + item.optString("note")))
                for (j in 0 until patients.length()) {
                    val patient = patients.getJSONObject(j)
                    val patientId = patient.getLong("id")
                    val patientName = patient.getString("name")
                    box.addView(secondary(patientName + " →") { patientScreen(patientId) })
                }
                list.addView(box)
                list.addView(spacer(9))
            }
        }
    }

    private fun patientsScreen(status: String = "active", documentLibrary: Boolean = false) {
        selectedNavigation = "patients"
        backAction = { homeScreen() }
        val body = root()
        body.addView(title(if(documentLibrary) "Документи" else "Пацієнти", 28f))
        val search = edit("Пошук за №, ПІБ, телефоном, категорією")
        body.addView(search)
        val filters = LinearLayout(this)
        for ((key, label) in listOf("active" to "Активні", "completed" to "Завершені", "archived" to "Архів")) {
            filters.addView(MobileUi.button(this, label, selected = key == status) { patientsScreen(key, documentLibrary) }, LinearLayout.LayoutParams(0, dp(48), 1f))
        }
        body.addView(filters)
        if (documentLibrary) body.addView(caption("Оберіть пацієнта, щоб відкрити його документи."))
        body.addView(spacer())
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(list)
        mount(scroll(body))

        apiAsync("GET", "/api/patients?status=" + status) { result ->
            val all = result as JSONArray

            fun render(query: String) {
                list.removeAllViews()
                for (i in 0 until all.length()) {
                    val patient = all.getJSONObject(i)
                    val hay = (
                        patient.optString("patient_no") + " " +
                        patient.optString("name") + " " +
                        patient.optString("phone") + " " +
                        patient.optString("category")
                    ).lowercase()
                    if (query.isNotBlank() && !hay.contains(query.lowercase())) continue
                    val patientId = patient.getLong("id")
                    val box = card()
                    box.background = rounded(Color.WHITE, 17, line)
                    box.setOnClickListener { patientWorkspace(patientId, if(documentLibrary) "documents" else "summary") }
                    box.addView(caption("№" + patient.optString("patient_no", "—")))
                    box.addView(title(patient.optString("name"), 18f))
                    box.addView(caption(patient.optString("category") + " · " + patient.optString("phone")))
                    box.contentDescription = "Відкрити картку " + patient.optString("name")
                    box.isFocusable = true
                    list.addView(box)
                    list.addView(spacer(9))
                }
            }

            render("")
            if (all.length() == 0) list.addView(caption("У цій категорії пацієнтів поки немає."))
            search.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    render(s?.toString().orEmpty())
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
    }

    private fun patientScreen(id: Long) = patientWorkspace(id)

    private fun patientWorkspace(id: Long, tab: String = "summary") {
        selectedNavigation = "patients"
        val workspace = PatientWorkspace(this, mobileApi(), role, server,
            { view, back -> backAction = back; mount(scroll(view)) },
            { patientsScreen() }, { patientId, name -> consultationDialog(patientId, name) },
            { document, back -> previewDocument(document, back) })
        workspace.open(id, tab)
    }

    private fun consultationDialog(patientId: Long, patientName: String) = consultationDialog(patientId, patientName, 0L)
    private fun consultationDialog(patientId: Long, patientName: String, preferredAppointment: Long) {
        val journal = offlineStore()
        val draftStore = DraftStore(this, server, userId)
        val savedDraft = try { draftStore.read(patientId) } catch (_: Exception) {
            Toast.makeText(this, "Локальну чернетку не вдалося розшифрувати. Її не видалено; новий текст не перезапише її.", Toast.LENGTH_LONG).show(); return
        }
        val draftDate = savedDraft?.optString("consult_date", LocalDate.now().toString()) ?: LocalDate.now().toString()
        val clientKey = savedDraft?.optString("client_key")?.takeIf { it.isNotBlank() } ?: java.util.UUID.randomUUID().toString()
        apiAsync("GET", "/api/appointments?date=" + draftDate) { result ->
            val apps = result as JSONArray
            val eligible = mutableListOf<JSONObject>()
            val queued = journal.queue()
            val queuedAppointments = (0 until queued.length()).map { queued.getJSONObject(it) }.filter {
                it.optString("state") in listOf("pending", "blocked") && it.getJSONObject("payload").optLong("patient_id") == patientId
            }.map { it.getJSONObject("payload").optLong("appointment_id") }

            for (i in 0 until apps.length()) {
                val appointment = apps.getJSONObject(i)
                val status = appointment.optString("status")
                if (status != "scheduled" && status != "confirmed") continue
                if(appointment.optLong("id") in queuedAppointments) continue
                val patients = appointment.optJSONArray("patients") ?: JSONArray()
                for (j in 0 until patients.length()) {
                    if (patients.getJSONObject(j).optLong("id") == patientId) {
                        eligible.add(appointment)
                        break
                    }
                }
            }

            if (savedDraft != null && eligible.none { it.optLong("id") == savedDraft.optLong("appointment_id") }) {
                AlertDialog.Builder(this).setTitle("Збережена чернетка")
                    .setMessage("Чернетка стосується запису, який уже завершено або скасовано. Перевірте історію консультацій. Текст не буде автоматично перенесено на інший прийом.")
                    .setNegativeButton("Залишити", null)
                    .setPositiveButton("Видалити локальну чернетку") { _, _ ->
                        try { draftStore.remove(patientId); consultationDialog(patientId, patientName) }
                        catch (_: Exception) { showError("Не вдалося видалити чернетку") }
                    }.show()
                return@apiAsync
            }
            if (eligible.isEmpty()) {
                showError(if(queuedAppointments.isNotEmpty()) "Консультація для доступного прийому вже у черзі. Відкрийте «Синхронізація» для перегляду." else "На обрану дату немає завантаженого активного запису цього пацієнта.")
                return@apiAsync
            }

            val wrap = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(6), dp(12), dp(18))
                setBackgroundColor(bg)
            }
            val scroll = ScrollView(this).apply { addView(wrap) }

            wrap.addView(title(patientName, 20f))
            wrap.addView(caption("Заповніть підсумок прийому. Текст автоматично зберігається як зашифрована чернетка."))

            val appointmentSpinner = Spinner(this)
            val appointmentLabels = eligible.map {
                it.optString("start").takeLast(5) + " · " + it.optString("room")
            }
            appointmentSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, appointmentLabels)
            if(savedDraft == null && preferredAppointment > 0) {
                val chosen = eligible.indexOfFirst { it.optLong("id") == preferredAppointment }
                if(chosen >= 0) appointmentSpinner.setSelection(chosen)
            }

            val typeValues = listOf("primary", "repeat", "crisis", "individual", "family", "child", "group")
            val typeLabels = listOf("Первинна", "Повторна", "Кризова", "Індивідуальна", "Сімейна", "Дитяча", "Групова")
            val typeSpinner = Spinner(this)
            typeSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, typeLabels)

            val riskValues = listOf("low", "moderate", "high", "critical")
            val riskLabels = listOf("Низький", "Помірний", "Високий", "Критичний")
            val riskSpinner = Spinner(this)
            riskSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, riskLabels)

            val duration = edit("Тривалість, хв").apply {
                setText("60")
                inputType = InputType.TYPE_CLASS_NUMBER
            }
            val requestText = edit("Запит / причина звернення").apply { minLines = 2 }
            val stateText = edit("Стан на початку консультації").apply { minLines = 2 }
            val workDone = edit("Що було проведено").apply { minLines = 3 }
            val note = edit("Приватна нотатка психолога").apply { minLines = 3 }
            val goals = edit("Цілі роботи").apply { minLines = 2 }
            val next = edit("План наступної консультації").apply { minLines = 2 }
            val homework = edit("Домашнє завдання").apply { minLines = 2 }
            val recommendations = edit("Рекомендації").apply { minLines = 2 }
            val resultText = edit("Результат / динаміка").apply { minLines = 2 }

            val flagValues = listOf(
                "anxiety" to "Тривога",
                "depression" to "Депресивні прояви",
                "ptsd" to "ПТСР / флешбеки",
                "sleep" to "Порушення сну",
                "panic" to "Панічні прояви",
                "aggression" to "Агресія / дратівливість",
                "family_conflict" to "Сімейний конфлікт",
                "burnout" to "Емоційне виснаження",
                "suicide" to "Суїцидальний ризик",
                "harm_others" to "Ризик для оточення",
                "urgent_followup" to "Терміновий повторний контакт",
                "doctor_referral" to "Скерування до лікаря / психіатра",
                "family_work" to "Потреба у сімейній роботі",
                "group_work" to "Потреба у груповій роботі"
            )
            val flagChecks = flagValues.map { pair ->
                CheckBox(this).apply {
                    text = pair.second
                    setTextColor(ink)
                    textSize = 13f
                }
            }

            val stageNames = listOf("Прийом", "Запит і стан", "Робота", "Подальший план", "Ризики")
            val stages = mutableListOf<View>()
            var currentStage = 0
            val stageHeading = title("1 з 5 · Прийом", 18f); wrap.addView(stageHeading)
            val stageBar = LinearLayout(this); wrap.addView(stageBar)
            val stageButtons = mutableListOf<Button>()
            fun showStage(index: Int) {
                currentStage = index
                stages.forEachIndexed { i, view -> view.visibility = if(i == index) View.VISIBLE else View.GONE }
                stageButtons.forEachIndexed { i, button -> button.background = rounded(if(i == index) forestSoft else Color.WHITE, 12, line) }
                stageHeading.text = "${index + 1} з 5 · ${stageNames[index]}"
                consultationWindow?.getButton(AlertDialog.BUTTON_POSITIVE)?.text = if(index == 4) "Завершити й передати" else "Далі"
                consultationWindow?.getButton(AlertDialog.BUTTON_NEUTRAL)?.isEnabled = index > 0
                scroll.smoothScrollTo(0, 0)
            }
            stageNames.forEachIndexed { i, name ->
                val button = MobileUi.button(this, "${i + 1}", selected = i == 0) { showStage(i) }
                button.contentDescription = "Етап ${i + 1}: $name"
                stageBar.addView(button, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(4); bottomMargin = dp(12) }); stageButtons.add(button)
            }
            fun addGap(parent: LinearLayout, value: Int = 8) = parent.addView(spacer(value))
            fun section(name: String, hint: String, build: (LinearLayout) -> Unit) {
                val box = card()
                box.background = rounded(Color.WHITE, 18, line)
                box.addView(title(name, 17f))
                box.addView(caption(hint))
                build(box)
                stages.add(box); box.visibility = if(stages.size == 1) View.VISIBLE else View.GONE
                wrap.addView(box)
            }

            section("1 · Прийом", "Оберіть конкретний запис із календаря. Після збереження консультація буде прив’язана саме до нього.") { box ->
                box.addView(caption("Запис у календарі"))
                box.addView(appointmentSpinner)
                addGap(box)
                box.addView(caption("Тип консультації"))
                box.addView(typeSpinner)
                addGap(box)
                box.addView(duration)
            }

            section("2 · Запит і стан", "Фіксуйте факти та слова пацієнта окремо від власної інтерпретації.") { box ->
                box.addView(caption("Основний запит — коротко, бажано словами пацієнта"))
                box.addView(requestText)
                addGap(box)
                box.addView(caption("Стан на початку — спостереження, скарги, важливі зміни"))
                box.addView(stateText)
            }

            section("3 · Робота психолога", "Опишіть що реально проводилось на консультації. Приватна нотатка доступна лише ролям із клінічним доступом.") { box ->
                box.addView(caption("Проведена робота / техніки / інтервенції"))
                box.addView(workDone)
                addGap(box)
                box.addView(caption("Приватна нотатка психолога"))
                box.addView(note)
                addGap(box)
                box.addView(caption("Цілі поточного етапу"))
                box.addView(goals)
                addGap(box)
                box.addView(caption("Результат / динаміка наприкінці зустрічі"))
                box.addView(resultText)
            }

            section("4 · План після консультації", "Ці поля SOLVIA використовує для наступної зустрічі та автоматичного формування виписки.") { box ->
                box.addView(caption("План наступної консультації"))
                box.addView(next)
                addGap(box)
                box.addView(caption("Домашнє завдання"))
                box.addView(homework)
                addGap(box)
                box.addView(caption("Рекомендації"))
                box.addView(recommendations)
            }

            section("5 · Ризики та контроль", "Оберіть рівень ризику і тільки ті позначки, які були реально оцінені під час консультації.") { box ->
                box.addView(caption("Рівень ризику"))
                box.addView(riskSpinner)
                addGap(box)
                box.addView(title("Важливі позначки", 15f))
                flagChecks.forEach { box.addView(it) }
            }

            val draftStatus = caption("Чернетка зашифрована на цьому пристрої · $draftDate")
            wrap.addView(draftStatus)
            if(offlineMode) wrap.addView(caption("Офлайн · прийом обрано зі збереженої копії розкладу. Сервер перевірить доступ під час передавання."))
            val textFields = linkedMapOf("note" to note, "goals" to goals, "next_plan" to next,
                "homework" to homework, "recommendations" to recommendations, "request_text" to requestText,
                "state_text" to stateText, "work_done" to workDone, "result_text" to resultText)
            if (savedDraft != null) {
                textFields.forEach { (key, field) -> field.setText(savedDraft.optString(key)) }
                duration.setText(savedDraft.optInt("duration_minutes", 60).toString())
                typeSpinner.setSelection(typeValues.indexOf(savedDraft.optString("consultation_type", "repeat")).coerceAtLeast(0))
                riskSpinner.setSelection(riskValues.indexOf(savedDraft.optString("risk_level", "low")).coerceAtLeast(0))
                val selected = eligible.indexOfFirst { it.optLong("id") == savedDraft.optLong("appointment_id") }
                if (selected >= 0) appointmentSpinner.setSelection(selected)
                val flags = savedDraft.optJSONArray("risk_flags") ?: JSONArray()
                flagChecks.forEachIndexed { index, check -> check.isChecked = (0 until flags.length()).any { flags.optString(it) == flagValues[index].first } }
            }
            fun snapshot(): JSONObject {
                val flags = JSONArray(); flagChecks.forEachIndexed { index, check -> if (check.isChecked) flags.put(flagValues[index].first) }
                val value = JSONObject().put("client_key", clientKey).put("consult_date", draftDate)
                    .put("appointment_id", eligible[appointmentSpinner.selectedItemPosition].getLong("id"))
                    .put("duration_minutes", duration.text.toString().toIntOrNull() ?: 60)
                    .put("consultation_type", typeValues[typeSpinner.selectedItemPosition])
                    .put("risk_level", riskValues[riskSpinner.selectedItemPosition]).put("risk_flags", flags)
                textFields.forEach { (key, field) -> value.put(key, field.text.toString()) }; return value
            }
            val tools = card().apply { visibility = View.GONE }
            wrap.addView(secondary("Інструменти запису") { tools.visibility = if(tools.visibility == View.VISIBLE) View.GONE else View.VISIBLE })
            wrap.addView(tools)
            tools.addView(secondary("Перенести цілі й план попередньої консультації") {
                apiAsync("GET", "/api/patients/$patientId") { result ->
                    val history = (result as JSONObject).optJSONArray("consultations")
                    if(history == null || history.length() == 0) showError("Попередніх консультацій немає")
                    else AlertDialog.Builder(this).setTitle("Перенести план?").setMessage("Буде замінено лише цілі та план наступної зустрічі. Нотатки й оцінка ризиків залишаться вашими.")
                        .setNegativeButton("Скасувати", null).setPositiveButton("Перенести") { _, _ ->
                            goals.setText(history.getJSONObject(0).optString("goals")); next.setText(history.getJSONObject(0).optString("next_plan"))
                        }.show()
                }
            })
            tools.addView(secondary("Перевірити підсумок перед збереженням") {
                AlertDialog.Builder(this).setTitle("Підсумок консультації")
                    .setMessage(textFields.entries.joinToString("\n\n") { (key, field) -> field.hint.toString() + ":\n" + field.text.toString().ifBlank { "—" } })
                    .setPositiveButton("Повернутися до запису", null).show()
            })
            tools.addView(secondary("Шаблон первинного / повторного прийому") {
                val labels = arrayOf("Первинний прийом", "Повторний прийом")
                AlertDialog.Builder(this).setTitle("Структура нотатки").setItems(labels) { _, index ->
                    if(note.text.isNotBlank()) { showError("Нотатка вже містить текст. Шаблон доступний для порожньої нотатки.") }
                    else {
                        typeSpinner.setSelection(index)
                        note.setText(if(index == 0) "Запит пацієнта:\n\nВажливі відомості:\n\nСпостереження психолога:\n\nУзгоджені цілі:\n\nПроведена робота:\n\nПодальший план:\n" else "Зміни від попередньої зустрічі:\n\nДомашнє завдання — виконання:\n\nПроведена робота:\n\nРезультат зустрічі:\n\nПодальший план:\n")
                        showStage(2); note.requestFocus()
                    }
                }.show()
            })
            textFields.values.forEach { it.filters = arrayOf(android.text.InputFilter.LengthFilter(10000)) }
            var submitted = false
            var serverRevision = savedDraft?.optInt("server_version", 0) ?: 0
            fun persistDraft() {
                if (submitted) return
                try { draftStore.save(patientId, snapshot().put("server_version", serverRevision)); draftStatus.text = "Чернетку зашифровано на пристрої · $draftDate" }
                catch (_: Exception) { draftStatus.text = "Не вдалося зберегти чернетку. Не закривайте до збереження на сервері." }
            }
            val watcher = object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { persistDraft() }
                override fun afterTextChanged(s: Editable?) {}
            }
            textFields.values.forEach { it.addTextChangedListener(watcher) }; duration.addTextChangedListener(watcher)
            flagChecks.forEach { it.setOnCheckedChangeListener { _, _ -> persistDraft() } }
            val selectionWatcher = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) { persistDraft() }
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
            }
            listOf(appointmentSpinner, typeSpinner, riskSpinner).forEach { it.onItemSelectedListener = selectionWatcher }

            val dialog = AlertDialog.Builder(this)
                .setTitle("Підсумок консультації")
                .setView(scroll)
                .setNegativeButton("Чернетка", null)
                .setNeutralButton("Назад", null)
                .setPositiveButton("Далі", null)
                .create()
            consultationWindow = dialog
            dialog.setOnDismissListener { persistDraft(); if (consultationWindow === dialog) consultationWindow = null }
            tools.addView(secondary("Зберегти чернетку на сервері") {
                apiAsync("GET", "/api/patients/$patientId/draft") { value ->
                    val remote = value as JSONObject
                    val version = remote.optInt("version")
                    if (remote.optJSONObject("payload") != null && version != serverRevision) {
                        showError("Серверну чернетку змінено на іншому пристрої. Локальний текст залишився зашифрованим. Спочатку відновіть серверну версію.")
                    } else {
                        val current = snapshot()
                        apiAsync("PATCH", "/api/patients/$patientId/draft", JSONObject().put("version", version).put("payload", current)) { response ->
                            serverRevision = (response as JSONObject).getInt("version")
                            persistDraft(); draftStatus.text = "Чернетку збережено на сервері та зашифровано на пристрої"
                        }
                    }
                }
            })
            tools.addView(secondary("Відновити серверну чернетку") {
                apiAsync("GET", "/api/patients/$patientId/draft") { value ->
                    val remote = value as JSONObject
                    val payload = remote.optJSONObject("payload")
                    if (payload == null) showError("Серверної чернетки поки немає")
                    else AlertDialog.Builder(this).setTitle("Відновити чернетку?")
                        .setMessage("Текст у цьому вікні буде замінено серверною версією. Незбережені локальні зміни буде втрачено.")
                        .setNegativeButton("Залишити локальну", null)
                        .setPositiveButton("Відновити") { _, _ ->
                            try {
                                draftStore.save(patientId, payload.put("server_version", remote.optInt("version")))
                                submitted = true; dialog.dismiss(); consultationDialog(patientId, patientName)
                            } catch (_: Exception) { showError("Не вдалося зберегти зашифровану чернетку") }
                        }.show()
                }
            })

            dialog.setOnShowListener {
                showStage(0)
                dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { showStage((currentStage - 1).coerceAtLeast(0)) }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    if(currentStage < 4) { showStage(currentStage + 1); return@setOnClickListener }
                    val minutes = duration.text.toString().toIntOrNull() ?: 0
                    if (note.text.toString().isBlank() || note.text.toString().trimEnd().endsWith("Подальший план:")) {
                        showStage(2); note.requestFocus(); Toast.makeText(this, "Заповніть приватну нотатку психолога.", Toast.LENGTH_LONG).show()
                        return@setOnClickListener
                    }
                    if (minutes !in 10..480) {
                        showStage(0); duration.requestFocus(); Toast.makeText(this, "Тривалість має бути від 10 до 480 хвилин.", Toast.LENGTH_LONG).show()
                        return@setOnClickListener
                    }

                    val appointment = eligible[appointmentSpinner.selectedItemPosition]
                    val flags = JSONArray()
                    flagChecks.forEachIndexed { index, check ->
                        if (check.isChecked) flags.put(flagValues[index].first)
                    }
                    val payload = JSONObject()
                        .put("client_key", clientKey)
                        .put("patient_id", patientId)
                        .put("consult_date", draftDate)
                        .put("appointment_id", appointment.getLong("id"))
                        .put("note", note.text.toString())
                        .put("goals", goals.text.toString())
                        .put("next_plan", next.text.toString())
                        .put("homework", homework.text.toString())
                        .put("recommendations", recommendations.text.toString())
                        .put("consultation_type", typeValues[typeSpinner.selectedItemPosition])
                        .put("duration_minutes", minutes)
                        .put("request_text", requestText.text.toString())
                        .put("state_text", stateText.text.toString())
                        .put("work_done", workDone.text.toString())
                        .put("result_text", resultText.text.toString())
                        .put("risk_level", riskValues[riskSpinner.selectedItemPosition])
                        .put("risk_flags", flags)
                    if (serverRevision > 0) payload.put("draft_version", serverRevision)

                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                    textFields.values.forEach { it.isEnabled = false }
                    duration.isEnabled = false
                    listOf(appointmentSpinner, typeSpinner, riskSpinner).forEach { it.isEnabled = false }
                    flagChecks.forEach { it.isEnabled = false }
                    persistDraft()
                    try {
                        journal.enqueue(payload, patientName)
                        OfflineSyncJob.schedule(this, server, userId)
                        submitted = true
                        runCatching { draftStore.remove(patientId) }
                        dialog.dismiss()
                        Toast.makeText(this, "Збережено на телефоні. Запис буде передано на сервер після відновлення зв’язку.", Toast.LENGTH_LONG).show()
                        updateConnectionStatus(); syncNow(refresh = false); syncScreen()
                    } catch(e: Exception) {
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                        textFields.values.forEach { it.isEnabled = true }; duration.isEnabled = true
                        listOf(appointmentSpinner, typeSpinner, riskSpinner).forEach { it.isEnabled = true }
                        flagChecks.forEach { it.isEnabled = true }
                        showError(e.message ?: "Не вдалося зафіксувати запис. Чернетка залишилась на телефоні.")
                    }
                }
            }
            dialog.show()
            dialog.window?.setLayout(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT)
            dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
    }

    private fun logout() {
        consultationWindow?.dismiss(); consultationWindow = null
        val oldToken = token
        val oldServer = server
        if(userId > 0) runCatching { offlineStore().revokeSession() }
        token = ""
        role = ""
        offlineMode = false
        workspaceReady = false
        userId = 0
        pendingPdf = null
        pdfPreview?.close(); pdfPreview = null
        java.io.File(cacheDir, "documents").deleteRecursively()
        io.execute { try { requestAt(oldServer, "POST", "/api/logout", JSONObject(), oldToken) } catch (_: Exception) { } }
        loginScreen()
    }

    private fun settingsScreen() {
        selectedNavigation = "more"
        backAction = { homeScreen() }
        val body = root()
        body.addView(topBar("Налаштування") { homeScreen() })
        body.addView(caption("SOLVIA " + BuildConfig.VERSION_NAME + " · " + server))
        val screenAwake = CheckBox(this).apply {
            text = "Не вимикати екран під час роботи"
            isChecked = prefs.getBoolean("keep_screen_on", false)
            setOnCheckedChangeListener { _, checked ->
                prefs.edit().putBoolean("keep_screen_on", checked).apply()
                if (checked) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
        body.addView(screenAwake)
        body.addView(secondary("Перевірити з’єднання") {
            apiAsync("GET", "/api/health") { value ->
                val health = value as JSONObject
                showError("Сервер доступний: SOLVIA " + health.optString("version") + " · " + health.optString("platform"))
            }
        })
        body.addView(secondary("Оновлення SOLVIA") {
            startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://github.com/docvincent123/Serenia/releases")))
        })
        body.addView(caption("Установлюйте APK нового випуску з тим самим підписом. Налаштування з’єднання зберігаються."))
        body.addView(title("Змінити пароль", 20f))
        val old = edit("Поточний пароль", true)
        val next = edit("Новий пароль — від 12 символів", true)
        val repeat = edit("Повторіть новий пароль", true)
        body.addView(old); body.addView(spacer()); body.addView(next); body.addView(spacer()); body.addView(repeat)
        body.addView(primary("Зберегти новий пароль") {
            if (next.text.toString() != repeat.text.toString()) { showError("Паролі не збігаються"); return@primary }
            apiAsync("POST", "/api/account/password", JSONObject().put("current_password", old.text.toString()).put("new_password", next.text.toString())) {
                token = ""; loginScreen()
                Toast.makeText(this, "Пароль змінено. Увійдіть знову на всіх пристроях.", Toast.LENGTH_LONG).show()
            }
        })
        body.addView(secondary("Вийти й змінити сервер") {
            AlertDialog.Builder(this).setTitle("Змінити сервер?")
                .setMessage("Поточну сесію буде завершено. Перевірте нову HTTPS-адресу та сертифікат.")
                .setPositiveButton("Продовжити") { _, _ -> logout(); setupScreen() }
                .setNegativeButton("Скасувати", null).show()
        })
        mount(scroll(body))
    }

    private fun supervisionsScreen() {
        backAction = { moreScreen() }; val body = root(); body.addView(topBar("Мої супервізії", ::moreScreen)); mount(scroll(body))
        apiAsync("GET", "/api/supervisions") { value ->
            val rows = value as JSONArray
            if(rows.length() == 0) body.addView(caption("Призначених супервізій поки немає."))
            for(i in 0 until rows.length()) {
                val item = rows.getJSONObject(i); val box = card()
                box.addView(title(item.optString("topic", "Супервізія"), 18f))
                box.addView(caption(item.optString("scheduled_at") + " · " + item.optString("supervisor")))
                box.addView(caption("Опис випадку: " + item.optString("case_summary")))
                box.addView(caption("Рекомендації супервізора: " + item.optString("recommendations")))
                box.addView(secondary("Описати випадок") {
                    val field = edit("Без персональних даних").apply { minLines = 5; setText(item.optString("case_summary")) }
                    val dialog = AlertDialog.Builder(this).setTitle("Мій опис випадку").setView(field).setNegativeButton("Скасувати", null).setPositiveButton("Зберегти", null).create()
                    dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val save = dialog.getButton(AlertDialog.BUTTON_POSITIVE); save.isEnabled = false
                        apiAsync("PATCH", "/api/supervisions/" + item.getLong("id"), JSONObject().put("case_summary", field.text.toString()),
                            onError = { save.isEnabled = true; showError(it) }) { dialog.dismiss(); supervisionsScreen() }
                    } }; dialog.show()
                }); body.addView(box); body.addView(spacer())
            }
        }
    }

    private fun reportScreen() {
        backAction = { homeScreen() }
        val day = LocalDate.now().toString()
        val body = root()
        body.addView(topBar("Звіт за зміну", ::homeScreen))
        body.addView(caption(day + " · дані зберігаються у PostgreSQL сервера"))

        val summary = edit("Підсумок роботи за зміну").apply { minLines = 4 }
        val incidents = edit("Важливі події / ризики").apply { minLines = 3 }
        val handover = edit("Передача / що проконтролювати").apply { minLines = 3 }
        val critical = CheckBox(this).apply {
            text = "Були критичні випадки"
            setTextColor(ink)
        }
        val notifyAdmin = CheckBox(this).apply {
            text = "Потрібен контроль адміністратора"
            setTextColor(ink)
        }
        val notifyDirector = CheckBox(this).apply {
            text = "Повідомити керівника"
            setTextColor(ink)
        }

        body.addView(summary)
        body.addView(spacer(7))
        body.addView(incidents)
        body.addView(spacer(7))
        body.addView(handover)
        body.addView(spacer(7))
        body.addView(critical)
        body.addView(notifyAdmin)
        body.addView(notifyDirector)

        val statusCard = card()
        statusCard.background = rounded(forestSoft, 15, line)
        val statusText = caption("Перевіряємо, чи є вже збережений звіт…")
        statusCard.addView(statusText)
        body.addView(statusCard)
        body.addView(spacer(10))

        body.addView(primary("Зберегти / оновити звіт") {
            if (summary.text.toString().isBlank()) {
                Toast.makeText(this, "Заповніть підсумок роботи.", Toast.LENGTH_LONG).show()
                return@primary
            }
            val payload = JSONObject()
                .put("shift_date", day)
                .put("summary", summary.text.toString())
                .put("incidents", incidents.text.toString())
                .put("handover", handover.text.toString())
                .put("critical_cases", critical.isChecked)
                .put("notify_admin", notifyAdmin.isChecked)
                .put("notify_director", notifyDirector.isChecked)

            apiAsync("POST", "/api/shift-reports", payload) { result ->
                val count = (result as JSONObject).optInt("consultations_count")
                Toast.makeText(this, "Звіт збережено · консультацій: $count", Toast.LENGTH_LONG).show()
                reportScreen()
            }
        })
        mount(scroll(body))

        apiAsync("GET", "/api/shift-reports?from=$day&to=$day") { result ->
            val rows = result as JSONArray
            if (rows.length() > 0) {
                val current = rows.getJSONObject(0)
                summary.setText(current.optString("summary"))
                incidents.setText(current.optString("incidents"))
                handover.setText(current.optString("handover"))
                critical.isChecked = current.optBoolean("critical_cases")
                notifyAdmin.isChecked = current.optBoolean("notify_admin")
                notifyDirector.isChecked = current.optBoolean("notify_director")
                statusText.text = "Звіт уже збережений · консультацій: " + current.optInt("consultations_count") + " · можна редагувати"
            } else {
                statusText.text = "Звіт за сьогодні ще не подано."
            }
        }
    }

    private fun roleLabel(value: String): String = when (value) {
        "admin" -> "Адміністратор"
        "reception" -> "Реєстратура"
        "psychologist" -> "Психолог"
        "director" -> "Керівник центру"
        else -> value
    }

    private fun statusLabel(value: String): String = when (value) {
        "draft" -> "Чернетка"
        "scheduled" -> "Заплановано"
        "confirmed" -> "Підтверджено"
        "completed" -> "Проведено"
        "cancelled" -> "Скасовано"
        "no_show" -> "Не з’явився"
        else -> value
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        backAction?.invoke() ?: super.onBackPressed()
    }

}
