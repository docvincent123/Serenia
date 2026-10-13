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
    private val ink = MobileUi.ink
    private val muted = MobileUi.muted
    private val forest = MobileUi.accent
    private val forestDark = MobileUi.onAccent
    private val forestSoft = MobileUi.soft
    private val line = MobileUi.border

    private val updates by lazy { MobileUpdates(this, { server }, { token }, { consultationWindow == null && !isFinishing && !isDestroyed }) }
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
    private var connectionEpoch = 0L
    private var checkingConnection = false
    private var syncRunning = false
    private var statusView: TextView? = null
    private var workspaceTitle: TextView? = null
    private var draftIndicatorRefresh: (() -> Unit)? = null
    private val pendingIndicators = mutableListOf<Pair<ImageView, () -> Boolean>>()
    private val draftSyncTick = Runnable { if(token.isNotBlank()) { OfflineSyncJob.schedule(this, server, userId); syncNow() } }
    private fun updateTransferIndicators() {
        pendingIndicators.toList().forEach { (view, pending) -> view.visibility = if(runCatching { pending() }.getOrDefault(true)) View.VISIBLE else View.GONE }
        draftIndicatorRefresh?.invoke()
    }
    private fun unsentIcon() = ImageView(this).apply {
        setImageResource(R.drawable.ic_unsent); contentDescription = "Не передано на сервер"
        setPadding(dp(10), dp(10), dp(10), dp(10))
    }
    private fun scheduleDraftSync() {
        syncHandler.removeCallbacks(draftSyncTick); syncHandler.postDelayed(draftSyncTick, 1800)
    }
    private var lastCacheTime = 0L
    private val syncHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var homeAppointmentsRefresh: ((JSONArray) -> Unit)? = null
    private var appointmentRefreshRunning = false
    private val syncTick = object : Runnable {
        override fun run() { syncNow(); refreshAppointments(); if(token.isNotBlank()) updates.check(); syncHandler.postDelayed(this, 60000) }
    }
    private var networkCallback: android.net.ConnectivityManager.NetworkCallback? = null
    private fun offlineStore() = OfflineStore(this, server, userId)
    override fun onResume() { super.onResume(); updates.resume(); syncHandler.removeCallbacks(syncTick); syncHandler.post(syncTick) }
    override fun onPause() { syncHandler.removeCallbacks(syncTick); super.onPause() }
    override fun onDestroy() {
        syncHandler.removeCallbacks(syncTick); syncHandler.removeCallbacks(draftSyncTick)
        networkCallback?.let { runCatching { (getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).unregisterNetworkCallback(it) } }
        consultationWindow?.dismiss(); consultationWindow = null
        pdfPreview?.close(); pdfPreview = null
        updates.close(); io.shutdown(); cacheIo.shutdown(); super.onDestroy()
    }
    private fun unavailable(error: Exception) = error is java.io.IOException && error !is javax.net.ssl.SSLException
    private fun updateConnectionStatus() {
        if(token.isBlank()) return
        val count = runCatching { val q = offlineStore().queue(); (0 until q.length()).count { q.getJSONObject(it).optString("state") in listOf("pending", "blocked") } }.getOrDefault(0)
        statusView?.apply {
            val online = !offlineMode && !checkingConnection
            text = when { checkingConnection -> "● Перевірка"; online -> "● Онлайн"; else -> "● Офлайн" }
            setTextColor(Color.parseColor(when { checkingConnection -> "#713F12"; online -> "#14532D"; else -> "#991B1B" }))
            background = rounded(Color.parseColor(when { checkingConnection -> "#FEF3C7"; online -> "#DCFCE7"; else -> "#FEE2E2" }), 12)
            contentDescription = text.toString() + ". Зв’язок із сервером центру. У черзі: $count" +
                (if(cachePreparing) ". Завантаження офлайн-копій" else "")
        }
    }
    private fun syncNow(refresh: Boolean = false) {
        if(token.isBlank() || role != "psychologist" || syncRunning || isDestroyed) return
        syncRunning = true
        val base = server; val sessionToken = token; val uid = userId; val networkEpoch = connectionEpoch
        val store = OfflineStore(this, base, uid)
        io.execute {
            var authExpired = false
            var connected = false
            try {
                val shift = requestAt(base, "GET", "/api/shift-day", authToken = sessionToken)
                connected = true; store.saveCache("/api/shift-day", shift)
                val draftsAuthorized = DraftSync(DraftStore(this, base, uid), store) { method, path, data ->
                    if(store.session()?.optString("token") != sessionToken) throw SyncFailure(401, "Потрібен повторний вхід")
                    try { requestAt(base, method, path, data, sessionToken) as JSONObject }
                    catch(e: ApiError) { throw SyncFailure(e.status, e.message ?: "Помилка сервера") }
                }.run()
                val authorized = draftsAuthorized && ConsultationSync(store) { payload ->
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
                if(connectionEpoch == networkEpoch) { offlineMode = !connected; checkingConnection = false }
                updateConnectionStatus(); updateTransferIndicators()
                if(connectionEpoch != networkEpoch) syncHandler.post { syncNow() }
                if(authExpired) { store.revokeSession(); logout() }
                else if(refresh) syncScreen()
                else if(selectedNavigation == "messages" && consultationWindow == null) messagesScreen()
            }
        }
    }
    private fun refreshAppointments() {
        if(token.isBlank() || role != "psychologist" || appointmentRefreshRunning) return
        appointmentRefreshRunning = true
        val base = server; val auth = token; val uid = userId
        cacheIo.execute {
            try {
                val store = OfflineStore(this, base, uid)
                val shift = requestAt(base, "GET", "/api/shift-day", authToken = auth) as JSONObject
                store.saveCache("/api/shift-day", shift)
                if(!shift.optBoolean("open")) {
                    if(token == auth && server == base) { AppointmentReminders.cancelScope(this, base, uid); ShiftNotifications.refresh(this, base, uid) }
                } else {
                    for(day in 0..1) {
                        val path = "/api/appointments?date=" + LocalDate.now().plusDays(day.toLong())
                        store.saveCache(path, requestAt(base, "GET", path, authToken = auth))
                    }
                    if(token == auth && server == base) {
                        AppointmentReminders.refreshFromCache(this, base, uid)
                        runOnUiThread {
                            if(token == auth && server == base && workspaceReady && consultationWindow == null && selectedNavigation in listOf("home", "archive"))
                                homeAppointmentsRefresh?.invoke(store.cache("/api/appointments?date=" + LocalDate.now()) as? JSONArray ?: JSONArray())
                        }
                    }
                }
            } catch(_: Exception) { }
            finally { runOnUiThread { appointmentRefreshRunning = false } }
        }
    }
    private fun prepareOfflineCache(base: String, auth: String, store: OfflineStore) {
        if(cachePreparing) return
        cachePreparing = true; updateConnectionStatus()
        cacheIo.execute {
            var message = "Офлайн-копії оновлено"
            var denied = false
            try { warmCache(base, auth, store); if(token == auth && server == base) AppointmentReminders.refreshFromCache(this, base, userId) }
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
        val ids = mutableSetOf<Long>(); val directory = JSONArray()
        for(day in 0..7) {
            val path = "/api/appointments?date=" + LocalDate.now().plusDays(day.toLong())
            val rows = requestAt(base, "GET", path, authToken = auth) as JSONArray
            store.saveCache(path, rows)
            for(i in 0 until rows.length()) {
                val patients = rows.getJSONObject(i).optJSONArray("patients") ?: JSONArray()
                for(j in 0 until patients.length()) {
                    val patient = patients.getJSONObject(j)
                    if(ids.add(patient.optLong("id"))) directory.put(patient)
                }
            }
        }
        store.saveCache("/api/patients", directory)
        for(id in ids) {
            val path = "/api/patients/$id"
            try { store.saveCache(path, requestAt(base, "GET", path, authToken = auth)) }
            catch(e: ApiError) { if(e.status == 401) throw e; store.forgetCache(path) }
        }
    }
    private fun syncScreen() {
        backAction = { moreScreen() }; val body = root(); body.addView(topBar("Стан передавання", ::homeScreen))
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
        val drafts = DraftStore(this, server, userId)
        val cachedPatients = offlineStore().cache("/api/patients") as? JSONArray ?: JSONArray()
        for(id in drafts.patients()) {
            val draft = drafts.read(id) ?: continue
            if(DraftSync.transferred(draft)) continue
            val name = (0 until cachedPatients.length()).map { cachedPatients.getJSONObject(it) }.firstOrNull { it.optLong("id") == id }?.optString("name") ?: "Пацієнт №$id"
            val item = card(); item.addView(title(name, 18f))
            item.addView(caption(if(draft.optBoolean("sync_blocked")) draft.optString("sync_error") else "Запис у роботі · не передано на сервер"))
            item.addView(secondary("Відкрити запис") { consultationDialog(id, name) }); body.addView(item)
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
            override fun onAvailable(network: android.net.Network) { runOnUiThread {
                connectionEpoch++; checkingConnection = token.isNotBlank(); updateConnectionStatus()
                syncNow(); refreshAppointments()
            } }
            override fun onLost(network: android.net.Network) { runOnUiThread {
                connectionEpoch++
                if(connectivity.activeNetwork == null) { offlineMode = true; checkingConnection = false; updateConnectionStatus() }
                else { checkingConnection = token.isNotBlank(); updateConnectionStatus(); syncNow(); refreshAppointments() }
            } }
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
        statusView = null; workspaceTitle = null; pendingIndicators.clear()
        if(token.isNotBlank() && workspaceReady) {
            val header = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setBackgroundColor(forest); setPadding(dp(12), dp(8), dp(16), dp(8))
            }
            header.addView(Button(this).apply {
                text = "☰"; textSize = 25f; contentDescription = "Відкрити меню психолога"
                setTextColor(MobileUi.onAccent); background = rounded(forest, 8)
                setOnClickListener {
                    val child = if(content is ScrollView && content.childCount > 0) content.getChildAt(0) else content
                    if(child.tag == "unsaved_form") AlertDialog.Builder(this@MainActivity).setTitle("Залишити форму?")
                        .setMessage("Незбережені зміни буде втрачено.").setNegativeButton("Продовжити", null)
                        .setPositiveButton("Залишити") { _, _ -> openMenu() }.show()
                    else openMenu()
                }
            }, LinearLayout.LayoutParams(dp(48), dp(48)))
            header.addView(TextView(this).apply {
                workspaceTitle = this
                text = "SOLVIA"; textSize = 20f; setTextColor(MobileUi.onAccent)
                setPadding(dp(12), 0, 0, 0); setTypeface(typeface, Typeface.BOLD)
            }, LinearLayout.LayoutParams(0, -2, 1f))
            statusView = TextView(this).apply {
                tag = "connection-status"; textSize = 12f; gravity = Gravity.CENTER
                setTypeface(typeface, Typeface.BOLD); setPadding(dp(8), dp(8), dp(8), dp(8))
                minHeight = dp(40); setOnClickListener { syncScreen() }
            }
            header.addView(statusView, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(8) })
            header.addView(logo(36).apply { contentDescription = "Емблема SOLVIA" }, LinearLayout.LayoutParams(dp(36), dp(36)))
            shell.addView(header)
            updateConnectionStatus()
        }
        shell.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(shell)
        lightSystemBars(window)
    }

    private fun lightSystemBars(target: android.view.Window) {
        if(Build.VERSION.SDK_INT >= 30) target.insetsController?.setSystemBarsAppearance(0,
            android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS)
        else target.decorView.systemUiVisibility = 0
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

    private fun menuSections() = listOf(
        "Робота" to listOf("Активні консультації", "Архів зміни", "Повідомлення"),
        "Особисте" to listOf("Мій профіль", "Налаштування", "Змінити пароль"),
        "Підключення" to listOf("Стан передавання", "Перепідключення", "Вийти")
    )
    private fun menuIcon(label: String) = when(label) {
        "Активні консультації", "Пацієнти", "Мій профіль" -> R.drawable.ic_patients
        "Архів зміни", "Документи пацієнтів" -> R.drawable.ic_reports
        "Повідомлення" -> R.drawable.ic_messages
        "Стан передавання" -> R.drawable.ic_unsent
        "Вийти" -> R.drawable.ic_logout
        else -> R.drawable.ic_settings
    }
    private fun navigateMenu(label: String) {
        when(label) {
            "Активні консультації" -> renderHomeScreen()
            "Архів зміни" -> renderHomeScreen("completed")
            "Повідомлення" -> messagesScreen()
            "Мій профіль" -> informationScreen()
            "Налаштування" -> settingsScreen()
            "Змінити пароль" -> passwordScreen()
            "Стан передавання" -> syncScreen()
            "Перепідключення" -> { syncNow(); refreshAppointments() }
            "Вийти" -> AlertDialog.Builder(this).setTitle("Вийти?")
                .setMessage("Збережені записи залишаться на телефоні. Непередані дані буде синхронізовано після наступного входу.")
                .setNegativeButton("Залишитися", null).setPositiveButton("Вийти") { _, _ -> logout() }.show()
        }
    }
    private fun openMenu() {
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(MobileUi.panel) }
        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(forest); setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        val identity = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        identity.addView(logo(44), LinearLayout.LayoutParams(dp(44), dp(44)).apply { marginEnd = dp(14) })
        identity.addView(title(userName, 20f).apply { setTextColor(MobileUi.onAccent) }, LinearLayout.LayoutParams(0, -2, 1f))
        heading.addView(identity)
        heading.addView(TextView(this).apply { text = "Психолог · SOLVIA"; setTextColor(MobileUi.onAccent); textSize = 13f })
        panel.addView(heading)
        val rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(12)) }
        val popup = android.widget.PopupWindow(panel, (resources.displayMetrics.widthPixels * 0.86f).toInt(), -1, true).apply {
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(MobileUi.panel)); elevation = dp(16).toFloat(); isOutsideTouchable = true
        }
        fun row(label: String, icon: Int, action: () -> Unit) {
            rows.addView(MobileUi.button(this, label) { popup.dismiss(); action() }.apply {
                textSize = 18f; gravity = Gravity.START or Gravity.CENTER_VERTICAL
                background = rounded(MobileUi.panel, 0)
                val image = getDrawable(icon)?.mutate(); image?.setTint(MobileUi.ink)
                image?.setBounds(0, 0, dp(24), dp(24)); setCompoundDrawables(image, null, null, null)
                compoundDrawablePadding = dp(16); minHeight = dp(58)
            })
        }
        menuSections().forEach { (section, labels) ->
            rows.addView(caption(section.uppercase()).apply { setTextColor(forest); setPadding(dp(14), dp(16), dp(14), dp(4)) })
            labels.forEach { label -> row(label, menuIcon(label)) { navigateMenu(label) } }
        }
        panel.addView(scroll(rows), LinearLayout.LayoutParams(-1, 0, 1f))
        popup.showAtLocation(window.decorView, Gravity.TOP or Gravity.START, 0, 0)
    }

    private fun moreScreen() {
        selectedNavigation = "more"; backAction = { homeScreen() }
        val body = root(); body.addView(title("Меню", 26f)); body.addView(caption(userName))
        menuSections().forEach { (section, labels) ->
            val group = card(); group.addView(title(section, 18f))
            labels.forEach { label -> group.addView(secondary(label) { navigateMenu(label) }) }
            body.addView(group)
        }
        mount(scroll(body))
    }

    private fun messagesScreen() {
        val previousScroll = if(selectedNavigation == "messages") findViewById<android.view.ViewGroup>(android.R.id.content)?.let { group ->
            fun find(view: View): ScrollView? = if(view is ScrollView) view else if(view is android.view.ViewGroup) (0 until view.childCount).firstNotNullOfOrNull { find(view.getChildAt(it)) } else null
            find(group)?.scrollY ?: 0
        } else 0
        selectedNavigation = "messages"; backAction = { homeScreen() }
        val body = root(); body.addView(topBar("Повідомлення", ::homeScreen))
        body.addView(title("Передавання записів", 18f))
        val queue = offlineStore().queue()
        val pending = (0 until queue.length()).map { queue.getJSONObject(it) }.filter { it.optString("state") in listOf("pending", "blocked") }
        if(pending.isEmpty()) body.addView(caption("Немає непереданих завершених консультацій."))
        pending.forEach { record ->
            val row = card(); row.addView(title(record.optString("patient_name"), 18f))
            row.addView(caption(if(record.optString("state") == "blocked") "Потрібна перевірка: " + record.optString("error") else "Запис очікує передавання на сервер"))
            row.addView(secondary("Переглянути стан передавання") { syncScreen() }); body.addView(row)
        }
        val drafts = DraftStore(this, server, userId)
        val unsent = drafts.patients().count { drafts.read(it)?.let { value -> !DraftSync.transferred(value) } ?: false }
        if(unsent > 0) body.addView(caption("Записів у роботі, що очікують передавання: $unsent"))
        body.addView(title("Нагадування", 18f))
        val notices = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; body.addView(notices)
        val messageScroll = scroll(body) { syncNow() }
        mount(messageScroll); messageScroll.post { messageScroll.scrollTo(0, previousScroll) }
        apiAsync("GET", "/api/appointments?date=" + LocalDate.now(), onError = { notices.addView(caption("Нагадування поки недоступні. Перевірте підключення.")) }) { result ->
            val rows = result as JSONArray; var count = 0
            for(i in 0 until rows.length()) {
                val item = rows.getJSONObject(i)
                if(item.optString("status") !in listOf("scheduled", "confirmed")) continue
                val start = runCatching { java.time.LocalDateTime.parse(item.optString("start")) }.getOrNull() ?: continue
                val minutes = java.time.Duration.between(java.time.LocalDateTime.now(), start).toMinutes()
                if(minutes !in -15..30) continue
                val patients = item.optJSONArray("patients") ?: JSONArray()
                val unfinished = (0 until patients.length()).map { patients.getJSONObject(it) }.filter { patient ->
                    patient.optString("completed_at").isBlank() && !(0 until queue.length()).any { j ->
                        val record = queue.getJSONObject(j); val data = record.getJSONObject("payload")
                        data.optLong("appointment_id") == item.optLong("id") && data.optLong("patient_id") == patient.optLong("id") && record.optString("state") in listOf("pending", "blocked", "sent")
                    }
                }
                if(unfinished.isEmpty()) continue
                val row = card(); row.addView(title(if(minutes <= 0) "Час консультації" else "Консультація незабаром", 18f))
                row.addView(caption(item.optString("start").takeLast(5) + " · " + item.optString("room")))
                row.addView(caption(unfinished.joinToString(", ") { it.optString("name") }))
                row.addView(secondary("Відкрити активні") { renderHomeScreen() }); notices.addView(row); count++
            }
            if(count == 0) notices.addView(caption("Нових нагадувань немає."))
        }
    }

    private fun informationScreen() {
        val body = root(); backAction = { moreScreen() }
        body.addView(topBar("Інформація", ::moreScreen))
        val account = card(); account.addView(title(userName, 22f))
        account.addView(caption("Психолог · користувач №$userId")); body.addView(account)
        val connection = card(); connection.addView(title("Підключення", 20f)); connection.addView(caption(server))
        connection.addView(caption(if(offlineMode) "Офлайн" else "Онлайн")); body.addView(connection)
        body.addView(secondary("Перепідключення") { syncNow(refresh = true) })
        body.addView(secondary("Налаштування") { settingsScreen() })
        body.addView(secondary("Змінити пароль") { passwordScreen() })
        body.addView(caption("SOLVIA ${BuildConfig.VERSION_NAME} · QureMed Industries"))
        mount(scroll(body))
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
        setImageResource(R.drawable.solvia_badge)
        adjustViewBounds = true
        scaleType = ImageView.ScaleType.CENTER_CROP
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size)).apply { bottomMargin = dp(12) }
    }

    private fun title(value: String, size: Float = 28f): TextView = TextView(this).apply {
        text = value
        textSize = size * MobileUi.textScale(this@MainActivity)
        setTextColor(ink)
        setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(8), 0, dp(10))
    }

    private fun caption(value: String): TextView = TextView(this).apply {
        text = value
        textSize = 13f * MobileUi.textScale(this@MainActivity)
        setTextColor(muted)
        setPadding(0, 0, 0, dp(12))
    }

    private fun edit(hintText: String, password: Boolean = false): EditText = EditText(this).apply {
        setSelectAllOnFocus(prefs.getBoolean("select_all", false))
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

    private fun primary(label: String, action: () -> Unit): Button = MobileUi.button(this, label, primary = true, action = action).apply { minimalIcon(label, MobileUi.onAccent) }
    private fun secondary(label: String, action: () -> Unit): Button = MobileUi.button(this, label, action = action).apply { minimalIcon(label, MobileUi.buttonInk) }
    private fun card(): LinearLayout = MobileUi.card(this)

    private fun scroll(content: View, refresh: (() -> Unit)? = null): ScrollView =
        (if(refresh == null) ScrollView(this) else RefreshScrollView(this, refresh)).apply {
            isFillViewport = true; isVerticalScrollBarEnabled = true
            addView(content, android.widget.FrameLayout.LayoutParams(-1, -2))
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

    override fun onNewIntent(next: Intent) {
        super.onNewIntent(next); setIntent(next)
        next.data?.let { uri ->
            if(token.isNotBlank()) Toast.makeText(this, "Для зміни сервера спочатку вийдіть із профілю.", Toast.LENGTH_LONG).show()
            else importServerConfig(uri)
        }
    }

    private fun openServerConfigFile() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(intent, openConfigRequest)
    }

    private fun configAddress(value: String): String {
        val validated = normalize(value)
        val supplied = URI(value.trim())
        // A file contains a URL, so preserve its standard port instead of guessing the LAN port.
        if(supplied.scheme != null && supplied.port == -1) {
            val scheme = supplied.scheme.lowercase()
            return URI(scheme, null, supplied.host.lowercase(), if(scheme == "https") 443 else 80, null, null, null).toString()
        }
        return validated
    }
    private fun rememberServer(candidate: String) {
        val previous = prefs.getString("server", "").orEmpty()
        if(previous.isNotBlank() && previous != candidate) {
            val uid = prefs.getLong("offline_user:$previous", 0)
            if(uid > 0) OfflineStore(this, previous, uid).revokeSession()
            AppointmentReminders.cancelScope(this, previous, uid); ShiftNotifications.clear(this)
        }
        server = candidate; prefs.edit().putString("server", candidate).apply()
    }
    private fun importServerConfig(uri: android.net.Uri) {
        io.execute {
            try {
                val text = contentResolver.openInputStream(uri)?.use { stream ->
                    val buffer = java.io.ByteArrayOutputStream(); val chunk = ByteArray(4096)
                    while(buffer.size() <= 65536) { val n = stream.read(chunk); if(n < 0) break; buffer.write(chunk, 0, n) }
                    val bytes = buffer.toByteArray()
                    require(bytes.size <= 65536) { "Файл підключення завеликий" }; String(bytes, Charsets.UTF_8)
                }
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
                val candidate = configAddress(firstSource)

                try {
                    val health = requestAt(candidate, "GET", "/api/health", authToken = "") as JSONObject
                    require(health.optBoolean("ok")) { "Сервер не підтвердив готовність" }
                    rememberServer(candidate)
                    runOnUiThread {
                        Toast.makeText(this, "Сервер SOLVIA підключено: $server", Toast.LENGTH_LONG).show()
                        loginScreen()
                    }
                } catch (primary: Exception) {
                    if (candidate.startsWith("https://", true) && httpSource.isNotBlank()) {
                        val localHttp = configAddress(httpSource)
                        val health = requestAt(localHttp, "GET", "/api/health", authToken = "") as JSONObject
                        require(health.optBoolean("ok")) { "Локальний HTTP сервер не готовий" }
                        runOnUiThread {
                            AlertDialog.Builder(this)
                                .setTitle("Доступний локальний HTTP")
                                .setMessage("HTTPS не вдалося відкрити, але сервер доступний через $localHttp. Використовувати HTTP лише у приватній Wi-Fi/LAN мережі центру? Для VPS та інтернету використовуйте HTTPS.")
                                .setNegativeButton("Ні") { _, _ -> setupScreen() }
                                .setPositiveButton("Підключити локально") { _, _ ->
                                    rememberServer(localHttp)
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
        val body = root().apply {
            setPadding(dp(24), dp(36), dp(24), dp(24))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(bg, Color.rgb(29, 34, 41)))
        }
        val brand = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        brand.addView(logo(88))
        brand.addView(title("SOLVIA", 34f).apply { letterSpacing = 0.12f; gravity = Gravity.CENTER })
        brand.addView(caption("Кабінет психолога").apply { gravity = Gravity.CENTER; textSize = 15f })
        body.addView(brand); body.addView(spacer(22))
        val form = card(); form.addView(title("Вхід до центру", 22f))
        val login = edit("Ваш логін").apply {
            isSingleLine = true; imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_NEXT
            setAutofillHints(View.AUTOFILL_HINT_USERNAME)
        }
        val password = edit("Пароль", true).apply {
            isSingleLine = true; imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            setAutofillHints(View.AUTOFILL_HINT_PASSWORD)
        }
        form.addView(caption("Логін")); form.addView(login)
        form.addView(caption("Пароль")); form.addView(password)
        val error = caption("").apply { visibility = View.GONE; setTextColor(Color.rgb(255, 180, 171)) }
        form.addView(error)
        var signingIn = false
        var submit: Button? = null
        submit = primary("Увійти") {
            if(!signingIn) {
                if(login.text.isBlank() || password.text.isBlank()) {
                    error.text = "Введіть логін і пароль."; error.visibility = View.VISIBLE
                } else {
                    signingIn = true; submit?.isEnabled = false; error.visibility = View.GONE
                    val payload = JSONObject().put("login", login.text.toString().trim()).put("password", password.text.toString())
                        .put("platform", "Android").put("device_id", Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "")
                        .put("device_name", (Build.MANUFACTURER + " " + Build.MODEL).trim())
                    apiAsync("POST", "/api/login", payload, onError = {
                        signingIn = false; submit?.isEnabled = true; error.text = it; error.visibility = View.VISIBLE
                    }) { result -> signingIn = false; submit?.isEnabled = true; acceptLogin(result as JSONObject) }
                }
            }
        }
        password.setOnEditorActionListener { _, action, _ ->
            if(action == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) { submit?.performClick(); true } else false
        }
        form.addView(submit); body.addView(form)
        body.addView(caption("Налаштувати підключення").apply {
            gravity = Gravity.CENTER; setPadding(dp(8), dp(12), dp(8), dp(12)); minHeight = dp(48)
            setOnClickListener { setupScreen() }
        })
        body.addView(caption("SOLVIA ${BuildConfig.VERSION_NAME}").apply { gravity = Gravity.CENTER })
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
        homeScreen(); updates.check()
        AppointmentReminders.channel(this)
        if(Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 4200)
        refreshAppointments()
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

    private fun renderHomeScreen(initialTab: String = "active") {
        homeAppointmentsRefresh = null
        workspaceReady = true; selectedNavigation = if(initialTab == "completed") "archive" else "home"; backAction = null
        val body = root()
        val pageTitle = title(if(initialTab == "completed") "Архів зміни" else "Активні консультації", 26f)
        pageTitle.visibility = View.GONE
        body.addView(pageTitle)

        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        body.addView(tabs)
        val today = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; body.addView(today)
        mount(scroll(body) { syncNow(); refreshAppointments() })
        if(role != "director") apiAsync("GET", "/api/appointments?date=" + LocalDate.now()) { value ->
            var entries = value as JSONArray
            val visits = mutableListOf<Pair<JSONObject, JSONObject>>()
            for(i in 0 until entries.length()) {
                val item = entries.getJSONObject(i)
                val patients = item.optJSONArray("patients") ?: JSONArray()
                for(j in 0 until patients.length()) visits.add(item to patients.getJSONObject(j))
            }
            val queued = offlineStore().queue()
            fun localState(item: JSONObject, patient: JSONObject): String = (0 until queued.length()).map { queued.getJSONObject(it) }.lastOrNull {
                val payload = it.getJSONObject("payload")
                payload.optLong("appointment_id") == item.optLong("id") && payload.optLong("patient_id") == patient.optLong("id") && it.optString("state") in listOf("pending", "blocked", "sent")
            }?.optString("state") ?: ""
            fun completed(item: JSONObject, patient: JSONObject) = VisitState.completed(patient.optString("completed_at"), item.optString("status"), localState(item, patient))
            fun active(item: JSONObject, patient: JSONObject) = !completed(item,patient) && item.optString("status") in listOf("scheduled", "confirmed")
            fun render(tab: String) {
                selectedNavigation = if(tab == "completed") "archive" else "home"
                pageTitle.text = if(tab == "completed") "Архів зміни" else "Активні консультації"
                workspaceTitle?.text = "SOLVIA · " + LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("dd.MM"))
                pendingIndicators.clear()
                tabs.removeAllViews(); today.removeAllViews()
                val activeCount = visits.count { active(it.first,it.second) }
                val completedCount = visits.count { completed(it.first,it.second) }
                listOf("active" to "Активні · $activeCount", "completed" to "Архів · $completedCount").forEach { (key,label) ->
                    tabs.addView(MobileUi.button(this,label,selected=tab==key) { render(key) }.apply {
                        background = rounded(if(tab == key) forestSoft else MobileUi.panel, 0)
                        setTextColor(if(tab == key) forest else ink)
                    }, LinearLayout.LayoutParams(0,dp(48),1f).apply { rightMargin=dp(2) })
                }
                today.addView(caption(if(tab=="completed") "Проконсультовані за цю зміну. Значок збоку означає, що запис ще не передано." else "Пацієнти, що очікують консультації. Відмітьте прибуття пацієнта перед початком консультації."))
                val visible = visits.filter { if(tab=="completed") completed(it.first,it.second) else active(it.first,it.second) }
                if(visible.isEmpty()) {
                    val empty = card(); empty.addView(logo(48))
                    empty.addView(title(if(tab == "completed") "Завершених консультацій ще немає" else "Очікуємо призначення", 20f))
                    empty.addView(caption(if(tab == "completed") "Після завершення консультації запис з’явиться тут." else "Нові прийоми, призначені вам реєстратурою, з’являться в цьому списку."))
                    today.addView(empty)
                }
                for((item,patient) in visible) {
                    val row = card()
                    val state = localState(item, patient)
                    val draft = DraftStore(this, server, userId).read(patient.optLong("id"))
                    val pending = state in listOf("pending", "blocked") || (state.isBlank() && draft != null && draft.optLong("appointment_id") == item.optLong("id") && !DraftSync.transferred(draft))
                    val heading = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                    heading.addView(title(item.optString("start").takeLast(5),18f).apply {
                        gravity = Gravity.CENTER; background = rounded(forestSoft,12); setTextColor(forest)
                    }, LinearLayout.LayoutParams(dp(68),dp(58)).apply { rightMargin = dp(10) })
                    heading.addView(title(patient.optString("name"),22f), LinearLayout.LayoutParams(0, -2, 1f))
                    val indicator = unsentIcon().apply {
                        visibility = if(pending) View.VISIBLE else View.GONE
                        tag = "unsent:${patient.optLong("id")}:${item.optLong("id")}"
                        setOnClickListener { syncScreen() }
                    }
                    pendingIndicators.add(indicator to { val rows = offlineStore().queue()
                        val record = (0 until rows.length()).map { rows.getJSONObject(it) }.lastOrNull {
                            val payload = it.getJSONObject("payload")
                            payload.optLong("patient_id") == patient.optLong("id") && payload.optLong("appointment_id") == item.optLong("id") && it.optString("state") != "reviewed"
                        }
                        if(record != null) record.optString("state") in listOf("pending", "blocked")
                        else DraftStore(this, server, userId).read(patient.optLong("id"))?.let { it.optLong("appointment_id") == item.optLong("id") && !DraftSync.transferred(it) } ?: false
                    })
                    heading.addView(indicator, LinearLayout.LayoutParams(dp(48), dp(48))); row.addView(heading)
                    row.addView(caption("№ " + patient.optString("patient_no", "—") + " · " + item.optString("start").takeLast(5) + " — " + item.optString("end").takeLast(5)))
                    row.addView(caption("Кабінет: " + item.optString("room")))
                    row.addView(caption(when {
                        patient.optString("completed_at").isNotBlank() -> "Передано на сервер · " + patient.optString("completed_at").substringAfter('T').take(5)
                        state=="blocked" -> "Потрібна перевірка синхронізації"
                        state=="pending" -> "Збережено на телефоні · очікує передавання"
                        state=="sent" -> "Передано на сервер"
                        patient.optString("arrived_at").isNotBlank() -> "Пацієнт у центрі"
                        else -> "Очікуємо прибуття"
                    }))
                    if(active(item,patient) && patient.optString("arrived_at").isBlank()) {
                        lateinit var arrived: Button
                        arrived = primary("Пацієнт прибув") {
                            arrived.isEnabled = false
                            apiAsync("POST", "/api/appointments/${item.optLong("id")}/arrival", JSONObject().put("patient_id", patient.optLong("id")), onError = { message -> arrived.isEnabled = true; showError(message) }) { value ->
                                patient.put("arrived_at", (value as JSONObject).optString("arrived_at", java.time.LocalDateTime.now().toString()))
                                offlineStore().saveCache("/api/appointments?date=" + LocalDate.now(), entries)
                                render(tab); refreshAppointments()
                            }
                        }
                        row.addView(arrived)
                    }
                    if(active(item,patient) && state.isBlank() && patient.optString("arrived_at").isNotBlank()) row.addView(primary(if(draft != null) "Продовжити консультацію" else "Почати консультацію") {
                        consultationDialog(patient.getLong("id"),patient.optString("name"),item.getLong("id"))
                    })
                    if(state in listOf("pending","blocked")) row.addView(secondary("Синхронізація") { syncScreen() })
                    row.addView(secondary(if(tab == "completed") "Переглянути запис" else "Деталі прийому") { visitDetailsScreen(patient.getLong("id"), item.getLong("id"), tab) })
                    today.addView(row)
                }
            }
            AppointmentReminders.refreshFromCache(this, server, userId)
            render(initialTab)
            var fingerprint = entries.toString()
            homeAppointmentsRefresh = { updated ->
                val fresh = updated.toString()
                if(fresh != fingerprint) {
                    fingerprint = fresh; entries = updated; visits.clear()
                    for(i in 0 until updated.length()) {
                        val item = updated.getJSONObject(i); val patients = item.optJSONArray("patients") ?: JSONArray()
                        for(j in 0 until patients.length()) visits.add(item to patients.getJSONObject(j))
                    }
                    val listScroll = body.parent as? ScrollView
                    val position = listScroll?.scrollY ?: 0
                    render(if(selectedNavigation == "archive") "completed" else "active")
                    listScroll?.post { listScroll.scrollTo(0, position) }
                }
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

    private fun visitDetailsScreen(patientId: Long, appointmentId: Long, from: String) {
        selectedNavigation = if(from == "completed") "archive" else "home"
        val back = { renderHomeScreen(from) }; backAction = back
        val body = root(); body.addView(topBar(if(from == "completed") "Запис консультації" else "Деталі прийому", back))
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; body.addView(content)
        mount(scroll(body))
        fun render(patient: JSONObject) {
            content.removeAllViews()
            val identity = card(); identity.addView(title(patient.optString("name"), 23f))
            identity.addView(caption("№ " + patient.optString("patient_no", "—")))
            for((key,label) in listOf("dob" to "Дата народження", "category" to "Категорія", "phone" to "Телефон"))
                if(patient.optString(key).isNotBlank()) identity.addView(caption(label + ": " + patient.optString(key)))
            content.addView(identity)
            val history = patient.optJSONArray("consultations") ?: JSONArray()
            val record = (0 until history.length()).map { history.getJSONObject(it) }.firstOrNull { it.optLong("appointment_id") == appointmentId }
            if(record != null) {
                if(record.optString("sync_status").isNotBlank()) content.addView(caption(record.optString("sync_status")))
                for((key,label) in listOf("request_text" to "Запит", "state_text" to "Скарги та стан", "note" to "Нотатка психолога",
                    "work_done" to "Проведена робота", "goals" to "Цілі", "result_text" to "Результат і динаміка", "recommendations" to "Рекомендації",
                    "homework" to "Домашнє завдання", "next_plan" to "Подальший план")) {
                    val value = record.optString(key)
                    if(value.isNotBlank()) {
                        val box = card(); box.addView(title(label, 17f)); box.addView(MobileUi.label(this, value).apply { setTextIsSelectable(true) }); content.addView(box)
                    }
                }
            } else if(from == "completed") content.addView(caption("Оновіть передавання, якщо запис ще зберігається на телефоні."))
            if(from != "completed") content.addView(primary("Відкрити консультацію") { consultationDialog(patientId, patient.optString("name"), appointmentId) })
        }
        val journal = offlineStore()
        val queue = journal.queue()
        val local = (0 until queue.length()).map { queue.getJSONObject(it) }.lastOrNull {
            val data = it.getJSONObject("payload")
            data.optLong("patient_id") == patientId && data.optLong("appointment_id") == appointmentId && it.optString("state") in listOf("pending", "blocked", "sent")
        }
        fun localCopy(): JSONObject {
            val record = JSONObject(local!!.getJSONObject("payload").toString())
                .put("sync_status", if(local.optString("state") == "sent") "Передано на сервер" else "Запис очікує передавання")
            return JSONObject().put("id",patientId).put("name",local.optString("patient_name"))
                .put("consultations",JSONArray().put(record))
        }
        if(from == "completed" && local != null && offlineMode && journal.session() != null) {
            render(localCopy()); return
        }
        mobileApi().call("GET", "/api/patients/$patientId", null, { result -> render(result as JSONObject) }, { message ->
            if(from == "completed" && local != null && journal.session() != null) render(localCopy())
            else content.addView(caption(message))
        })
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
                box.background = rounded(if (item.optString("status") == "completed") MobileUi.soft else MobileUi.panel, 17, line)
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
                    box.background = rounded(MobileUi.panel, 17, line)
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
                    if (patients.getJSONObject(j).optLong("id") == patientId && patients.getJSONObject(j).optString("completed_at").isBlank()) {
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
            val scroll = ScrollView(this).apply { tag = "consultation-scroll"; addView(wrap) }

            val consultationHeader = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            consultationHeader.addView(title(patientName, 20f), LinearLayout.LayoutParams(0, -2, 1f))
            val writingIndicator = unsentIcon()
            consultationHeader.addView(writingIndicator, LinearLayout.LayoutParams(dp(48), dp(48)))
            wrap.addView(consultationHeader)
            wrap.addView(caption("Зміни зберігаються автоматично."))

            val appointmentSpinner = Spinner(this)
            val appointmentLabels = eligible.map {
                it.optString("start").takeLast(5) + " · " + it.optString("room")
            }
            appointmentSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, appointmentLabels)
            appointmentSpinner.setSelection(0)
            if(preferredAppointment > 0 || savedDraft != null) {
                val selectedId = savedDraft?.optLong("appointment_id") ?: preferredAppointment
                val chosen = eligible.indexOfFirst { it.optLong("id") == selectedId }
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

            val emotionSpinner = Spinner(this).apply {
                tag = "emotional-state"
                adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, ConsultationChoices.emotionalStates)
            }
            val followupSpinner = Spinner(this).apply {
                tag = "followup-plan"
                adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, ConsultationChoices.followupPlans)
            }
            val consultationSpinners = listOf(appointmentSpinner, typeSpinner, riskSpinner, emotionSpinner, followupSpinner)

            fun plannedMinutes(): Int {
                val a = eligible[appointmentSpinner.selectedItemPosition]
                return runCatching { java.time.Duration.between(java.time.LocalDateTime.parse(a.getString("start")), java.time.LocalDateTime.parse(a.getString("end"))).toMinutes().toInt().coerceIn(10,480) }.getOrDefault(60)
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
                    minHeight = dp(48)
                    setTextColor(ink)
                    textSize = 13f
                }
            }

            fun focusField(field: EditText) {
                field.requestFocus(); scroll.post { scroll.smoothScrollTo(0, field.top + (field.parent as View).top) }
            }
            fun addGap(parent: LinearLayout, value: Int = 8) = parent.addView(spacer(value))
            fun section(name: String, hint: String, build: (LinearLayout) -> Unit) {
                val box = card()
                box.background = rounded(MobileUi.panel, 18, line)
                val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                header.addView(TextView(this).apply { text = "▪"; textSize = 30f; setTextColor(forest) }, LinearLayout.LayoutParams(dp(30),dp(40)))
                header.addView(title(name, 19f)); box.addView(header); box.addView(caption(hint))
                build(box)
                wrap.addView(box)
            }

            section("Дані прийому", "Прийом визначено автоматично за вибраним пацієнтом.") { box ->
                box.addView(caption("Час прийому: " + eligible[appointmentSpinner.selectedItemPosition].optString("start").takeLast(5)))
                addGap(box)
                box.addView(caption("Тип консультації"))
                box.addView(typeSpinner)

            }

            section("Скарги та стан", "Запит пацієнта й поточний стан.") { box ->
                box.addView(caption("Основний запит — коротко, бажано словами пацієнта"))
                box.addView(requestText)
                addGap(box)
                box.addView(caption("Стан на початку — спостереження, скарги, важливі зміни"))
                box.addView(stateText)
                addGap(box); box.addView(caption("Емоційний стан — за вашою оцінкою (необов’язково)")); box.addView(emotionSpinner)
            }

            section("Проведена робота", "Нотатка, проведена робота, цілі та результат.") { box ->
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

            section("Рекомендації та план", "Домашнє завдання й план наступної зустрічі.") { box ->
                box.addView(caption("План наступної консультації"))
                box.addView(next)
                addGap(box)
                box.addView(caption("Домашнє завдання"))
                box.addView(homework)
                addGap(box)
                box.addView(caption("Рекомендації"))
                box.addView(recommendations)
                addGap(box); box.addView(caption("Подальший супровід (необов’язково)")); box.addView(followupSpinner)
            }

            section("Ризики та контроль", "Позначте лише оцінені вами ризики.") { box ->
                box.addView(caption("Рівень ризику"))
                box.addView(riskSpinner)
                addGap(box)
                box.addView(title("Важливі позначки", 15f))
                flagChecks.forEach { box.addView(it) }
            }

            val draftStatus = caption("Зміни зберігаються автоматично")
            wrap.addView(draftStatus)
            val textFields = linkedMapOf("note" to note, "goals" to goals, "next_plan" to next,
                "homework" to homework, "recommendations" to recommendations, "request_text" to requestText,
                "state_text" to stateText, "work_done" to workDone, "result_text" to resultText)
            if (savedDraft != null) {
                textFields.forEach { (key, field) -> field.setText(savedDraft.optString(key)) }
                typeSpinner.setSelection(typeValues.indexOf(savedDraft.optString("consultation_type", "repeat")).coerceAtLeast(0))
                riskSpinner.setSelection(riskValues.indexOf(savedDraft.optString("risk_level", "low")).coerceAtLeast(0))
                emotionSpinner.setSelection(ConsultationChoices.emotionalStates.indexOf(savedDraft.optString("emotional_state", "Не обрано")).coerceAtLeast(0))
                followupSpinner.setSelection(ConsultationChoices.followupPlans.indexOf(savedDraft.optString("followup_choice", "Не обрано")).coerceAtLeast(0))
                val selected = eligible.indexOfFirst { it.optLong("id") == savedDraft.optLong("appointment_id") }
                if (selected >= 0) appointmentSpinner.setSelection(selected)
                val flags = savedDraft.optJSONArray("risk_flags") ?: JSONArray()
                flagChecks.forEachIndexed { index, check -> check.isChecked = (0 until flags.length()).any { flags.optString(it) == flagValues[index].first } }
            }
            fun snapshot(): JSONObject {
                val flags = JSONArray(); flagChecks.forEachIndexed { index, check -> if (check.isChecked) flags.put(flagValues[index].first) }
                val value = JSONObject().put("client_key", clientKey).put("consult_date", draftDate)
                    .put("appointment_id", eligible[appointmentSpinner.selectedItemPosition].getLong("id"))
                    .put("duration_minutes", plannedMinutes())
                    .put("consultation_type", typeValues[typeSpinner.selectedItemPosition])
                    .put("risk_level", riskValues[riskSpinner.selectedItemPosition]).put("risk_flags", flags)
                    .put("emotional_state", ConsultationChoices.emotionalStates[emotionSpinner.selectedItemPosition])
                    .put("followup_choice", ConsultationChoices.followupPlans[followupSpinner.selectedItemPosition])
                textFields.forEach { (key, field) -> value.put(key, field.text.toString()) }; return value
            }
            val tools = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16),dp(16),dp(16),dp(16)) }
            writingIndicator.setOnClickListener {
                if(draftStore.read(patientId)?.optBoolean("sync_blocked") == true) {
                    (tools.parent as? android.view.ViewGroup)?.removeView(tools)
                    AlertDialog.Builder(this).setTitle("Перевірка передавання").setView(tools).setPositiveButton("Закрити", null).show()
                } else syncNow()
            }
            var submitted = false
            var serverRevision = savedDraft?.optInt("server_version", 0) ?: 0
            fun persistDraft() {
                if (submitted) return
                try {
                    val local = draftStore.saveEditing(patientId, snapshot().put("server_version", serverRevision))
                    serverRevision = local.optInt("server_version")
                    writingIndicator.visibility = if(DraftSync.transferred(local)) View.GONE else View.VISIBLE
                    draftStatus.text = if(DraftSync.transferred(local)) "Запис передано на сервер" else "Запис збережено на телефоні"
                    scheduleDraftSync()
                }
                catch (_: Exception) { draftStatus.text = "Не вдалося зберегти текст. Залиште цю форму відкритою." }
            }
            draftIndicatorRefresh = {
                val local = draftStore.read(patientId)
                if(local != null) {
                    serverRevision = local.optInt("server_version")
                    writingIndicator.visibility = if(DraftSync.transferred(local)) View.GONE else View.VISIBLE
                    draftStatus.text = if(DraftSync.transferred(local)) "Запис передано на сервер" else if(local.optBoolean("sync_blocked")) "Потрібна перевірка серверної версії" else "Запис збережено на телефоні"
                }
            }
            val watcher = object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { persistDraft() }
                override fun afterTextChanged(s: Editable?) {}
            }
            textFields.values.forEach { it.addTextChangedListener(watcher) }
            flagChecks.forEach { it.setOnCheckedChangeListener { _, _ -> persistDraft() } }
            val selectionWatcher = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) { persistDraft() }
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
            }
            consultationSpinners.forEach { it.onItemSelectedListener = selectionWatcher }

            val dialog = AlertDialog.Builder(this)
                .setTitle("Консультація")
                .setView(scroll)
                .setNegativeButton("Закрити", null)
                .setPositiveButton("Завершити", null)
                .create()
            consultationWindow = dialog
            dialog.setOnDismissListener { persistDraft(); draftIndicatorRefresh = null; if (consultationWindow === dialog) consultationWindow = null }
            tools.addView(secondary("Повторити передавання") {
                persistDraft(); syncNow()
            })
            tools.addView(secondary("Відновити серверний запис") {
                apiAsync("GET", "/api/patients/$patientId/draft") { value ->
                    val remote = value as JSONObject
                    val payload = remote.optJSONObject("payload")
                    if (payload == null) showError("Серверного запису поки немає")
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
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).apply {
                    isAllCaps = false; textSize = 15f; setTextColor(MobileUi.onAccent)
                    background = rounded(forest, 14); setPadding(dp(18), dp(10), dp(18), dp(10)); minHeight = dp(48)
                }
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).apply { isAllCaps = false; setTextColor(muted) }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    val minutes = plannedMinutes()
                    if (note.text.toString().isBlank()) {
                        focusField(note); Toast.makeText(this, "Заповніть приватну нотатку психолога.", Toast.LENGTH_LONG).show()
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
                        .put("recommendations", ConsultationChoices.include(recommendations.text.toString(), "Подальший супровід", ConsultationChoices.followupPlans, followupSpinner.selectedItemPosition))
                        .put("consultation_type", typeValues[typeSpinner.selectedItemPosition])
                        .put("duration_minutes", minutes)
                        .put("request_text", requestText.text.toString())
                        .put("state_text", ConsultationChoices.include(stateText.text.toString(), "Емоційний стан", ConsultationChoices.emotionalStates, emotionSpinner.selectedItemPosition))
                        .put("work_done", workDone.text.toString())
                        .put("result_text", resultText.text.toString())
                        .put("risk_level", riskValues[riskSpinner.selectedItemPosition])
                        .put("risk_flags", flags)
                    if(listOf("state_text", "recommendations").any { payload.optString(it).toByteArray(Charsets.UTF_8).size > 10000 }) {
                        Toast.makeText(this, "Скоротіть опис стану або рекомендації: текст разом із вибраним значенням перевищує ліміт.", Toast.LENGTH_LONG).show()
                        return@setOnClickListener
                    }
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                    textFields.values.forEach { it.isEnabled = false }
                    consultationSpinners.forEach { it.isEnabled = false }
                    flagChecks.forEach { it.isEnabled = false }
                    persistDraft(); submitted = true
                    val base = server; val auth = token; val uid = userId
                    io.execute {
                        var error: String? = null
                        try {
                            synchronized(DraftSync.lock) {
                                check(token == auth && server == base) { "Сесію завершено. Запис залишається на телефоні." }
                                val latest = draftStore.read(patientId)
                                check(latest?.optBoolean("sync_blocked") != true) { "Натисніть значок передавання та перевірте серверну версію. Локальний текст збережено." }
                                if((latest?.optInt("server_version", 0) ?: 0) > 0) payload.put("draft_version", latest!!.optInt("server_version"))
                                journal.enqueue(payload, patientName)
                                draftStore.remove(patientId)
                                OfflineSyncJob.schedule(this, base, uid)
                            }
                        } catch(e: Exception) { error = e.message ?: "Не вдалося зафіксувати запис" }
                        runOnUiThread {
                            if(isDestroyed || token != auth || server != base) return@runOnUiThread
                            if(error == null) {
                                dialog.dismiss()
                                Toast.makeText(this, "Запис збережено. Значок зникне після підтвердження сервера.", Toast.LENGTH_LONG).show()
                                AppointmentReminders.refreshFromCache(this, server, userId)
                                updateConnectionStatus(); syncNow(); renderHomeScreen("completed")
                            } else {
                                submitted = false
                                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                                textFields.values.forEach { it.isEnabled = true }
                                consultationSpinners.forEach { it.isEnabled = true }
                                flagChecks.forEach { it.isEnabled = true }
                                showError(error!!)
                            }
                        }
                    }
                }
            }
            dialog.show()
            dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(bg))
            dialog.window?.setLayout(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT)
            dialog.window?.let { lightSystemBars(it) }
            dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
    }

    private fun logout() {
        ShiftNotifications.clear(this)
        consultationWindow?.dismiss(); consultationWindow = null
        AppointmentReminders.cancel(this)
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

    private fun requestNotificationAccess() {
        if(Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 4200)
        else startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if(requestCode == 4200 && userId > 0) { ShiftNotifications.refresh(this, server, userId); refreshAppointments() }
    }

    private fun settingsScreen() {
        selectedNavigation = "more"; backAction = { homeScreen() }
        val body = root(); body.addView(topBar("Налаштування", ::homeScreen))
        listOf("Оповіщення", "Оформлення", "Редагування", "Підключення").forEach { section ->
            body.addView(secondary(section) { settingsDetailsScreen(section) })
        }
        body.addView(caption("SOLVIA ${BuildConfig.VERSION_NAME}")); mount(scroll(body))
    }
    private fun settingsDetailsScreen(section: String) {
        selectedNavigation = "more"; backAction = { settingsScreen() }
        val body = root(); body.addView(topBar(section, ::settingsScreen))
        when(section) {
            "Оповіщення" -> {
        body.addView(title("Оповіщення", 20f))
        body.addView(CheckBox(this).apply {
            text = "Звукове нагадування на час консультації"; setTextColor(ink)
            isChecked = prefs.getBoolean("reminders_enabled", true)
            setOnCheckedChangeListener { _, enabled ->
                prefs.edit().putBoolean("reminders_enabled", enabled).apply()
                if(enabled) refreshAppointments() else AppointmentReminders.cancel(this@MainActivity)
            }
        })
        body.addView(caption(if(AppointmentReminders.allowed(this)) "Оповіщення увімкнено" else "Android блокує оповіщення. Дозвольте їх у налаштуваннях телефона."))
        body.addView(primary("Перевірити дзвінок консультації") {
            if(AppointmentReminders.allowed(this)) AppointmentReminders.test(this)
            else requestNotificationAccess()
        })
        body.addView(secondary("Зупинити тестовий дзвінок") { AppointmentReminders.stopTest(this) })
        body.addView(secondary("Перевірити повідомлення у шторці") {
            if(AppointmentReminders.allowed(this)) ShiftNotifications.testMessage(this)
            else requestNotificationAccess()
        })
        listOf("shift_notification" to "Показувати активну зміну у шторці", "new_visit_notifications" to "Повідомляти про нові консультації").forEach { (key, label) ->
            body.addView(CheckBox(this).apply {
                text = label; setTextColor(ink); isChecked = prefs.getBoolean(key, true)
                setOnCheckedChangeListener { _, enabled ->
                    prefs.edit().putBoolean(key, enabled).apply()
                    if(userId > 0) ShiftNotifications.refresh(this@MainActivity, server, userId)
                }
            })
        }
        body.addView(caption("Зміна залишається у шторці після закриття застосунку, поки діє сесія. Нові записи перевіряються у фоні; Android може затримати оновлення. Примусова зупинка вимикає фонову роботу до наступного запуску."))
        body.addView(secondary("Звук і дозволи оповіщень") {
            AppointmentReminders.channel(this)
            startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                .putExtra(Settings.EXTRA_CHANNEL_ID, AppointmentReminders.CHANNEL))
        })
        if(Build.VERSION.SDK_INT >= 31) {
            body.addView(caption(if(AppointmentReminders.exact(this)) "Точний час нагадування дозволено" else "Без дозволу на точні будильники Android може затримати нагадування."))
            body.addView(secondary("Дозволити точний час нагадування") {
                startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:$packageName")))
            })
        }
            }
            "Оформлення" -> {
        body.addView(title("Оформлення", 20f))
        body.addView(caption("Розмір тексту"))
        val sizes = listOf("Стандартний", "Збільшений", "Великий")
        body.addView(Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, sizes)
            setSelection(prefs.getInt("text_size", 0)); minimumHeight = dp(48)
            onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                    prefs.edit().putInt("text_size", position).apply()
                }
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
            }
        })
        body.addView(caption("Новий розмір застосовується при наступному відкритті екрана."))
            }
            "Редагування" -> {
        body.addView(title("Редагування", 20f))
        body.addView(CheckBox(this).apply {
            text = "Виділяти весь текст при натисканні поля"; setTextColor(ink)
            isChecked = prefs.getBoolean("select_all", false)
            setOnCheckedChangeListener { _, value -> prefs.edit().putBoolean("select_all", value).apply() }
        })
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
            }
            "Підключення" -> {
        body.addView(secondary("Перевірити з’єднання") {
            apiAsync("GET", "/api/health") { value ->
                val health = value as JSONObject
                showError("Сервер доступний: SOLVIA " + health.optString("version") + " · " + health.optString("platform"))
            }
        })
        body.addView(secondary("Оновлення SOLVIA") {
            updates.check(manual = true)
        })
        body.addView(caption("Версії надходять із сервера центру. Оновлення встановлюється поверх програми й зберігає ваші дані. Android попросить підтвердити встановлення."))
        body.addView(secondary("Вийти й змінити сервер") {
            AlertDialog.Builder(this).setTitle("Змінити сервер?")
                .setMessage("Поточну сесію буде завершено. Перевірте нову HTTPS-адресу та сертифікат.")
                .setPositiveButton("Продовжити") { _, _ -> logout(); setupScreen() }
                .setNegativeButton("Скасувати", null).show()
        })
            }
        }
        mount(scroll(body))
    }
    private fun passwordScreen() {
        selectedNavigation = "more"; backAction = { homeScreen() }
        val body = root(); body.addView(topBar("Змінити пароль", ::homeScreen))
        val old = edit("Поточний пароль", true)
        val next = edit("Новий пароль — від 12 символів", true)
        val repeat = edit("Повторіть новий пароль", true)
        body.addView(old); body.addView(spacer()); body.addView(next); body.addView(spacer()); body.addView(repeat)
        body.addView(primary("Зберегти новий пароль") {
            if (next.text.toString() != repeat.text.toString()) { showError("Паролі не збігаються"); return@primary }
            apiAsync("POST", "/api/account/password", JSONObject().put("current_password", old.text.toString()).put("new_password", next.text.toString())) {
                logout()
                Toast.makeText(this, "Пароль змінено. Увійдіть знову на всіх пристроях.", Toast.LENGTH_LONG).show()
            }
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
        body.addView(caption(day + " · консультації та звіт доступні адміністрації центру після передавання"))

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

        val reportStore = offlineStore()
        val savedReport = reportStore.reportDraft(day)
        fun payload() = JSONObject().put("shift_date", day)
            .put("summary", summary.text.toString()).put("incidents", incidents.text.toString())
            .put("handover", handover.text.toString()).put("critical_cases", critical.isChecked)
            .put("notify_admin", notifyAdmin.isChecked).put("notify_director", notifyDirector.isChecked)
        fun fill(current: JSONObject) {
            summary.setText(current.optString("summary")); incidents.setText(current.optString("incidents"))
            handover.setText(current.optString("handover")); critical.isChecked = current.optBoolean("critical_cases")
            notifyAdmin.isChecked = current.optBoolean("notify_admin"); notifyDirector.isChecked = current.optBoolean("notify_director")
        }
        if(savedReport != null) fill(savedReport)
        val watcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                runCatching { reportStore.saveReportDraft(day, payload()) }.onFailure { statusText.text = "Не вдалося зберегти чернетку звіту" }
            }
            override fun afterTextChanged(s: Editable?) {}
        }
        listOf(summary, incidents, handover).forEach { it.addTextChangedListener(watcher) }
        listOf(critical, notifyAdmin, notifyDirector).forEach { check -> check.setOnCheckedChangeListener { _, _ ->
            runCatching { reportStore.saveReportDraft(day, payload()) }
        } }
        body.addView(caption("Текст звіту зберігається як зашифрована чернетка. Завершіть або перевірте всі консультації перед виходом."))
        var submitting = false
        var saveButton: Button? = null
        var finishButton: Button? = null
        fun submit(finish: Boolean) {
            if(submitting) return
            if(summary.text.toString().isBlank()) { showError("Заповніть підсумок роботи."); return }
            val drafts = DraftStore(this, server, userId)
            if(finish && drafts.patients().isNotEmpty()) {
                showError("Є незавершені чернетки консультацій. Перевірте їх у меню «Мої чернетки» перед завершенням зміни."); return
            }
            val report = payload()
            try { reportStore.saveReportDraft(day, report) } catch(_: Exception) { showError("Не вдалося зберегти чернетку звіту"); return }
            submitting = true; saveButton?.isEnabled = false; finishButton?.isEnabled = false
            listOf(summary, incidents, handover).forEach { it.isEnabled = false }
            listOf(critical, notifyAdmin, notifyDirector).forEach { it.isEnabled = false }
            val auth = token; val base = server; val epoch = sceneEpoch
            statusText.text = "Передаємо консультації та звіт…"
            io.execute {
                var error: String? = null; var count = 0
                try {
                    val authorized = ConsultationSync(reportStore) { record ->
                        check(reportStore.session()?.optString("token") == auth) { "Сесію завершено. Увійдіть знову." }
                        try { requestAt(base, "POST", "/api/consultations", record, auth) as JSONObject }
                        catch(e: ApiError) { throw SyncFailure(e.status, e.message ?: "Помилка сервера") }
                    }.run()
                    check(authorized) { "Сесія завершилась. Увійдіть знову; записи залишаються на телефоні." }
                    val rows = reportStore.queue()
                    check(!(0 until rows.length()).any { rows.getJSONObject(it).optString("state") in listOf("pending", "blocked") }) {
                        "Є записи, які сервер ще не підтвердив. Перевірте синхронізацію. Чернетка звіту збережена."
                    }
                    check(reportStore.session()?.optString("token") == auth) { "Сесію завершено. Увійдіть знову." }
                    count = (requestAt(base, "POST", "/api/shift-reports", report, auth) as JSONObject).optInt("consultations_count")
                    reportStore.clearReportDraft(day, report)
                } catch(e: Exception) { error = e.message ?: "Немає з’єднання. Чернетка звіту збережена." }
                runOnUiThread {
                    if(token != auth || server != base || sceneEpoch != epoch || isDestroyed) return@runOnUiThread
                    submitting = false; saveButton?.isEnabled = true; finishButton?.isEnabled = true
                    listOf(summary, incidents, handover).forEach { it.isEnabled = true }
                    listOf(critical, notifyAdmin, notifyDirector).forEach { it.isEnabled = true }
                    if(error != null) { statusText.text = error; showError(error!!) }
                    else {
                        statusText.text = "Передано на сервер · консультацій: $count"
                        Toast.makeText(this, if(finish) "Зміну завершено. Консультації та звіт доступні на ПК." else "Звіт передано на сервер", Toast.LENGTH_LONG).show()
                        if(finish) logout()
                    }
                }
            }
        }
        saveButton = primary("Зберегти / оновити звіт") { submit(false) }; body.addView(saveButton)
        finishButton = primary("Завершити зміну й передати записи") {
            AlertDialog.Builder(this).setTitle("Завершити мою зміну?")
                .setMessage("Додаток передасть завершені консультації та звіт на сервер і вийде з облікового запису після підтвердження. Загальну зміну центру закриває адміністратор.")
                .setNegativeButton("Продовжити роботу", null).setPositiveButton("Завершити") { _, _ -> submit(true) }.show()
        }; body.addView(finishButton)
        mount(scroll(body))

        apiAsync("GET", "/api/shift-reports?from=$day&to=$day", onError = { statusText.text = "Сервер недоступний. Чернетка звіту залишається на телефоні." }) { result ->
            val rows = result as JSONArray
            if (rows.length() > 0 && savedReport == null && !submitting && summary.text.isBlank() && incidents.text.isBlank() && handover.text.isBlank()) {
                val current = rows.getJSONObject(0)
                summary.setText(current.optString("summary"))
                incidents.setText(current.optString("incidents"))
                handover.setText(current.optString("handover"))
                critical.isChecked = current.optBoolean("critical_cases")
                notifyAdmin.isChecked = current.optBoolean("notify_admin")
                notifyDirector.isChecked = current.optBoolean("notify_director")
                statusText.text = "Звіт уже збережений · консультацій: " + current.optInt("consultations_count") + " · можна редагувати"
            } else {
                statusText.text = if(savedReport != null) "Відновлено чернетку звіту з телефона." else "Звіт за сьогодні ще не подано."
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

