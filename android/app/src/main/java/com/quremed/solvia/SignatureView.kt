package com.quremed.solvia

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.Base64
import android.view.MotionEvent
import android.view.View
import java.io.ByteArrayOutputStream

/** A handwritten mark, not a qualified electronic signature. */
class SignatureView(context: Context) : View(context) {
    private val strokes = Path()
    private val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(20, 45, 58); strokeWidth = 3f * resources.displayMetrics.density
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    var hasSignature = false
        private set
    init { setBackgroundColor(Color.WHITE); contentDescription = "Поле рукописного підпису" }
    fun clear() { strokes.reset(); hasSignature = false; invalidate() }
    override fun onDraw(canvas: Canvas) { super.onDraw(canvas); canvas.drawPath(strokes, pen) }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { parent.requestDisallowInterceptTouchEvent(true); strokes.moveTo(event.x, event.y); strokes.lineTo(event.x + 0.1f, event.y); hasSignature = true }
            MotionEvent.ACTION_MOVE -> strokes.lineTo(event.x, event.y)
            MotionEvent.ACTION_UP -> { parent.requestDisallowInterceptTouchEvent(false); performClick() }
            MotionEvent.ACTION_CANCEL -> parent.requestDisallowInterceptTouchEvent(false)
        }
        invalidate(); return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
    fun dataUrl(): String {
        check(hasSignature && width > 0 && height > 0) { "Поставте підпис у полі" }
        val image = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(image); canvas.drawColor(Color.WHITE); canvas.drawPath(strokes, pen)
        val output = ByteArrayOutputStream()
        image.compress(Bitmap.CompressFormat.PNG, 100, output); image.recycle()
        return "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
    }
}
