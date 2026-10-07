package ru.wrcommunity.android.features

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import ru.wrcommunity.android.data.*

data class MessagingState(val route:String="",val busy:Boolean=false,val error:String?=null,val notice:String?=null,val conversations:List<Conversation> = emptyList(),val next:String?=null,val unread:Int=0,val requests:Int=0,val budget:ContactBudget?=null,val messages:List<ChatMessage> = emptyList(),val pending:List<PendingMessage> = emptyList(),val draft:String="",val handle:String="",val older:Boolean=false,val blocks:List<Pair<String,String>> = emptyList(),val dmRequests:Boolean=true,val denied:Boolean=false,val accessValidated:Boolean=false)
class MessagingViewModel(client:FeatureClient,private val store:MessageStore=MemoryMessageStore(),private val storageDispatcher:CoroutineDispatcher=Dispatchers.IO):FeatureViewModel(client) {
    private val repository=MessagingRepository(client)
    private val flow=MutableStateFlow(MessagingState())
    val chatState=flow.asStateFlow()
    val identityKey get()=client.identityKey
    private var identity=client.identityKey
    private var generation=0L
    private var polling:Job?=null
    private var loading:Job?=null
    private var action:Job?=null
    private var cursor=0L
    private var blockVersion:Long?=null
    private var pollDelay=5000L
    private val handles=mutableMapOf<String,String>()
    private val drafts=mutableMapOf<String,String>()
    private val queues=mutableMapOf<String,List<PendingMessage>>()
    private var request:PendingMessage?=null
    private var signature=""
    private var active=false
    private var owner:String?=null
    private val storageMutex=Mutex()
    private val restored=mutableSetOf<String>()
    private val requests=mutableMapOf<String,Pair<PendingMessage?,String>>()
    private fun roomSnapshot(route:String)=StoredMessageRoom(drafts[route].orEmpty(),handles[route].orEmpty(),queues[route].orEmpty(),requests[route]?.first,requests[route]?.second.orEmpty())
    private suspend fun persistRoom(route:String,account:String,snapshot:StoredMessageRoom)=storageMutex.withLock{withContext(storageDispatcher){store.write(account,route,snapshot)}}
    private fun saveRoom(){
        val route=flow.value.route;val account=owner?:return
        if(route !in restored)return
        val snapshot=roomSnapshot(route);val key=generation
        viewModelScope.launch(start=CoroutineStart.UNDISPATCHED){
            try{persistRoom(route,account,snapshot)}
            catch(e:CancellationException){throw e}
            catch(_:Exception){if(key==generation)update{it.copy(error="Не удалось сохранить черновик на устройстве. Не закрывай приложение до восстановления хранения.")}}
        }
    }
    private suspend fun restoreRoom(route:String,key:Long){
        val account=owner?:return
        if(route !in restored){
            val stored=storageMutex.withLock{withContext(storageDispatcher){store.read(account)[route]}}
            if(key!=generation||account!=owner)return
            stored?.let{drafts[route]=it.draft;handles[route]=it.handle;queues[route]=it.pending.map{p->p.copy(busy=false)};requests[route]=it.request to it.signature}
        }
        restored.add(route)
        request=requests[route]?.first;signature=requests[route]?.second.orEmpty()
        update{it.copy(draft=drafts[route].orEmpty(),handle=handles[route].orEmpty(),pending=queues[route].orEmpty(),accessValidated=true)}
    }
    private fun clearStorage(clear:()->Unit){
        val key=generation
        viewModelScope.launch(start=CoroutineStart.UNDISPATCHED){
            try{storageMutex.withLock{withContext(storageDispatcher){clear()}}}
            catch(e:CancellationException){throw e}
            catch(_:Exception){if(key==generation)update{it.copy(error="Не удалось очистить сохранённые сообщения на устройстве.")}}
        }
    }
    fun clearStoredMessages(){clearStorage(store::clearAll)}

    private fun update(f:(MessagingState)->MessagingState){flow.value=f(flow.value)}
    fun open(route:String){
        if(identity!=identityKey)reset()
        if(flow.value.route==route)return
        stop();action?.cancel();generation++;cursor=0;blockVersion=null
        owner=userId
        request=null;signature=""
        // A route is unlocked only by its new successful server response, including cached queues.
        flow.value=MessagingState(route=route)
    }
    override fun reset(){
        val previous=owner
        super.reset();stop();action?.cancel();generation++
        drafts.clear();handles.clear();queues.clear();requests.clear();restored.clear();request=null;signature="";cursor=0;blockVersion=null
        flow.value=MessagingState();identity=identityKey;owner=null
        // Initial guest bootstrap has no owner. It must not erase a session's disk queue.
        if(previous!=null)clearStorage{store.clear(previous)}
    }
    fun start(){if(active)return;active=true;refresh();schedulePolling()}
    private fun schedulePolling(){
        polling?.cancel()
        if(!active)return
        polling=viewModelScope.launch {
            while(isActive){
                delay(if(isRoom())2000 else pollDelay)
                if(loading?.isActive!=true&&!flow.value.denied){
                    if(isRoom())fetchMessages(cursor==0L) else if(flow.value.route=="chat/inbox")summary()
                }
            }
        }
    }
    fun stop(){active=false;polling?.cancel();loading?.cancel();polling=null;loading=null}
    private fun isRoom()=flow.value.route.startsWith("chat/direct/")||flow.value.route.startsWith("chat/club/")
    fun draft(value:String){if(!flow.value.accessValidated)return;val v=value.take(2000);drafts[flow.value.route]=v;update{it.copy(draft=v)};saveRoom()}
    fun handle(value:String){if(!flow.value.accessValidated)return;val handle=value.take(24);handles[flow.value.route]=handle;update{it.copy(handle=handle)};saveRoom()}
    private suspend fun guard(block:suspend()->Unit){
        val key=generation
        try{block()}
        catch(e:CancellationException){throw e}
        catch(e:Exception){
            if(key!=generation)return
            val denied=e is ApiException&&e.status in listOf(401,403,404)
            var storageError:String?=null
            if(denied&&(isRoom()||(e is ApiException&&e.status==401))){
                cursor=0
                val route=flow.value.route
                val account=owner
                queues.remove(route);drafts.remove(route);handles.remove(route);requests.remove(route);restored.add(route)
                // Hide revoked content immediately; complete its disk removal before finishing the request.
                update{it.copy(messages=emptyList(),conversations=emptyList(),blocks=emptyList(),pending=emptyList(),draft="",handle="",denied=true,accessValidated=false)}
                if(account!=null)try{persistRoom(route,account,StoredMessageRoom())}
                catch(clear:CancellationException){throw clear}
                catch(_:Exception){storageError="Не удалось очистить сохранённые сообщения на устройстве."}
            }
            if(key!=generation)return
            update{it.copy(error=storageError?:message(e,false),busy=false)}
            if(e is ApiException&&e.status==429)runCatching{MessagingContract.budget(client.get("api/direct/contact-budget"))}.getOrNull()?.let{b->if(key==generation)update{it.copy(budget=b)}}
        }
    }
    fun refresh(){if(loading?.isActive==true)return;if(isRoom())polling?.cancel();val key=generation;loading=viewModelScope.launch{update{it.copy(busy=true,error=null)};guard{when{
        isRoom()->reloadHistory()
        flow.value.route=="chat/blocks"->{val raw=client.get("api/blocks");if(key==generation)update{it.copy(blocks=raw.rows("blocks").map{b->b.getString("id") to "${b.optString("name")} · @${b.optString("handle")}"})}}
        flow.value.route=="chat/privacy"->{val raw=client.get("api/me");if(key==generation)update{it.copy(dmRequests=raw.optJSONObject("user")?.optBoolean("dmRequests",true)?:true)}}
        flow.value.route.startsWith("chat/new/")->{val raw=client.get("api/profiles/${flow.value.route.substringAfterLast('/')}");val p=raw.optJSONObject("profile");val budget=MessagingContract.budget(client.get("api/direct/contact-budget"));if(key==generation){restoreRoom(flow.value.route,key);update{it.copy(handle=p?.optString("handle")?:it.handle,budget=budget)};handles[flow.value.route]=flow.value.handle;saveRoom()}}
        else->{val page=repository.inbox();if(key==generation){restoreRoom(flow.value.route,key);if(key==generation)update{it.copy(conversations=page.conversations,next=page.next,unread=page.unread,requests=page.requests,budget=page.budget)}}}
    }};if(key==generation){update{it.copy(busy=false)};schedulePolling()}}}
    private suspend fun reloadHistory(){
        val route=flow.value.route
        val key=generation
        val page=repository.history(route,flow.value.messages.minOfOrNull{it.id})
        if(key!=generation)return
        restoreRoom(route,key)
        if(key!=generation)return
        val previous=blockVersion
        if(page.blockVersion!=null&&previous!=null&&page.blockVersion<previous)return
        blockVersion=page.blockVersion
        cursor=page.messages.maxOfOrNull{it.id}?:0L
        val pending=MessagingContract.reconcile(flow.value.pending,page.messages,userId.orEmpty())
        queues[route]=pending
        update{it.copy(messages=page.messages,pending=pending,older=page.more,denied=false,error=null,accessValidated=true)};saveRoom()
    }
    private suspend fun summary(){val key=generation;try{val r=client.get("api/direct/summary");if(r.optString("viewerId")!=userId)throw ApiException(403,"Сеанс изменился.");if(key==generation){pollDelay=5000;update{it.copy(unread=r.optInt("unread"),requests=r.optInt("requests"))}}}catch(e:CancellationException){throw e}catch(e:Exception){pollDelay=(pollDelay*2).coerceAtMost(60000);guard{throw e}}}
    private suspend fun fetchMessages(initial:Boolean){val route=flow.value.route;val key=generation;guard{var first=initial;do{val page=repository.messages(route,if(first)emptyMap() else mapOf("after" to cursor.toString()));if(key!=generation)return@guard
        val old=blockVersion;val next=page.blockVersion
        if(old!=null&&next!=null&&next<old)return@guard
        if(old!=null&&next!=null&&next!=old){blockVersion=next;cursor=0;update{it.copy(messages=emptyList(),older=false)};fetchMessages(true);return@guard}
        restoreRoom(route,key);if(key!=generation)return@guard;blockVersion=next?:old;update{it.copy(denied=false,error=null,accessValidated=true)};merge(page.messages);cursor=maxOf(cursor,page.messages.maxOfOrNull{it.id}?:0)
        if(first)update{it.copy(older=page.more)};val more=!first&&page.more;first=false
    }while(more)}}
    private fun merge(messages:List<ChatMessage>){val state=flow.value;val pending=MessagingContract.reconcile(state.pending,messages,userId.orEmpty());queues[state.route]=pending;update{it.copy(messages=(it.messages+messages).distinctBy{m->m.id}.sortedBy{m->m.id},pending=pending)};saveRoom()}
    fun older(){val min=flow.value.messages.minOfOrNull{it.id}?:return;if(loading?.isActive==true)return;val key=generation;val route=flow.value.route;loading=viewModelScope.launch{update{it.copy(busy=true)};guard{val p=repository.messages(route,mapOf("before" to min.toString()));if(key==generation){if(p.blockVersion!=null&&blockVersion!=null&&p.blockVersion<blockVersion!!)return@guard;if(p.blockVersion!=null&&blockVersion!=null&&p.blockVersion!=blockVersion){cursor=0;update{it.copy(messages=emptyList())};fetchMessages(true)}else{merge(p.messages);update{it.copy(older=p.more)}}}};if(key==generation)update{it.copy(busy=false)}}}
    fun moreInbox(){val next=flow.value.next?:return;if(flow.value.busy)return;mutate{val p=repository.inbox(next);update{it.copy(conversations=(it.conversations+p.conversations).distinctBy{c->c.id},next=p.next,unread=p.unread,requests=p.requests)}}}
    private fun mutate(block:suspend()->Unit){if(flow.value.busy)return;val key=generation;update{it.copy(busy=true,error=null,notice=null)};action=viewModelScope.launch{if(key!=generation)return@launch;guard{block();if(key==generation)update{it.copy(notice=it.notice?:"Готово.")}};if(key==generation)update{it.copy(busy=false)}}}
    fun send(){val s=flow.value;if(s.draft.isBlank()||s.pending.size>=20||s.denied||!s.accessValidated)return;val p=MessagingContract.pending(s.draft);queues[s.route]=s.pending+p;update{it.copy(pending=it.pending+p)};draft("");retry(p.clientId)}
    fun retry(id:String){val p=flow.value.pending.find{it.clientId==id}?:return;if(p.busy||flow.value.denied||!flow.value.accessValidated)return;val route=flow.value.route;val key=generation;update{it.copy(pending=it.pending.map{p->if(p.clientId==id)p.copy(busy=true,error=null)else p})};viewModelScope.launch{guard{try{if(key!=generation)return@guard;val account=owner?:return@guard;persistRoom(route,account,roomSnapshot(route));if(key!=generation)return@guard;val m=repository.send(route,p);if(key==generation)merge(listOf(m))}catch(e:Exception){if(key==generation){update{it.copy(pending=it.pending.map{p->if(p.clientId==id)p.copy(busy=false,error="Отправка не подтверждена. Повтори с тем же идентификатором.")else p})};queues[route]=flow.value.pending;saveRoom()};throw e}}}}
    fun discard(id:String){update{it.copy(pending=it.pending.filterNot{p->p.clientId==id})};queues[flow.value.route]=flow.value.pending;saveRoom()}
    fun decide(id:String,accept:Boolean){mutate{client.post("api/direct/$id/decision",JSONObject().put("decision",if(accept)"accept" else "reject"));val p=repository.inbox();update{it.copy(conversations=p.conversations,next=p.next,requests=p.requests,unread=p.unread)}}}
    fun request(){val s=flow.value;if(s.busy||s.draft.isBlank()||s.handle.isBlank()||!s.accessValidated)return;val sig=s.handle.trim()+"\u0000"+s.draft.trim();if(sig!=signature){signature=sig;request=MessagingContract.pending(s.draft)};val p=request?:return;requests[s.route]=request to signature;saveRoom();mutate{val account=owner?:return@mutate;persistRoom(s.route,account,roomSnapshot(s.route));client.post("api/direct",MessagingContract.payload(p).put("handle",s.handle.trim()));if(flow.value.draft==s.draft&&flow.value.handle==s.handle)draft("");request=null;signature="";requests.remove(s.route);saveRoom();val page=repository.inbox();update{it.copy(conversations=page.conversations,next=page.next,unread=page.unread,requests=page.requests,budget=page.budget,notice="Запрос отправлен. Дополнительные сообщения доступны после принятия.")}}}
    fun privacy(enabled:Boolean){mutate{client.patch("api/me/privacy",JSONObject().put("dmRequests",enabled));update{it.copy(dmRequests=enabled)}}}
    fun block(id:String,remove:Boolean=false){mutate{client.call("api/blocks",if(remove)"DELETE" else "POST",JSONObject().put("userId",id));if(isRoom()){cursor=0;update{it.copy(messages=emptyList())};fetchMessages(true)}else if(flow.value.route=="chat/blocks"){val r=client.get("api/blocks");update{it.copy(blocks=r.rows("blocks").map{b->b.getString("id") to b.optString("name")})}}else{val p=repository.inbox();update{it.copy(conversations=p.conversations,next=p.next)}}}}
    fun markRead(){if(!flow.value.route.startsWith("chat/direct/"))return;val last=flow.value.messages.maxOfOrNull{it.id}?:return;mutate{client.post("api/direct/${flow.value.route.substringAfterLast('/')}/read",JSONObject().put("lastId",last));update{it.copy(notice="Загруженные сообщения отмечены прочитанными.")}}}
}
