package ru.wrcommunity.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
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
    val scrollState=rememberScrollState()
    DisposableEffect(route,user){onDispose{model.rememberPosition(route,scrollState.value)}}
    LaunchedEffect(route,user){scrollState.scrollTo(model.position(route));model.open(route)}
    val kind=route.removePrefix("content/").substringBefore('/')
    val id=route.substringAfter("content/").substringAfter('/',"")
    Column(Modifier.fillMaxSize().verticalScroll(scrollState).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(contentTitles[kind]?:"Сообщество",style=MaterialTheme.typography.headlineMedium)
        if(state.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={model.refresh()},enabled=!state.busy){Text("Обновить")}}
        state.notice?.let{Text(it,color=MaterialTheme.colorScheme.primary)}
        if(kind in listOf("feed","clubs","saved","guides","drafts","search","notifications")) {
            NavLinks(listOf("Лента" to "content/feed","Клубы" to "content/clubs","Руководства" to "content/guides","Поиск" to "content/search","Сохранённое" to "content/saved","Черновики" to "content/drafts","Обсуждения" to "content/notifications"),onNavigate)
        }
        val data=state.data
        when(kind) {
            "clubs" -> {CatalogFilters(model,state.busy,onNavigate);if(user!=null)Link("Создать клуб","content/create-club",onNavigate)
                data?.rows("clubs")?.let{clubs->if(clubs.isEmpty())Empty("Клубы не найдены.");clubs.forEach{club->ClubCard(club,model,onNavigate)}}
                More(data,state.busy){model.more("api/clubs","clubs",cursorKey="after")}}
            "feed","saved","guides","search" -> {
                if(kind in listOf("guides","search"))PostFilters(model,kind,route,state.busy)
                data?.rows("posts")?.let{posts->if(posts.isEmpty())Empty("Публикаций пока нет.");posts.forEach{PostCard(it,model,onNavigate)}}
                More(data,state.busy){model.more(if(kind=="search")"api/posts/search" else "api/$kind","posts")}
            }
            "club" -> data?.let{ClubDetail(it,model,onNavigate,state.busy)}
            "post" -> data?.let{PostDetail(it,model,onNavigate,state.busy)}
            "create-club" -> ClubCreate(model,onNavigate,state.busy)
            "settings" -> data?.optJSONObject("club")?.let{ClubSettings(it,model,state.busy)}
            "members" -> data?.let{Members(it,model,onNavigate,state.busy)}
            "invites" -> data?.let{Invites(it,id,model,state.busy)}
            "audit" -> data?.let{Audit(it,id,model,state.busy)}
            "create","create-poll","create-guide","edit","draft" -> {
                if(kind.startsWith("create")||data!=null)ContentEditor(kind,id,data,model,onNavigate,state.busy)
            }
            "drafts" -> data?.let{page->val drafts=page.rows("drafts");if(drafts.isEmpty())Empty("Сохранённых черновиков нет.");drafts.forEach{draft->Panel{Text(draft.optString("title").ifBlank{"Без заголовка"},style=MaterialTheme.typography.titleMedium);Text(draft.optString("club_name"));Text(stamp(draft.optLong("updated_at")));Link("Продолжить","content/draft/${draft.optString("club_id")}",onNavigate)}}}
            "notifications" -> data?.let{page->if(page.rows("notifications").isEmpty())Empty("Ответов и упоминаний пока нет.");page.rows("notifications").forEach{n->Panel{Text(n.optString("title"),style=MaterialTheme.typography.titleMedium);Text(n.optString("actor_name")+if(n.optString("kind")=="reply")" ответил тебе" else " упомянул тебя");Link("Открыть обсуждение","content/post/${n.optLong("post_id")}",onNavigate);if(n.optInt("seen")==0)TextButton(onClick={model.mutate("api/discussions/notifications/${n.optLong("id")}/read")},enabled=!state.busy){Text("Отметить прочитанным")}}};More(page,state.busy){model.more("api/discussions/notifications","notifications")}}
            "invite" -> InviteAccept(model,onNavigate,state.busy)
        }
        Spacer(Modifier.height(36.dp))
    }
}

private val contentTitles=mapOf("clubs" to "Клубы","feed" to "Лента сообщества","post" to "Публикация","club" to "Клуб","saved" to "Сохранённое","guides" to "Руководства","drafts" to "Черновики","draft" to "Личный черновик","create" to "Новая публикация","create-poll" to "Новый опрос","create-guide" to "Новое руководство","edit" to "Редактирование","members" to "Участники и заявки","settings" to "Настройки клуба","invites" to "Приглашения","invite" to "Вступить по приглашению","audit" to "Журнал клуба","search" to "Поиск публикаций","notifications" to "Ответы и упоминания","create-club" to "Создать клуб")
private fun stamp(value:Long)=if(value==0L)"" else DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(Date(value))
private fun roleLabel(role:String)=when(role){"owner"->"Владелец";"moderator"->"Модератор";else->"Участник"}
@Composable private fun Panel(content:@Composable ColumnScope.()->Unit){Card(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp),content=content)}}
@Composable private fun Empty(text:String){Text(text,color=MaterialTheme.colorScheme.onSurfaceVariant)}
@Composable private fun Link(label:String,route:String,navigate:(String)->Unit){TextButton(onClick={navigate(route)}){Text(label)}}
@Composable private fun NavLinks(links:List<Pair<String,String>>,navigate:(String)->Unit){links.chunked(2).forEach{row->Row(Modifier.fillMaxWidth()){row.forEach{(label,route)->Link(label,route,navigate)}}}}
@Composable private fun More(page:JSONObject?,busy:Boolean,action:()->Unit){if(page!=null&&ContentRepository.next(page)!=null)OutlinedButton(onClick=action,enabled=!busy){Text("Показать ещё")}}
@Composable private fun Field(value:String,label:String,onChange:(String)->Unit,multiline:Boolean=false,enabled:Boolean=true){OutlinedTextField(value,onChange,label={Text(label)},modifier=Modifier.fillMaxWidth(),singleLine=!multiline,minLines=if(multiline)3 else 1,enabled=enabled)}
@Composable private fun Choice(value:String,label:String,options:List<Pair<String,String>>,change:(String)->Unit){Text(label,style=MaterialTheme.typography.labelLarge);options.chunked(2).forEach{row->Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){row.forEach{(key,text)->FilterChip(selected=value==key,onClick={change(key)},label={Text(text)})}}}}
@Composable private fun Destructive(label:String,description:String,busy:Boolean,action:()->Unit){var confirm by remember{mutableStateOf(false)};TextButton(onClick={confirm=true},enabled=!busy){Text(label,color=MaterialTheme.colorScheme.error)};if(confirm)AlertDialog(onDismissRequest={confirm=false},title={Text(label)},text={Text(description)},confirmButton={TextButton(onClick={confirm=false;action()}){Text("Подтвердить")}},dismissButton={TextButton(onClick={confirm=false}){Text("Отмена")}}}

@Composable private fun CatalogFilters(model:ContentViewModel,busy:Boolean,navigate:(String)->Unit){
    var q by rememberSaveable{mutableStateOf(model.filter("content/clubs","q"))};var tag by rememberSaveable{mutableStateOf(model.filter("content/clubs","tag"))};var scope by rememberSaveable{mutableStateOf(model.filter("content/clubs","scope").ifBlank{"all"})};var sort by rememberSaveable{mutableStateOf(model.filter("content/clubs","sort").ifBlank{"new"})}
    Panel{Field(q,"Название или тема",{q=it});Field(tag,"Метка",{tag=it});Choice(scope,"Доступ",listOf("all" to "Все","open" to "Открытые","mine" to "Мои")){scope=it};Choice(sort,"Сортировка",listOf("new" to "Новые","name" to "По имени","discussion" to "Обсуждения")){sort=it};Button(onClick={model.open("content/clubs",mapOf("q" to q,"tag" to tag,"scope" to scope,"sort" to sort))},enabled=!busy){Text("Найти клубы")};Link("У меня есть приглашение","content/invite",navigate)}
}
@Composable private fun PostFilters(model:ContentViewModel,kind:String,route:String,busy:Boolean){var q by rememberSaveable(kind){mutableStateOf(model.filter(route,"q").ifBlank{if(kind=="search")"Wild Rift" else ""})};var champion by rememberSaveable(kind){mutableStateOf(model.filter(route,"champion"))};var version by rememberSaveable(kind){mutableStateOf(model.filter(route,"gameVersion"))};var topic by rememberSaveable(kind){mutableStateOf(model.filter(route,"topic"))};Panel{Field(q,"Поиск по тексту",{q=it});if(kind=="guides"){Field(champion,"Чемпион",{champion=it});Field(version,"Версия игры",{version=it});Choice(topic,"Тема",listOf("" to "Все")+topics){topic=it}};Button(onClick={model.open(route,mapOf("q" to q,"champion" to champion,"gameVersion" to version,"topic" to topic))},enabled=!busy&& (kind!="search"||q.isNotBlank())){Text("Искать")}}}
@Composable private fun ClubCard(club:JSONObject,model:ContentViewModel,navigate:(String)->Unit){Panel{NativeMedia(club.nullableString("cover_id"),model.mediaClient.api,"Обложка клуба",Modifier.fillMaxWidth().height(150.dp));Text(club.optString("name"),style=MaterialTheme.typography.titleLarge);Text(club.optString("description"));Text(if(club.optString("access")=="open")"Открытый клуб" else "Вступление по заявке");Text("${club.optInt("members")} участников");if(club.optBoolean("isDemoClub"))Text("Демонстрационный клуб");Text(tags(club));Link("Открыть клуб","content/club/${club.optString("id")}",navigate)}}
private fun tags(club:JSONObject)=club.optJSONArray("tags")?.let{a->List(a.length()){a.optString(it)}.joinToString(" · ")}.orEmpty()
@Composable private fun PostCard(post:JSONObject,model:ContentViewModel,navigate:(String)->Unit){Panel{NativeMedia(post.nullableString("image_id"),model.mediaClient.api,"Изображение публикации",Modifier.fillMaxWidth().height(180.dp));Text(post.optString("title"),style=MaterialTheme.typography.titleLarge);Text(post.optString("author_name")+if(post.optBoolean("isBot"))" · Бот" else "");post.nullableString("club_name")?.let{Text(it)};Text(post.optString("body").take(260));post.optJSONObject("guide")?.let{Text("Руководство · ${it.optString("game_version")}")};if(post.optJSONObject("poll")!=null)Text("Опрос");Link("Читать и обсуждать","content/post/${post.optLong("id")}",navigate)}}

@Composable private fun ClubDetail(data:JSONObject,model:ContentViewModel,navigate:(String)->Unit,busy:Boolean){
    val club=data.getJSONObject("club");val id=club.optString("id");val membership=club.nullableString("membership");val role=club.optString("myRole");val member=membership=="member";val staff=role in listOf("owner","moderator")
    Panel{NativeMedia(club.nullableString("cover_id"),model.mediaClient.api,"Обложка клуба",Modifier.fillMaxWidth().height(180.dp));Text(club.optString("name"),style=MaterialTheme.typography.headlineSmall);Text(club.optString("description"));Text(tags(club));Text("${club.optInt("members")} участников");if(club.optBoolean("isDemoClub"))Text("Демонстрационный клуб");Text("Правила",style=MaterialTheme.typography.titleMedium);Text(club.optString("rules").ifBlank{"Правила пока не добавлены."});if(member)Text(roleLabel(role));if(model.userId!=null&&club.optString("owner_id")!=model.userId)Link("Пожаловаться на клуб","moderation/report/club_page/$id",navigate)
        when(membership){"pending"->Text("Заявка ожидает решения");"banned"->Text("Вступление ограничено");"member"->if(role!="owner")Destructive("Выйти из клуба","Доступ к закрытым материалам и чату будет потерян.",busy){model.mutate("api/clubs/$id/leave")};else->if(model.userId!=null)Button(onClick={model.mutate("api/clubs/$id/join")},enabled=!busy){Text(if(club.optString("access")=="open")"Вступить" else "Подать заявку")}}
        if(membership=="pending")Destructive("Отозвать заявку","Заявка будет удалена.",busy){model.mutate("api/clubs/$id/leave")}
    }
    data.optJSONObject("transfer")?.let{offer->Panel{Text("Передача владения",style=MaterialTheme.typography.titleMedium);Text("Действует до ${stamp(offer.optLong("expires_at"))}. Прежние приглашения будут отозваны.");if(offer.optString("target_id")==model.userId)Destructive("Принять владение","Ты станешь владельцем и получишь управление клубом. Прежние приглашения будут отозваны.",busy){model.mutate("api/clubs/$id/transfer/accept",body=JSONObject().put("offerId",offer.optString("id")))};Destructive("Отменить передачу","Предложение будет отменено.",busy){model.mutate("api/clubs/$id/transfer/cancel",body=JSONObject().put("offerId",offer.optString("id")))}}}
    NavLinks(listOf("Руководства клуба" to "content/guides/$id","Поиск в клубе" to "content/search/$id"),navigate)
    if(member)NavLinks(listOf("Чат" to "chat/club/$id","Участники" to "content/members/$id","Написать пост" to "content/create/$id","Опрос" to "content/create-poll/$id","Руководство" to "content/create-guide/$id","Черновик" to "content/draft/$id"),navigate)
    if(staff)Link("Журнал действий","content/audit/$id",navigate)
    if(role=="owner")NavLinks(listOf("Настройки" to "content/settings/$id","Приглашения" to "content/invites/$id"),navigate)
    val pins=data.optJSONObject("pinsPage")?.rows("posts").orEmpty();if(pins.isNotEmpty()){Text("Закреплено",style=MaterialTheme.typography.titleLarge);pins.forEach{Link(it.optString("title"),"content/post/${it.optLong("id")}",navigate)}}
    data.optJSONObject("postsPage")?.let{page->Text("Публикации",style=MaterialTheme.typography.titleLarge);if(page.rows("posts").isEmpty())Empty("Публикаций пока нет.");page.rows("posts").forEach{PostCard(it,model,navigate)};More(page,busy){model.more("api/clubs/$id/posts","posts","postsPage")}}
    if(!member&&club.optString("access")!="open")Empty("Материалы доступны после принятия в клуб.")
}

@Composable private fun PostDetail(data:JSONObject,model:ContentViewModel,navigate:(String)->Unit,busy:Boolean){
    val p=data.getJSONObject("post");val id=p.optLong("id");val club=data.getJSONObject("club");val clubId=p.optString("club_id");val member=club.optString("membership")=="member";val staff=club.optString("myRole") in listOf("owner","moderator");val own=p.optString("author_id")==model.userId
    Panel{Text(p.optString("title"),style=MaterialTheme.typography.headlineSmall);Text(p.optString("author_name")+if(p.optBoolean("isBot"))" · Бот" else "");Link("Профиль автора","discovery/player/${p.optString("author_id")}",navigate);Text(stamp(p.optLong("created_at")));p.optJSONObject("guide")?.let{g->Text("${topics.find{it.first==g.optString("topic")}?.second.orEmpty()} · ${g.optString("champion")} · версия ${g.optString("game_version")}");Text(g.optString("summary"))};Text(p.optString("body"));p.nullableString("image_id")?.let{NativeMedia(it,model.mediaClient.api,"Изображение публикации",Modifier.fillMaxWidth())};Link("Открыть клуб","content/club/$clubId",navigate)
        listOf("like" to "Нравится","useful" to "Полезно","fire" to "Огонь").forEach{(kind,label)->val selected=p.optString("myReaction")==kind;TextButton(onClick={model.mutate("api/posts/$id/reaction",if(selected)"DELETE" else "PUT",JSONObject().put("kind",kind))},enabled=member&&!busy){Text("${if(selected)"✓ " else ""}$label · ${p.rows("reactions").find{it.optString("kind")==kind}?.optInt("count")?:0}")}}
        if(model.userId!=null)TextButton(onClick={model.mutate("api/posts/$id/saved",if(p.optBoolean("saved"))"DELETE" else "PUT")},enabled=!busy){Text(if(p.optBoolean("saved"))"Убрать из сохранённого" else "Сохранить")}
        if(own){if(member&&p.optJSONObject("poll")==null)Link("Редактировать","content/edit/$id",navigate);Destructive("Удалить публикацию","Публикация, комментарии и вложение будут удалены без возможности восстановления.",busy){model.mutate("api/posts/$id","DELETE",onSuccess={navigate("content/club/$clubId")})}}
        else if(model.userId!=null)Link("Пожаловаться","moderation/report/post/$id",navigate)
        if(staff){val pinned=data.optJSONObject("pinsPage")?.rows("posts")?.any{it.optLong("id")==id}==true;TextButton(onClick={model.mutate("api/clubs/$clubId/pins/$id",if(pinned)"DELETE" else "PUT")},enabled=!busy){Text(if(pinned)"Снять закрепление" else "Закрепить")};if(!own)Destructive("Удалить как модератор","Публикация и обсуждение будут удалены. Действие попадёт в журнал клуба.",busy){model.mutate("api/clubs/$clubId/posts/$id","DELETE",onSuccess={navigate("content/club/$clubId")})}}
    }
    p.optJSONObject("poll")?.let{poll->Panel{Text(if(poll.optBoolean("closed"))"Опрос завершён" else "До ${stamp(poll.optLong("endsAt"))}");Text("Всего голосов: ${poll.optInt("total")}");poll.rows("options").forEach{o->val chosen=!poll.isNull("myOption")&&poll.optInt("myOption")==o.optInt("option_id");OutlinedButton(onClick={model.mutate("api/posts/$id/poll/vote","PUT",JSONObject().put("optionId",o.optInt("option_id")))},enabled=member&&!busy&&!poll.optBoolean("closed")&&poll.isNull("myOption")){Text("${if(chosen)"✓ " else ""}${o.optString("label")} · ${o.optInt("votes")}")}}}}
    var reply by rememberSaveable(id){mutableStateOf<Long?>(null)};var comment by rememberSaveable(id,model.userId){mutableStateOf("")}
    val comments=data.optJSONObject("commentsPage")
    Text("Обсуждение",style=MaterialTheme.typography.titleLarge)
    if(comments?.rows("comments")?.isEmpty()==true)Empty("Первый комментарий может быть твоим.")
    comments?.rows("comments")?.forEach{c->Panel{Text(c.optString("author_name")+if(c.optInt("isBot")==1)" · Бот" else "");if(!c.isNull("parent_id"))Text("Ответ ${c.optString("parent_author_name")}: ${c.optString("parent_body")}",style=MaterialTheme.typography.bodySmall);Text(c.optString("body"));if(member)TextButton(onClick={reply=if(c.isNull("parent_id"))c.optLong("id") else c.optLong("parent_id")}){Text("Ответить")};if(model.userId!=null&&c.optString("author_id")!=model.userId)Link("Пожаловаться","moderation/report/comment/${c.optLong("id")}",navigate);if(comments.optBoolean("canModerate"))Destructive("Удалить комментарий","Текст будет удалён; ответы останутся без цитаты.",busy){model.mutate("api/clubs/$clubId/comments/${c.optLong("id")}","DELETE")}}}
    More(comments,busy){model.more("api/posts/$id/comments","comments","commentsPage")}
    if(member)Panel{reply?.let{Text("Ответ на комментарий №$it");TextButton(onClick={reply=null}){Text("Отменить ответ")}};Field(comment,"Комментарий · @логин для упоминания",{comment=it},true,!busy);Button(onClick={val body=JSONObject().put("body",comment).put("parentId",reply?:JSONObject.NULL);body.put("clientId",model.attempt("comment:$id",body.toString()));model.mutate("api/posts/$id/comments",body=body,onSuccess={comment="";reply=null})},enabled=!busy&&comment.isNotBlank()&&comment.length<=1000){Text("Отправить")}}
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

@Composable private fun InviteAccept(model:ContentViewModel,navigate:(String)->Unit,busy:Boolean){var token by rememberSaveable(model.userId){mutableStateOf("")};var preview by remember{mutableStateOf<JSONObject?>(null)};Panel{Field(token,"Код приглашения",{token=it;preview=null},true,!busy);Button(onClick={model.mutate("api/club-invites/preview",body=JSONObject().put("token",token.trim()),onSuccess={preview=it})},enabled=!busy&&token.trim().length==64){Text("Проверить приглашение")};preview?.let{p->Text(p.optJSONObject("club")?.optString("name").orEmpty(),style=MaterialTheme.typography.titleLarge);Text("До ${stamp(p.optLong("expiresAt"))}");Button(onClick={model.mutate("api/club-invites/accept",body=JSONObject().put("token",token.trim()),onSuccess={navigate("content/club/${it.optString("clubId")}")})},enabled=!busy){Text("Вступить или подать заявку")}}}}

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
