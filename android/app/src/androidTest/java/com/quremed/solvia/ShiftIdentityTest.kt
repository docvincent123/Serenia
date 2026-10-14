package com.quremed.solvia

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class ShiftIdentityTest {
    private val c get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun rememberedUkrainianLoginNeverFillsPassword() {
        val p=c.getSharedPreferences("solvia_settings",0);val old=p.getString("server",null)
        val base="https://${UUID.randomUUID()}.invalid"
        p.edit().putString("server",base).putString("last_login:$base","Психолог Олена").putString("login_history:$base","[\"Психолог Олена\",\"Психолог Іван\"]").commit()
        try {
            androidx.test.core.app.ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { activity ->
                    fun views(v: android.view.View): List<android.view.View> = listOf(v) + if(v is android.view.ViewGroup) (0 until v.childCount).flatMap { views(v.getChildAt(it)) } else emptyList()
                    val all=views(activity.window.decorView)
                    val login=all.filterIsInstance<android.widget.AutoCompleteTextView>().first()
                    assertEquals("Психолог Олена",login.text.toString());assertEquals(2,login.adapter.count)
                    val password=all.filterIsInstance<android.widget.EditText>().first { it.hint?.toString()=="Пароль" }
                    assertEquals("",password.text.toString());assertFalse(password.isSaveEnabled)
                    assertEquals(android.view.View.IMPORTANT_FOR_AUTOFILL_NO,password.importantForAutofill)
                }
            }
        } finally {
            val edit=p.edit().remove("last_login:$base").remove("login_history:$base")
            if(old==null)edit.remove("server") else edit.putString("server",old)
            edit.commit()
        }
    }
    @Test fun boundShiftSessionSurvivesRestartBeyondNormalTtl() {
        val base="https://${UUID.randomUUID()}.invalid"
        val user=JSONObject().put("id",35).put("name","Психолог Тест По батькові").put("shift_bound",true)
        OfflineStore(c,base,35).saveSession(user,"same-token",1000)
        assertEquals("same-token",OfflineStore(c,base,35).session(1000+13*60*60*1000L)?.getString("token"))
        assertNull(OfflineStore(c,base,36).session(2000))
        OfflineStore(c,base,35).revokeSession()
        assertNull(OfflineStore(c,base,35).session(2000))
    }
    @Test fun networkCountersAreScopedAndDoNotStorePayloads() {
        val base="https://${UUID.randomUUID()}.invalid"
        PhoneNetworkStats.sent(c,base);PhoneNetworkStats.received(c,base);PhoneNetworkStats.failed(c,base)
        assertEquals(Triple(1L,1L,1L),PhoneNetworkStats.snapshot(c,base))
        assertEquals(Triple(0L,0L,0L),PhoneNetworkStats.snapshot(c,base+"/other"))
    }
    @Test fun selectedRingtoneUsesItsOwnChannelAndCanBeReset() {
        val p=c.getSharedPreferences("solvia_settings",0)
        val old=p.getString("consultation_ringtone",null)
        try {
            p.edit().remove("consultation_ringtone").commit();assertEquals(AppointmentReminders.CHANNEL,AppointmentReminders.channelId(c))
            p.edit().putString("consultation_ringtone","content://settings/system/notification_sound").commit()
            val first=AppointmentReminders.channelId(c)
            p.edit().putString("consultation_ringtone","").commit();assertNotEquals(first,AppointmentReminders.channelId(c))
        } finally {
            if(old==null)p.edit().remove("consultation_ringtone").commit() else p.edit().putString("consultation_ringtone",old).commit()
        }
    }
}
