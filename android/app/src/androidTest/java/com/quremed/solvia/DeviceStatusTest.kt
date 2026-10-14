package com.quremed.solvia
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class DeviceStatusTest {
 @Test fun statusCountsQueuesWithoutClinicalContentAndOnlyAcknowledgesEmptyQueue() {
  val c=InstrumentationRegistry.getInstrumentation().targetContext
  val base="https://"+java.util.UUID.randomUUID()+".invalid";val uid=991L
  val store=OfflineStore(c,base,uid);val drafts=DraftStore(c,base,uid)
  val payload=JSONObject().put("patient_id",1).put("appointment_id",2).put("client_key","synthetic-device-status").put("note","PRIVATE SYNTHETIC TEXT")
  store.enqueue(payload,"PRIVATE SYNTHETIC NAME");drafts.saveEditing(3,JSONObject().put("note","PRIVATE DRAFT").put("client_key","synthetic-draft"))
  val report=DeviceStatus.payload(c,base,uid)
  assertEquals(2,report.getInt("pending_count"));assertFalse(report.toString().contains("PRIVATE"))
  DeviceStatus.acknowledge(c,base,uid,report,JSONObject().put("server_time","2026-10-14T10:00:00"))
  assertNull(store.cache("/local/sync-status"))
  store.mark("synthetic-device-status","sent");drafts.remove(3)
  val empty=DeviceStatus.payload(c,base,uid);assertEquals(0,empty.getInt("pending_count"))
  DeviceStatus.acknowledge(c,base,uid,empty,JSONObject().put("server_time","2026-10-14T10:00:00"))
  assertEquals("2026-10-14T10:00:00",DeviceStatus.payload(c,base,uid).getString("last_sync"))
 }
}
