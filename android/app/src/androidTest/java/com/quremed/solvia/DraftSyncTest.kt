package com.quremed.solvia

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class DraftSyncTest {
    private fun local() = JSONObject().put("client_key", UUID.randomUUID().toString()).put("appointment_id",12).put("note","Перший текст").put("server_version",0)
    private fun stores(): Pair<DraftStore,OfflineStore> {
        val c = InstrumentationRegistry.getInstrumentation().targetContext
        val base = "https://${UUID.randomUUID()}.invalid"
        return DraftStore(c,base,77) to OfflineStore(c,base,77)
    }
    @Test fun ackClearsOnlyTheCapturedTextAndNewEditsStayPending() {
        val (drafts,journal) = stores(); drafts.save(7,local())
        val sync = DraftSync(drafts,journal) { method,_,body ->
            if(method == "GET") JSONObject().put("version",0).put("payload",JSONObject.NULL)
            else {
                val changed = drafts.read(7)!!.put("note","Новий текст під час передавання")
                drafts.saveEditing(7, changed)
                JSONObject().put("version",1)
            }
        }
        assertTrue(sync.run()); val current = drafts.read(7)!!
        assertEquals("Новий текст під час передавання",current.getString("note"))
        assertEquals(1,current.getInt("server_version")); assertFalse(DraftSync.transferred(current))
    }
    @Test fun lostResponseWithNewerEditsRecoversWithoutAFalseConflict() {
        val (drafts,journal) = stores(); drafts.save(7,local())
        var remote: JSONObject? = null; var version = 0; var lose = true
        val sync = DraftSync(drafts,journal) { method,_,body ->
            if(method == "GET") JSONObject().put("version",version).put("payload",remote ?: JSONObject.NULL)
            else {
                assertEquals(version,body!!.getInt("version"))
                remote = JSONObject(body.getJSONObject("payload").toString()); version++
                if(lose) {
                    lose=false; drafts.saveEditing(7,drafts.read(7)!!.put("note","Нові правки"))
                    throw java.io.IOException("Відповідь втрачено")
                }
                JSONObject().put("version",version)
            }
        }
        assertTrue(sync.run()); assertFalse(DraftSync.transferred(drafts.read(7)!!))
        assertTrue(sync.run()); assertEquals(2,version)
        assertEquals("Нові правки",remote!!.getString("note")); assertTrue(DraftSync.transferred(drafts.read(7)!!))
    }
    @Test fun remoteConflictPreservesLocalTextAndDoesNotOverwrite() {
        val (drafts,journal) = stores(); val value=local(); drafts.save(7,value)
        var patches=0
        val sync=DraftSync(drafts,journal) { method,_,_ ->
            if(method == "PATCH") patches++
            JSONObject().put("version",4).put("payload",JSONObject().put("client_key",UUID.randomUUID().toString()).put("note","Інший пристрій"))
        }
        assertTrue(sync.run()); assertEquals(0,patches)
        assertEquals("Перший текст",drafts.read(7)!!.getString("note")); assertTrue(drafts.read(7)!!.optBoolean("sync_blocked"))
    }
    @Test fun alreadySentOldAppointmentDoesNotBlockANewDraft() {
        val (drafts,journal) = stores(); drafts.save(7,local())
        journal.enqueue(JSONObject().put("client_key","old-consultation-key").put("patient_id",7).put("appointment_id",11),"Тест")
        journal.mark("old-consultation-key","sent",serverId=1)
        var patches=0
        val sync=DraftSync(drafts,journal) { method,_,_ ->
            if(method == "GET") JSONObject().put("version",0).put("payload",JSONObject.NULL)
            else { patches++; JSONObject().put("version",1) }
        }
        assertTrue(sync.run()); assertEquals(1,patches); assertTrue(DraftSync.transferred(drafts.read(7)!!))
    }
    @Test fun queuedConsultationPreventsLateDraftUploads() {
        val (drafts,journal) = stores(); drafts.save(7,local())
        journal.enqueue(JSONObject().put("client_key","finished-consultation").put("patient_id",7).put("appointment_id",12),"Тест")
        var requests=0
        assertTrue(DraftSync(drafts,journal) { _,_,_ -> requests++; JSONObject() }.run())
        assertEquals(0,requests)
    }
}
