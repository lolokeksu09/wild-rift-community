package ru.wrcommunity.android

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.wrcommunity.android.data.ApiException
import ru.wrcommunity.android.features.NotificationCounts

class NotificationCountsTest {
    private fun summary()=JSONObject().put("viewerId","self").apply {
        listOf("direct","reports","discussions","lfg","events").forEach{put(it,JSONObject().put("viewerId","self").put("unread",2))}
        getJSONObject("direct").put("requests",3)
    }
    @Test fun badgesIncludeRequestsAndEveryNotificationCategory(){
        val counts=NotificationCounts.parse(summary(),"self")
        assertEquals(5,counts.direct);assertEquals(8,counts.other);assertEquals(13,counts.total)
    }
    @Test fun privateChildSummaryCannotCrossAccountBoundary(){
        val raw=summary();raw.getJSONObject("events").put("viewerId","other")
        try{NotificationCounts.parse(raw,"self");fail("Foreign summary accepted")}catch(e:ApiException){assertEquals(403,e.status)}
    }
    @Test fun invalidNegativeCountsNeverBecomeBadges(){
        val raw=summary();raw.getJSONObject("direct").put("unread",-3).put("requests",-1)
        assertEquals(0,NotificationCounts.parse(raw,"self").direct)
    }
}
