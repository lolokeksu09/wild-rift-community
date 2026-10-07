@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)

package ru.wrcommunity.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONArray
import org.json.JSONObject
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.ContentViewModel
import java.text.DateFormat
import java.util.Date

@Composable
fun ContentSection(model:ContentViewModel,route:String,onNavigate:(String)->Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    val user=model.userId
    val scrollState=key(route,user){rememberScrollState()}
    var restorePending by remember(route,user){mutableStateOf(true)}
    DisposableEffect(route,user){onDispose{if(!restorePending)model.rememberPosition(route,scrollState.value)}}
    LaunchedEffect(route,user){model.open(route)}
    LaunchedEffect(route,state.busy,state.revision){
        if(restorePending&&!state.busy&&state.data!=null&&model.loadedRoute==route){
            // Wait for freshly restored rows to be measured before clamping the saved offset.
            withFrameNanos{};withFrameNanos{}
            if(NativeRoutes.comment(route)==null)scrollState.scrollTo(model.position(route).coerceAtMost(scrollState.maxValue))
            restorePending=false
        }
    }
    val kind=route.removePrefix("content/").substringBefore('/')
    val id=route.substringAfter("content/").substringAfter('/',"")
    Column(Modifier.fillMaxSize().testTag(when(kind){"clubs"->"catalog-list";"club"->"club-list";"post"->"post-list";else->"content-list"}).verticalScroll(scrollState).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        if(kind=="clubs") RiftHero("КЛУБЫ · НАЙДИ СВОЙ КРУГ","Найди свою компанию","Для тех, с кем совпадает настроение на игру.",if(user==null)"Войти и найти своих" else "Создать клуб",{onNavigate(if(user==null)"account" else "content/create-club")})
        else if(kind !in listOf("club","members","post")) SectionHeading(contentTitles[kind]?:"Сообщество",contentSubtitles[kind])
        if(state.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={model.refresh()},enabled=!state.busy){Text("Обновить")}}
        state.notice?.let{Text(it,color=MaterialTheme.colorScheme.primary)}
        if(kind in listOf("feed","clubs","saved","guides","drafts","search","notifications")) {
            ContentDestinations(kind,user!=null,onNavigate)
        }
        val data=state.data.takeIf{model.loadedRoute==route}
        when(kind) {
            "clubs" -> {CatalogFilters(model,data,state.busy,onNavigate)
                data?.let{SectionHeading("Твоя компания начинается здесь","Показано ${it.rows("clubs").size} из ${it.optInt("total",it.rows("clubs").size)} клубов")}
                data?.rows("clubs")?.let{clubs->if(clubs.isEmpty())Empty("Клубы не найдены.");clubs.forEach{club->ClubCard(club,model,onNavigate)}}
                More(data,state.busy){model.more("api/clubs","clubs",cursorKey="after")}}
            "feed","saved","guides","search" -> {
                if(kind in listOf("guides","search"))PostFilters(model,kind,route,state.busy)
                data?.rows("posts")?.let{posts->if(posts.isEmpty())Empty(if(data?.optBoolean("searchPending")==true)"Введи фразу для поиска." else "Публикаций пока нет.");posts.forEach{PostCard(it,model,onNavigate)}}
                More(data,state.busy){model.more(if(kind=="search")"api/posts/search" else "api/$kind","posts")}
            }
            "club" -> data?.let{ClubDetail(it,model,onNavigate,state.busy)}
            "post" -> data?.let{PostDetail(it,model,onNavigate,state.busy,NativeRoutes.comment(route))}
            "create-club" -> ClubCreate(model,onNavigate,state.busy)
            "settings" -> data?.optJSONObject("club")?.let{ClubSettings(it,model,state.busy)}
            "members" -> data?.let{Members(it,model,onNavigate,state.busy)}
            "invites" -> data?.let{Invites(it,id,model,state.busy)}
            "audit" -> data?.let{Audit(it,id,model,state.busy)}
            "create","create-poll","create-guide","edit","draft" -> {
                if(kind.startsWith("create")||data!=null)ContentEditor(kind,id,data,model,onNavigate,state.busy)
            }
            "drafts" -> data?.let{page->val drafts=page.rows("drafts");if(drafts.isEmpty())Empty("Сохранённых черновиков нет.");drafts.forEach{draft->Panel{Text(draft.optString("title").ifBlank{"Без заголовка"},style=MaterialTheme.typography.titleMedium);Text(draft.optString("club_name"));Text(stamp(draft.optLong("updated_at")));Link("Продолжить","content/draft/${draft.optString("club_id")}",onNavigate)}}}
            "notifications" -> data?.let{page->if(page.rows("notifications").isEmpty())Empty("Ответов и упоминаний пока нет.");page.rows("notifications").forEach{n->Panel{Text(n.optString("title"),style=MaterialTheme.typography.titleMedium);Text(n.optString("actor_name")+if(n.optString("kind")=="reply")" ответил тебе" else " упомянул тебя");Link("Открыть обсуждение",NativeRoutes.post(n.optLong("post_id"),n.optLong("comment_id").takeIf{it>0}),onNavigate);if(n.optInt("seen")==0)TextButton(onClick={model.mutate("api/discussions/notifications/${n.optLong("id")}/read")},enabled=!state.busy){Text("Отметить прочитанным")}}};More(page,state.busy){model.more("api/discussions/notifications","notifications")}}
            "invite" -> InviteAccept(model,onNavigate,state.busy)
        }
        Spacer(Modifier.height(36.dp))
    }
}

private val contentTitles=mapOf("clubs" to "Клубы","feed" to "Лента сообщества","post" to "Публикация","club" to "Клуб","saved" to "Сохранённое","guides" to "Руководства","drafts" to "Черновики","draft" to "Личный черновик","create" to "Новая публикация","create-poll" to "Новый опрос","create-guide" to "Новое руководство","edit" to "Редактирование","members" to "Участники и заявки","settings" to "Настройки клуба","invites" to "Приглашения","invite" to "Вступить по приглашению","audit" to "Журнал клуба","search" to "Поиск публикаций","notifications" to "Ответы и упоминания","create-club" to "Создать клуб")
private val contentSubtitles=mapOf("feed" to "Истории, вопросы и опыт твоего сообщества.","saved" to "Публикации, к которым хочется вернуться.","guides" to "Играй увереннее: опыт и советы участников.","drafts" to "Твои идеи перед публикацией.","search" to "Найди обсуждение по теме или названию.")
@Composable private fun ContentDestinations(kind:String,signedIn:Boolean,navigate:(String)->Unit){
    val links=listOf("feed" to "Лента","clubs" to "Клубы","guides" to "Руководства","search" to "Поиск")+if(signedIn)listOf("saved" to "Сохранённое","drafts" to "Черновики","notifications" to "Ответы") else emptyList()
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){links.forEach{(key,label)->FilterChip(selected=kind==key,onClick={navigate("content/$key")},label={Text(label)})}}
}
private fun stamp(value:Long)=if(value==0L)"" else DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(Date(value))
private fun roleLabel(role:String)=when(role){"owner"->"Владелец";"moderator"->"Модератор";else->"Участник"}
@Composable private fun Panel(modifier:Modifier=Modifier,content:@Composable ColumnScope.()->Unit){RiftCard(modifier,content)}
@Composable private fun Empty(text:String){Text(text,color=MaterialTheme.colorScheme.onSurfaceVariant)}
@Composable private fun Link(label:String,route:String,navigate:(String)->Unit){TextButton(onClick={navigate(route)}){Text(label)}}
@Composable private fun More(page:JSONObject?,busy:Boolean,action:()->Unit){if(page!=null&&ContentRepository.next(page)!=null)OutlinedButton(onClick=action,enabled=!busy){Text("Показать ещё")}}
@Composable private fun Field(value:String,label:String,onChange:(String)->Unit,multiline:Boolean=false,enabled:Boolean=true){OutlinedTextField(value,onChange,label={Text(label)},modifier=Modifier.fillMaxWidth(),singleLine=!multiline,minLines=if(multiline)3 else 1,enabled=enabled)}
@Composable private fun Choice(value:String,label:String,options:List<Pair<String,String>>,enabled:Boolean=true,change:(String)->Unit){Text(label,style=MaterialTheme.typography.labelLarge);FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){options.forEach{(key,text)->FilterChip(selected=value==key,onClick={change(key)},enabled=enabled,label={Text(text)})}}}
@Composable private fun Destructive(label:String,description:String,busy:Boolean,action:()->Unit) {
    var confirm by remember{mutableStateOf(false)}
    TextButton(onClick={confirm=true},enabled=!busy){Text(label,color=MaterialTheme.colorScheme.error)}
    if(confirm)AlertDialog(
        onDismissRequest={confirm=false},title={Text(label)},text={Text(description)},
        confirmButton={TextButton(onClick={confirm=false;action()}){Text("Подтвердить")}},
        dismissButton={TextButton(onClick={confirm=false}){Text("Отмена")}}
    )
}

@Composable private fun CatalogFilters(model:ContentViewModel,data:JSONObject?,busy:Boolean,navigate:(String)->Unit){
    var q by rememberSaveable(model.userId){mutableStateOf(model.filter("content/clubs","q"))}
    var tag by rememberSaveable(model.userId){mutableStateOf(model.filter("content/clubs","tag"))}
    var scope by rememberSaveable(model.userId){mutableStateOf(model.filter("content/clubs","scope").ifBlank{"all"})}
    var sort by rememberSaveable(model.userId){mutableStateOf(model.filter("content/clubs","sort").ifBlank{"new"})}
    var expanded by rememberSaveable{mutableStateOf(false)}
    fun apply()=model.open("content/clubs",mapOf("q" to q,"tag" to tag,"scope" to scope,"sort" to sort))
    val availableTags=data?.optJSONArray("tags")?.let{a->List(a.length()){a.optString(it)}.filter{it.isNotBlank()}}.orEmpty()
    Panel{
        Field(q,"Поиск клубов",{q=it},enabled=!busy)
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            (listOf("all" to "Все клубы","open" to "Открытые")+if(model.userId!=null)listOf("mine" to "Мои клубы") else emptyList()).forEach{(key,label)->FilterChip(scope==key,{scope=key;apply()},enabled=!busy,label={Text(label)})}
        }
        Text("Темы",style=MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            (listOf("")+availableTags+listOf(tag).filter{it.isNotBlank()&&it !in availableTags}).forEach{topic->FilterChip(tag==topic,{tag=topic;apply()},enabled=!busy,label={Text(topic.ifBlank{"Все темы"})})}
        }
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
            Button(onClick={apply()},enabled=!busy,modifier=Modifier.semantics{contentDescription="Найти клубы"}){Text("Найти клубы")}
            TextButton(onClick={expanded=!expanded}){Text(if(expanded)"Скрыть фильтры" else "Порядок и ещё")}
        }
        if(expanded){
            Choice(sort,"Сортировка",listOf("new" to "Новые","name" to "По имени","discussion" to "Обсуждения"),enabled=!busy){sort=it;apply()}
            TextButton(onClick={q="";tag="";scope="all";sort="new";apply()},enabled=!busy){Text("Сбросить фильтры")}
            Link("У меня есть приглашение","content/invite",navigate)
        }
    }
}
@Composable private fun PostFilters(model:ContentViewModel,kind:String,route:String,busy:Boolean){var q by rememberSaveable(route,model.userId){mutableStateOf(model.filter(route,"q"))};var champion by rememberSaveable(route,model.userId){mutableStateOf(model.filter(route,"champion"))};var version by rememberSaveable(route,model.userId){mutableStateOf(model.filter(route,"gameVersion"))};var topic by rememberSaveable(route,model.userId){mutableStateOf(model.filter(route,"topic"))};Panel{Field(q,"Поиск по тексту",{q=it});if(kind=="guides"){Field(champion,"Чемпион",{champion=it});Field(version,"Версия игры",{version=it});Choice(topic,"Тема",listOf("" to "Все")+topics){topic=it}};Button(onClick={model.open(route,mapOf("q" to q,"champion" to champion,"gameVersion" to version,"topic" to topic))},enabled=!busy&& (kind!="search"||q.isNotBlank())){Text("Искать")}}}
@Composable private fun ClubCover(club:JSONObject,model:ContentViewModel,height:Int){
    Box(Modifier.fillMaxWidth().height(height.dp).clip(RoundedCornerShape(16.dp))){
        RiftCover(club.optString("name"),club.optString("accent","gold"),Modifier.fillMaxSize())
        club.nullableString("cover_id")?.let{NativeMedia(it,model.mediaClient.api,"Обложка клуба",Modifier.fillMaxSize())}
    }
}
private fun tagList(club:JSONObject)=club.optJSONArray("tags")?.let{a->List(a.length()){a.optString(it)}.filter{it.isNotBlank()}}.orEmpty()
private fun tags(club:JSONObject)=tagList(club).joinToString(" · ")
@Composable private fun Badges(labels:List<String>){FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){labels.filter{it.isNotBlank()}.forEach{label->Surface(color=MaterialTheme.colorScheme.surfaceVariant,shape=RoundedCornerShape(8.dp)){Text(label,Modifier.padding(horizontal=10.dp,vertical=6.dp),style=MaterialTheme.typography.labelMedium)}}}}
@Composable private fun ClubCard(club:JSONObject,model:ContentViewModel,navigate:(String)->Unit){Panel{
    ClubCover(club,model,150)
    Text(if(club.optString("access")=="open")"ОТКРЫТЫЙ КЛУБ" else "ПО ЗАЯВКАМ",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)
    Text(club.optString("name"),modifier=Modifier.fillMaxWidth().clickable{navigate("content/club/${club.optString("id")}")}.heightIn(min=48.dp).padding(vertical=8.dp),style=MaterialTheme.typography.titleLarge)
    Text(club.optString("description").ifBlank{"Место для общения и совместных игр."},color=MaterialTheme.colorScheme.onSurfaceVariant)
    Badges(tagList(club)+if(club.optBoolean("isDemoClub"))listOf("Демо-клуб") else emptyList())
    HorizontalDivider()
    club.optJSONObject("lastPost")?.let{last->
        Text("Последнее обсуждение",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Link(last.optString("title"),"content/post/${last.optLong("id")}",navigate)
        Text(stamp(last.optLong("created_at")),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }?:Text(if(club.optString("access")=="open")"Первые обсуждения ещё впереди" else "Обсуждения доступны участникам",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    Text("${club.optInt("members")} участников"+when(club.optString("membership")){"member"->" · Ты в клубе";"pending"->" · Заявка отправлена";"banned"->" · Доступ ограничен";else->""},style=MaterialTheme.typography.labelLarge)
    OutlinedButton(onClick={navigate("content/club/${club.optString("id")}")},modifier=Modifier.fillMaxWidth()){Text("Открыть клуб →")}
}}
@Composable private fun PostByline(post:JSONObject,model:ContentViewModel,navigate:(String)->Unit){
    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
        RiftAvatar(post.optString("author_name"),post.nullableString("author_avatar_id"),model.mediaClient.api)
        Column(Modifier.weight(1f)){
            TextButton(onClick={navigate("discovery/player/${post.optString("author_id")}")},contentPadding=PaddingValues(0.dp)){Text(post.optString("author_name")+if(post.optBoolean("isBot"))" · Бот" else "",style=MaterialTheme.typography.labelLarge)}
            Text(stamp(post.optLong("created_at"))+if(post.optLong("edited_at")>0)" · Изменено" else "",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
@Composable private fun PostCard(post:JSONObject,model:ContentViewModel,navigate:(String)->Unit){Panel{
    PostByline(post,model,navigate)
    post.nullableString("club_name")?.let{Text(it,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary)}
    post.optJSONObject("guide")?.let{Badges(listOf("Руководство",it.optString("game_version")))}
    if(post.optJSONObject("poll")!=null)Badges(listOf("Опрос"))
    Text(post.optString("title"),modifier=Modifier.testTag("post-card-${post.optLong("id")}").fillMaxWidth().clickable{navigate("content/post/${post.optLong("id")}")}.heightIn(min=48.dp).padding(vertical=8.dp),style=MaterialTheme.typography.titleLarge)
    Text(post.optString("body").let{if(it.length>300)it.take(300).trimEnd()+"…" else it},style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
    post.nullableString("image_id")?.let{NativeMedia(it,model.mediaClient.api,"Изображение публикации",Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(12.dp)))}
    if(post.optBoolean("isBot"))Text("Демонстрационная публикация бота",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    val reactions=post.rows("reactions").sumOf{it.optInt("count")}
    FlowRow(horizontalArrangement=Arrangement.spacedBy(12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){Text("Реакций: $reactions"+if(post.optBoolean("saved"))" · Сохранено" else "",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Link("Обсудить →","content/post/${post.optLong("id")}",navigate)}
}}
@Composable private fun ClubTabs(club:JSONObject,selected:String,navigate:(String)->Unit){
    val id=club.optString("id");val member=club.optString("membership")=="member"
    TabRow(selectedTabIndex=if(selected=="members")2 else 0){
        Tab(selected=selected=="posts",onClick={navigate("content/club/$id")},text={Text("Публикации")})
        Tab(selected=false,onClick={navigate("chat/club/$id")},enabled=member,text={Text("Чат")})
        Tab(selected=selected=="members",onClick={navigate("content/members/$id")},enabled=member,text={Text("Участники")})
    }
}
@Composable private fun ClubHeader(club:JSONObject,model:ContentViewModel,navigate:(String)->Unit,busy:Boolean,selected:String="posts"){
    val id=club.optString("id");val membership=club.nullableString("membership");val role=club.optString("myRole");val member=membership=="member";val staff=role in listOf("owner","moderator")
    var menu by remember(id,model.userId){mutableStateOf(false)}
    var rules by rememberSaveable(id){mutableStateOf(false)}
    Panel{
        ClubCover(club,model,190)
        Text("ТВОЁ МЕСТО В СООБЩЕСТВЕ",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)
        Text(club.optString("name"),style=MaterialTheme.typography.headlineMedium)
        Text(club.optString("description"),color=MaterialTheme.colorScheme.onSurfaceVariant)
        Badges(listOf(if(club.optString("access")=="open")"Открытый клуб" else "По заявкам","${club.optInt("members")} участников")+tagList(club)+(if(club.optBoolean("isDemoClub"))listOf("Демо-клуб") else emptyList())+(if(member)listOf(roleLabel(role)) else emptyList()))
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
            when(membership){
                "pending"->Destructive("Отозвать заявку","Заявка будет удалена.",busy){model.mutate("api/clubs/$id/leave")}
                "banned"->Text("Вступление ограничено",color=MaterialTheme.colorScheme.error)
                "member"->if(role!="owner")Destructive("Выйти из клуба","Доступ к закрытым материалам и чату будет потерян.",busy){model.mutate("api/clubs/$id/leave")}
                else->Button(onClick={if(model.userId==null)navigate("account") else model.mutate("api/clubs/$id/join")},enabled=!busy){Text(if(model.userId==null)"Войти и присоединиться" else if(club.optString("access")=="open")"Вступить в клуб" else "Подать заявку")}
            }
            if(member)Button(onClick={navigate("content/create/$id")},enabled=!busy){Text("Написать пост")}
            Box{
                OutlinedButton(onClick={menu=true}){Text("Действия")}
                DropdownMenu(menu,{menu=false}){
                    val links=listOf("Руководства клуба" to "content/guides/$id","Поиск в клубе" to "content/search/$id")+(if(member)listOf("Создать опрос" to "content/create-poll/$id","Написать руководство" to "content/create-guide/$id","Мой черновик" to "content/draft/$id") else emptyList())+(if(staff)listOf("Журнал действий" to "content/audit/$id") else emptyList())+(if(role=="owner")listOf("Настройки клуба" to "content/settings/$id","Приглашения" to "content/invites/$id") else emptyList())+(if(model.userId!=null&&club.optString("owner_id")!=model.userId)listOf("Пожаловаться на клуб" to "moderation/report/club_page/$id") else emptyList())
                    links.forEach{(label,route)->DropdownMenuItem(text={Text(label)},onClick={menu=false;navigate(route)})}
                }
            }
        }
        if(membership=="pending")Text("Заявка ожидает решения",style=MaterialTheme.typography.bodySmall)
        TextButton(onClick={rules=!rules}){Text(if(rules)"Скрыть правила" else "Правила клуба")}
        if(rules)Text(club.optString("rules").ifBlank{"Правила пока не добавлены."})
    }
    ClubTabs(club,selected,navigate)
}
@Composable private fun ClubDetail(data:JSONObject,model:ContentViewModel,navigate:(String)->Unit,busy:Boolean){
    val club=data.getJSONObject("club");val id=club.optString("id");val member=club.optString("membership")=="member"
    ClubHeader(club,model,navigate,busy)
    data.optJSONObject("transfer")?.let{offer->Panel{Text("Передача владения",style=MaterialTheme.typography.titleMedium);Text("Действует до ${stamp(offer.optLong("expires_at"))}. Прежние приглашения будут отозваны.");if(offer.optString("target_id")==model.userId)Destructive("Принять владение","Ты станешь владельцем и получишь управление клубом. Прежние приглашения будут отозваны.",busy){model.mutate("api/clubs/$id/transfer/accept",body=JSONObject().put("offerId",offer.optString("id")))};Destructive("Отменить передачу","Предложение будет отменено.",busy){model.mutate("api/clubs/$id/transfer/cancel",body=JSONObject().put("offerId",offer.optString("id")))}}}
    val pins=data.optJSONObject("pinsPage")?.rows("posts").orEmpty()
    if(pins.isNotEmpty())Panel{Text("Закреплено",style=MaterialTheme.typography.titleMedium);pins.forEach{Link(it.optString("title"),"content/post/${it.optLong("id")}",navigate)}}
    data.optJSONObject("postsPage")?.let{page->SectionHeading("Разговоры клуба","Делись опытом, задавай вопросы и находи своих.");if(page.rows("posts").isEmpty())Empty("Публикаций пока нет.");page.rows("posts").forEach{PostCard(it,model,navigate)};More(page,busy){model.more("api/clubs/$id/posts","posts","postsPage")}}
    if(!member&&club.optString("access")!="open")Empty("Материалы доступны после принятия в клуб.")
}

@Composable private fun PostDetail(data:JSONObject,model:ContentViewModel,navigate:(String)->Unit,busy:Boolean,focus:Long?=null){
    val p=data.getJSONObject("post");val id=p.optLong("id");val club=data.getJSONObject("club");val clubId=p.optString("club_id");val member=club.optString("membership")=="member";val staff=club.optString("myRole") in listOf("owner","moderator");val own=p.optString("author_id")==model.userId
    var tools by remember(id,model.userId){mutableStateOf(false)}
    Panel{PostByline(p,model,navigate);Text(p.optString("title"),style=MaterialTheme.typography.headlineSmall);p.optJSONObject("guide")?.let{g->Text("${topics.find{it.first==g.optString("topic")}?.second.orEmpty()} · ${g.optString("champion")} · версия ${g.optString("game_version")}");Text(g.optString("summary"))};Text(p.optString("body"));p.nullableString("image_id")?.let{NativeMedia(it,model.mediaClient.api,"Изображение публикации",Modifier.fillMaxWidth())};Link("Открыть клуб","content/club/$clubId",navigate)
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("like" to "Нравится","useful" to "Полезно","fire" to "Огонь").forEach{(kind,label)->val selected=p.optString("myReaction")==kind;TextButton(onClick={model.mutate("api/posts/$id/reaction",if(selected)"DELETE" else "PUT",JSONObject().put("kind",kind))},enabled=member&&!busy){Text("${if(selected)"✓ " else ""}$label · ${p.rows("reactions").find{it.optString("kind")==kind}?.optInt("count")?:0}")}}}
        if(model.userId!=null)TextButton(onClick={model.mutate("api/posts/$id/saved",if(p.optBoolean("saved"))"DELETE" else "PUT")},enabled=!busy){Text(if(p.optBoolean("saved"))"Убрать из сохранённого" else "Сохранить")}
        if(model.userId!=null){TextButton(onClick={tools=!tools}){Text(if(tools)"Скрыть действия" else "Действия публикации")}}
        if(tools){
        if(own){if(member&&p.optJSONObject("poll")==null)Link("Редактировать","content/edit/$id",navigate);Destructive("Удалить публикацию","Публикация, комментарии и вложение будут удалены без возможности восстановления.",busy){model.mutate("api/posts/$id","DELETE",onSuccess={navigate("content/club/$clubId")})}}
        else if(model.userId!=null)Link("Пожаловаться","moderation/report/post/$id",navigate)
        if(staff){val pinned=data.optJSONObject("pinsPage")?.rows("posts")?.any{it.optLong("id")==id}==true;TextButton(onClick={model.mutate("api/clubs/$clubId/pins/$id",if(pinned)"DELETE" else "PUT")},enabled=!busy){Text(if(pinned)"Снять закрепление" else "Закрепить")};if(!own)Destructive("Удалить как модератор","Публикация и обсуждение будут удалены. Действие попадёт в журнал клуба.",busy){model.mutate("api/clubs/$clubId/posts/$id","DELETE",onSuccess={navigate("content/club/$clubId")})}}
        }
    }
    p.optJSONObject("poll")?.let{poll->Panel{Text(if(poll.optBoolean("closed"))"Опрос завершён" else "До ${stamp(poll.optLong("endsAt"))}");Text("Всего голосов: ${poll.optInt("total")}");poll.rows("options").forEach{o->val chosen=!poll.isNull("myOption")&&poll.optInt("myOption")==o.optInt("option_id");OutlinedButton(onClick={model.mutate("api/posts/$id/poll/vote","PUT",JSONObject().put("optionId",o.optInt("option_id")))},enabled=member&&!busy&&!poll.optBoolean("closed")&&poll.isNull("myOption")){Text("${if(chosen)"✓ " else ""}${o.optString("label")} · ${o.optInt("votes")}")}}}}
    var reply by rememberSaveable(id,model.userId){mutableStateOf<Long?>(null)};var comment by rememberSaveable(id,model.userId){mutableStateOf("")}
    val comments=data.optJSONObject("commentsPage")
    SectionHeading("Обсуждение","Вопросы, ответы и опыт участников.")
    if(comments?.rows("comments")?.isEmpty()==true)Empty("Первый комментарий может быть твоим.")
    val focusRequester=remember(focus){BringIntoViewRequester()}
    LaunchedEffect(focus,comments,busy){if(focus!=null&&!busy&&comments?.rows("comments")?.any{it.optLong("id")==focus}==true){withFrameNanos{};withFrameNanos{};focusRequester.bringIntoView()}}
    if(focus!=null){Text(if(comments?.rows("comments")?.any{it.optLong("id")==focus}==true)"Выбранный ответ"else "Выбранный ответ недоступен.",color=MaterialTheme.colorScheme.primary);TextButton(onClick={navigate(NativeRoutes.post(id))}){Text("Показать последние комментарии")}}
    comments?.rows("comments")?.forEach{c->val selected=c.optLong("id")==focus;Panel(Modifier.testTag("comment-${c.optLong("id")}").then(if(selected)Modifier.bringIntoViewRequester(focusRequester)else Modifier)){if(selected)Text("Ответ из уведомления",color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.labelLarge);Row(horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.CenterVertically){RiftAvatar(c.optString("author_name"),null,model.mediaClient.api,32.dp);Column{Text(c.optString("author_name")+if(c.optInt("isBot")==1)" · Бот" else "",style=MaterialTheme.typography.labelLarge);Text(stamp(c.optLong("created_at")),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}};if(!c.isNull("parent_id"))Text("Ответ ${c.optString("parent_author_name")}: ${c.optString("parent_body")}",style=MaterialTheme.typography.bodySmall);Text(c.optString("body"));if(member)TextButton(onClick={reply=if(c.isNull("parent_id"))c.optLong("id") else c.optLong("parent_id")}){Text("Ответить")};if(model.userId!=null&&c.optString("author_id")!=model.userId)Link("Пожаловаться","moderation/report/comment/${c.optLong("id")}",navigate);if(comments.optBoolean("canModerate"))Destructive("Удалить комментарий","Текст будет удалён; ответы останутся без цитаты.",busy){model.mutate("api/clubs/$clubId/comments/${c.optLong("id")}","DELETE")}}}
    More(comments,busy){model.more("api/posts/$id/comments","comments","commentsPage")}
    if(member)Panel{reply?.let{Text("Ответ на комментарий");TextButton(onClick={reply=null}){Text("Отменить ответ")}};Field(comment,"Комментарий · @логин для упоминания",{comment=it},true,!busy);Button(onClick={val body=JSONObject().put("body",comment).put("parentId",reply?:JSONObject.NULL);body.put("clientId",model.attempt("comment:$id",body.toString()));model.mutate("api/posts/$id/comments",body=body,onSuccess={comment="";reply=null})},enabled=!busy&&comment.isNotBlank()&&comment.length<=1000){Text("Отправить")}}
    else Empty("Для комментариев и реакций вступи в клуб.")
}

@Composable private fun ClubCreate(model:ContentViewModel,navigate:(String)->Unit,busy:Boolean){var name by rememberSaveable(model.userId){mutableStateOf("")};var description by rememberSaveable(model.userId){mutableStateOf("")};var access by rememberSaveable{mutableStateOf("open")};Panel{Field(name,"Название",{name=it},enabled=!busy);Field(description,"Описание",{description=it},true,!busy);Choice(access,"Вступление",listOf("open" to "Открытое","request" to "По заявкам")){access=it};Button(onClick={model.mutate("api/clubs",body=JSONObject().put("name",name).put("description",description).put("access",access),onSuccess={navigate("content/club/${it.optString("id")}")})},enabled=!busy&&name.length in 2..80&&description.length<=1000){Text("Создать клуб")};Text("При потере ответа сначала проверь раздел «Мои»: создание клуба нельзя повторять автоматически.",style=MaterialTheme.typography.bodySmall)}}

@Composable private fun ClubSettings(club:JSONObject,model:ContentViewModel,busy:Boolean){val id=club.optString("id");var name by rememberSaveable(id,model.userId){mutableStateOf(club.optString("name"))};var description by rememberSaveable(id,model.userId){mutableStateOf(club.optString("description"))};var rules by rememberSaveable(id,model.userId){mutableStateOf(club.optString("rules"))};var tagText by rememberSaveable(id,model.userId){mutableStateOf(tags(club).replace(" · ",", "))};var accent by rememberSaveable(id,model.userId){mutableStateOf(club.optString("accent","azure"))};var version by rememberSaveable(id,model.userId){mutableIntStateOf(club.optInt("settings_version"))};var cover by rememberSaveable(id,model.userId){mutableStateOf(club.nullableString("cover_id"))};var savedSettings by remember(id,model.userId){mutableStateOf(false)}
    LaunchedEffect(club){if(savedSettings){version=club.optInt("settings_version");savedSettings=false}}
    if(club.optString("myRole")!="owner"){Empty("Управление настройками доступно владельцу.");return}
    Panel{Field(name,"Название",{name=it},enabled=!busy);Field(description,"Описание",{description=it},true,!busy);Field(rules,"Публичные правила",{rules=it},true,!busy);Field(tagText,"До 5 меток через запятую",{tagText=it},enabled=!busy);Choice(accent,"Цвет клуба",listOf("azure" to "Голубой","emerald" to "Изумрудный","violet" to "Фиолетовый","coral" to "Коралловый")){accent=it};Button(onClick={val body=JSONObject().put("name",name).put("description",description).put("rules",rules).put("tags",JSONArray(tagText.split(',').map{it.trim()}.filter{it.isNotBlank()})).put("accent",accent).put("version",version);model.mutate("api/clubs/$id/settings","PATCH",body,onSuccess={savedSettings=true})},enabled=!busy){Text("Сохранить настройки")};TextButton(onClick={name=club.optString("name");description=club.optString("description");rules=club.optString("rules");tagText=tags(club).replace(" · ",", ");accent=club.optString("accent");version=club.optInt("settings_version")},enabled=!busy){Text("Загрузить серверную версию в форму")};Text("После конфликта обнови данные и загрузи серверную версию. Это заменит введённый текст.",style=MaterialTheme.typography.bodySmall)}
    Panel{Text("Обложка клуба",style=MaterialTheme.typography.titleMedium);NativeImagePicker(model.mediaClient,cover,{cover=it},"Обложка клуба");Button(onClick={model.mutate("api/clubs/$id/cover","PATCH",JSONObject().put("coverId",cover?:JSONObject.NULL))},enabled=!busy){Text("Сохранить обложку")};if(club.nullableString("cover_id")!=null)Destructive("Убрать обложку","Обложка будет удалена из публичной карточки клуба.",busy){model.mutate("api/clubs/$id/cover","PATCH",JSONObject().put("coverId",JSONObject.NULL),onSuccess={cover=null})}}
}

@Composable private fun Members(data:JSONObject,model:ContentViewModel,navigate:(String)->Unit,busy:Boolean){val club=data.getJSONObject("club");val id=club.optString("id");val role=club.optString("myRole");val owner=role=="owner";val staff=owner||role=="moderator";val page=data.optJSONObject("membersPage")?:return
    ClubHeader(club,model,navigate,busy,"members")
    SectionHeading("Люди клуба",if(staff)"Участники, заявки и управление ролями." else "Познакомься с теми, кто играет рядом.")
    if(page.rows("members").isEmpty())Empty("Участников и заявок нет.")
    page.rows("members").forEach{m->val userId=m.optString("id");val status=m.optString("status");val targetRole=m.optString("role");val body=JSONObject().put("userId",userId)
        Panel{Text(m.optString("name")+if(m.optInt("isBot")==1)" · Бот" else "",style=MaterialTheme.typography.titleMedium);Text("@${m.optString("handle")} · ${when(status){"pending"->"Заявка";"banned"->"Доступ ограничен";else->roleLabel(targetRole)}}");Link("Профиль","discovery/player/$userId",navigate)
            if(staff&&status=="pending"){Button(onClick={model.mutate("api/clubs/$id/decision",body=JSONObject(body.toString()).put("decision","approve"))},enabled=!busy){Text("Принять заявку")};Destructive("Отклонить заявку","Участник сможет подать новую заявку.",busy){model.mutate("api/clubs/$id/decision",body=JSONObject(body.toString()).put("decision","reject"))}}
            if(staff&&targetRole=="member"&&status=="member"&&userId!=model.userId){Destructive("Исключить","Участник потеряет доступ к чату и закрытым материалам клуба.",busy){model.mutate("api/clubs/$id/kick",body=body)};Destructive("Заблокировать в клубе","Участник потеряет доступ и не сможет снова вступить до снятия бана.",busy){model.mutate("api/clubs/$id/ban",body=body)}}
            if(owner&&targetRole!="owner"&&status=="member"&&userId!=model.userId){Destructive(if(targetRole=="moderator")"Снять полномочия" else "Назначить модератором","Модератор рассматривает заявки, управляет участниками, удалением и закреплением контента.",busy){model.mutate("api/clubs/$id/moderators",if(targetRole=="moderator")"DELETE" else "PUT",body)};Destructive("Предложить владение","Участник должен принять предложение. После передачи прежние приглашения будут отозваны.",busy){body.put("clientId",model.attempt("transfer:$id",userId));model.mutate("api/clubs/$id/transfer",body=body)}}
            if(owner&&status=="banned")Destructive("Снять бан","Участник сможет снова вступить или подать заявку.",busy){model.mutate("api/clubs/$id/unban",body=body)}
        }
    }
    More(page,busy){model.more("api/clubs/$id/members","members","membersPage","after")};Link("Вернуться в клуб","content/club/$id",navigate)
}

@Composable private fun Invites(data:JSONObject,id:String,model:ContentViewModel,busy:Boolean){var hours by rememberSaveable(id){mutableStateOf("24")};var uses by rememberSaveable(id){mutableStateOf("10")};var token by rememberSaveable(id,model.userId){mutableStateOf("")};Panel{Text("Для клуба по заявкам приглашение не заменяет одобрение участника.");Field(hours,"Срок в часах · 1–168",{hours=it},enabled=!busy);Field(uses,"Число вступлений · 1–50",{uses=it},enabled=!busy);Button(onClick={val body=JSONObject().put("durationHours",hours.toInt()).put("maxUses",uses.toInt());body.put("clientId",model.attempt("invite:$id",body.toString()));model.mutate("api/clubs/$id/invites",body=body,onSuccess={token=it.optString("token")})},enabled=!busy&&hours.toIntOrNull() in 1..168&&uses.toIntOrNull() in 1..50){Text("Создать приглашение")};if(token.isNotBlank()){Text("Передай этот код приглашённому участнику:");Field(token,"Код приглашения",{},multiline=true);TextButton(onClick={token=""}){Text("Скрыть код")}}}
    val page=data.optJSONObject("invitesPage")?:return;if(page.rows("invites").isEmpty())Empty("Приглашений пока нет.");page.rows("invites").forEach{i->Panel{Text("Использовано ${i.optInt("uses")} из ${i.optInt("max_uses")}");Text(if(i.optInt("revoked")==1)"Отозвано" else "До ${stamp(i.optLong("expires_at"))}");if(i.optInt("revoked")==0&&i.optLong("expires_at")>System.currentTimeMillis())Destructive("Отозвать приглашение","Код приглашения больше не будет действовать.",busy){model.mutate("api/clubs/$id/invites/${i.optString("id")}","DELETE")}}}
}

@Composable private fun InviteAccept(model:ContentViewModel,navigate:(String)->Unit,busy:Boolean){var token by rememberSaveable(model.userId){mutableStateOf("")};var preview by remember(model.userId){mutableStateOf<JSONObject?>(null)};Panel{Field(token,"Код приглашения",{token=it;preview=null},true,!busy);Button(onClick={model.mutate("api/club-invites/preview",body=JSONObject().put("token",token.trim()),onSuccess={preview=it})},enabled=!busy&&token.trim().length==64){Text("Проверить приглашение")};preview?.let{p->Text(p.optJSONObject("club")?.optString("name").orEmpty(),style=MaterialTheme.typography.titleLarge);Text("До ${stamp(p.optLong("expiresAt"))}");Button(onClick={model.mutate("api/club-invites/accept",body=JSONObject().put("token",token.trim()),onSuccess={navigate("content/club/${it.optString("clubId")}")})},enabled=!busy){Text("Вступить или подать заявку")}}}}

private val auditLabels=mapOf("cover" to "Обложка обновлена","settings" to "Настройки обновлены","moderator-grant" to "Назначен модератор","moderator-revoke" to "Сняты полномочия","approve" to "Заявка принята","reject" to "Заявка отклонена","ban" to "Доступ ограничен","kick" to "Участник исключён","unban" to "Бан снят","leave" to "Выход из клуба","pin" to "Публикация закреплена","unpin" to "Закрепление снято","post-remove" to "Публикация удалена","comment-remove" to "Комментарий удалён","invite-create" to "Приглашение создано","invite-revoke" to "Приглашение отозвано","invite-member" to "Вступление по приглашению","invite-pending" to "Заявка по приглашению","transfer-offer" to "Предложена передача владения","transfer-cancel" to "Передача отменена","transfer-accept" to "Владение передано","owner-operator-transfer" to "Оператор передал владение")
@Composable private fun Audit(data:JSONObject,id:String,model:ContentViewModel,busy:Boolean){val page=data.optJSONObject("auditPage")?:return;if(page.rows("entries").isEmpty())Empty("Журнал пока пуст.");page.rows("entries").forEach{e->Panel{Text(auditLabels[e.optString("action")]?:"Действие управления",style=MaterialTheme.typography.titleMedium);Text(e.optString("actor_name")+e.nullableString("target_name")?.let{" → $it"}.orEmpty());Text(stamp(e.optLong("created_at")))}};More(page,busy){model.more("api/clubs/$id/audit","entries","auditPage")}}

private val topics=listOf("champion" to "Чемпион","build" to "Сборка","macro" to "Макроигра","roles" to "Роли","beginner" to "Новичкам")
@Composable private fun ContentEditor(kind:String,id:String,data:JSONObject?,model:ContentViewModel,navigate:(String)->Unit,busy:Boolean){
    val source=if(kind=="edit")data?.optJSONObject("post") else if(kind=="draft")data?.optJSONObject("draft") else null
    val g=source?.optJSONObject("guide");val guide=kind=="create-guide"||g!=null;val poll=kind=="create-poll";val draft=kind=="draft";val edit=kind=="edit"
    var title by rememberSaveable(kind,id,model.userId){mutableStateOf(source?.optString("title").orEmpty())};var bodyText by rememberSaveable(kind,id,model.userId){mutableStateOf(source?.optString("body").orEmpty())};var image by rememberSaveable(kind,id,model.userId){mutableStateOf(source?.nullableString("image_id"))};var version by rememberSaveable(kind,id,model.userId){mutableIntStateOf(source?.optInt(if(draft)"version" else "edit_version",if(draft)0 else 1)?:0)}
    var topic by rememberSaveable(kind,id,model.userId){mutableStateOf(g?.optString("topic")?:"beginner")};var champion by rememberSaveable(kind,id,model.userId){mutableStateOf(g?.optString("champion").orEmpty())};var gameVersion by rememberSaveable(kind,id,model.userId){mutableStateOf(g?.optString("game_version").orEmpty())};var summary by rememberSaveable(kind,id,model.userId){mutableStateOf(g?.optString("summary").orEmpty())};var options by rememberSaveable(id,model.userId){mutableStateOf("")};var hours by rememberSaveable(id,model.userId){mutableStateOf("24")};var dirty by rememberSaveable(kind,id,model.userId){mutableStateOf(false)}
    Panel {
        Field(title,if(poll)"Вопрос" else "Заголовок",{title=it;dirty=true},enabled=!busy);Field(bodyText,if(guide)"Руководство" else "Текст",{bodyText=it;dirty=true},true,!busy)
        if(guide){Choice(topic,"Тема",topics){topic=it;dirty=true};Field(champion,"Чемпион (необязательно)",{champion=it;dirty=true},enabled=!busy);Field(gameVersion,"Версия игры · например 7.0",{gameVersion=it;dirty=true},enabled=!busy);Field(summary,"Краткое описание",{summary=it;dirty=true},true,!busy)}
        if(poll){Field(options,"2–6 вариантов · по одному на строку",{options=it;dirty=true},true,!busy);Field(hours,"Срок в часах · 1–168",{hours=it;dirty=true},enabled=!busy)}
        if(!guide&&!poll&&!edit)NativeImagePicker(model.mediaClient,image,{image=it;dirty=true},"Изображение публикации")
        if(draft){Text("Личный серверный черновик. Публикация использует последнюю сохранённую версию.",style=MaterialTheme.typography.bodySmall)
            Button(onClick={model.mutate("api/clubs/$id/draft","PUT",JSONObject().put("title",title).put("body",bodyText).put("imageId",image?:JSONObject.NULL).put("version",version),onSuccess={version=it.optJSONObject("draft")?.optInt("version")?:version;dirty=false})},enabled=!busy&&title.length<=100&&bodyText.length<=4000){Text("Сохранить черновик")}
            Button(onClick={val payload=JSONObject().put("version",version);payload.put("clientId",model.attempt("publish-draft:$id",payload.toString()));model.mutate("api/clubs/$id/draft/publish",body=payload,onSuccess={navigate("content/post/${it.optLong("id")}")})},enabled=!busy&&!dirty&&version>0&&title.isNotBlank()&&bodyText.isNotBlank()){Text("Опубликовать сохранённый черновик")}
            if(version>0)Destructive("Удалить черновик","Личный черновик и его вложение будут удалены.",busy){model.mutate("api/clubs/$id/draft","DELETE",JSONObject().put("version",version),onSuccess={title="";bodyText="";image=null;version=0;dirty=false})}
        }else{
            Button(onClick={
                var path="api/clubs/$id/posts";var method="POST"
                val payload=when {
                    guide -> {path=if(edit)"api/posts/$id/guide" else "api/clubs/$id/guides";method=if(edit)"PATCH" else "POST";ContentRepository.guideBody(title,bodyText,topic,champion,gameVersion,summary,"",if(edit)version else null)}
                    poll -> {path="api/clubs/$id/polls";JSONObject().put("title",title).put("body",bodyText).put("durationHours",hours.toInt()).put("options",JSONArray(options.lines().map{it.trim()}.filter{it.isNotBlank()}))}
                    edit -> {path="api/posts/$id";method="PATCH";ContentRepository.editBody(title,bodyText,version,"")}
                    else -> ContentRepository.postBody(title,bodyText,image,"")
                }
                payload.remove("clientId");payload.put("clientId",model.attempt("$kind:$id",payload.toString()))
                model.mutate(path,method,payload,onSuccess={result->if(edit)version=result.optInt("version",version);navigate("content/post/${if(edit)id else result.optLong("id")}")})
            },enabled=!busy&&title.isNotBlank()&&title.length<=100&&(poll||bodyText.isNotBlank())&&bodyText.length<=(if(guide)12000 else 4000)&&(!poll||(hours.toIntOrNull() in 1..168&&options.lines().filter{it.isNotBlank()}.size in 2..6))&&(!guide||gameVersion.isNotBlank())){Text(if(edit)"Сохранить изменения" else "Опубликовать")}
        }
        if(edit||draft)Destructive("Загрузить серверную версию","Текущий введённый текст будет заменён последней загруженной серверной версией.",busy){title=source?.optString("title").orEmpty();bodyText=source?.optString("body").orEmpty();image=source?.nullableString("image_id");version=source?.optInt(if(draft)"version" else "edit_version",if(draft)0 else 1)?:0;topic=g?.optString("topic")?:"beginner";champion=g?.optString("champion").orEmpty();gameVersion=g?.optString("game_version").orEmpty();summary=g?.optString("summary").orEmpty();dirty=false}
    }
}
