package ru.wrcommunity.android.features

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.wrcommunity.android.data.*
import java.io.IOException

data class FeatureState(val data:JSONObject?=null,val busy:Boolean=false,val error:String?=null,
    val notice:String?=null,val revision:Long=0)

open class FeatureViewModel(protected val client:FeatureClient):ViewModel() {
    protected val mutable=MutableStateFlow(FeatureState())
    val state=mutable.asStateFlow()
    private var job:Job?=null
    private var generation=0L
    private var mutation=false
    private var pendingLoad:Pair<String,Map<String,String>>?=null
    private var loadedRoute:Pair<String,Map<String,String>>?=null
    val userId:String? get()=client.userId
    val mediaClient:FeatureClient get()=client
    open fun reset(){generation++;job?.cancel();job=null;mutation=false;pendingLoad=null;loadedRoute=null;mutable.value=FeatureState()}
    fun clearNotice(){mutable.value=mutable.value.copy(notice=null,error=null)}
    fun load(path:String,query:Map<String,String> = emptyMap()) {
        val requested=path to query.toMap()
        if(mutation){pendingLoad=requested;if(loadedRoute!=requested)mutable.value=mutable.value.copy(data=null);return}
        val changed=loadedRoute!=requested;loadedRoute=requested
        job?.cancel();val key=++generation
        mutable.value=mutable.value.copy(busy=true,error=null,data=if(changed)null else mutable.value.data)
        job=viewModelScope.launch {
            try{val data=client.get(path,query);if(key==generation)mutable.value=FeatureState(data,revision=mutable.value.revision+1)}
            catch(e:CancellationException){throw e}
            catch(e:Exception){if(key==generation)mutable.value=mutable.value.copy(busy=false,
                data=if(e is ApiException && e.status in listOf(401,403,404))null else mutable.value.data,error=message(e,false))}
        }
    }
    fun act(path:String,method:String="POST",body:JSONObject=JSONObject(),refreshPath:String?=null,
            onSuccess:(JSONObject)->Unit={}) {
        if(mutable.value.busy)return
        job?.cancel();val key=++generation;mutation=true
        mutable.value=mutable.value.copy(busy=true,error=null,notice=null)
        job=viewModelScope.launch {
            try {
                val result=client.call(path,method,body)
                if(key==generation){mutation=false;mutable.value=mutable.value.copy(busy=false,notice="Готово.")
                    val next=pendingLoad;pendingLoad=null
                    if(next!=null)load(next.first,next.second)else{onSuccess(result);if(refreshPath!=null)load(refreshPath)}}
            } catch(e:CancellationException){throw e}
            catch(e:Exception){if(key==generation){mutation=false;mutable.value=mutable.value.copy(busy=false,data=if(e is ApiException && e.status in listOf(401,403,404))null else mutable.value.data,error=message(e,true))
                val next=pendingLoad;pendingLoad=null;if(next!=null)load(next.first,next.second)}}
        }
    }
    protected fun message(e:Exception,write:Boolean)=when(e){
        is ApiException -> e.message?.take(300) ?: "Действие недоступно."
        is javax.net.ssl.SSLException -> "Не удалось подтвердить защищённое соединение."
        is IOException -> if(write)"Нет связи. Действие могло выполниться — обнови данные перед повтором. Текст сохранён." else "Нет связи с сервером. Попробуй обновить позже."
        else -> "Не удалось выполнить действие. Проверь введённые данные."
    }
}
