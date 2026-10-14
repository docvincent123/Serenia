package com.quremed.solvia

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MobileUpdatesTest {
    private val c get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun onlyNewerVersionsForTheSamePackageAreOffered() {
        val info=JSONObject().put("available",true).put("package_name",c.packageName).put("version_code",33)
        assertTrue(MobileUpdates.available(info,c.packageName,32))
        assertFalse(MobileUpdates.available(info,c.packageName,33))
        assertFalse(MobileUpdates.available(info,"com.other.app",32))
        assertFalse(MobileUpdates.available(JSONObject(),c.packageName,32))
    }
    @Test fun apkProviderIsPrivateAndBlocksOtherFiles() {
        val uri=android.net.Uri.parse("content://${c.packageName}.updates/../../secret")
        val provider=c.packageManager.resolveContentProvider("${c.packageName}.updates",0)!!
        assertFalse(provider.exported); assertTrue(provider.grantUriPermissions)
        try { c.contentResolver.openFileDescriptor(uri,"r"); fail("Provider must reject other files") } catch(_:java.io.FileNotFoundException) { }
    }
    @Test fun signedUpgradeKeepsExistingPreferences() {
        val prefs=c.getSharedPreferences("solvia_update_probe",0)
        @Suppress("DEPRECATION") val version=c.packageManager.getPackageInfo(c.packageName,0).versionCode
        if(version==34) assertTrue(prefs.edit().putString("connection","preserved-server").commit())
        else { assertEquals(39,version); assertEquals("preserved-server",prefs.getString("connection","")) }
    }
}
