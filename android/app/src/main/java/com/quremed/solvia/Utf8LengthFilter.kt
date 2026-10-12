package com.quremed.solvia

import android.text.InputFilter
import android.text.Spanned

/** Server limits are UTF-8 bytes, not UTF-16 characters. Never split a surrogate pair. */
class Utf8LengthFilter(private val maxBytes: Int) : InputFilter {
    override fun filter(source: CharSequence, start: Int, end: Int, dest: Spanned, dstart: Int, dend: Int): CharSequence? {
        val retained = dest.subSequence(0, dstart).toString() + dest.subSequence(dend, dest.length)
        val available = maxBytes - retained.toByteArray(Charsets.UTF_8).size
        val addition = source.subSequence(start, end).toString()
        if(addition.toByteArray(Charsets.UTF_8).size <= available) return null
        var cursor = start
        var used = 0
        while(cursor < end) {
            val codepoint = Character.codePointAt(source, cursor)
            val width = Character.charCount(codepoint)
            if(cursor + width > end) break
            val bytes = String(Character.toChars(codepoint)).toByteArray(Charsets.UTF_8).size
            if(used + bytes > available) break
            used += bytes; cursor += width
        }
        return source.subSequence(start, cursor)
    }
}
