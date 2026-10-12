package com.quremed.solvia

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** One native visual language for the psychologist's phone workspace. */
object MobileUi {
    val background = Color.rgb(246, 248, 250)
    val ink = Color.rgb(25, 44, 55)
    val muted = Color.rgb(105, 124, 137)
    val accent = Color.rgb(18, 113, 120)
    val soft = Color.rgb(229, 243, 242)
    val border = Color.rgb(225, 233, 236)
    fun dp(context: Context, n: Int) = (n * context.resources.displayMetrics.density).toInt()
    fun surface(context: Context, color: Int = Color.WHITE, radius: Int = 16, outlined: Boolean = false) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(context, radius).toFloat()
        if(outlined) setStroke(dp(context, 1), border)
    }
    fun button(context: Context, label: String, primary: Boolean = false, selected: Boolean = false, action: () -> Unit): Button = Button(context).apply {
        text = label; isAllCaps = false; textSize = 14f; gravity = Gravity.CENTER
        setTypeface(typeface, if(primary || selected) Typeface.BOLD else Typeface.NORMAL)
        setTextColor(if(primary) Color.WHITE else accent)
        minHeight = dp(context, 50); minimumHeight = dp(context, 50); minWidth = 0; minimumWidth = 0
        setPadding(dp(context, 14), dp(context, 9), dp(context, 14), dp(context, 9))
        backgroundTintList = null; stateListAnimator = null; elevation = 0f
        background = RippleDrawable(ColorStateList.valueOf(Color.argb(35, 18, 113, 120)),
            surface(context, if(primary) accent else if(selected) soft else Color.WHITE, 12, !primary && !selected), null)
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(context, 8) }
        setOnClickListener { action() }
    }
    fun card(context: Context): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14))
        background = surface(context, outlined = true)
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(context, 12) }
    }
    fun label(context: Context, value: String, size: Float = 14f, bold: Boolean = false): TextView = TextView(context).apply {
        text = value; textSize = size; setTextColor(ink); setPadding(0, dp(context, 5), 0, dp(context, 7))
        if(bold) setTypeface(typeface, Typeface.BOLD)
    }
    fun input(field: EditText) {
        field.setTextColor(ink); field.setHintTextColor(muted); field.textSize = 16f
        field.setPadding(dp(field.context, 14), dp(field.context, 13), dp(field.context, 14), dp(field.context, 13))
        field.background = surface(field.context, background, 12, true)
        field.layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(field.context, 10) }
    }
}
