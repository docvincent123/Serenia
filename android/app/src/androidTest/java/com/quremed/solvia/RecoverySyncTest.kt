package com.quremed.solvia

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RecoverySyncTest {
 private val context=InstrumentationRegistry.getInstrumentation().targetContext
 private fun scope()="https://recovery-${java.util.UUID.randomUUID()}.invalid"
 private fun payload()=JSONObject().put("patient_id",101).put("appointment_id",202)
  .put("client_key",java.util.UUID.randomUUID().toString()).put("note","Private original text").put("duration_minutes",60)
 private fun response(source:JSONObject,id:Long=77)=JSONObject().put("items",JSONArray().put(JSONObject()
  .put("state","completed").put("client_key",source.getString("client_key")).put("consultation_id",id).put("source",source)))
 @Test fun completedRecoveryAcknowledgesQueueRetainsTextAndRemovesOnlyMatchingDraft() {
  val base=scope();val store=OfflineStore(context,base,41);val drafts=DraftStore(context,base,41);val p=payload()
  store.enqueue(p,"Synthetic patient");store.mark(p.getString("client_key"),"blocked","Conflict");drafts.save(101,JSONObject(p.toString()).put("sync_blocked",true))
  var calls=0
  val sync=RecoverySync(drafts,store){body->calls++;assertEquals(1,body.getJSONArray("items").length());response(p)}
  assertTrue(sync.run());assertEquals(1,calls);assertEquals("sent",store.queue().getJSONObject(0).getString("state"))
  assertEquals("Private original text",store.queue().getJSONObject(0).getJSONObject("payload").getString("note"));assertNull(drafts.read(101))
  assertTrue(sync.run());assertEquals(1,calls);assertEquals(0,DeviceStatus.payload(context,base,41).getInt("blocked_count"))
 }
 @Test fun draftOnlyRecoveryKeepsAnEncryptedJournalCopy() {
  val base=scope();val store=OfflineStore(context,base,42);val drafts=DraftStore(context,base,42);val p=payload()
  drafts.save(101,JSONObject(p.toString()).put("sync_blocked",true).put("sync_error","Draft changed"))
  assertTrue(RecoverySync(drafts,store){body->assertEquals("draft",body.getJSONArray("items").getJSONObject(0).getString("kind"));response(p)}.run())
  assertNull(drafts.read(101));assertEquals(1,store.queue().length());assertEquals("sent",store.queue().getJSONObject(0).getString("state"))
 }
 @Test fun editsMadeDuringRecoveryStayLocalAndBlockedForReview() {
  val base=scope();val store=OfflineStore(context,base,43);val drafts=DraftStore(context,base,43);val p=payload()
  drafts.save(101,JSONObject(p.toString()).put("sync_blocked",true))
  assertTrue(RecoverySync(drafts,store){drafts.save(101,JSONObject(p.toString()).put("note","Newer local text").put("sync_blocked",true));response(p)}.run())
  assertEquals("Newer local text",drafts.read(101)!!.getString("note"));assertTrue(drafts.read(101)!!.getBoolean("sync_blocked"))
  assertTrue(drafts.read(101)!!.getString("sync_error").contains("Нові локальні правки"))
 }
 @Test fun wrongIdentityAndUnavailableRecoveryNeverDropBlockedText() {
  val base=scope();val store=OfflineStore(context,base,44);val drafts=DraftStore(context,base,44);val p=payload()
  store.enqueue(p,"Synthetic");store.mark(p.getString("client_key"),"blocked","Conflict")
  assertTrue(RecoverySync(drafts,store){response(JSONObject(p.toString()).put("patient_id",999))}.run())
  assertEquals("blocked",store.queue().getJSONObject(0).getString("state"))
  for(code in listOf(404,500))assertTrue(RecoverySync(drafts,store){throw SyncFailure(code,"Unavailable")}.run())
  assertFalse(RecoverySync(drafts,store){throw SyncFailure(401,"Expired")}.run())
  assertEquals("Private original text",store.queue().getJSONObject(0).getJSONObject("payload").getString("note"))
 }
 @Test fun deviceCounterDeduplicatesSameQueueAndDraftButKeepsNewerEditsVisible() {
  val base=scope();val store=OfflineStore(context,base,45);val drafts=DraftStore(context,base,45);val p=payload()
  store.enqueue(p,"Synthetic");store.mark(p.getString("client_key"),"blocked","Conflict");drafts.save(101,JSONObject(p.toString()).put("sync_blocked",true))
  assertEquals(1,DeviceStatus.payload(context,base,45).getInt("blocked_count"))
  drafts.save(101,JSONObject(p.toString()).put("note","Newer text").put("sync_blocked",true))
  assertEquals(2,DeviceStatus.payload(context,base,45).getInt("blocked_count"))
  assertFalse(DeviceStatus.payload(context,base,45).toString().contains("Private"))
 }
 @Test fun uploadsAreBatchedAndDoNotPreventRoutineSyncOnServerErrors() {
  val base=scope();val store=OfflineStore(context,base,46);val drafts=DraftStore(context,base,46)
  repeat(7){val p=payload().put("patient_id",101+it);store.enqueue(p,"Synthetic");store.mark(p.getString("client_key"),"blocked","Conflict")}
  var calls=0
  assertTrue(RecoverySync(drafts,store){body->calls++;assertTrue(body.getJSONArray("items").length()<=5);JSONObject().put("items",JSONArray())}.run())
  assertEquals(2,calls);assertEquals(7,store.queue().length())
 }
}
