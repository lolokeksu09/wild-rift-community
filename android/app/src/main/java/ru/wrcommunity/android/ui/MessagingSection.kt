package ru.wrcommunity.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.wrcommunity.android.features.MessagingViewModel
import java.text.DateFormat
import java.util.Date

@Composable
fun MessagingSection(model:MessagingViewModel,route:String,onNavigate:(String)->Unit) {
    val s by model.chatState.collectAsStateWithLifecycle()
    val owner=LocalLifecycleOwner.current
    var confirmation by remember(route){mutableStateOf<Pair<String,()->Unit>?>(null)}
    DisposableEffect(route,model.identityKey,owner){model.open(route);val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_START)model.start() else if(event==Lifecycle.Event.ON_STOP)model.stop()};owner.lifecycle.addObserver(observer);if(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))model.start();onDispose{owner.lifecycle.removeObserver(observer);model.stop()}}
    confirmation?.let{(text,action)->AlertDialog(onDismissRequest={confirmation=null},title={Text("Подтверди действие")},text={Text(text)},confirmButton={TextButton(onClick={confirmation=null;action()}){Text("Подтвердить")}},dismissButton={TextButton(onClick={confirmation=null}){Text("Отмена")}}}
    LazyColumn(modifier=Modifier.fillMaxSize(),contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item { Text(when{route=="chat/privacy"->"Приватность сообщений";route=="chat/blocks"->"Блокировки";route.startsWith("chat/club/")->"Чат клуба";route.startsWith("chat/direct/")->"Личная беседа";route.startsWith("chat/new/")->"Новое знакомство";else->"Сообщения"},style=MaterialTheme.typography.headlineSmall)
            TextButton(onClick=model::refresh,enabled=!s.busy){Text("Обновить")}
            if(route!="chat/inbox")TextButton(onClick={onNavigate("chat/inbox")}){Text("К списку бесед")}
            if(s.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
            s.error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
            s.notice?.let{Text(it)}
        }
        when {
            route=="chat/privacy" -> item {
                Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Switch(checked=s.dmRequests,onCheckedChange=model::privacy,enabled=!s.busy);Text("Принимать новые запросы")}
                Text("Настройка не закрывает существующие беседы и запросы. Личные сообщения хранятся на сервере без сквозного шифрования.")
                TextButton(onClick={onNavigate("chat/blocks")}){Text("Управление блокировками")}
            }
            route=="chat/blocks" -> {
                if(!s.busy&&s.blocks.isEmpty())item{Text("Заблокированных игроков нет.")}
                items(s.blocks,key={it.first}){(id,name)->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){TextButton(onClick={onNavigate("discovery/player/$id")}){Text(name)};OutlinedButton(onClick={confirmation="Снять блокировку? Принятая беседа снова станет доступна. Сообщения игрока вернутся в общие чаты." to {model.block(id,true)}},enabled=!s.busy){Text("Разблокировать")}}}}
            }
            route.startsWith("chat/direct/")||route.startsWith("chat/club/") -> {
                if(route.startsWith("chat/club/"))item{TextButton(onClick={onNavigate("content/club/${route.substringAfterLast('/')}")}){Text("Открыть клуб")}}
                if(s.older)item{OutlinedButton(onClick=model::older,enabled=!s.busy){Text("Ранние сообщения")}}
                if(!s.busy&&s.messages.isEmpty()&&!s.denied)item{Text("Сообщений пока нет. Начни разговор.")}
                items(s.messages,key={it.id}){m->Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=if(m.senderId==model.userId)MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainer)){Column(Modifier.padding(12.dp)){
                    TextButton(onClick={onNavigate("discovery/player/${m.senderId}")}){Text(m.sender.ifBlank{"Игрок"})}
                    Text(DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT).format(Date(m.time)),style=MaterialTheme.typography.labelSmall)
                    Text(m.body)
                    if(m.senderId!=model.userId){TextButton(onClick={onNavigate("moderation/report/${if(route.startsWith("chat/direct/"))"direct" else "chat"}/${m.id}")}){Text("Пожаловаться")};TextButton(onClick={confirmation="Блокировать игрока? Личная переписка станет недоступна с обеих сторон; его сообщения скроются в общих чатах. Членство не изменится." to {model.block(m.senderId)}}){Text("Блокировать игрока")}}
                }}}
                if(route.startsWith("chat/direct/")&&s.messages.isNotEmpty())item{OutlinedButton(onClick=model::markRead,enabled=!s.busy&&!s.denied){Text("Отметить загруженное прочитанным")};Text("Отметка включает более ранние сообщения, даже если они не показаны.",style=MaterialTheme.typography.bodySmall)}
                items(s.pending,key={it.clientId}){p->OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(p.body);Text(if(p.busy)"Отправляется…" else p.error?:"Отправка не подтверждена.");TextButton(onClick={model.retry(p.clientId)},enabled=!p.busy&&!s.denied){Text("Повторить")};TextButton(onClick={confirmation="Убрать из очереди? Сообщение могло уже сохраниться на сервере: это действие не удаляет доставленное сообщение." to {model.discard(p.clientId)}},enabled=!p.busy){Text("Убрать из очереди")}}}}
                if(!s.denied)item{OutlinedTextField(value=s.draft,onValueChange=model::draft,label={Text("Сообщение")},supportingText={Text("${s.draft.length}/2000")},modifier=Modifier.fillMaxWidth(),minLines=2);Button(onClick=model::send,enabled=s.draft.isNotBlank()&&s.pending.size<20){Text("Отправить")};Text("Очередь и черновики сохраняются до выхода из аккаунта или закрытия приложения.",style=MaterialTheme.typography.bodySmall)}
            }
            else -> {
                if(route=="chat/inbox")item{Text("Непрочитано: ${s.unread} · Входящих запросов: ${s.requests}");TextButton(onClick={onNavigate("chat/privacy")}){Text("Приватность")};TextButton(onClick={onNavigate("chat/blocks")}){Text("Блокировки")}}
                item{s.budget?.let{b->Text("Новые знакомства: осталось ${b.remaining} из ${b.limit}.${if(b.waitSeconds>0)" Пауза: ${(b.waitSeconds+59)/60} мин." else ""}${if(b.newAccount)" Для нового аккаунта действует меньший лимит." else ""}")}
                    OutlinedTextField(value=s.handle,onValueChange=model::handle,label={Text("Точный логин игрока")},modifier=Modifier.fillMaxWidth(),singleLine=true)
                    OutlinedTextField(value=s.draft,onValueChange=model::draft,label={Text("Первое сообщение")},modifier=Modifier.fillMaxWidth(),supportingText={Text("${s.draft.length}/2000")},minLines=2)
                    Button(onClick=model::request,enabled=!s.busy&&s.handle.length>=3&&s.draft.isNotBlank()){Text("Отправить запрос")}
                    Text("Первый запрос содержит одно сообщение. Переписка откроется после согласия получателя. При потере связи повтор использует тот же идентификатор.",style=MaterialTheme.typography.bodySmall)
                }
                if(route=="chat/inbox"){
                    if(s.conversations.isEmpty()&&!s.busy)item{Text("Бесед пока нет.")}
                    items(s.conversations,key={it.id}){c->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){
                        TextButton(onClick={onNavigate("discovery/player/${c.peerId}")}){Text("${c.peer} · @${c.handle}")}
                        Text(when(c.status){"accepted"->"Принята · новых: ${c.unread}";"rejected"->"Запрос отклонён. Повторное знакомство недоступно.";else->if(c.requester==model.userId)"Запрос отправлен" else "Входящий запрос"})
                        if(c.status=="accepted")Button(onClick={onNavigate("chat/direct/${c.id}")}){Text("Открыть беседу")}else{Text(c.firstBody);if(c.status=="pending"&&c.requester!=model.userId){Button(onClick={model.decide(c.id,true)},enabled=!s.busy){Text("Принять")};OutlinedButton(onClick={confirmation="Отклонить запрос? Решение окончательно: новое знакомство между этими аккаунтами невозможно." to {model.decide(c.id,false)}},enabled=!s.busy){Text("Отклонить")}}
                        if(c.requester!=model.userId&&c.firstId>0)TextButton(onClick={onNavigate("moderation/report/direct/${c.firstId}")}){Text("Пожаловаться на запрос")}}
                        TextButton(onClick={confirmation="Блокировать игрока? Беседа скроется, чтение и отправка станут недоступны обоим участникам. Сообщения не удаляются." to {model.block(c.peerId)}},enabled=!s.busy){Text("Блокировать")}
                    }}}
                    if(s.next!=null)item{OutlinedButton(onClick=model::moreInbox,enabled=!s.busy){Text("Ещё беседы")}}
                }
            }
        }
    }
}
