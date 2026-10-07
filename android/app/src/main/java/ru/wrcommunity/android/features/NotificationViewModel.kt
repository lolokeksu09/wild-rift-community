package ru.wrcommunity.android.features

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import org.json.JSONObject
import ru.wrcommunity.android.data.ApiException
import ru.wrcommunity.android.data.FeatureClient

data class NotificationCounts(val messages:Int=0,val requests:Int=0,val other:Int=0) {
    val direct:Int get()=messages+requests
    val total:Int get()=direct+other
    companion object {
        fun parse(raw:JSONObject,owner:String):NotificationCounts {
            if(raw.optString("viewerId")!=owner)throw ApiException(403,"Сеанс изменился.")
            val keys=listOf("direct","reports","discussions","lfg","events")
            keys.forEach{key->if(raw.optJSONObject(key)?.optString("viewerId")!=owner)throw ApiException(403,"Сеанс изменился.")}
            fun count(key:String,field:String="unread")=raw.getJSONObject(key).optInt(field).coerceIn(0,100000)
            return NotificationCounts(count("direct"),count("direct","requests"),keys.drop(1).sumOf{count(it)})
        }
    }
}

/** Only a resumed application polls; account changes cancel its lifecycle coroutine. */
class NotificationViewModel(private val client:FeatureClient):ViewModel() {
    private val mutable=MutableStateFlow(NotificationCounts())
    val counts=mutable.asStateFlow()
    fun reset(){mutable.value=NotificationCounts()}
    suspend fun poll() {
        val owner=client.userId?:return
        val boundary=client.identityKey
        var wait=15000L
        while(currentCoroutineContext().isActive&&owner==client.userId&&boundary==client.identityKey) {
            try {
                val fresh=NotificationCounts.parse(client.get("api/notifications/summary"),owner)
                if(owner==client.userId&&boundary==client.identityKey)mutable.value=fresh
                wait=15000L
            }catch(e:CancellationException){throw e}catch(e:Exception) {
                if(e is ApiException&&e.status in listOf(401,403,404)){reset();return}
                wait=(wait*2).coerceAtMost(60000L)
            }
            delay(wait)
        }
    }
}
