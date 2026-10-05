package ru.wrcommunity.android.ui

import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable fun AccountCommunityApp(guest:GuestViewModel,account:AccountViewModel,api:CommunityApi) {
    val state by account.state.collectAsStateWithLifecycle()
    var profile by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(state.boundary){guest.resetForAccountChange(state.boundary)}
    BackHandler(profile){profile=false}
    val activity=LocalActivity.current
    DisposableEffect(profile){
        if(profile)activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose{activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)}
    }
    Scaffold(bottomBar={NavigationBar {
        NavigationBarItem(selected=!profile,onClick={profile=false;account.clearCodes()},icon={Icon(Icons.Default.Groups,null)},label={Text("Клубы")})
        NavigationBarItem(selected=profile,onClick={profile=true;account.refresh()},icon={Icon(Icons.Default.PersonOutline,null)},label={Text("Профиль")})
    }}){padding->Box(Modifier.fillMaxSize().padding(padding)){
        if(profile)AccountScreen(state,account) else CommunityApp(guest,api,state.user?.handle)
    }}
}

@Composable internal fun AccountScreen(state:AccountState,model:AccountViewModel) {
    val keyboard=LocalSoftwareKeyboardController.current
    LaunchedEffect(state.notice){if(state.notice!=null)keyboard?.hide()}
    LazyColumn(Modifier.fillMaxSize().imePadding().testTag("account-list"),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        item{Text(if(state.user==null)"Твой аккаунт" else "Профиль",style=MaterialTheme.typography.headlineLarge)}
        if(!state.ready)item{CircularProgressIndicator()}
        state.error?.let{item{MessageCard(it)}}
        state.notice?.let{item{MessageCard(it)}}
        if(state.user==null && state.ready)item{SignInForm(state,model)}
        state.user?.let{user->
            item{Text("@${user.handle}",color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.titleLarge)}
            item{ProfileForm(user,state.busy,model)}
            item{SecurityForm(state,model)}
        }
    }
}
@Composable private fun MessageCard(text:String){Surface(shape=RoundedCornerShape(16.dp),color=MaterialTheme.colorScheme.surfaceVariant){
    Text(text,Modifier.fillMaxWidth().padding(16.dp).semantics{liveRegion=LiveRegionMode.Polite})
}}
@Composable private fun Input(value:String,change:(String)->Unit,label:String,max:Int,busy:Boolean,secret:Boolean=false,multiline:Boolean=false) {
    OutlinedTextField(value,{change(it.take(max))},label={Text(label)},enabled=!busy,modifier=Modifier.fillMaxWidth(),
        singleLine=!multiline,minLines=if(multiline)3 else 1,
        keyboardOptions=KeyboardOptions(keyboardType=if(secret)KeyboardType.Password else KeyboardType.Text),
        visualTransformation=if(secret)PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        shape=RoundedCornerShape(16.dp))
}
@Composable private fun SignInForm(state:AccountState,model:AccountViewModel) {
    var mode by rememberSaveable{mutableStateOf("login")}
    var handle by rememberSaveable{mutableStateOf("")}
    var name by rememberSaveable{mutableStateOf("")}
    var password by remember{mutableStateOf("")}
    var confirmation by remember{mutableStateOf("")}
    var code by remember{mutableStateOf("")}
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text("Один аккаунт для приложения и сайта. Клубы можно читать без входа.",color=MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            FilterChip(mode=="login",{if(!state.busy){mode="login";password="";confirmation="";code=""}},label={Text("Вход")})
            FilterChip(mode=="register",{if(!state.busy){mode="register";password="";confirmation="";code=""}},label={Text("Регистрация")})
        }
        AnimatedContent(mode,label="Форма аккаунта"){current->Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
            if(current=="recover")Text("Восстановление по резервному коду",style=MaterialTheme.typography.titleLarge)
            Input(handle,{handle=it},"Логин",24,state.busy)
            if(current=="register")Input(name,{name=it},"Имя",40,state.busy)
            if(current=="recover")Input(code,{code=it},"Резервный код",100,state.busy,true)
            Input(password,{password=it},if(current=="recover")"Новый пароль" else "Пароль",128,state.busy,true)
            if(current!="login")Input(confirmation,{confirmation=it},"Повтори пароль",128,state.busy,true)
            Text("Логин: 3–24 символа, латиница, цифры и _. Пароль: 12–128 символов.",style=MaterialTheme.typography.bodySmall)
            Button(onClick={if(current=="recover")model.recover(handle,code,password) else model.signIn(handle,password,if(current=="register")name else null)},
                enabled=!state.busy && Regex("[a-zA-Z0-9_]{3,24}").matches(handle.trim()) && password.length in 12..128 &&
                    (current=="login" || password==confirmation) && (current!="register" || name.isNotBlank()) && (current!="recover" || code.isNotBlank()),
                modifier=Modifier.fillMaxWidth()) {Text(if(state.busy)"Подожди…" else when(current){"register"->"Создать аккаунт";"recover"->"Восстановить аккаунт";else->"Войти"})}
        }}
        TextButton(onClick={if(!state.busy){mode=if(mode=="recover")"login" else "recover";password="";confirmation="";code=""}},enabled=!state.busy){Text(if(mode=="recover")"Вернуться ко входу" else "Забыл пароль")}
    }
}
@Composable private fun ProfileForm(user:Account,busy:Boolean,model:AccountViewModel) {
    var name by remember(user.id,user.name){mutableStateOf(user.name)}
    var bio by remember(user.id,user.bio){mutableStateOf(user.bio)}
    var visible by remember(user.id,user.visible){mutableStateOf(user.visible)}
    var riot by remember(user.id,user.game["riotId"]){mutableStateOf(user.game["riotId"] ?: "")}
    var region by remember(user.id,user.game["region"]){mutableStateOf(user.game["region"] ?: "")}
    var language by remember(user.id,user.game["language"]){mutableStateOf(user.game["language"] ?: "")}
    var rank by remember(user.id,user.game["rank"]){mutableStateOf(user.game["rank"] ?: "")}
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        Input(name,{name=it},"Имя",40,busy);Input(bio,{bio=it},"О себе",300,busy,multiline=true)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("Профиль виден другим",Modifier.weight(1f));Switch(visible,{visible=it},enabled=!busy,modifier=Modifier.semantics{contentDescription="Профиль виден другим"})}
        Input(riot,{riot=it},"Riot ID",64,busy);Input(region,{region=it},"Регион",40,busy)
        Input(language,{language=it},"Язык",40,busy);Input(rank,{rank=it},"Ранг",40,busy)
        Text("Игровые данные заполняются вручную. Ранг не проверен Riot.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick={model.update(name,bio,visible,mapOf("riotId" to riot,"region" to region,"language" to language,"rank" to rank))},enabled=!busy&&name.isNotBlank(),modifier=Modifier.fillMaxWidth()){Text(if(busy)"Подожди…" else "Сохранить профиль")}
    }
}
@Composable private fun SecurityForm(state:AccountState,model:AccountViewModel) {
    var section by rememberSaveable{mutableStateOf("")}
    var password by remember{mutableStateOf("")}
    var newPassword by remember{mutableStateOf("")}
    var confirmPassword by remember{mutableStateOf("")}
    var confirm by remember{mutableStateOf<String?>(null)}
    LaunchedEffect(state.notice){if(state.notice?.startsWith("Пароль изменён")==true){password="";newPassword="";confirmPassword=""}}
    DisposableEffect(Unit){onDispose{model.clearCodes()}}
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
        HorizontalDivider();Text("Безопасность",style=MaterialTheme.typography.titleLarge)
        OutlinedButton(onClick={section=if(section=="password")"" else "password";password="";newPassword="";confirmPassword="";model.clearCodes()},enabled=!state.busy,modifier=Modifier.fillMaxWidth()){Text("Изменить пароль")}
        if(section=="password"){
            Input(password,{password=it},"Текущий пароль",128,state.busy,true)
            Input(newPassword,{newPassword=it},"Новый пароль",128,state.busy,true)
            Input(confirmPassword,{confirmPassword=it},"Повтори новый пароль",128,state.busy,true)
            Text("Другие сеансы и старые резервные коды будут отозваны.",style=MaterialTheme.typography.bodySmall)
            Button(onClick={model.changePassword(password,newPassword)},enabled=!state.busy&&password.length in 12..128&&newPassword.length in 12..128&&newPassword==confirmPassword&&newPassword!=password){Text("Изменить пароль и завершить другие сеансы")}
        }
        OutlinedButton(onClick={section=if(section=="codes")"" else "codes";password="";newPassword="";confirmPassword="";model.clearCodes()},enabled=!state.busy,modifier=Modifier.fillMaxWidth()){Text("Резервные коды")}
        if(section=="codes") {
            Text("Коды нужны для восстановления аккаунта. Новые заменят прежние. Они показываются только сейчас и не сохраняются приложением.")
            Input(password,{password=it},"Пароль для создания кодов",128,state.busy,true)
            Button(onClick={confirm="codes"},enabled=!state.busy&&password.length in 12..128){Text("Создать новые коды")}
            state.codes.forEach{Text(it,style=MaterialTheme.typography.titleMedium)}
            if(state.codes.isNotEmpty())TextButton(onClick={model.clearCodes();password=""}){Text("Я сохранил коды — скрыть")}
        }
        OutlinedButton(onClick={section="sessions";password="";model.clearCodes();model.devices()},enabled=!state.busy,modifier=Modifier.fillMaxWidth()){Text("Мои сеансы")}
        if(section=="sessions"){
            Text("Показаны до 100 сеансов. При необходимости можно завершить все.",style=MaterialTheme.typography.bodySmall)
            state.devices.forEach{device->Surface(shape=RoundedCornerShape(16.dp),color=MaterialTheme.colorScheme.surfaceVariant){Column(Modifier.padding(16.dp)){
                Text(if(device.current)"Этот телефон" else "Другой сеанс",style=MaterialTheme.typography.titleMedium)
                Text("Действует до "+DateTimeFormatter.ofPattern("dd.MM.yyyy").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(device.expiresAt)))
                TextButton(onClick={confirm=device.id},enabled=!state.busy){Text("Завершить сеанс")}
            }}}
        }
        OutlinedButton(onClick={confirm="all"},enabled=!state.busy,modifier=Modifier.fillMaxWidth()){Text("Выйти на всех устройствах")}
        Button(onClick={model.logout()},enabled=!state.busy,modifier=Modifier.fillMaxWidth()){Text("Выйти")}
        if(state.error!=null)TextButton(onClick={confirm="local"},enabled=!state.busy){Text("Удалить вход только с телефона")}
        TextButton(onClick=model::refresh,enabled=!state.busy){Text("Обновить профиль")}
    }
    confirm?.let{action->AlertDialog(onDismissRequest={confirm=null},title={Text("Подтверди действие")},
        text={Text(when(action){"all"->"Завершить все сеансы, включая этот телефон?";"local"->"Удалить вход с телефона? Сеанс на сервере останется активным.";"codes"->"Создать новые коды? Прежние перестанут действовать.";else->"Завершить выбранный сеанс?"})},
        confirmButton={TextButton(onClick={confirm=null;when(action){"all"->model.logout(true);"local"->model.forget();"codes"->model.codes(password);else->model.revoke(action)}}){Text("Подтвердить")}},
        dismissButton={TextButton(onClick={confirm=null}){Text("Отмена")}})}
}
