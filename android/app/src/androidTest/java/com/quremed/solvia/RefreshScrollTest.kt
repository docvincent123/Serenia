package com.quremed.solvia

import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import org.junit.Assert.*
import org.junit.Test

class RefreshScrollTest {
    @Test fun pullRefreshOnlyAtTopAndLongListsScrollNormally() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity { activity ->
            var refreshes = 0
            val scroll = RefreshScrollView(activity) { refreshes++ }
            val rows = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
            repeat(20) { rows.addView(TextView(activity).apply { text = "Пацієнт $it" }, LinearLayout.LayoutParams(-1, 150)) }
            scroll.addView(rows)
            scroll.measure(View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY))
            scroll.layout(0, 0, 720, 800)
            assertTrue(scroll.canScrollVertically(1))
            fun gesture(from: Float, to: Float, cancel: Boolean = false) {
                val now = android.os.SystemClock.uptimeMillis()
                val down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, 100f, from, 0)
                val move = MotionEvent.obtain(now, now+30, MotionEvent.ACTION_MOVE, 100f, to, 0)
                val up = MotionEvent.obtain(now, now+60, if(cancel) MotionEvent.ACTION_CANCEL else MotionEvent.ACTION_UP, 100f, to, 0)
                scroll.onInterceptTouchEvent(down)
                if(scroll.onInterceptTouchEvent(move)) scroll.onTouchEvent(up)
                down.recycle(); move.recycle(); up.recycle()
            }
            val density = activity.resources.displayMetrics.density
            gesture(100f, 100f + 120f * density)
            assertEquals(1, refreshes)
            gesture(100f, 100f + 120f * density, cancel = true)
            assertEquals(1, refreshes)
            scroll.scrollTo(0, 600)
            assertTrue(scroll.canScrollVertically(-1))
            gesture(100f, 100f + 120f * density)
            assertEquals(1, refreshes)
            scroll.fullScroll(View.FOCUS_DOWN)
            assertTrue(scroll.scrollY > 0)
        } }
    }
    @Test fun optionalChoicesPreserveTextWithoutInventingDefaultAssessment() {
        assertEquals("Опис психолога", ConsultationChoices.include("Опис психолога", "Стан", ConsultationChoices.emotionalStates, 0))
        assertEquals("Опис психолога\nСтан: Тривожний", ConsultationChoices.include("Опис психолога", "Стан", ConsultationChoices.emotionalStates, 2))
        assertEquals("", ConsultationChoices.include("", "Стан", ConsultationChoices.emotionalStates, -1))
    }
}
