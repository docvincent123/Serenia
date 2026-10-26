package com.quremed.solvia

import android.content.ComponentName
import android.content.pm.ServiceInfo
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class WorkflowNotificationsTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun historySurvivesDuplicateDeliveryAndIsScopedToUser() {
        val base="https://${UUID.randomUUID()}.invalid";val uid=42L;val store=OfflineStore(context,base,uid)
        val first=JSONObject().put("id",1).put("kind","appointment.created").put("actor_id",uid)
        WorkflowNotifications.receive(context,base,uid) { path ->
            assertEquals("/api/workflow-events",path)
            JSONObject().put("cursor",1).put("initial",true).put("events",JSONArray().put(first))
        }
        val arrived=JSONObject().put("id",2).put("kind","patient.arrived").put("actor_id",uid)
        repeat(2) { attempt -> WorkflowNotifications.receive(context,base,uid) { path ->
            assertEquals("/api/workflow-events?after=${if(attempt==0)1 else 2}",path)
            JSONObject().put("cursor",2).put("events",JSONArray().put(arrived))
        } }
        assertEquals(2,WorkflowNotifications.history(store).length())
        assertEquals(0,WorkflowNotifications.history(OfflineStore(context,base,43)).length())
        WorkflowNotifications.receive(context,base,uid) { JSONObject() }
        assertEquals(2,WorkflowNotifications.history(store).length())
    }
    @Test fun liveServiceHasTheRequiredTypeAndIsNotExported() {
        val service=context.packageManager.getServiceInfo(ComponentName(context,LiveShiftService::class.java),0)
        assertFalse(service.exported)
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,service.foregroundServiceType)
    }
    @Test fun activeShiftServiceShowsAnOngoingNoticeAndStopsOnRequest() {
        InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS").use {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes()
        }
        val prefs=context.getSharedPreferences("solvia_settings",0);val enabled=prefs.getBoolean("live_shift",true)
        val base="https://127.0.0.1:1";val uid=987654L;val store=OfflineStore(context,base,uid)
        val manager=context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        fun awaitState(condition:()->Boolean){val end=android.os.SystemClock.elapsedRealtime()+5000;while(!condition()&&android.os.SystemClock.elapsedRealtime()<end)Thread.sleep(50);assertTrue(condition())}
        try {
            prefs.edit().putBoolean("live_shift",true).commit()
            store.saveSession(JSONObject().put("id",uid).put("role","psychologist"),"synthetic-service-test")
            androidx.test.core.app.ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { activity -> LiveShiftService.start(activity,base,uid) }
                awaitState { LiveShiftService.running&&manager.activeNotifications.any { it.id==209 } }
                val notice=manager.activeNotifications.first { it.id==209 }.notification
                assertTrue(notice.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0)
                assertFalse(notice.extras.toString().contains("synthetic-service-test"))
                LiveShiftService.stop(context)
                awaitState { !LiveShiftService.running&&manager.activeNotifications.none { it.id==209 } }
            }
        } finally { LiveShiftService.stop(context);store.revokeSession();prefs.edit().putBoolean("live_shift",enabled).commit() }
    }

}
