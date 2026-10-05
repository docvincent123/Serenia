package com.quremed.solvia

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import java.io.FileOutputStream

data class DocumentSection(val label: String, val value: String)
data class NativeDocument(val title: String, val center: String, val sections: List<DocumentSection>, val signature: String = "")

object NativePdf {
    fun create(activity: Activity, model: NativeDocument): File {
        val folder = File(activity.cacheDir, "documents").apply { mkdirs() }
        val file = File.createTempFile("solvia-", ".pdf", folder)
        val pdf = PdfDocument()
        val text = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(25, 42, 52); textSize = 11f }
        val heading = TextPaint(text).apply { typeface = Typeface.DEFAULT_BOLD; textSize = 12f }
        val footer = Paint(text).apply { textSize = 8f; color = Color.GRAY }
        var page: PdfDocument.Page? = null
        var pageNo = 0
        var y = 0f
        fun nextPage() {
            page?.let {
                it.canvas.drawText("SOLVIA · ${model.title.take(48)} · $pageNo", 42f, 818f, footer)
                pdf.finishPage(it)
            }
            pageNo++
            page = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, pageNo).create())
            page!!.canvas.drawText(model.center.take(65), 42f, 35f, heading)
            page!!.canvas.drawLine(42f, 44f, 553f, 44f, footer)
            y = 66f
        }
        fun paragraph(value: String, paint: TextPaint) {
            if (value.isBlank()) return
            val layout = StaticLayout.Builder.obtain(value, 0, value.length, paint, 511)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(3f, 1f).setIncludePad(false).build()
            for (i in 0 until layout.lineCount) {
                val height = (layout.getLineBottom(i) - layout.getLineTop(i)).toFloat()
                if (page == null || y + height > 790f) nextPage()
                val canvas = page!!.canvas
                canvas.save(); canvas.clipRect(42f, y, 553f, y + height)
                canvas.translate(42f, y - layout.getLineTop(i)); layout.draw(canvas); canvas.restore()
                y += height
            }
            y += 10f
        }
        try {
            nextPage(); paragraph(model.title, TextPaint(heading).apply { textSize = 19f })
            model.sections.forEach {
                if (y > 747f) nextPage()
                paragraph(it.label, heading); paragraph(it.value.ifBlank { "—" }, text)
            }
            if (model.signature.startsWith("data:image/png;base64,")) {
                val bytes = Base64.decode(model.signature.substringAfter(','), Base64.DEFAULT)
                val image = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                if (image != null) {
                    if (y + 110f > 790f) nextPage()
                    paragraph("Рукописний підпис", heading)
                    page!!.canvas.drawBitmap(image, null, android.graphics.RectF(42f, y, 242f, y + 80f), null)
                    image.recycle()
                }
            }
            page?.let { it.canvas.drawText("SOLVIA · $pageNo", 42f, 818f, footer); pdf.finishPage(it) }
            FileOutputStream(file).use { pdf.writeTo(it) }
            return file
        } catch (error: Exception) { file.delete(); throw error }
        finally { pdf.close() }
    }

    fun print(activity: Activity, file: File, title: String) {
        val manager = activity.getSystemService(Activity.PRINT_SERVICE) as PrintManager
        manager.print(title, object : PrintDocumentAdapter() {
            override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cancel: CancellationSignal?, callback: LayoutResultCallback, extras: android.os.Bundle?) {
                if (cancel?.isCanceled == true) { callback.onLayoutCancelled(); return }
                try {
                    val count = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                        PdfRenderer(descriptor).use { it.pageCount }
                    }
                    callback.onLayoutFinished(PrintDocumentInfo.Builder("SOLVIA.pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(count).build(), old != new)
                } catch (error: Exception) { callback.onLayoutFailed(error.message ?: "Не вдалося відкрити PDF") }
            }
            override fun onWrite(pages: Array<out PageRange>?, destination: ParcelFileDescriptor?, cancel: CancellationSignal?, callback: WriteResultCallback) {
                if (destination == null) { callback.onWriteFailed("Немає файлу призначення"); return }
                try {
                    if (cancel?.isCanceled == true) { callback.onWriteCancelled(); return }
                    FileOutputStream(destination.fileDescriptor).use { output -> file.inputStream().use { it.copyTo(output) } }
                    if (cancel?.isCanceled == true) callback.onWriteCancelled() else callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
                } catch (error: Exception) { callback.onWriteFailed(error.message) }
            }
        }, PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).setColorMode(PrintAttributes.COLOR_MODE_COLOR).build())
    }
}

/** Only the visible page is rasterized; long records do not allocate all pages at once. */
class NativePdfPreview(private val activity: Activity, val file: File, private val export: (File) -> Unit) : AutoCloseable {
    private val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = PdfRenderer(descriptor)
    private var bitmap: Bitmap? = null
    private var current = 0
    private var closed = false
    fun view(title: String): View {
        val root = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(12, 12, 12, 12) }
        val counter = TextView(activity).apply { gravity = Gravity.CENTER; textSize = 15f }
        val image = ZoomPdfView(activity).apply { adjustViewBounds = true; contentDescription = title; setBackgroundColor(Color.WHITE) }
        val controls = LinearLayout(activity).apply { gravity = Gravity.CENTER }
        fun render() {
            if (closed) return
            renderer.openPage(current).use { page ->
                val width = minOf(1440, activity.resources.displayMetrics.widthPixels * 2).coerceAtLeast(595)
                val next = Bitmap.createBitmap(width, (width * page.height.toFloat() / page.width).toInt(), Bitmap.Config.ARGB_8888)
                next.eraseColor(Color.WHITE); page.render(next, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                image.resetZoom(); image.setImageBitmap(next); bitmap?.recycle(); bitmap = next
            }
            counter.text = "Сторінка ${current + 1} з ${renderer.pageCount}"
        }
        fun button(label: String, action: () -> Unit) = MobileUi.button(activity, label, action = action)
        controls.addView(button("Попередня") { if (current > 0) { current--; render() } }, LinearLayout.LayoutParams(0, -2, 1f))
        controls.addView(button("Наступна") { if (current + 1 < renderer.pageCount) { current++; render() } }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(counter); root.addView(controls)
        root.addView(button("Зберегти PDF") { export(file) })
        root.addView(button("Друк") { NativePdf.print(activity, file, title) })
        root.addView(TextView(activity).apply { text = "Розведіть два пальці, щоб збільшити текст. Подвійний дотик скидає масштаб."; textSize = 13f })
        root.addView(image); render(); return root
    }
    override fun close() { if (!closed) { closed = true; renderer.close(); bitmap?.recycle(); bitmap = null } }
}

/** Pinch zoom and drag keep an A4 document readable on a small phone. */
private class ZoomPdfView(activity: Activity) : ImageView(activity) {
    private var zoom = 1f
    private var offsetX = 0f
    private var offsetY = 0f
    private var lastX = 0f
    private var lastY = 0f
    private val scale = ScaleGestureDetector(activity, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val next = (zoom * detector.scaleFactor).coerceIn(1f, 5f)
            val ratio = next / zoom
            offsetX = detector.focusX - (detector.focusX - offsetX) * ratio
            offsetY = detector.focusY - (detector.focusY - offsetY) * ratio
            zoom = next; clamp(); invalidate(); return true
        }
    })
    private val gestures = android.view.GestureDetector(activity, object : android.view.GestureDetector.SimpleOnGestureListener() {
        override fun onDown(event: MotionEvent) = true
        override fun onDoubleTap(event: MotionEvent): Boolean { resetZoom(); return true }
    })
    fun resetZoom() { zoom = 1f; offsetX = 0f; offsetY = 0f; invalidate() }
    private fun clamp() {
        offsetX = offsetX.coerceIn(-width * (zoom - 1f), 0f)
        offsetY = offsetY.coerceIn(-height * (zoom - 1f), 0f)
    }
    override fun onDraw(canvas: android.graphics.Canvas) {
        canvas.save(); canvas.translate(offsetX, offsetY); canvas.scale(zoom, zoom)
        super.onDraw(canvas); canvas.restore()
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        parent?.requestDisallowInterceptTouchEvent(event.pointerCount > 1 || zoom > 1f)
        gestures.onTouchEvent(event); scale.onTouchEvent(event)
        when(event.actionMasked) {
            MotionEvent.ACTION_MOVE -> if(event.pointerCount == 1 && !scale.isInProgress && zoom > 1f) {
                offsetX += event.x - lastX; offsetY += event.y - lastY; clamp(); invalidate()
            }
            MotionEvent.ACTION_UP -> { performClick(); parent?.requestDisallowInterceptTouchEvent(false) }
            MotionEvent.ACTION_CANCEL -> parent?.requestDisallowInterceptTouchEvent(false)
        }
        lastX = event.x; lastY = event.y
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
}
