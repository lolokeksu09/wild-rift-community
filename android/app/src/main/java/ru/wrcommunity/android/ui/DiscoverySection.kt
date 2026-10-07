package ru.wrcommunity.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.DiscoveryViewModel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val roleLabels=linkedMapOf("baron" to "Барон","jungle" to "Лес","mid" to "Центр","dragon" to "Дракон","support" to "Поддержка")
private val modes=linkedMapOf("ranked" to "Ранкед","normal" to "Обычная","aram" to "ARAM","custom" to "Своя игра")
private val states=mapOf("open" to "Идёт набор","full" to "Состав собран","started" to "Игра началась","ended" to "Завершено","cancelled" to "Отменено","closed" to "Закрыто","expired" to "Срок истёк","pending" to "Заявка ожидает решения","accepted" to "Ты в составе","rejected" to "Отклонено")
private val notices=mapOf("application" to "Новая заявка","accepted" to "Ты принят в состав","rejected" to "Заявка отклонена","removed" to "Ты исключён из состава","closed" to "Группа закрыта","cancelled" to "Отмена","left" to "Игрок вышел","joined" to "Игрок занял место","reminder" to "До начала осталось не больше 30 минут","mention" to "Упоминание","reply" to "Ответ на комментарий")
private fun time(ms:Long,zone:String=ZoneId.systemDefault().id):String=try{DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm").withZone(ZoneId.of(zone)).format(Instant.ofEpochMilli(ms))}catch(_:Exception){"Время не указано"}
private fun JSONObject.words(key:String)=optJSONArray(key)?.let{a->List(a.length()){a.optString(it)}}?:emptyList()

@Composable fun DiscoverySection(model:DiscoveryViewModel,route:String,onNavigate:(String)->Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    val owner=LocalLifecycleOwner.current
    LaunchedEffect(route){model.open(route)}
    DisposableEffect(model){onDispose{model.dispose()}}
    LaunchedEffect(route,owner){while(true){delay(if(route=="discovery/notifications")5000 else 2000)
        if(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)&&!model.state.value.busy &&
            (route=="discovery/notifications"||model.state.value.data?.has("chat")==true))model.refresh(quiet=true)
    }}
    var confirm by remember(route){mutableStateOf<Pair<String,()->Unit>?>(null)}
    if(confirm!=null)AlertDialog(onDismissRequest={confirm=null},title={Text("Подтвердить действие")},text={Text(confirm!!.first)},
        confirmButton={TextButton(onClick={val action=confirm!!.second;confirm=null;action()}){Text("Подтвердить")}},dismissButton={TextButton(onClick={confirm=null}){Text("Отмена")}})
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(when {route.endsWith("home")->"Твоя главная";route.endsWith("players")->"Найти напарника";route.endsWith("members")->"Люди сообщества";route.endsWith("lfg")->"Найти команду";route.endsWith("events")->"Игровые вечера";route.endsWith("notifications")->"Уведомления";route.endsWith("saved")->"Сохранённое";route.contains("player/")->"Профиль";route.contains("group/")->"Команда";else->"Игровой вечер"},style=MaterialTheme.typography.headlineMedium)
        if(state.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        state.notice?.let{Text(it,color=MaterialTheme.colorScheme.primary)}
        TextButton(onClick={model.refresh()},enabled=!state.busy){Text("Обновить")}
        when {
            route=="discovery/home" -> Home(model,state.data,onNavigate)
            route=="discovery/players"||route=="discovery/members" -> {
                Finder(model,route=="discovery/members")
                val key=if(route.endsWith("members"))"members" else "players"
                state.data?.let{d->if(d.rows(key).isEmpty())Text("Совпадений пока нет. Измени фильтры или опубликуй свой профиль.")
                    d.rows(key).forEach{PlayerCard(it,model,onNavigate,false)}
                    Pager(d,key,model,after=true)
                }
            }
            route.startsWith("discovery/player/")->state.data?.optJSONObject("profile")?.let{PlayerCard(it,model,onNavigate,true)}
            route=="discovery/lfg"||route=="discovery/events" -> {
                val event=route.endsWith("events")
                GroupFilters(model,event)
                state.data?.let{d->val key=if(event)"events" else "groups";if(d.rows(key).isEmpty())Text("Пока нет объявлений. Можно создать своё.")
                    d.rows(key).forEach{GroupCard(it,event,onNavigate)};Pager(d,key,model)}
                Creator(model,route,onNavigate)
            }
            route.startsWith("discovery/group/")||route.startsWith("discovery/event/") -> state.data?.let{Detail(model,it,route.contains("event/"),onNavigate){text,action->confirm=text to action}}
            route=="discovery/notifications" -> Notifications(model,state.data,onNavigate)
            route=="discovery/saved" -> state.data?.let{d->if(d.rows("posts").isEmpty())Text("Нет доступных сохранённых публикаций.")
                d.rows("posts").forEach{p->Card{Column(Modifier.padding(16.dp)){Text(p.optString("title"),style=MaterialTheme.typography.titleLarge);Text(p.optString("club_name"));Text(p.optString("body").take(300));TextButton(onClick={onNavigate("content/post/${p.opt("id")}")}){Text("Читать")}}}};Pager(d,"posts",model)}
        }
    }
}

@Composable private fun Pager(data:JSONObject,key:String,model:DiscoveryViewModel,after:Boolean=false) {
    data.nullableString("next")?.let{cursor->OutlinedButton(onClick={model.more(key,cursor,cursorName=if(after)"after" else "before")},enabled=!model.state.value.busy){Text("Показать ещё")}}
}
@Composable private fun Field(label:String,key:String,model:DiscoveryViewModel,initial:String="",max:Int=1000) {
    val drafts by model.drafts.collectAsStateWithLifecycle()
    OutlinedTextField(value=drafts[key]?:initial,onValueChange={if(it.length<=max)model.setDraft(key,it)},label={Text(label)},modifier=Modifier.fillMaxWidth())
}
@Composable private fun Choice(label:String,value:String,options:Map<String,String>,onChange:(String)->Unit) {
    var expanded by remember{mutableStateOf(false)}
    Box{OutlinedButton(onClick={expanded=true},modifier=Modifier.fillMaxWidth()){Text("$label: ${options[value]?:value}")}
        DropdownMenu(expanded=expanded,onDismissRequest={expanded=false}){options.forEach{(key,title)->DropdownMenuItem(text={Text(title)},onClick={onChange(key);expanded=false})}}}
}
@Composable private fun DraftChoice(label:String,key:String,model:DiscoveryViewModel,initial:String,options:Map<String,String>) {
    val drafts by model.drafts.collectAsStateWithLifecycle();Choice(label,drafts[key]?:initial,options){model.setDraft(key,it)}
}
@Composable private fun Finder(model:DiscoveryViewModel,members:Boolean) {
    val drafts by model.drafts.collectAsStateWithLifecycle()
    Text("Только опубликованные профили. Игровые сведения указаны игроками; ранг не проверен.")
    Field("Имя или логин","filter.q",model,max=80)
    DraftChoice("Роль","filter.role",model,"",mapOf("" to "Любая")+roleLabels)
    if(!members){listOf("rank" to "Ранг","region" to "Регион","language" to "Язык").forEach{(k,l)->Field(l,"filter.$k",model,max=40)}
        DraftChoice("Микрофон","filter.microphone",model,"",mapOf("" to "Любой","yes" to "Есть","no" to "Нет"))
        Text("Ранг, регион и язык сравниваются точно без учёта регистра.")}
    Button(onClick={val keys=if(members)listOf("q","role")else listOf("q","role","rank","region","language","microphone");model.open(model.currentRoute,keys.associateWith{drafts["filter.$it"]?.trim().orEmpty()}.filterValues{it.isNotBlank()})},enabled=!model.state.value.busy){Text("Найти")}
    TextButton(onClick={listOf("q","role","rank","region","language","microphone").forEach{model.setDraft("filter.$it","")};model.open(model.currentRoute,emptyMap())}){Text("Сбросить фильтры")}
}
@Composable private fun PlayerCard(p:JSONObject,model:DiscoveryViewModel,navigate:(String)->Unit,detail:Boolean) {
    Card(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        p.nullableString("coverId")?.let{NativeMedia(it,model.mediaClient.api,"Обложка профиля",Modifier.fillMaxWidth().height(150.dp))}
        p.nullableString("avatarId")?.let{NativeMedia(it,model.mediaClient.api,"Аватар ${p.optString("name")}",Modifier.size(72.dp))}
        Text(p.optString("name")+(if(p.optBoolean("isBot"))" · Бот" else ""),style=MaterialTheme.typography.titleLarge)
        Text("@${p.optString("handle")}");Text(p.optString("bio"))
        p.optJSONObject("gameProfile")?.let{g->
            Text("${g.optString("rank").ifBlank{"Ранг не указан"}} · указан игроком, не проверен")
            Text(listOf(g.optString("region"),g.optString("language")).filter{it.isNotBlank()}.joinToString(" · "))
            Text(g.words("roles").joinToString(" · "){roleLabels[it]?:it})
            Text(g.words("champions").joinToString(" · "));g.nullableString("riotId")?.let{Text("Riot ID: $it")}
            g.nullableString("playTime")?.let{Text("Играет: $it")}
            Text(when(g.optString("microphone")){"yes"->"Микрофон есть";"no"->"Без микрофона";else->"Микрофон не указан"})
        }
        if(!detail)TextButton(onClick={navigate("discovery/player/${p.optString("id")}")}){Text("Профиль")}
        if(p.optString("id")!=model.userId){if(detail||p.optBoolean("acceptsRequests"))Button(onClick={navigate("chat/new/${p.optString("id")}")}){Text("Написать")}
            TextButton(onClick={navigate("moderation/report/profile/${p.optString("id")}")}){Text("Пожаловаться")}}
    }}
}
@Composable private fun Home(model:DiscoveryViewModel,d:JSONObject?,navigate:(String)->Unit) {
    listOf("content/feed" to "Лента сообщества","discovery/players" to "Найти напарника","discovery/members" to "Люди сообщества","discovery/lfg" to "Найти команду","discovery/events" to "Игровые вечера","discovery/notifications" to "Уведомления","discovery/saved" to "Сохранённое").forEach{(r,t)->OutlinedButton(onClick={navigate(r)},modifier=Modifier.fillMaxWidth()){Text(t)}}
    if(d==null)return
    Text("Мои клубы · ${d.optInt("clubCount")}",style=MaterialTheme.typography.titleLarge)
    if(d.rows("myClubs").isEmpty())Text("Пока нет клубов. Найди сообщество по интересам.")
    d.rows("myClubs").forEach{c->TextButton(onClick={navigate("content/club/${c.optString("id")}")}){Text("${c.optString("name")} · ${c.optInt("members")} участников")}}
    d.rows("myClubs").firstOrNull()?.let{club->Button(onClick={navigate("content/create/${club.optString("id")}")}){Text("Написать публикацию")}}
    OutlinedButton(onClick={model.setDraft("editor.discovery/events","1");navigate("discovery/events")}){Text("Организовать вечер")}
    OutlinedButton(onClick={model.setDraft("editor.discovery/lfg","1");navigate("discovery/lfg")}){Text("Создать группу")}
    Text("Ближайшие вечера",style=MaterialTheme.typography.titleLarge)
    d.rows("events").forEach{GroupCard(it,true,navigate)}
    Text("Мои группы и заявки",style=MaterialTheme.typography.titleLarge)
    d.rows("myGroups").forEach{GroupCard(it,false,navigate)}
    Text("Подходящие объявления",style=MaterialTheme.typography.titleLarge)
    d.optJSONObject("preferences")?.let{p->Text(listOf(p.optString("region"),p.optString("language"),p.optString("rank"),p.words("roles").joinToString{roleLabels[it]?:it},if(p.optString("microphone")=="no")"Без обязательного голоса"else "").filter{it.isNotBlank()}.joinToString(" · "))}
    Text("Подбор по заполненным игровым полям. Совместимость очереди и ранг не проверены.")
    if(d.rows("groups").isEmpty())Text("Подходящих групп сейчас нет.")
    d.rows("groups").forEach{GroupCard(it,false,navigate)}
}
@Composable private fun GroupFilters(model:DiscoveryViewModel,event:Boolean) {
    val drafts by model.drafts.collectAsStateWithLifecycle()
    DraftChoice("Показать","list.mine",model,"",mapOf("" to "Предстоящие","1" to "Мои"))
    DraftChoice(if(event)"Свободная роль" else "Нужная роль","list.role",model,"",mapOf("" to "Любая")+(if(event)roleLabels else mapOf("any" to "Любая роль")+roleLabels))
    if(!event){DraftChoice("Режим","list.mode",model,"",mapOf("" to "Все")+modes)
        listOf("region" to "Регион","language" to "Язык","rank" to "Желаемый ранг").forEach{(k,l)->Field(l,"list.$k",model,max=40)}
        DraftChoice("Голос","list.voice",model,"",mapOf("" to "Любой","none" to "Без голоса","optional" to "По желанию","required" to "Обязателен"))}
    Button(onClick={val keys=if(event)listOf("mine","role")else listOf("mine","role","mode","region","language","rank","voice");model.open(model.currentRoute,keys.associateWith{drafts["list.$it"].orEmpty().trim()}.filterValues{it.isNotBlank()})},enabled=!model.state.value.busy){Text("Показать")}
}
@Composable private fun GroupCard(g:JSONObject,event:Boolean,navigate:(String)->Unit) {
    Card(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
        Text(g.optString("title"),style=MaterialTheme.typography.titleLarge)
        Text("${modes[g.optString("mode")]?:""} · ${states[g.optString("state")]?:states[g.optString("membership")]?:""}")
        Text("${time(g.optLong("starts_at"))} · твоё время")
        val region=g.optString("region");val language=g.optString("language")
        if(region.isNotBlank()||language.isNotBlank())Text(listOf(region,language).filter{it.isNotBlank()}.joinToString(" · "))
        if(event){
            val slots=g.rows("slots")
            val capacity=if(slots.isNotEmpty())slots.size else g.optInt("capacity")
            val members=if(slots.isNotEmpty())slots.count{it.optBoolean("taken")} else g.optInt("members")
            Text("Мест занято: $members / $capacity")
            g.nullableString("myRole")?.let{Text("Твоя роль: ${roleLabels[it]?:it}")}
            g.nullableString("timezone")?.let{Text("У организатора: ${time(g.optLong("starts_at"),it)} · $it")}
            slots.forEach{Text("${roleLabels[it.optString("role")]} · ${if(it.optBoolean("taken"))"занято" else "свободно"}")}
        }
        else Text("${g.optInt("members")} / ${g.optInt("capacity")} · ${roleLabels[g.optString("role")]?:"Любая роль"} · ${g.optString("rank")} (не проверен)")
        TextButton(onClick={navigate("discovery/"+(if(event)"event/" else "group/")+g.opt("id"))}){Text("Подробности и состав")}
    }}
}
@Composable private fun Creator(model:DiscoveryViewModel,route:String,navigate:(String)->Unit) {
    val event=route.endsWith("events")
    val drafts by model.drafts.collectAsStateWithLifecycle()
    var expanded by remember(route){mutableStateOf(drafts["editor.$route"]=="1")}
    TextButton(onClick={expanded=!expanded}){Text(if(expanded)"Свернуть создание"else if(event)"Организовать игровой вечер" else "Создать объявление")}
    if(!expanded)return
    fun v(key:String,fallback:String="")=drafts["create.$route.$key"]?:fallback
    fun key(name:String)="create.$route.$name"
    Field("Название",key("title"),model,max=80)
    Field("Описание",key("description"),model,max=1000)
    DraftChoice("Режим",key("mode"),model,"ranked",modes)
    Field("Регион",key("region"),model,max=40);Field("Язык",key("language"),model,max=40)
    Field(if(event)"Начало: ГГГГ-ММ-ДДTЧЧ:ММ"else "Начало: ГГГГ-ММ-ДДTЧЧ:ММ (пусто — сейчас)",key("date"),model,max=16)
    Field("Часовой пояс IANA",key("timezone"),model,ZoneId.systemDefault().id,max=80)
    DraftChoice("Длительность, часов",key("duration"),model,"1",(if(event)listOf(1,2,3,4,6)else listOf(1,2,4,8,24)).associate{it.toString() to "$it ч"})
    if(event){
        Text("Выбери 2–5 различных ролей. Организатор занимает одну из них.")
        val selected=v("roles",roleLabels.keys.joinToString(",")).split(',').filter{it.isNotBlank()}
        roleLabels.forEach{(r,label)->Row{Checkbox(checked=r in selected,onCheckedChange={checked->model.setDraft(key("roles"),(if(checked)selected+r else selected-r).joinToString(","))});Text(label,Modifier.padding(top=12.dp))}}
        DraftChoice("Твоя роль",key("ownerRole"),model,"baron",roleLabels)
        Text("Начало через 5 минут или позже, до 30 дней вперёд. Места в ARAM условны. Напоминания только внутри приложения.")
    }else{
        DraftChoice("Нужная роль",key("role"),model,"any",mapOf("any" to "Любая")+roleLabels)
        Field("Желаемый ранг (не проверяется)",key("rank"),model,max=40)
        DraftChoice("Голос",key("voice"),model,"optional",mapOf("optional" to "По желанию","required" to "Обязателен","none" to "Без голоса"))
        DraftChoice("Игроков вместе с тобой",key("capacity"),model,"5",(2..5).associate{it.toString() to it.toString()})
        Text("Начало сейчас или в ближайшие 7 дней. Игровые данные указаны игроками.")
    }
    Button(enabled=!model.state.value.busy,onClick={try{
        require(v("title").trim().length>=3){"Название должно содержать от 3 до 80 символов."}
        require(v("region").isNotBlank()&&v("language").isNotBlank()){"Укажи регион и язык."}
        val payload=JSONObject().put("title",v("title")).put("description",v("description")).put("mode",v("mode","ranked"))
            .put("region",v("region")).put("language",v("language")).put("durationHours",v("duration","1").toInt())
        val zone=v("timezone",ZoneId.systemDefault().id)
        if(event){val roles=v("roles",roleLabels.keys.joinToString(",")).split(',').filter{it.isNotBlank()}
            require(roles.size in 2..5 && v("ownerRole","baron") in roles){"Выбери 2–5 ролей и включи свою роль."}
            payload.put("timezone",zone).put("startsAt",DiscoveryContract.instant(v("date"),zone)).put("roles",JSONArray(roles)).put("ownerRole",v("ownerRole","baron"))
        }else payload.put("startsAt",if(v("date").isBlank())JSONObject.NULL else DiscoveryContract.instant(v("date"),zone))
            .put("role",v("role","any")).put("voice",v("voice","optional")).put("rank",v("rank")).put("capacity",v("capacity","5").toInt())
        model.create(payload,navigate)
    }catch(e:Exception){model.formError(if(e is java.time.DateTimeException)"Проверь дату в формате ГГГГ-ММ-ДДTЧЧ:ММ и часовой пояс IANA, например Europe/Moscow или UTC."else e.message?:"Проверь дату, часовой пояс и остальные поля.")}}){Text("Создать")}
    Text("После потери связи проверь «Мои» перед явным повтором. Черновик сохраняется до выхода из аккаунта.")
}

@Composable private fun Detail(model:DiscoveryViewModel,d:JSONObject,event:Boolean,navigate:(String)->Unit,confirm:(String,()->Unit)->Unit) {
    val g=d.optJSONObject(if(event)"event"else "group")?:return
    val id=g.optString("id");val owner=g.optString("owner_id")==model.userId
    val member=if(event)g.nullableString("myRole")!=null else g.optString("membership")=="accepted"
    val status=g.optString("state");val live=status in listOf("open","full")
    Text(g.optString("title"),style=MaterialTheme.typography.headlineSmall)
    Text("${modes[g.optString("mode")]} · ${states[status]}")
    Text("Начало ${time(g.optLong("starts_at"))} · твоё время")
    if(event){Text("У организатора: ${time(g.optLong("starts_at"),g.optString("timezone","UTC"))} · ${g.optString("timezone")}");Text("До ${time(g.optLong("ends_at"))}")}
    else{Text("Действует до ${time(g.optLong("expires_at"))}");Text("${g.optInt("members")} / ${g.optInt("capacity")} · ранг ${g.optString("rank").ifBlank{"любой"}} (не проверен)")
        Text("Голос: ${mapOf("none" to "Без голоса","optional" to "По желанию","required" to "Обязателен")[g.optString("voice")]}")}
    Text("${g.optString("region")} · ${g.optString("language")}");Text(g.optString("description"))
    TextButton(onClick={navigate("discovery/player/${g.optString("owner_id")}")}){Text(if(event)"Организатор: ${g.optString("owner_name")}"else "Профиль автора")}
    if(!owner)TextButton(onClick={navigate("moderation/report/"+(if(event)"event/"else "lfg/")+id)}){Text("Пожаловаться")}
    if(event){
        g.rows("slots").forEach{s->val person=d.rows("members").find{it.optString("role")==s.optString("role")}
            Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){
                Text("${roleLabels[s.optString("role")]} · ${if(s.optBoolean("taken"))person?.optString("name")?:"Занято" else "Свободно"}")
                person?.let{p->TextButton(onClick={navigate("discovery/player/${p.optString("id")}")}){Text("Профиль игрока")}
                    if(owner&&p.optString("id")!=model.userId)TextButton(enabled=!model.state.value.busy,onClick={confirm("Исключить игрока? Чат закроется для него, повторная запись будет запрещена."){model.action("remove",JSONObject().put("userId",p.optString("id")))}}){Text("Исключить")}}
                if(!s.optBoolean("taken")&&!member&&status=="open")Button(enabled=!model.state.value.busy,onClick={model.action("join",JSONObject().put("role",s.optString("role")))}){Text("Занять место")}
            }}
        }
        if(owner && status!="cancelled")OutlinedButton(enabled=!model.state.value.busy,onClick={confirm("Отменить событие? Набор и отправка сообщений прекратятся, история останется составу."){model.action("cancel")}}){Text("Отменить событие")}
    }else{
        Text(states[g.optString("membership")]?:"Ты ещё не в составе")
        if(!owner&&status=="open"&&g.optString("membership") !in listOf("pending","accepted","rejected"))Button(enabled=!model.state.value.busy,onClick={model.action("apply")}){Text("Подать заявку")}
        d.rows("members").forEach{p->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){
            Text("${p.optString("name")} · ${states[p.optString("status")]?:if(p.optString("status")=="cancelled")"Вышел"else p.optString("status")}")
            TextButton(onClick={navigate("discovery/player/${p.optString("id")}")}){Text("Профиль")}
            if(owner&&live&&p.optString("id")!=model.userId){
                if(p.optString("status")=="pending"&&status=="open")Button(enabled=!model.state.value.busy,onClick={model.action("decision",JSONObject().put("userId",p.optString("id")).put("decision","accept"))}){Text("Принять")}
                if(p.optString("status") in listOf("pending","accepted"))TextButton(enabled=!model.state.value.busy,onClick={confirm("Отклонить или исключить игрока? Доступ к чату закроется, новая заявка будет запрещена."){model.action("decision",JSONObject().put("userId",p.optString("id")).put("decision","reject"))}}){Text(if(p.optString("status")=="accepted")"Исключить"else "Отклонить")}
            }
        }}}
        if(owner&&live)OutlinedButton(enabled=!model.state.value.busy,onClick={confirm("Закрыть группу? Набор и отправка сообщений прекратятся."){model.action("close")}}){Text("Закрыть группу")}
    }
    if(!owner&&(member||(!event&&g.optString("membership")=="pending")))OutlinedButton(enabled=!model.state.value.busy,onClick={confirm("Покинуть состав или отменить заявку? Доступ к чату закроется."){model.action("leave")}}){Text(if(member)"Покинуть состав"else "Отменить заявку")}
    if(!member)Text("Чат и имена состава доступны только участникам.")
    else d.optJSONObject("chat")?.let{chat->
        Text("Чат состава",style=MaterialTheme.typography.titleLarge)
        chat.nullableString("next")?.let{cursor->OutlinedButton(enabled=!model.state.value.busy,onClick={model.more("messages",cursor,DiscoveryContract.routePath(model.currentRoute)+"/messages")}){Text("Ранее")}}
        if(chat.rows("messages").isEmpty())Text("Сообщений пока нет.")
        chat.rows("messages").forEach{m->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(m.optString("sender_name"),style=MaterialTheme.typography.labelLarge);Text(m.optString("body"));Text(time(m.optLong("created_at")),style=MaterialTheme.typography.labelSmall)}}}
        if(chat.optBoolean("canSend")){val drafts by model.drafts.collectAsStateWithLifecycle();val key="message.${model.currentRoute}";Field("Сообщение",key,model,max=2000)
            Button(enabled=!model.state.value.busy&&!drafts[key].isNullOrBlank(),onClick={model.send(drafts[key].orEmpty())}){Text("Отправить")}
            Text("Если ответ потерян, проверь историю. Повтор с тем же текстом сохраняет идентификатор отправки.")
        }else Text("Чат доступен только для чтения.")
    }
}

@Composable private fun Notifications(model:DiscoveryViewModel,d:JSONObject?,navigate:(String)->Unit) {
    val categories=linkedMapOf("discussions" to "Ответы и упоминания","lfg" to "Группы и заявки","events" to "События и напоминания","direct" to "Личные сообщения","reports" to "Решения по жалобам")
    Choice("Категория",model.category,categories){model.open("discovery/notifications",selectedCategory=it)}
    val summary=d?.optJSONObject("summary")
    categories.forEach{(k,title)->summary?.optJSONObject(k)?.let{Text("$title: ${it.optInt("unread")}"+(if(k=="direct")" · запросов: ${it.optInt("requests")}"else ""))}}
    if(d==null)return
    val key=DiscoveryRepository.notificationKey(model.category)
    if(d.rows(key).isEmpty())Text("Уведомлений в этой категории пока нет.")
    d.rows(key).forEach{n->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
        when(model.category){
            "direct"->{Text(n.optString("peer_name"),style=MaterialTheme.typography.titleLarge);Text("${n.optInt("unread")} непрочитанных · ${states[n.optString("status")]?:n.optString("status")}");TextButton(onClick={navigate(if(n.optString("status")=="accepted")"chat/direct/${n.optString("id")}" else "chat/inbox")}){Text("Открыть переписку")}}
            "reports"->{Text("Жалоба №${n.opt("id")} · ${when(n.optString("status")){"pending"->"На рассмотрении";"resolved"->"Решение принято";"dismissed"->"Отклонена";else->"Рассмотрена"}}")
                n.nullableString("decision_note")?.let{Text(it)};TextButton(onClick={navigate("moderation/reports")}){Text("Жалобы и апелляции")}
                if(n.optString("status")!="pending"&&n.optInt("decision_seen")==0)TextButton(enabled=!model.state.value.busy,onClick={model.read(n.optString("id"))}){Text("Отметить решение прочитанным")}
                if(n.nullableString("appeal_status")!=null&&n.optString("appeal_status")!="pending"&&n.optInt("appeal_seen")==0)TextButton(enabled=!model.state.value.busy,onClick={model.read(n.optString("id"),true)}){Text("Отметить апелляцию прочитанной")}}
            else->{Text(notices[n.optString("kind")]?:"Новое событие")
                if(model.category=="discussions"){Text(n.optString("title"));Text(n.optString("actor_name"))}
                Text(time(n.optLong("created_at")))
                TextButton(onClick={navigate(when(model.category){"lfg"->"discovery/group/${n.opt("group_id")}";"events"->"discovery/event/${n.opt("event_id")}";else->"content/post/${n.opt("post_id")}"})}){Text("Открыть")}
                if(n.optInt("seen")==0)TextButton(enabled=!model.state.value.busy,onClick={model.read(n.optString("id"))}){Text("Прочитано")}
                else Text("Прочитано",style=MaterialTheme.typography.labelSmall)
            }
        }
    }}}
    d.nullableString("next")?.let{cursor->OutlinedButton(enabled=!model.state.value.busy,onClick={model.more(key,cursor,cursorName=if(model.category=="direct")"after"else "before")}){Text("Ранее")}}
    Text("Напоминания появляются внутри приложения. Отдельная доставка push не подключена.")
}
