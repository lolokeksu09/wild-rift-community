package ru.wrcommunity.android.features

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.wrcommunity.android.data.*
import java.util.UUID

class ContentViewModel(client:FeatureClient):FeatureViewModel(client) {
    private val repository=ContentRepository(client)
    private var contentJob:Job?=null
    private var serial=0L
    private var currentRoute="content/feed"
    private var filters:Map<String,String> = emptyMap()
    private val positions=mutableMapOf<String,Int>()
    fun position(route:String)=positions[route]?:0
    fun rememberPosition(route:String,value:Int){positions[route]=value}
    fun filter(route:String,key:String)=routeFilters[route]?.get(key).orEmpty()
    private val routeFilters=mutableMapOf<String,Map<String,String>>()
    // Scoped to this ViewModel/account and payload; same request after lost response uses same ID.
    private val attempts=mutableMapOf<String,Pair<String,String>>()
    fun attempt(key:String,payload:String):String {
        val scopedKey="${client.identityKey}:$key"
        val old=attempts[scopedKey]
        if(old?.first==payload)return old.second
        return UUID.randomUUID().toString().also{attempts[scopedKey]=payload to it}
    }
    fun open(route:String,query:Map<String,String>? = null) {
        val requested=query ?: routeFilters[route] ?: if(route.startsWith("content/search"))mapOf("q" to "Wild Rift") else emptyMap()
        val selected=if((route.startsWith("content/guides/")||route.startsWith("content/search/")))requested+mapOf("club" to route.substringAfterLast('/')) else requested
        routeFilters[route]=selected
        val retain=route==currentRoute && selected==filters
        currentRoute=route;filters=selected
        contentJob?.cancel();val token=++serial
        mutable.value=mutable.value.copy(busy=true,error=null,data=if(retain)mutable.value.data else null,notice=if(retain)mutable.value.notice else null)
        contentJob=viewModelScope.launch {
            try {val data=repository.screen(route,selected);if(token==serial)mutable.value=FeatureState(data,notice=mutable.value.notice,revision=mutable.value.revision+1)}
            catch(e:CancellationException){throw e}
            catch(e:Exception){if(token==serial)mutable.value=mutable.value.copy(busy=false,data=if(e is ApiException&&e.status in listOf(401,403,404))null else mutable.value.data,error=message(e,false))}
        }
    }
    override fun reset(){contentJob?.cancel();contentJob=null;++serial;attempts.clear();routeFilters.clear();positions.clear();filters=emptyMap();super.reset()}
    fun refresh()=open(currentRoute,filters)
    fun mutate(path:String,method:String="POST",body:JSONObject=JSONObject(),onSuccess:(JSONObject)->Unit={}) {
        if(mutable.value.busy)return
        contentJob?.cancel();val token=++serial
        mutable.value=mutable.value.copy(busy=true,error=null,notice=null)
        contentJob=viewModelScope.launch {
            try {
                val result=client.call(path,method,body)
                if(token==serial){
                    val confirmed=body.nullableString("clientId")
                    if(confirmed!=null)attempts.entries.removeAll{it.value.second==confirmed}
                    mutable.value=mutable.value.copy(busy=false,notice="Готово.");onSuccess(result);refresh()
                }
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(token==serial)mutable.value=mutable.value.copy(busy=false,error=message(e,true))}
        }
    }
    fun more(path:String,key:String,container:String?=null,cursorKey:String="before") {
        if(mutable.value.busy)return
        val original=mutable.value.data?:return
        val page=if(container==null)original else original.optJSONObject(container)?:return
        val cursor=ContentRepository.next(page)?:return
        val token=++serial;mutable.value=mutable.value.copy(busy=true,error=null)
        contentJob=viewModelScope.launch {
            try {
                val next=client.get(path,filters+mapOf(cursorKey to cursor))
                if(token==serial){val merged=ContentRepository.mergePage(page,next,key,key=="comments")
                    val data=if(container==null)merged else JSONObject(original.toString()).put(container,merged)
                    mutable.value=mutable.value.copy(data=data,busy=false,revision=mutable.value.revision+1)}
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(token==serial)mutable.value=mutable.value.copy(busy=false,data=if(e is ApiException&&e.status in listOf(401,403,404))null else original,error=message(e,false))}
        }
    }
}
