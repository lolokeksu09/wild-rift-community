package ru.wrcommunity.android.features

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.wrcommunity.android.data.*

class DiscoveryViewModel(client:FeatureClient):FeatureViewModel(client) {
    private val repo=DiscoveryRepository(client)
    private var fetch:Job?=null
    private var serial=0L
    var currentRoute="discovery/home";private set
    var filters:Map<String,String> = emptyMap();private set
    var category="discussions";private set
    private val routeFilters=mutableMapOf<String,Map<String,String>>()
    val createSubmission=DiscoverySubmission()
    val messageSubmission=DiscoverySubmission()
    private val fields=MutableStateFlow<Map<String,String>>(emptyMap())
    val drafts=fields.asStateFlow()
    private var accountKey=client.identityKey
    fun setDraft(key:String,value:String){fields.value=fields.value+(key to value)}
    fun open(route:String,query:Map<String,String>?=null,selectedCategory:String=category,quiet:Boolean=false) {
        if(accountKey!=client.identityKey){fields.value=emptyMap();createSubmission.clear();messageSubmission.clear();accountKey=client.identityKey}
        if(mutable.value.busy && route==currentRoute)return
        if(route!=currentRoute){super.reset();mutable.value=FeatureState();messageSubmission.clear()}
        val selected=query ?: routeFilters[route] ?: emptyMap()
        routeFilters[route]=selected
        if(selectedCategory!=category||selected!=filters)mutable.value=FeatureState()
        currentRoute=route;filters=selected;category=selectedCategory
        fetch?.cancel();val ticket=++serial
        if(!quiet)mutable.value=mutable.value.copy(busy=true,error=null)
        viewModelScope.launch {
            try {
                val result=if(route=="discovery/notifications")repo.notificationPage(category)
                    else if(route.startsWith("discovery/group/")||route.startsWith("discovery/event/"))repo.detail(route)
                    else repo.page(DiscoveryContract.routePath(route),selected)
                if(ticket==serial){
                    val old=mutable.value.data
                    if(quiet && old?.has("chat")==true && result.has("chat")) {
                        val previous=old.getJSONObject("chat");val latest=result.getJSONObject("chat")
                        if(previous.optLong("blockVersion")==latest.optLong("blockVersion")){
                            val combined=DiscoveryContract.merge(previous,latest,"messages")
                            combined.put("next",previous.opt("next")?:JSONObject.NULL)
                            result.put("chat",combined)
                        }
                    }
                    mutable.value=FeatureState(result,revision=mutable.value.revision+1)
                }
            } catch(e:CancellationException){throw e}
            catch(e:Exception){if(ticket==serial)mutable.value=mutable.value.copy(busy=false,
                data=if(e is ApiException && e.status in listOf(401,403,404))null else mutable.value.data,error=message(e,false))}
        }.also{fetch=it}
    }
    fun refresh(quiet:Boolean=false)=open(currentRoute,filters,category,quiet)
    fun more(key:String,cursor:String,path:String?=null,cursorName:String="before") {
        if(mutable.value.busy)return
        val old=mutable.value.data?:return
        val ticket=++serial;fetch?.cancel();mutable.value=mutable.value.copy(busy=true,error=null)
        fetch=viewModelScope.launch {
            try {
                val p=repo.page(path?:if(currentRoute=="discovery/notifications")DiscoveryRepository.notificationPath(category) else DiscoveryContract.routePath(currentRoute),filters+(cursorName to cursor))
                if(ticket==serial){
                    if(path!=null){val result=JSONObject(old.toString());result.put("chat",DiscoveryContract.merge(old.getJSONObject("chat"),p,key));mutable.value=FeatureState(result,revision=mutable.value.revision+1)}
                    else {val merged=DiscoveryContract.merge(old,p,key);if(old.has("summary"))merged.put("summary",old.getJSONObject("summary"));mutable.value=FeatureState(merged,revision=mutable.value.revision+1)}
                }
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(ticket==serial)mutable.value=mutable.value.copy(busy=false,data=if(e is ApiException&&e.status in listOf(401,403,404))null else old,error=message(e,false))}
        }
    }
    fun action(action:String,body:JSONObject=JSONObject()) {
        fetch?.cancel();serial++
        act(DiscoveryContract.routePath(currentRoute)+"/"+action,body=body,onSuccess={refresh()})
    }
    fun create(body:JSONObject,onCreated:(String)->Unit) {
        fetch?.cancel();serial++
        val event=currentRoute=="discovery/events"
        act(if(event)"api/events" else "api/lfg",body=createSubmission.body(body),onSuccess={
            createSubmission.clear();fields.value=fields.value.filterKeys{!it.startsWith("create.")}
            onCreated("discovery/"+(if(event)"event/" else "group/")+it.get("id"))
        })
    }
    fun send(text:String) {
        fetch?.cancel();serial++
        act(DiscoveryContract.routePath(currentRoute)+"/messages",body=messageSubmission.body(JSONObject().put("body",text)),onSuccess={
            messageSubmission.clear();setDraft("message.$currentRoute","");refresh()
        })
    }
    fun read(id:String,appeal:Boolean=false) {
        fetch?.cancel();serial++
        val path=DiscoveryRepository.notificationPath(category)
        act(path+"/$id/"+(if(appeal)"appeal/read" else "read"),onSuccess={refresh()})
    }
    fun formError(text:String){mutable.value=mutable.value.copy(error=text)}
    fun dispose(){serial++;fetch?.cancel()}
    override fun reset(){dispose();super.reset();fields.value=emptyMap();routeFilters.clear();filters=emptyMap();createSubmission.clear();messageSubmission.clear();accountKey=client.identityKey}
    fun clearPrivate()=reset()
}
