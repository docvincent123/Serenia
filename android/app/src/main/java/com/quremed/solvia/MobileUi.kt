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
    val background = Color.rgb(243,243,233)
    val ink = Color.rgb(17,44,43)
    val muted = Color.rgb(105,127,116)
    val accent = Color.rgb(17,44,43)
    val onAccent = Color.rgb(167,237,207)
    val soft = Color.rgb(211,239,223)
    val border = Color.rgb(219,228,215)
    val panel = Color.rgb(255,255,252)
    val buttonInk = Color.rgb(17,44,43)
    fun textScale(context: Context) = when(context.getSharedPreferences("solvia_settings", 0).getInt("text_size", 0)) { 1 -> 1.12f; 2 -> 1.25f; else -> 1f }
    fun dp(context: Context, n: Int) = (n * context.resources.displayMetrics.density).toInt()
    fun surface(context: Context, color: Int = panel, radius: Int = 16, outlined: Boolean = false) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(context, radius).toFloat()
        if(outlined) setStroke(dp(context, 1), border)
    }
    fun button(context: Context, label: String, primary: Boolean = false, selected: Boolean = false, action: () -> Unit): Button = Button(context).apply {
        text = label; isAllCaps = false; textSize = 15f * textScale(context); gravity = Gravity.CENTER
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(if(primary) onAccent else buttonInk)
        minHeight = dp(context, 52); minimumHeight = dp(context, 52); minWidth = 0; minimumWidth = 0
        setPadding(dp(context, 14), dp(context, 9), dp(context, 14), dp(context, 9))
        backgroundTintList = null; stateListAnimator = null; elevation = 0f
        background = RippleDrawable(ColorStateList.valueOf(Color.argb(45,72,128,95)),
            surface(context, if(primary) accent else if(selected) soft else Color.rgb(255,255,252), 14, false), null)
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(context, 8) }
        setOnClickListener { action() }
    }
    fun card(context: Context): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(context, 18), dp(context, 16), dp(context, 18), dp(context, 16))
        background = surface(context, outlined = true)
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(context, 12) }
    }
    fun label(context: Context, value: String, size: Float = 14f, bold: Boolean = false): TextView = TextView(context).apply {
        text = value; textSize = size * textScale(context); setTextColor(ink); setPadding(0, dp(context, 5), 0, dp(context, 7))
        if(bold) setTypeface(typeface, Typeface.BOLD)
    }
    fun input(field: EditText) {
        field.setSelectAllOnFocus(field.context.getSharedPreferences("solvia_settings", 0).getBoolean("select_all", false))
        field.setTextColor(ink); field.setHintTextColor(muted); field.textSize = 16f * textScale(field.context)
        field.setPadding(dp(field.context, 14), dp(field.context, 13), dp(field.context, 14), dp(field.context, 13))
        field.background = surface(field.context, background, 12, true)
        field.layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(field.context, 10) }
    }
}
