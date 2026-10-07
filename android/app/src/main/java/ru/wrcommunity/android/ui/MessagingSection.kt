package ru.wrcommunity.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.wrcommunity.android.features.MessagingState
import ru.wrcommunity.android.features.MessagingViewModel
import ru.wrcommunity.android.data.ChatMessage
import ru.wrcommunity.android.data.Conversation
import ru.wrcommunity.android.data.MessagingContract
import java.text.DateFormat
import java.util.Date

@Composable
fun MessagingSection(model:MessagingViewModel,route:String,onNavigate:(String)->Unit) {
    val s by model.chatState.collectAsStateWithLifecycle()
    val owner=LocalLifecycleOwner.current
    var confirmation by remember(route,model.identityKey){mutableStateOf<Pair<String,()->Unit>?>(null)}
    var newMessage by remember(route,model.identityKey){mutableStateOf(false)}
    val confirm:(String,()->Unit)->Unit={text,action->confirmation=text to action}
    DisposableEffect(route,model.identityKey,owner){model.open(route);val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_START)model.start() else if(event==Lifecycle.Event.ON_STOP)model.stop()};owner.lifecycle.addObserver(observer);if(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))model.start();onDispose{owner.lifecycle.removeObserver(observer);model.stop()}}
    LaunchedEffect(s.notice){if(s.notice?.startsWith("Запрос отправлен.")==true)newMessage=false}
    confirmation?.let { (text, action) ->
        AlertDialog(onDismissRequest={confirmation=null},title={Text("Подтверди действие")},text={Text(text)},
            confirmButton={TextButton(onClick={confirmation=null;action()}){Text("Подтвердить")}},
            dismissButton={TextButton(onClick={confirmation=null}){Text("Отмена")}})
    }
    if(newMessage)Dialog(onDismissRequest={newMessage=false}) {
        Surface(shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surfaceContainerHigh) {
            Column(Modifier.padding(20.dp).imePadding().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                SectionHeading("Новое знакомство")
                FirstMessageForm(s,model)
                TextButton(onClick={newMessage=false}){Text("Закрыть")}
            }
        }
    }
    val room=route.startsWith("chat/direct/")||route.startsWith("chat/club/")
    if(room) {
        ChatRoom(s,model,route,onNavigate,confirm)
        return
    }
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item {
            SectionHeading(when(route){"chat/privacy"->"Приватность сообщений";"chat/blocks"->"Блокировки";else->if(route.startsWith("chat/new/"))"Новое знакомство" else "Сообщения"},action="Обновить",onAction=model::refresh)
            if(route!="chat/inbox")TextButton(onClick={onNavigate("chat/inbox")}){Text("К списку бесед")}
            MessageFeedback(s)
        }
        when {
            route=="chat/privacy"->item {
                RiftCard {
                    Row(verticalAlignment=Alignment.CenterVertically){Switch(checked=s.dmRequests,onCheckedChange=model::privacy,enabled=!s.busy);Text("Принимать новые запросы",Modifier.weight(1f))}
                    Text("Настройка не закрывает существующие беседы и запросы. Личные сообщения хранятся на сервере без сквозного шифрования.",style=MaterialTheme.typography.bodySmall)
                    TextButton(onClick={onNavigate("chat/blocks")}){Text("Управление блокировками")}
                }
            }
            route=="chat/blocks"->{
                if(!s.busy&&s.blocks.isEmpty())item{Text("Заблокированных игроков нет.")}
                items(s.blocks,key={it.first}){(id,name)->RiftCard {
                    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
                        RiftAvatar(name,null,model.mediaClient.api)
                        TextButton(onClick={onNavigate("discovery/player/$id")},modifier=Modifier.weight(1f)){Text(name)}
                    }
                    OutlinedButton(onClick={confirm("Снять блокировку? Принятая беседа снова станет доступна. Сообщения игрока вернутся в общие чаты."){model.block(id,true)}},enabled=!s.busy){Text("Разблокировать")}
                }}
            }
            route.startsWith("chat/new/")->item{RiftCard{FirstMessageForm(s,model)}}
            else->{
                item {
                    Text("Непрочитано: ${s.unread} · Запросов: ${s.requests}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) {
                        Button(onClick={newMessage=true},enabled=s.accessValidated&&!s.denied){Text("Новое сообщение")}
                        TextButton(onClick={onNavigate("chat/privacy")}){Text("Настройки")}
                    }
                }
                if(s.conversations.isEmpty()&&!s.busy)item{RiftCard{Text("Бесед пока нет",style=MaterialTheme.typography.titleMedium);Text("Найди игрока и отправь первое сообщение. После согласия вы сможете переписываться.")}}
                items(s.conversations,key={it.id}){c->ConversationRow(c,s,model,onNavigate,confirm)}
                if(s.next!=null)item{OutlinedButton(onClick=model::moreInbox,enabled=!s.busy){Text("Ещё беседы")}}
            }
        }
    }
}

@Composable
private fun MessageFeedback(s:MessagingState) {
    if(s.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
    s.error?.let{Text(it,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
    s.notice?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
}

@Composable
private fun ChatRoom(s:MessagingState,model:MessagingViewModel,route:String,onNavigate:(String)->Unit,confirm:(String,()->Unit)->Unit) {
    val history=rememberLazyListState()
    var initiallyScrolled by remember(route,model.identityKey){mutableStateOf(false)}
    LaunchedEffect(route,s.messages.lastOrNull()?.id,s.pending.size) {
        val count=history.layoutInfo.totalItemsCount
        val nearEnd=(history.layoutInfo.visibleItemsInfo.lastOrNull()?.index?:0)>=count-3
        if(s.accessValidated&&(!initiallyScrolled||nearEnd)) {
            val last=(if(s.older)1 else 0)+s.messages.size+s.pending.size-1
            if(last>=0)history.scrollToItem(last)
            initiallyScrolled=true
        }
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=8.dp)) {
            SectionHeading(if(route.startsWith("chat/club/"))"Чат клуба" else "Личная беседа",action="Обновить",onAction=model::refresh)
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically) {
                TextButton(onClick={onNavigate("chat/inbox")}){Text("Все беседы")}
                if(route.startsWith("chat/direct/")&&s.messages.isNotEmpty())TextButton(onClick=model::markRead,enabled=!s.busy&&!s.denied){Text("Прочитано")}
            }
            MessageFeedback(s)
        }
        if(route.startsWith("chat/club/")) {
            val club=route.substringAfterLast('/')
            TabRow(selectedTabIndex=1) {
                Tab(selected=false,onClick={onNavigate("content/club/$club")},text={Text("Публикации")})
                Tab(selected=true,onClick={},text={Text("Чат")})
                Tab(selected=false,onClick={onNavigate("content/members/$club")},text={Text("Участники")})
            }
        }
        HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
        LazyColumn(state=history,modifier=Modifier.weight(1f).fillMaxWidth(),contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            if(s.older)item(key="older"){OutlinedButton(onClick=model::older,enabled=!s.busy,modifier=Modifier.fillMaxWidth()){Text("Ранние сообщения")}}
            if(!s.busy&&s.messages.isEmpty()&&s.pending.isEmpty()&&!s.denied)item(key="empty"){Text(if(s.accessValidated)"Сообщений пока нет. Начни разговор." else "Подключись к серверу, чтобы открыть беседу.",color=MaterialTheme.colorScheme.onSurfaceVariant)}
            items(s.messages,key={"message/${it.id}"}){m->MessageBubble(m,model,route,onNavigate,confirm)}
            items(s.pending,key={"pending/${it.clientId}"}){p->
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {
                    OutlinedCard(Modifier.widthIn(max=320.dp),shape=RoundedCornerShape(18.dp,18.dp,4.dp,18.dp)) {
                        Column(Modifier.padding(12.dp)) {
                            Text(p.body)
                            Text(if(p.busy)"Отправляется…" else p.error?:"Отправка не подтверждена.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement=Arrangement.spacedBy(4.dp)) {
                                TextButton(onClick={model.retry(p.clientId)},enabled=!p.busy&&!s.denied&&s.accessValidated){Text("Повторить")}
                                TextButton(onClick={confirm("Убрать из очереди? Сообщение могло уже сохраниться на сервере: это действие не удаляет доставленное сообщение."){model.discard(p.clientId)}},enabled=!p.busy){Text("Убрать")}
                            }
                        }
                    }
                }
            }
        }
        if(!s.denied)Surface(color=MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.fillMaxWidth().imePadding().padding(horizontal=12.dp,vertical=8.dp),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.Bottom) {
                OutlinedTextField(value=s.draft,onValueChange=model::draft,label={Text("Сообщение")},modifier=Modifier.weight(1f),maxLines=4,enabled=s.accessValidated,
                    supportingText={Text(if(s.pending.size>=20)"Очередь заполнена: повтори или убери сообщения" else "${s.draft.length}/2000")})
                IconButton(onClick=model::send,enabled=s.accessValidated&&s.draft.isNotBlank()&&s.pending.size<20,modifier=Modifier.size(48.dp)) {
                    Icon(Icons.AutoMirrored.Filled.Send,contentDescription="Отправить сообщение",tint=if(s.accessValidated&&s.draft.isNotBlank())MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(m:ChatMessage,model:MessagingViewModel,route:String,onNavigate:(String)->Unit,confirm:(String,()->Unit)->Unit) {
    val own=m.senderId==model.userId
    var menu by remember(m.id){mutableStateOf(false)}
    Row(Modifier.fillMaxWidth(),horizontalArrangement=if(own)Arrangement.End else Arrangement.Start,verticalAlignment=Alignment.Top) {
        if(!own){RiftAvatar(m.sender,null,model.mediaClient.api,size=32.dp);Spacer(Modifier.width(8.dp))}
        Surface(Modifier.widthIn(max=300.dp),shape=if(own)RoundedCornerShape(18.dp,18.dp,4.dp,18.dp) else RoundedCornerShape(4.dp,18.dp,18.dp,18.dp),
            color=if(own)MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh) {
            Column(Modifier.padding(start=12.dp,end=8.dp,top=4.dp,bottom=10.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Text(if(own)"Ты" else m.sender.ifBlank{"Игрок"},Modifier.weight(1f),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary)
                    Box {
                        IconButton(onClick={menu=true},modifier=Modifier.size(48.dp)){Icon(Icons.Default.MoreVert,contentDescription="Действия с сообщением")}
                        DropdownMenu(expanded=menu,onDismissRequest={menu=false}) {
                            DropdownMenuItem(text={Text("Профиль")},onClick={menu=false;onNavigate("discovery/player/${m.senderId}")})
                            if(!own){
                                DropdownMenuItem(text={Text("Пожаловаться")},onClick={menu=false;onNavigate(MessagingContract.reportRoute(route,m.id))})
                                DropdownMenuItem(text={Text("Блокировать")},onClick={menu=false;confirm("Блокировать игрока? Личная переписка станет недоступна с обеих сторон; его сообщения скроются в общих чатах. Членство не изменится."){model.block(m.senderId)}})
                            }
                        }
                    }
                }
                Text(m.body,style=MaterialTheme.typography.bodyMedium)
                Text(DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT).format(Date(m.time)),Modifier.align(Alignment.End).padding(top=4.dp),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun FirstMessageForm(s:MessagingState,model:MessagingViewModel) {
    s.budget?.let{b->Text("Осталось новых знакомств: ${b.remaining} из ${b.limit}.${if(b.waitSeconds>0)" Пауза: ${(b.waitSeconds+59)/60} мин." else ""}${if(b.newAccount)" Для нового аккаунта действует меньший лимит." else ""}",style=MaterialTheme.typography.bodySmall)}
    OutlinedTextField(value=s.handle,onValueChange=model::handle,label={Text("Точный логин игрока")},modifier=Modifier.fillMaxWidth(),singleLine=true,enabled=s.accessValidated)
    OutlinedTextField(value=s.draft,onValueChange=model::draft,label={Text("Первое сообщение")},modifier=Modifier.fillMaxWidth(),supportingText={Text("${s.draft.length}/2000")},minLines=3,maxLines=6,enabled=s.accessValidated)
    Button(onClick=model::request,enabled=s.accessValidated&&!s.busy&&s.handle.length>=3&&s.draft.isNotBlank(),modifier=Modifier.fillMaxWidth()){Text("Отправить запрос")}
    Text("Переписка откроется после согласия получателя. Черновик сохраняется на этом устройстве; при потере связи повтор не создаёт второй запрос.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    if(s.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
    s.error?.let{Text(it,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
}

@Composable
private fun ConversationRow(c:Conversation,s:MessagingState,model:MessagingViewModel,onNavigate:(String)->Unit,confirm:(String,()->Unit)->Unit) {
    var menu by remember(c.id){mutableStateOf(false)}
    RiftCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            RiftAvatar(c.peer,null,model.mediaClient.api,size=48.dp)
            Column(Modifier.weight(1f)) {
                Text(c.peer.ifBlank{"Игрок"},style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=TextOverflow.Ellipsis)
                Text("@${c.handle}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text(when(c.status){"accepted"->if(c.unread>0)"Новых сообщений: ${c.unread}" else "Беседа открыта";"rejected"->"Запрос отклонён";else->if(c.requester==model.userId)"Ожидает ответа" else "Входящий запрос"},style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary)
            }
            Box {
                IconButton(onClick={menu=true}){Icon(Icons.Default.MoreVert,contentDescription="Действия с беседой")}
                DropdownMenu(expanded=menu,onDismissRequest={menu=false}) {
                    DropdownMenuItem(text={Text("Профиль")},onClick={menu=false;onNavigate("discovery/player/${c.peerId}")})
                    if(c.requester!=model.userId&&c.firstId>0)DropdownMenuItem(text={Text("Пожаловаться на запрос")},onClick={menu=false;onNavigate("moderation/report/direct/${c.firstId}")})
                    DropdownMenuItem(text={Text("Блокировать")},enabled=!s.busy,onClick={menu=false;confirm("Блокировать игрока? Беседа скроется, чтение и отправка станут недоступны обоим участникам. Сообщения не удаляются."){model.block(c.peerId)}})
                }
            }
        }
        if(c.status=="accepted")TextButton(onClick={onNavigate("chat/direct/${c.id}")}){Text("Открыть беседу")}
        else {
            Text(c.firstBody,maxLines=3,overflow=TextOverflow.Ellipsis)
            if(c.status=="pending"&&c.requester!=model.userId)Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Button(onClick={model.decide(c.id,true)},enabled=!s.busy){Text("Принять")}
                OutlinedButton(onClick={confirm("Отклонить запрос? Решение окончательно: новое знакомство между этими аккаунтами невозможно."){model.decide(c.id,false)}},enabled=!s.busy){Text("Отклонить")}
            }
            if(c.status=="rejected")Text("Повторное знакомство недоступно.",style=MaterialTheme.typography.bodySmall)
        }
    }
}
