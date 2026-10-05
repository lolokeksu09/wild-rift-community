package ru.wrcommunity.android.features

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import ru.wrcommunity.android.data.*
import java.io.IOException

data class AccountState(val ready:Boolean=false,val busy:Boolean=false,val user:Account?=null,
    val error:String?=null,val notice:String?=null,val boundary:Long=0,val devices:List<DeviceSession> = emptyList(),
    val codes:List<String> = emptyList())

class AccountViewModel(private val repo:Accounts):ViewModel() {
    private val mutable=MutableStateFlow(AccountState())
    val state=mutable.asStateFlow()
    private var csrf:String?=null
    private var job:Job?=null
    init{refresh()}
    private fun identity(value:Identity) {
        val previous=mutable.value.user?.id
        csrf=value.csrf
        mutable.value=mutable.value.copy(user=value.user,ready=true,
            boundary=mutable.value.boundary+if(previous!=value.user?.id)1 else 0,
            devices=if(previous==value.user?.id)mutable.value.devices else emptyList(),codes=emptyList())
    }
    private fun operation(action:suspend ()->Unit) {
        if(mutable.value.busy)return
        mutable.value=mutable.value.copy(busy=true,error=null,notice=null)
        job=viewModelScope.launch {
            try{action()}catch(e:CancellationException){throw e}catch(e:Exception){
                if(e is ApiException && e.status in listOf(401,403) && mutable.value.user!=null) {
                    if(e.status==401)identity(Identity(null,null))
                    try{identity(repo.restore())}catch(refreshError:Exception){if(refreshError is CancellationException)throw refreshError}
                }
                mutable.value=mutable.value.copy(error=when(e){
                    is ApiException -> when(e.status){
                        400,401,403,409,422,429 -> e.message?.take(200) ?: "Действие недоступно."
                        else -> "Не удалось выполнить действие. Повтори позже."
                    }
                    is javax.net.ssl.SSLException -> "Не удалось подтвердить защищённое соединение."
                    is IOException -> "Нет связи с сервером. Действие могло выполниться — обнови профиль перед повтором."
                    else -> "Не удалось выполнить действие. Попробуй позже."
                })
            }finally{mutable.value=mutable.value.copy(busy=false,ready=true)}
        }
    }
    fun refresh()=operation{identity(repo.restore())}
    fun signIn(handle:String,password:String,name:String?=null)=operation {
        require(Regex("[a-zA-Z0-9_]{3,24}").matches(handle.trim()))
        require(password.length in 12..128)
        if(name!=null)require(name.trim().length in 1..40)
        identity(repo.signIn(handle.trim(),password,name?.trim()))
        mutable.value=mutable.value.copy(notice="Ты вошёл в аккаунт.")
    }
    fun update(name:String,bio:String,visible:Boolean,game:Map<String,String>)=operation {
        require(name.trim().length in 1..40 && bio.trim().length<=300)
        val updated=repo.update(name.trim(),bio.trim(),visible,game,requireNotNull(csrf))
        mutable.value=mutable.value.copy(user=updated,notice="Профиль сохранён.")
    }
    fun logout(all:Boolean=false)=operation {
        repo.logout(requireNotNull(csrf),all);identity(Identity(null,null))
        mutable.value=mutable.value.copy(notice=if(all)"Все сеансы завершены." else "Ты вышел из аккаунта.")
    }
    fun forget()=operation {
        repo.forget();identity(Identity(null,null))
        mutable.value=mutable.value.copy(notice="Вход удалён с телефона. Сеанс на сервере не отозван; его можно завершить с другого устройства.")
    }
    fun recover(handle:String,code:String,password:String)=operation {
        repo.recover(handle.trim(),code.trim(),password)
        mutable.value=mutable.value.copy(notice="Пароль изменён. Войди с новым паролем.")
    }
    fun changePassword(old:String,new:String)=operation {
        identity(repo.password(old,new,requireNotNull(csrf)))
        mutable.value=mutable.value.copy(boundary=mutable.value.boundary+1,devices=emptyList(),notice="Пароль изменён. Другие сеансы и старые резервные коды отозваны.")
    }
    fun codes(password:String)=operation {
        mutable.value=mutable.value.copy(codes=repo.codes(password,requireNotNull(csrf)),notice="Сохрани новые коды вне приложения. Старые коды больше не действуют.")
    }
    fun clearCodes(){mutable.value=mutable.value.copy(codes=emptyList())}
    fun devices()=operation{mutable.value=mutable.value.copy(devices=repo.sessions())}
    fun revoke(id:String)=operation {
        if(repo.revoke(id,requireNotNull(csrf))){repo.forget();identity(Identity(null,null))}
        else mutable.value=mutable.value.copy(devices=repo.sessions(),notice="Сеанс завершён.")
    }
}
