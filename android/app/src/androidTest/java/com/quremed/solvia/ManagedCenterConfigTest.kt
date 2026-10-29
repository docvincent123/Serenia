package com.quremed.solvia

import org.junit.Assert.*
import org.junit.Test

class ManagedCenterConfigTest {
    private val id = "a".repeat(64)

    @Test fun httpsCenterIsNormalizedAndBoundToServerIdentity() {
        val profile = ManagedCenterConfig.validate("https://CENTER.example.org/", id)
        assertEquals("https://center.example.org:443", profile.httpsUrl)
        assertEquals(id, profile.serverId)
        assertEquals("https://center.example.org:8443",
            ManagedCenterConfig.validate("https://center.example.org:8443", id).httpsUrl)
    }

    @Test fun unmanagedAndInsecureUrlsAreNotAccepted() {
        val invalid = listOf(
            "http://center.example.org",
            "https://center.example.org/api/login",
            "https://user:pass@center.example.org",
            "https://center.example.org?x=1",
            "https://center.example.org#test",
            "https://center.example.org:99999"
        )
        for (url in invalid) {
            try {
                ManagedCenterConfig.validate(url, id)
                fail("Accepted unsafe center URI: $url")
            } catch (_: Exception) { }
        }
    }

    @Test fun missingOrInvalidServerIdentityIsRejected() {
        for (value in listOf("", "1234", "A".repeat(64), "z".repeat(64))) {
            try {
                ManagedCenterConfig.validate("https://center.example.org", value)
                fail("Accepted invalid identity")
            } catch (_: IllegalArgumentException) { }
        }
    }
}
