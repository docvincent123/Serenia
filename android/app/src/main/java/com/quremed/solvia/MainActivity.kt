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
    private val openConfigRequest = 4101

    private val bg = Color.rgb(240, 246, 249)
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
        shell.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        if (token.isNotBlank() && workspaceReady) {
            val bar = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
                setBackgroundColor(Color.WHITE); elevation = dp(6).toFloat()
            }
            val links = mutableListOf(Triple("home", "Головна", R.drawable.ic_home))
            if (role != "director") {
                links.add(Triple("calendar", "Розклад", R.drawable.ic_calendar))
                links.add(Triple("patients", "Пацієнти", R.drawable.ic_patients))
            } else links.add(Triple("statistics", "Статистика", R.drawable.ic_reports))
            links.add(Triple("more", "Меню", R.drawable.ic_menu))
            links.forEach { (key, label, icon) ->
                bar.addView(Button(this).apply {
                    text = label; isAllCaps = false; textSize = 11f; contentDescription = label
                    setTextColor(if (selectedNavigation == key) forest else muted)
                    background = rounded(if (selectedNavigation == key) forestSoft else Color.WHITE, 12)
                    val drawable = getDrawable(icon)?.mutate()
                    drawable?.setTint(if(selectedNavigation == key) forest else muted)
                    drawable?.setBounds(0, 0, dp(22), dp(22)); setCompoundDrawables(null, drawable, null, null)
                    setPadding(dp(3), dp(8), dp(3), dp(5))
                    setOnClickListener {
                        when(key) {
                            "home" -> homeScreen(); "calendar" -> calendarScreen(); "patients" -> patientsScreen()
                            "statistics" -> { selectedNavigation = key; statisticsScreen() }; else -> moreScreen()
                        }
                    }
                }, LinearLayout.LayoutParams(0, dp(68), 1f))
            }
            shell.addView(bar)
        }
        setContentView(shell)
    }

    private fun mobileApi(): MobileApi = object : MobileApi {
        override fun call(method: String, path: String, body: JSONObject?, success: (Any) -> Unit, failure: (String) -> Unit) {
            apiAsync(method, path, body, onError = failure, ok = success)
        }
    }

    private fun moreScreen() {
        selectedNavigation = "more"; backAction = { homeScreen() }
        val body = root(); body.addView(title("Меню", 30f)); body.addView(caption("$userName · ${roleLabel(role)}"))
        if (role != "director") {
            body.addView(primary("Документи пацієнтів") { patientsScreen(documentLibrary = true) })
            body.addView(spacer())
        }
        if (role == "psychologist") {
            body.addView(secondary("Мої чернетки") { draftsScreen() })
            body.addView(secondary("Звіт за зміну") { reportScreen() })
        }
        if (role == "admin" || role == "reception") body.addView(secondary("Лист очікування") { waitingListScreen() })
        if (role != "reception") body.addView(secondary("Супервізії") { supervisionsScreen() })
        if (role == "admin" || role == "director") body.addView(secondary("Статистика центру") { statisticsScreen() })
        if (role == "admin") body.addView(secondary("Пристрої та сесії") { devicesScreen() })
        body.addView(secondary("Мої налаштування") { settingsScreen() })
        body.addView(spacer()); body.addView(caption("SOLVIA ${BuildConfig.VERSION_NAME}"))
        body.addView(secondary("Вийти") {
            AlertDialog.Builder(this).setTitle("Вийти з облікового запису?")
                .setMessage("Зашифровані чернетки залишаться для наступного входу цього користувача.")
                .setNegativeButton("Залишитися", null).setPositiveButton("Вийти") { _, _ -> logout() }.show()
        })
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

    private fun waitingListScreen() {
        backAction = { moreScreen() }; val body = root(); body.addView(topBar("Лист очікування", ::moreScreen))
        body.addView(primary("Додати до листа очікування") { waitingListForm() }); mount(scroll(body))
        apiAsync("GET", "/api/waiting-list") { value ->
            val entries = value as JSONArray
            if (entries.length() == 0) body.addView(caption("Лист очікування порожній"))
            for (i in 0 until entries.length()) {
                val item = entries.getJSONObject(i); val row = card()
                row.addView(title(item.optString("patient"), 18f)); row.addView(caption(item.optString("psychologist") + " · " + item.optString("phone")))
                row.addView(caption("${item.optString("date_from")} — ${item.optString("date_to")} · ${item.optString("time_from")} — ${item.optString("time_to")}"))
                row.addView(caption(item.optString("contact_note")))
                val status = item.optString("status")
                row.addView(caption(when(status) { "waiting" -> "Очікує"; "offered" -> "Час запропоновано"; "booked" -> "Записано"; else -> "Скасовано" }))
                if (status == "waiting" || status == "offered") {
                    row.addView(secondary("Записати у слот") { waitingBooking(item) })
                    row.addView(secondary(if(status == "waiting") "Позначити: час запропоновано" else "Повернути в очікування") {
                        apiAsync("PATCH", "/api/waiting-list/${item.getLong("id")}", JSONObject().put("version", item.getInt("version"))
                            .put("status", if(status == "waiting") "offered" else "waiting")) { waitingListScreen() }
                    })
                    row.addView(secondary("Скасувати очікування") {
                        AlertDialog.Builder(this).setTitle("Скасувати очікування?").setNegativeButton("Ні", null)
                            .setPositiveButton("Так") { _, _ -> apiAsync("PATCH", "/api/waiting-list/${item.getLong("id")}",
                                JSONObject().put("version", item.getInt("version")).put("status", "cancelled")) { waitingListScreen() } }.show()
                    })
                }; body.addView(row); body.addView(spacer())
            }
        }
    }

    private fun waitingListForm() {
        apiAsync("GET", "/api/patients?status=active") { value ->
            val rows = value as JSONArray
            if(rows.length() == 0) { showError("Спочатку додайте активного пацієнта"); return@apiAsync }
            val wrap = root(); val patients = Spinner(this)
            patients.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, (0 until rows.length()).map { rows.getJSONObject(it).optString("name") })
            val from = edit("Від YYYY-MM-DD").apply { setText(LocalDate.now().toString()) }
            val to = edit("До YYYY-MM-DD").apply { setText(LocalDate.now().plusDays(14).toString()) }
            val first = edit("Початок HH:mm").apply { setText("09:00") }; val last = edit("Кінець HH:mm").apply { setText("18:00") }
            val note = edit("Контактна примітка"); val high = CheckBox(this).apply { text = "Високий пріоритет" }
            listOf(patients, from, to, first, last, note, high).forEach { wrap.addView(it) }
            val dialog = AlertDialog.Builder(this).setTitle("Лист очікування").setView(scroll(wrap)).setNegativeButton("Скасувати", null).setPositiveButton("Зберегти", null).create()
            dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val p = rows.getJSONObject(patients.selectedItemPosition); val save = dialog.getButton(AlertDialog.BUTTON_POSITIVE); save.isEnabled = false
                apiAsync("POST", "/api/waiting-list", JSONObject().put("patient_id", p.getLong("id")).put("psychologist_id", p.getLong("psychologist_id"))
                    .put("date_from", from.text.toString()).put("date_to", to.text.toString()).put("time_from", first.text.toString()).put("time_to", last.text.toString())
                    .put("contact_note", note.text.toString()).put("priority", if(high.isChecked) "high" else "normal"),
                    onError = { save.isEnabled = true; showError(it) }) { dialog.dismiss(); waitingListScreen() }
            } }; dialog.show()
        }
    }

    private fun waitingBooking(item: JSONObject) {
        apiAsync("GET", "/api/meta") { value ->
            val rooms = (value as JSONObject).optJSONArray("rooms") ?: JSONArray()
            if(rooms.length() == 0) { showError("Немає доступних кабінетів"); return@apiAsync }
            val wrap = root(); val room = Spinner(this)
            room.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, (0 until rooms.length()).map { rooms.getJSONObject(it).optString("name") })
            val date = edit("Дата YYYY-MM-DD").apply { setText(item.optString("date_from")) }
            val start = edit("Початок HH:mm").apply { setText(item.optString("time_from")) }
            val end = edit("Кінець HH:mm").apply { setText(item.optString("time_from").take(2) + ":50") }
            listOf(date, start, end, room).forEach { wrap.addView(it) }
            val dialog = AlertDialog.Builder(this).setTitle("Запис із листа очікування").setView(scroll(wrap)).setNegativeButton("Скасувати", null).setPositiveButton("Записати", null).create()
            dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val save = dialog.getButton(AlertDialog.BUTTON_POSITIVE); save.isEnabled = false
                apiAsync("POST", "/api/waiting-list/${item.getLong("id")}/book", JSONObject().put("version", item.getInt("version"))
                    .put("room_id", rooms.getJSONObject(room.selectedItemPosition).getLong("id")).put("start", date.text.toString()+"T"+start.text.toString())
                    .put("end", date.text.toString()+"T"+end.text.toString()), onError = { save.isEnabled = true; showError(it) }) { dialog.dismiss(); waitingListScreen() }
            } }; dialog.show()
        }
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
        setPadding(dp(18), dp(12), dp(18), dp(16))
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
        background = rounded(Color.WHITE, 13, line)
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

    private fun primary(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        minHeight = dp(48)
        isAllCaps = false
        textSize = 14f
        setTextColor(Color.WHITE)
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(14), dp(10), dp(14), dp(10))
        background = rounded(forest, 13)
        minimalIcon(label, Color.WHITE)
        setOnClickListener { action() }
    }

    private fun secondary(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        minHeight = dp(48)
        isAllCaps = false
        textSize = 13f
        setTextColor(forestDark)
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(12), dp(10), dp(12), dp(10))
        background = rounded(forestSoft, 13, line)
        minimalIcon(label, forestDark)
        setOnClickListener { action() }
    }

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(15), dp(16), dp(15))
        background = rounded(Color.WHITE, 17, line)
        elevation = dp(1).toFloat()
    }

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
        io.execute {
            try {
                val result = requestAt(requestServer, method, path, body, requestToken)
                runOnUiThread { if (!isFinishing && !isDestroyed && token == requestToken && server == requestServer && sceneEpoch == requestEpoch) ok(result) }
            } catch (e: Exception) {
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
        importCard.addView(caption("На серверному ПК файл знаходиться у Public Documents → QureMed → SOLVIA. Скопіюйте його на телефон або планшет."))
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
        body.addView(logo())
        body.addView(title("SOLVIA " + BuildConfig.VERSION_NAME, 20f))
        body.addView(title("Вхід до центру"))
        body.addView(caption(server))
        val login = edit("Логін")
        val password = edit("Пароль", true)
        body.addView(login)
        body.addView(spacer(6))
        body.addView(password)
        body.addView(spacer())
        body.addView(primary("Увійти") {
            val payload = JSONObject()
                .put("login", login.text.toString())
                .put("password", password.text.toString())
                .put("platform", "Android")
                .put("device_id", Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "")
                .put("device_name", (Build.MANUFACTURER + " " + Build.MODEL).trim())
            apiAsync("POST", "/api/login", payload) { result ->
                val obj = result as JSONObject
                token = obj.getString("token")
                val user = obj.getJSONObject("user")
                role = user.getString("role")
                userName = user.getString("name")
                userId = user.getLong("id")
                homeScreen()
            }
        })
        body.addView(secondary("Змінити сервер") { setupScreen() })
        mount(scroll(body))
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
        val body = root()
        body.addView(logo())
        body.addView(title("Зміна ще не відкрита"))
        body.addView(caption("Дата: " + shift.optString("shift_date", LocalDate.now().toString())))
        if (role == "admin") {
            body.addView(caption("Підтвердіть відкриття робочої зміни. Після цього команда зможе працювати в SOLVIA."))
            body.addView(primary("Підтвердити відкриття зміни") {
                apiAsync("POST", "/api/shift-day", JSONObject().put("action", "open")) { homeScreen() }
            })
        } else {
            body.addView(caption("Адміністратор має підтвердити відкриття зміни на сьогодні."))
        }
        body.addView(secondary("Перевірити ще раз") { homeScreen() })
        body.addView(secondary("Вийти") {
            logout()
        })
        mount(scroll(body))
    }

    private fun renderHomeScreen() {
        workspaceReady = true
        backAction = null
        val outer = root()
        outer.addView(logo(64))
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val user = TextView(this).apply {
            text = userName + "\n" + roleLabel(role)
            setTextColor(ink)
            textSize = 14f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        head.addView(user)
        head.addView(secondary("Вийти") { logout() })
        outer.addView(head)
        outer.addView(spacer())

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        fun addTab(label: String, action: () -> Unit) {
            val b = secondary(label, action)
            b.layoutParams = LinearLayout.LayoutParams(0, dp(46), 1f)
            tabs.addView(b)
        }
        if (role != "director") {
            addTab("Календар") { calendarScreen() }
            addTab("Пацієнти") { patientsScreen() }
        } else addTab("Статистика") { statisticsScreen() }
        if (role == "psychologist") addTab("Звіт") { reportScreen() }
        if (role == "admin") addTab("Пристрої") { devicesScreen() }
        outer.addView(tabs)
        outer.addView(secondary("Налаштування") { settingsScreen() })
        if (role != "reception") outer.addView(secondary("Супервізії") { supervisionsScreen() })
        outer.addView(spacer())
        outer.addView(title("Робочий простір", 25f))
        outer.addView(caption("Ваш розклад, пацієнти та документи — поруч."))

        val today = card()
        today.addView(title("Сьогодні", 18f))
        today.addView(caption(LocalDate.now().toString()))
        today.addView(primary(if (role == "director") "Статистика центру" else "Відкрити календар") { if (role == "director") statisticsScreen() else calendarScreen() })
        today.addView(spacer(6))
        if (role != "director") today.addView(primary("Мої пацієнти") { patientsScreen() })
        outer.addView(today)
        mount(scroll(outer))
        if (role == "admin" || role == "psychologist") {
            apiAsync("GET", "/api/reminders") { result ->
                val reminders = result as JSONArray
                if (reminders.length() > 0) {
                    outer.addView(spacer())
                    val box = card()
                    box.addView(title("Найближчі записи", 18f))
                    for (i in 0 until reminders.length().coerceAtMost(5)) {
                        val item = reminders.getJSONObject(i)
                        box.addView(caption(
                            item.optString("start").takeLast(5) + " · " +
                            item.optString("patients") + " · " +
                            item.optString("psychologist")
                        ))
                    }
                    outer.addView(box)
                }
            }
        }
    }

    private fun topBar(label: String, back: () -> Unit): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(secondary("←") { back() })
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
        val dateInput = edit("YYYY-MM-DD").apply { setText(date) }
        body.addView(dateInput)
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        actions.addView(primary("Показати день") { calendarScreen(dateInput.text.toString()) },
            LinearLayout.LayoutParams(0, dp(46), 1f))
        if (role == "admin" || role == "reception") {
            actions.addView(spacer(8))
            actions.addView(primary("+ Новий запис") { newBookingDialog(dateInput.text.toString()) },
                LinearLayout.LayoutParams(0, dp(46), 1f))
        }
        body.addView(actions)
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

    private fun newBookingDialog(date: String) {
        val sessionToken = token
        val sessionServer = server
        val sessionEpoch = sceneEpoch
        io.execute {
            try {
                val meta = request("GET", "/api/meta") as JSONObject
                val patients = request("GET", "/api/patients") as JSONArray
                runOnUiThread {
                    if (isDestroyed || token != sessionToken || server != sessionServer || sceneEpoch != sessionEpoch) return@runOnUiThread
                    val psychologists = meta.optJSONArray("psychologists") ?: JSONArray()
                    val rooms = meta.optJSONArray("rooms") ?: JSONArray()
                    if (psychologists.length() == 0 || rooms.length() == 0 || patients.length() == 0) {
                        showError("Для запису потрібні психолог, кабінет і хоча б один пацієнт.")
                        return@runOnUiThread
                    }

                    val wrap = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(12), dp(4), dp(12), dp(16))
                        setBackgroundColor(bg)
                    }
                    val scroll = ScrollView(this).apply { addView(wrap) }
                    wrap.addView(caption("Дата: $date"))

                    val patientSpinner = Spinner(this)
                    val patientLabels = (0 until patients.length()).map {
                        val p = patients.getJSONObject(it)
                        "№" + p.optString("patient_no", "—") + " · " + p.optString("name")
                    }
                    patientSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, patientLabels)

                    val psychologistSpinner = Spinner(this)
                    val psychologistLabels = (0 until psychologists.length()).map { psychologists.getJSONObject(it).optString("name") }
                    psychologistSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, psychologistLabels)

                    val roomSpinner = Spinner(this)
                    val roomLabels = (0 until rooms.length()).map { rooms.getJSONObject(it).optString("name") }
                    roomSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, roomLabels)

                    val kinds = listOf("individual", "family", "child", "crisis", "group")
                    val kindLabels = listOf("Індивідуальна", "Сімейна", "Дитяча", "Кризова", "Групова")
                    val kindSpinner = Spinner(this)
                    kindSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, kindLabels)

                    val statuses = listOf("scheduled", "confirmed", "draft")
                    val statusLabels = listOf("Заплановано", "Підтверджено", "Чернетка")
                    val statusSpinner = Spinner(this)
                    statusSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, statusLabels)

                    val policy = meta.optJSONObject("workflow") ?: JSONObject()
                    val opening = policy.optString("opening_time", "08:00")
                    val closing = policy.optString("closing_time", "20:00")
                    val endDefault = java.time.LocalTime.parse(opening).plusMinutes(policy.optLong("default_duration_minutes",60)).toString()
                    wrap.addView(caption("Години роботи: $opening–$closing"))
                    val startTime = edit("Початок HH:MM").apply { setText(opening) }
                    val endTime = edit("Кінець HH:MM").apply { setText(endDefault) }
                    val note = edit("Примітка до запису").apply { minLines = 2 }

                    wrap.addView(caption("Пацієнт")); wrap.addView(patientSpinner); wrap.addView(spacer(7))
                    wrap.addView(caption("Психолог")); wrap.addView(psychologistSpinner); wrap.addView(spacer(7))
                    wrap.addView(caption("Кабінет")); wrap.addView(roomSpinner); wrap.addView(spacer(7))
                    wrap.addView(caption("Тип")); wrap.addView(kindSpinner); wrap.addView(spacer(7))
                    wrap.addView(caption("Статус")); wrap.addView(statusSpinner); wrap.addView(spacer(7))
                    wrap.addView(startTime); wrap.addView(spacer(7)); wrap.addView(endTime); wrap.addView(spacer(7)); wrap.addView(note)

                    val dialog = AlertDialog.Builder(this)
                        .setTitle("Новий запис до психолога")
                        .setView(scroll)
                        .setNegativeButton("Скасувати", null)
                        .setPositiveButton("Зберегти", null)
                        .create()
                    dialog.setOnShowListener {
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                            val patient = patients.getJSONObject(patientSpinner.selectedItemPosition)
                            val psychologist = psychologists.getJSONObject(psychologistSpinner.selectedItemPosition)
                            val room = rooms.getJSONObject(roomSpinner.selectedItemPosition)
                            val payload = JSONObject()
                                .put("psychologist_id", psychologist.getLong("id"))
                                .put("room_id", room.getLong("id"))
                                .put("start", date + "T" + startTime.text.toString().trim())
                                .put("end", date + "T" + endTime.text.toString().trim())
                                .put("kind", kinds[kindSpinner.selectedItemPosition])
                                .put("status", statuses[statusSpinner.selectedItemPosition])
                                .put("note", note.text.toString())
                                .put("patient_ids", JSONArray().put(patient.getLong("id")))
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                            apiAsync("POST", "/api/appointments", payload, onError = { dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true; showError(it) }) {
                                dialog.dismiss()
                                Toast.makeText(this, "Запис збережено в календарі.", Toast.LENGTH_LONG).show()
                                calendarScreen(date)
                            }
                        }
                    }
                    dialog.show()
                }
            } catch (e: Exception) {
                runOnUiThread { showError(e.message ?: "Не вдалося завантажити дані для запису") }
            }
        }
    }

    private fun patientsScreen(status: String = "active", documentLibrary: Boolean = false) {
        selectedNavigation = "patients"
        backAction = { homeScreen() }
        val body = root()
        body.addView(topBar(if (role == "psychologist") "Мої пацієнти" else "Пацієнти", ::homeScreen))
        if (role == "admin" || role == "reception") {
            body.addView(primary("+ Додати пацієнта") { newPatientDialog() })
            body.addView(spacer(10))
        }
        val search = edit("Пошук за №, ПІБ, телефоном, категорією")
        body.addView(search)
        val filters = LinearLayout(this)
        for ((key, label) in listOf("active" to "Активні", "completed" to "Завершені", "archived" to "Архів")) {
            filters.addView(secondary(label) { patientsScreen(key, documentLibrary) }, LinearLayout.LayoutParams(0, dp(48), 1f))
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
                    box.addView(caption("ПАЦІЄНТ · №" + patient.optString("patient_no", "—")))
                    box.addView(title(patient.optString("name"), 18f))
                    box.addView(caption(patient.optString("category") + " · " + patient.optString("phone")))
                    val psychologist = patient.optString("psychologist")
                    if (psychologist.isNotBlank()) box.addView(caption("Психолог: $psychologist"))
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

    private fun newPatientDialog() {
        val sessionToken = token
        val sessionServer = server
        val sessionEpoch = sceneEpoch
        io.execute {
            try {
                val meta = request("GET", "/api/meta") as JSONObject
                val families = request("GET", "/api/families") as JSONArray
                runOnUiThread {
                    if (isDestroyed || token != sessionToken || server != sessionServer || sceneEpoch != sessionEpoch) return@runOnUiThread
                    val psychologists = meta.optJSONArray("psychologists") ?: JSONArray()
                    val categories = meta.optJSONArray("categories") ?: JSONArray()
                    if (psychologists.length() == 0) {
                        showError("Спочатку додайте активного психолога.")
                        return@runOnUiThread
                    }
                    val wrap = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(12), dp(4), dp(12), dp(16))
                        setBackgroundColor(bg)
                    }
                    val scroll = ScrollView(this).apply { addView(wrap) }

                    val name = edit("ПІБ")
                    val phone = edit("Телефон")
                    val dob = edit("Дата народження YYYY-MM-DD")
                    val categorySpinner = Spinner(this)
                    categorySpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
                        (0 until categories.length()).map { categories.getString(it) })
                    val psychologistSpinner = Spinner(this)
                    psychologistSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
                        (0 until psychologists.length()).map { psychologists.getJSONObject(it).optString("name") })
                    val familySpinner = Spinner(this)
                    val familyLabels = mutableListOf("Без сімейного зв’язку")
                    for (i in 0 until families.length()) familyLabels.add(families.getJSONObject(i).optString("name"))
                    familySpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, familyLabels)
                    val sexValues = listOf("", "female", "male", "other")
                    val sexSpinner = Spinner(this)
                    sexSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
                        listOf("Не вказано", "Жіноча", "Чоловіча", "Інше"))
                    val familyRole = edit("Роль у сім’ї")
                    val address = edit("Адреса")
                    val adminNote = edit("Службова примітка").apply { minLines = 2 }

                    listOf(name, phone, dob).forEach { wrap.addView(it); wrap.addView(spacer(7)) }
                    wrap.addView(caption("Категорія")); wrap.addView(categorySpinner); wrap.addView(spacer(7))
                    wrap.addView(caption("Психолог")); wrap.addView(psychologistSpinner); wrap.addView(spacer(7))
                    wrap.addView(caption("Сім’я")); wrap.addView(familySpinner); wrap.addView(spacer(7))
                    wrap.addView(familyRole); wrap.addView(spacer(7))
                    wrap.addView(caption("Стать")); wrap.addView(sexSpinner); wrap.addView(spacer(7))
                    wrap.addView(address)
                    if (role == "admin") { wrap.addView(spacer(7)); wrap.addView(adminNote) }

                    val dialog = AlertDialog.Builder(this)
                        .setTitle("Новий пацієнт")
                        .setView(scroll)
                        .setNegativeButton("Скасувати", null)
                        .setPositiveButton("Створити", null)
                        .create()
                    dialog.setOnShowListener {
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                            if (name.text.toString().isBlank() || phone.text.toString().isBlank() || dob.text.toString().isBlank()) {
                                Toast.makeText(this, "Заповніть ПІБ, телефон і дату народження.", Toast.LENGTH_LONG).show()
                                return@setOnClickListener
                            }
                            val psy = psychologists.getJSONObject(psychologistSpinner.selectedItemPosition)
                            val payload = JSONObject()
                                .put("name", name.text.toString())
                                .put("phone", phone.text.toString())
                                .put("dob", dob.text.toString())
                                .put("category", categories.getString(categorySpinner.selectedItemPosition))
                                .put("psychologist_id", psy.getLong("id"))
                                .put("family_role", familyRole.text.toString())
                                .put("sex", sexValues[sexSpinner.selectedItemPosition])
                                .put("address", address.text.toString())
                                .put("admin_note", if (role == "admin") adminNote.text.toString() else "")
                            if (familySpinner.selectedItemPosition == 0) payload.put("family_id", JSONObject.NULL)
                            else payload.put("family_id", families.getJSONObject(familySpinner.selectedItemPosition - 1).getLong("id"))

                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                            apiAsync("POST", "/api/patients", payload, onError = { dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true; showError(it) }) {
                                dialog.dismiss()
                                Toast.makeText(this, "Пацієнта створено.", Toast.LENGTH_LONG).show()
                                patientsScreen()
                            }
                        }
                    }
                    dialog.show()
                }
            } catch (e: Exception) {
                runOnUiThread { showError(e.message ?: "Не вдалося завантажити форму пацієнта") }
            }
        }
    }

    private fun patientScreen(id: Long) = patientWorkspace(id)

    private fun patientWorkspace(id: Long, tab: String = "summary") {
        selectedNavigation = "patients"
        val workspace = PatientWorkspace(this, mobileApi(), role,
            { view, back -> backAction = back; mount(scroll(view)) },
            { patientsScreen() }, { patientId, name -> consultationDialog(patientId, name) },
            { document, back -> previewDocument(document, back) })
        workspace.open(id, tab)
    }

    private fun consultationDialog(patientId: Long, patientName: String) {
        val draftStore = DraftStore(this, server, userId)
        val savedDraft = try { draftStore.read(patientId) } catch (_: Exception) {
            Toast.makeText(this, "Локальну чернетку не вдалося розшифрувати. Її не видалено.", Toast.LENGTH_LONG).show(); null
        }
        val draftDate = savedDraft?.optString("consult_date", LocalDate.now().toString()) ?: LocalDate.now().toString()
        val clientKey = savedDraft?.optString("client_key")?.takeIf { it.isNotBlank() } ?: java.util.UUID.randomUUID().toString()
        apiAsync("GET", "/api/appointments?date=" + draftDate) { result ->
            val apps = result as JSONArray
            val eligible = mutableListOf<JSONObject>()
            for (i in 0 until apps.length()) {
                val appointment = apps.getJSONObject(i)
                val status = appointment.optString("status")
                if (status != "scheduled" && status != "confirmed") continue
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
                showError("На сьогодні немає активного запису цього пацієнта.")
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

            fun addGap(parent: LinearLayout, value: Int = 8) = parent.addView(spacer(value))
            fun section(name: String, hint: String, build: (LinearLayout) -> Unit) {
                val box = card()
                box.background = rounded(Color.WHITE, 18, line)
                box.addView(title(name, 17f))
                box.addView(caption(hint))
                build(box)
                wrap.addView(box)
                wrap.addView(spacer(10))
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
                .setNegativeButton("Залишити чернетку", null)
                .setPositiveButton("Зберегти", null)
                .create()
            consultationWindow = dialog
            dialog.setOnDismissListener { persistDraft(); if (consultationWindow === dialog) consultationWindow = null }
            wrap.addView(secondary("Зберегти чернетку на сервері") {
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
            wrap.addView(secondary("Відновити серверну чернетку") {
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
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    val minutes = duration.text.toString().toIntOrNull() ?: 0
                    if (note.text.toString().isBlank()) {
                        Toast.makeText(this, "Заповніть приватну нотатку психолога.", Toast.LENGTH_LONG).show()
                        return@setOnClickListener
                    }
                    if (minutes !in 10..480) {
                        Toast.makeText(this, "Тривалість має бути від 10 до 480 хвилин.", Toast.LENGTH_LONG).show()
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
                    val requestToken = token; val requestServer = server
                    io.execute {
                        try {
                            requestAt(requestServer, "POST", "/api/consultations", payload, requestToken)
                            try { draftStore.remove(patientId) } catch (_: Exception) { /* Consultation is already committed; do not misreport it as failed. */ }
                            runOnUiThread {
                                if (token == requestToken && server == requestServer && !isDestroyed) {
                                    submitted = true; dialog.dismiss()
                                    Toast.makeText(this, "Консультацію збережено в SOLVIA.", Toast.LENGTH_LONG).show(); patientScreen(patientId)
                                }
                            }
                        } catch (e: Exception) {
                            runOnUiThread {
                                if (token == requestToken && server == requestServer && !isDestroyed) {
                                    if (e is ApiError && e.status == 401) { dialog.dismiss(); logout(); return@runOnUiThread }
                                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                                    textFields.values.forEach { it.isEnabled = true }
                                    duration.isEnabled = true
                                    listOf(appointmentSpinner, typeSpinner, riskSpinner).forEach { it.isEnabled = true }
                                    flagChecks.forEach { it.isEnabled = true }
                                    draftStatus.text = "Не відправлено. Чернетка залишилась на пристрої; повторіть збереження."
                                    showError(e.message ?: "Немає зв’язку із сервером")
                                }
                            }
                        }
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
        token = ""
        role = ""
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

    private fun statisticsScreen() {
        backAction = { homeScreen() }
        val body = root(); body.addView(topBar("Статистика центру") { homeScreen() })
        mount(scroll(body))
        apiAsync("GET", "/api/stats") { value ->
            val data=value as JSONObject
            for ((key,label) in listOf("total_patients" to "Усього пацієнтів", "active_patients" to "Активні пацієнти", "new_patients" to "Нові звернення", "consultations" to "Консультації", "repeat_visits" to "Повторні прийоми", "active_courses" to "Активні курси", "signed_documents" to "Підписані документи")) {
                val box=card(); box.addView(title(data.optString(key,"0"),24f));box.addView(caption(label));body.addView(box);body.addView(spacer())
            }
            body.addView(caption("Показники поточного місяця. Керівник отримує статистику без приватних записів пацієнтів."))
        }
    }

    private fun supervisionsScreen() {
        backAction = { homeScreen() }
        val body = root(); body.addView(topBar("Супервізії") { homeScreen() });mount(scroll(body))
        apiAsync("GET", "/api/supervisions") { value ->
            val rows=value as JSONArray
            if(rows.length()==0)body.addView(caption("Супервізій ще немає. Керівник планує їх у SOLVIA Center."))
            for(i in 0 until rows.length()) {
                val item=rows.getJSONObject(i);val box=card()
                box.addView(title(item.optString("topic","Супервізія"),18f))
                box.addView(caption(item.optString("scheduled_at")+" · "+item.optString("psychologist")+" · "+item.optString("status")))
                box.addView(caption("Випадок: "+item.optString("case_summary")))
                box.addView(caption("Рекомендації: "+item.optString("recommendations")))
                box.addView(secondary(if(role=="psychologist") "Описати випадок" else "Рекомендації") {
                    val field=edit(if(role=="psychologist") "Без персональних даних" else "Рекомендації супервізора")
                    field.setText(item.optString(if(role=="psychologist") "case_summary" else "recommendations"))
                    field.minLines=4;field.gravity=Gravity.TOP
                    AlertDialog.Builder(this).setTitle("Супервізія").setView(field).setNegativeButton("Скасувати",null)
                        .setPositiveButton("Зберегти") { _, _ ->
                            val payload=JSONObject().put(if(role=="psychologist") "case_summary" else "recommendations",field.text.toString())
                            apiAsync("PATCH","/api/supervisions/"+item.getLong("id"),payload) { supervisionsScreen() }
                        }.show()
                })
                body.addView(box);body.addView(spacer())
            }
        }
    }

    private fun devicesScreen() {
        backAction = { homeScreen() }
        val body = root()
        body.addView(topBar("Активні пристрої", ::homeScreen))
        body.addView(caption("Телефони, планшети та ПК з активним входом у SOLVIA."))
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(list)
        mount(scroll(body))

        fun load() {
            apiAsync("GET", "/api/admin/sessions") { result ->
                list.removeAllViews()
                val sessions = result as JSONArray
                if (sessions.length() == 0) {
                    list.addView(caption("Активних сесій немає."))
                    return@apiAsync
                }
                for (i in 0 until sessions.length()) {
                    val session = sessions.getJSONObject(i)
                    val box = card()
                    box.addView(title(session.optString("device_name", session.optString("platform")), 17f))
                    box.addView(caption(
                        session.optString("name") + " · " +
                        roleLabel(session.optString("role")) + " · " +
                        session.optString("ip_address", "—")
                    ))
                    box.addView(caption(
                        (if (session.optBoolean("online")) "Онлайн" else "Неактивний") +
                        " · остання активність " + session.optString("last_seen", "—")
                    ))
                    box.addView(primary("Завершити сесію") {
                        AlertDialog.Builder(this)
                            .setTitle("Завершити сесію?")
                            .setMessage(session.optString("name") + " · " + session.optString("device_name"))
                            .setNegativeButton("Скасувати", null)
                            .setPositiveButton("Завершити") { _, _ ->
                                apiAsync("DELETE", "/api/admin/sessions/" + session.getString("session_id"), JSONObject()) {
                                    load()
                                }
                            }
                            .show()
                    })
                    list.addView(box)
                    list.addView(spacer(8))
                }
            }
        }
        load()
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

    override fun onDestroy() {
        io.shutdownNow()
        pdfPreview?.close(); pdfPreview = null
        super.onDestroy()
    }
}
