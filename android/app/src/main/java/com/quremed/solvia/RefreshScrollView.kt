package com.quremed.solvia

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.ScrollView
import kotlin.math.abs

/** Only intercept a downward pull at the top; ordinary scrolling and taps stay native. */
class RefreshScrollView(context: Context, private val refresh: () -> Unit) : ScrollView(context) {
    private var startX = 0f
    private var startY = 0f
    private var eligible = false
    private var pulling = false
    private var distance = 0f
    private val threshold = 80f * resources.displayMetrics.density
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = MobileUi.accent; textSize = 14f * resources.displayMetrics.scaledDensity; textAlign = Paint.Align.CENTER
    }
    init { isFillViewport = true; isVerticalScrollBarEnabled = true; tag = "refresh-scroll" }
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        when(event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                startX = event.x; startY = event.y; eligible = !canScrollVertically(-1)
                pulling = false; distance = 0f
            }
            MotionEvent.ACTION_MOVE -> {
                val dy = event.y - startY; val dx = abs(event.x - startX)
                if(eligible && !canScrollVertically(-1) && dy > slop * 2 && dy > dx * 2) {
                    pulling = true; distance = dy; parent?.requestDisallowInterceptTouchEvent(true)
                    invalidate(); return true
                }
                if(dy < -slop || dx > slop * 2) eligible = false
            }
            MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_UP -> eligible = false
        }
        return super.onInterceptTouchEvent(event)
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if(!pulling) return super.onTouchEvent(event)
        when(event.actionMasked) {
            MotionEvent.ACTION_MOVE -> { distance = (event.y - startY).coerceAtLeast(0f); invalidate() }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val trigger = event.actionMasked == MotionEvent.ACTION_UP && distance >= threshold
                pulling = false; eligible = false; distance = 0f
                parent?.requestDisallowInterceptTouchEvent(false); invalidate()
                if(trigger) refresh()
            }
        }
        return true
    }
    override fun dispatchDraw(canvas: Canvas) {
        super.dispatchDraw(canvas)
        if(pulling) {
            val y = scrollY + paddingTop + 28f * resources.displayMetrics.density
            paint.color = MobileUi.background
            canvas.drawRect(0f, scrollY.toFloat(), width.toFloat(), y + 12f * resources.displayMetrics.density, paint)
            paint.color = MobileUi.accent
            canvas.drawText(if(distance >= threshold) "Відпустіть для оновлення" else "Потягніть вниз для оновлення", width / 2f, y, paint)
        }
    }
}
