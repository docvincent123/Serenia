package com.quremed.solvia

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Synthetic fixtures only. No network, real accounts, or real clinical data. */
class NativeWorkflowTest {
    private fun patient(): JSONObject = JSONObject().put("id", 7).put("name", "Тестова Пацієнтка")
        .put("patient_no", "54321").put("dob", "1990-01-01").put("status", "active").put("phone", "+380000000000")
        .put("consultations", JSONArray().put(JSONObject().put("created", "2026-10-04T12:00").put("note", "Синтетична нотатка")
            .put("work_done", "Навчальна техніка").put("homework", "Тестове завдання")))
        .put("discharges", JSONArray().put(JSONObject().put("id", 9).put("document_no", "TEST-9").put("summary", "Підсумок")
            .put("dynamics", "Динаміка").put("recommendations", "Рекомендації").put("followup", "План")))
    private fun views(view: View): List<View> = listOf(view) + if(view is ViewGroup) (0 until view.childCount).flatMap { views(view.getChildAt(it)) } else emptyList()
    private fun button(root: View, label: String): Button = views(root).filterIsInstance<Button>().first { it.text.toString() == label }
    private fun fixture(activity: MainActivity, tab: String, failure: Boolean = false, submitted: (JSONObject) -> Unit = {}, preview: (NativeDocument) -> Unit = {}): () -> View {
        var current: View = activity.window.decorView
        val api = object : MobileApi {
            override fun call(method: String, path: String, body: JSONObject?, success: (Any) -> Unit, failureCallback: (String) -> Unit) {
                when {
                    method == "POST" -> { submitted(body!!); if(failure) failureCallback("Немає мережі") else success(JSONObject().put("id", 1)) }
                    path == "/api/settings/center" -> success(JSONObject().put("center_name", "Тестовий центр"))
                    path.endsWith("/documents") -> success(JSONArray().put(JSONObject().put("title", "Тестова згода").put("content", "Повний текст згоди")
                        .put("status", "refused").put("patient_name", "Ім’я на дату підписання").put("patient_no_snapshot", "12345")))
                    else -> success(patient())
                }
            }
        }
        PatientWorkspace(activity, api, "psychologist", "https://synthetic.example", { view, _ ->
            current = view; activity.setContentView(ScrollView(activity).apply { addView(view) })
        }, {}, { _, _ -> }, { model, _ -> preview(model) }).open(7, tab)
        return { current }
    }
    private fun screenshot(activity: MainActivity, name: String) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
        val folder = File(activity.getExternalFilesDir(null), "previews").apply { mkdirs() }
        val image = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        File(folder, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
    @Test fun documentsUseSnapshotIdentityAndCompleteText() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity { activity ->
            var preview: NativeDocument? = null
            val current = fixture(activity, "documents", preview = { preview = it })
            button(current(), "Відкрити документ").performClick()
            assertNotNull(preview)
            assertEquals("Ім’я на дату підписання", preview!!.sections.first().value)
            assertTrue(preview!!.sections.any { it.value == "Повний текст згоди" })
        } }
    }
    @Test fun consultationHistoryExposesCompleteRecord() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity { activity ->
            val current = fixture(activity, "history")
            button(current(), "Повний запис").performClick()
            val labels = views(current()).filterIsInstance<TextView>().map { it.text.toString() }
            assertTrue(labels.contains("Синтетична нотатка")); assertTrue(labels.contains("Тестове завдання"))
        } }
    }
    @Test fun documentSubmissionRetainsFormAfterNetworkFailure() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity { activity ->
            var payload: JSONObject? = null
            val current = fixture(activity, "documents", failure = true, submitted = { payload = it })
            button(current(), "Оформити документ").performClick()
            views(current()).filterIsInstance<EditText>().first { it.hint == "Назва документа" }.setText("Тест")
            views(current()).filterIsInstance<EditText>().first { it.hint == "Повний текст документа" }.setText("Текст, який не має загубитися")
            views(current()).filterIsInstance<CheckBox>().first().isChecked = true
            button(current(), "Зберегти").performClick()
            assertEquals("refused", payload!!.getString("status"))
            assertTrue(button(current(), "Зберегти").isEnabled)
            assertEquals("Текст, який не має загубитися", views(current()).filterIsInstance<EditText>().first { it.hint == "Повний текст документа" }.text.toString())
        } }
    }
    @Test fun signatureProducesRealPngAndCanBeCleared() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity { activity ->
            val signature = SignatureView(activity); signature.layout(0, 0, 500, 160)
            val parent = android.widget.LinearLayout(activity); parent.addView(signature)
            val down = MotionEvent.obtain(0, 0, MotionEvent.ACTION_DOWN, 20f, 30f, 0)
            val move = MotionEvent.obtain(0, 10, MotionEvent.ACTION_MOVE, 180f, 90f, 0)
            signature.onTouchEvent(down); signature.onTouchEvent(move); down.recycle(); move.recycle()
            assertTrue(signature.dataUrl().startsWith("data:image/png;base64,iVBOR"))
            signature.clear(); assertFalse(signature.hasSignature)
        } }
    }
    @Test fun longUkrainianPdfPaginatesAndRenders() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity { activity ->
            val text = (1..180).joinToString("\n") { "Рядок $it — перевірка українського тексту та перенесення сторінок." }
            val file = NativePdf.create(activity, NativeDocument("Тестова виписка", "Навчальний центр", listOf(DocumentSection("Підсумок", text))))
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd -> PdfRenderer(fd).use { renderer ->
                assertTrue(renderer.pageCount >= 3)
                renderer.openPage(renderer.pageCount - 1).use { page ->
                    val image = Bitmap.createBitmap(page.width, page.height, Bitmap.Config.ARGB_8888)
                    page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    assertTrue(image.byteCount > 0); image.recycle()
                }
            } }; file.delete()
        } }
    }
    @Test fun draftsRemainEncryptedAndAccountScoped() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val first = DraftStore(context, "https://synthetic.example", 101)
        val other = DraftStore(context, "https://synthetic.example", 102)
        first.save(7, JSONObject().put("note", "Секретна тестова нотатка"))
        assertEquals("Секретна тестова нотатка", first.read(7)!!.getString("note"))
        assertNull(other.read(7))
        assertFalse(context.getSharedPreferences("solvia_encrypted_drafts", 0).all.values.any { it.toString().contains("Секретна тестова нотатка") })
        first.remove(7)
    }
    @Test fun otherRolesCannotOpenMobileWorkspace() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity { activity ->
            val response = JSONObject().put("token", "synthetic-admin-token").put("user", JSONObject().put("role", "admin").put("name", "Admin").put("id", 1))
            MainActivity::class.java.getDeclaredMethod("acceptLogin", JSONObject::class.java).apply { isAccessible = true }.invoke(activity, response)
            assertEquals("", MainActivity::class.java.getDeclaredField("token").apply { isAccessible = true }.get(activity))
            assertEquals("", MainActivity::class.java.getDeclaredField("role").apply { isAccessible = true }.get(activity))
        } }
    }
    @Test fun nativeMenuContainsDocumentsDraftsAndSettings() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                for ((name, value) in listOf("token" to "synthetic-token", "role" to "psychologist", "userName" to "Психолог · тест", "workspaceReady" to true)) {
                    MainActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.set(activity, value)
                }
                MainActivity::class.java.getDeclaredMethod("moreScreen").apply { isAccessible = true }.invoke(activity)
                val root = activity.window.decorView
                assertNotNull(button(root, "Документи пацієнтів")); assertNotNull(button(root, "Мої чернетки")); assertNotNull(button(root, "Мої налаштування"))
                assertNotNull(button(root, "Розклад")); assertNotNull(button(root, "Пацієнти"))
                val labels = views(root).filterIsInstance<Button>().map { it.text.toString() }
                assertFalse(labels.any { it.contains("центру") || it.contains("Пристрої") || it.contains("очікування") })
            }
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            var reference: MainActivity? = null
            scenario.onActivity { reference = it }
            screenshot(reference!!, "native-menu")
        }
    }
    @Test fun patientWorkspaceGroupsClinicalRecordsAndDocumentsForPhone() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var activity: MainActivity? = null
            scenario.onActivity {
                activity = it
                val current = fixture(it, "summary")
                for(label in listOf("Огляд", "Записи", "Документи", "Курс супроводу", "Направлення")) assertNotNull(button(current(), label))
                assertFalse(views(current()).filterIsInstance<EditText>().any { it.isShown })
            }
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            screenshot(activity!!, "patient-overview")
            scenario.onActivity { fixture(it, "documents") }
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            screenshot(activity!!, "patient-documents")
        }
    }

}
