package com.quremed.solvia

import android.content.Context

/** Counts application requests/responses, not TCP packets; no payloads are stored. */
object PhoneNetworkStats {
    private fun preferences(c: Context)=c.getSharedPreferences("solvia_network_stats",0)
    @Synchronized private fun add(c: Context,server: String,key: String) {
        val p=preferences(c);val name="$server|$key";p.edit().putLong(name,p.getLong(name,0)+1).apply()
    }
    fun sent(c: Context,server: String)=add(c,server,"tx")
    fun received(c: Context,server: String)=add(c,server,"rx")
    fun failed(c: Context,server: String)=add(c,server,"errors")
    @Synchronized fun snapshot(c: Context,server: String): Triple<Long,Long,Long> {
        val p=preferences(c);return Triple(p.getLong("$server|rx",0),p.getLong("$server|tx",0),p.getLong("$server|errors",0))
    }
}
