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
}
