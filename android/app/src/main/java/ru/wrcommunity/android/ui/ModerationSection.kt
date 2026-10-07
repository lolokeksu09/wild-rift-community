package ru.wrcommunity.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONObject
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.ModerationViewModel

@Composable fun ModerationSection(model: ModerationViewModel, route: String, onNavigate: (String)->Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    val create = route.startsWith("moderation/report/")
    LaunchedEffect(route, model.userId) { if(create) model.prepareCreate() else model.open(route) }
    val data = state.data
    var filter by rememberSaveable(route,model.userId) { mutableStateOf("all") }
    val queue = data?.optBoolean("queue") == true
    val reports = data?.rows("reports").orEmpty().filter { when(filter) { "pending" -> it.optString("status") == "pending"; "appeal" -> it.optString("appeal_status") == "pending"; "done" -> it.optString("status") != "pending"; else -> true } }
    LazyColumn(Modifier.fillMaxSize().imePadding(), contentPadding=PaddingValues(16.dp), verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item {
            Text(if(create) "Сообщить о нарушении" else if(queue) "Очередь модерации" else "Мои обращения",style=MaterialTheme.typography.headlineMedium)
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                TextButton(onClick={onNavigate("moderation/reports")}) { Text("Мои обращения") }
                if(data?.optBoolean("isModerator") == true) TextButton(onClick={onNavigate("moderation/queue")}) { Text("Очередь") }
            }
            if(!create) {
                Text("Новых решений: ${data?.optInt("unread") ?: 0}",style=MaterialTheme.typography.bodyMedium)
                TextButton(enabled=!state.busy,onClick={model.open(route)}) { Text("Обновить") }
            }
            if(state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.error?.let { Text(it,color=MaterialTheme.colorScheme.error) }
            state.notice?.let { Text(it,color=MaterialTheme.colorScheme.primary) }
        }
        if(create) item {
            val parts=route.split('/')
            val kind=parts.getOrNull(2).orEmpty(); val target=parts.getOrNull(3).orEmpty()
            var reason by rememberSaveable(route,model.userId) { mutableStateOf("") }
            Text(ModerationRepository.kinds[kind] ?: "Неизвестный объект")
            Text("Модератор получит снимок содержимого и твоё пояснение. Жалобу на свой материал отправить нельзя. Повторная отправка на тот же объект вернёт существующее обращение.")
            ReasonField(reason,{reason=it},"Причина жалобы")
            Button(enabled=!state.busy && kind in ModerationRepository.kinds && ModerationRepository.reasonValid(reason),onClick={model.create(kind,target,reason,onNavigate)}) { Text("Отправить жалобу") }
        }
        if(queue) item {
            Text("Фильтр по загруженным обращениям. Для более ранних записей загрузи следующую страницу.",style=MaterialTheme.typography.bodySmall)
            Column {
                listOf("all" to "Все", "pending" to "Ожидают решения", "appeal" to "Ожидают пересмотра", "done" to "Первое решение принято").forEach { (value,label) ->
                    FilterChip(selected=filter==value,onClick={filter=value},label={Text(label)})
                }
            }
        }
        if(!create && !state.busy && state.error == null && reports.isEmpty()) item { Text(if(route.startsWith("moderation/item/")) "Обращение недоступно в твоих списках." else "Обращений в этом списке нет.") }
        items(reports,key={it.optString("id")}) { report -> ReportCard(report,queue,model,state.busy,onNavigate) }
        if(!create && data?.nullableString("next") != null) item {
            OutlinedButton(enabled=!state.busy,onClick={model.open(route,more=true)}) { Text("Загрузить более ранние обращения") }
        }
    }
}

@Composable private fun ReasonField(value: String, change: (String)->Unit, label: String) {
    OutlinedTextField(value=value,onValueChange={if(it.length<=1000)change(it)},label={Text(label)},supportingText={Text("${value.trim().length}/1000 · минимум 3 символа")},minLines=3,modifier=Modifier.fillMaxWidth())
}

@Composable private fun ReportCard(r: JSONObject, queue: Boolean, model: ModerationViewModel, busy: Boolean, navigate: (String)->Unit) {
    val id=r.optString("id"); val status=r.optString("status"); val appeal=r.nullableString("appeal_status")
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text("№$id · ${ModerationRepository.status(status)}",style=MaterialTheme.typography.titleMedium)
            Text(ModerationRepository.kinds[r.optString("kind")] ?: "Материал")
            TextButton(onClick={navigate("moderation/item/$id")}) { Text("Открыть обращение №$id") }
            if(queue) {
                r.optJSONObject("senderSanction")?.let { sanction ->
                    val name=when(sanction.optString("level")) { "warning" -> "Предупреждение"; "restricted" -> "Ограничение"; "suspended" -> "Приостановка"; else -> "Санкция" }
                    val until=if(sanction.isNull("until")) "" else " до ${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(sanction.optLong("until")))}"
                    Text("Автор: $name$until · нарушений за 30 дней: ${sanction.optInt("violations")}")
                } ?: Text("Автор: действующих санкций нет")
                Text("Снимок материала",style=MaterialTheme.typography.titleSmall)
                SelectionContainer { Text(ModerationRepository.snapshot(r)) }
            }
            SelectionContainer { Text("Причина: ${r.optString("reason")}") }
            r.nullableString("decision_note")?.let { Text("Первое решение: $it") }
            ModerationRepository.contentRoute(r)?.let { destination -> TextButton(onClick={navigate(destination)}) { Text("Открыть актуальный материал") } }
            if(queue && status=="pending") {
                if(ModerationRepository.independent(r,model.userId)) DecisionForm(id,"decision",model,busy)
                else Text("Требуется независимый модератор: заявитель и автор материала не могут принять решение.")
            }
            if(!queue && status!="pending" && r.optInt("decision_seen")==0) {
                OutlinedButton(enabled=!busy,onClick={model.submit(id,"read","")}) { Text("Первое решение · отметить прочитанным") }
            }
            r.nullableString("applied_action")?.let { action -> Text("Выполнено: ${ModerationRepository.actionLabel(action)}. ${r.optString("action_note")}") }
            if(queue) ModerationRepository.actionAvailable(r,model.userId)?.let { action -> ActionForm(id,action,model,busy) }
            if(r.optString("kind")=="direct" && queue) Text("Модератор не удаляет личную переписку. Снимок и решения сохраняются; санкции вычисляет сервер.")
            if(appeal != null) {
                Text("Пересмотр: ${ModerationRepository.status(appeal)}",style=MaterialTheme.typography.titleSmall)
                Text(r.optString("appeal_reason")); r.nullableString("appeal_note")?.let { Text(it) }
                if(appeal=="pending") {
                    if(queue && ModerationRepository.independent(r,model.userId,true)) DecisionForm(id,"appeal-decision",model,busy)
                    else Text("Ожидается другой независимый модератор. Первоначальный модератор не может завершить пересмотр.")
                } else if(!queue && r.optInt("appeal_seen")==0) OutlinedButton(enabled=!busy,onClick={model.submit(id,"appeal/read","")}) { Text("Пересмотр · отметить прочитанным") }
            } else if(!queue && status!="pending") {
                var reason by rememberSaveable(id,model.userId) { mutableStateOf("") }
                Text("Можно подать одну апелляцию. После отправки её текст нельзя изменить. Результат — новый итог по жалобе.")
                ReasonField(reason,{reason=it},"Обоснование пересмотра")
                Button(enabled=!busy && ModerationRepository.reasonValid(reason),onClick={model.submit(id,"appeal",reason)}) { Text("Подать апелляцию") }
            }
        }
    }
}

@Composable private fun DecisionForm(id: String, stage: String, model: ModerationViewModel, busy: Boolean) {
    var note by rememberSaveable(id,stage,model.userId) { mutableStateOf("") }
    var decision by rememberSaveable(id,stage,model.userId) { mutableStateOf("upheld") }
    var confirm by remember { mutableStateOf(false) }
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(if(stage=="appeal-decision") "Итог пересмотра по жалобе" else "Первое решение")
        listOf("upheld","dismissed").forEach { value -> FilterChip(selected=decision==value,onClick={decision=value},label={Text(ModerationRepository.status(value))}) }
        ReasonField(note,{note=it},"Объяснение для заявителя")
        Button(enabled=!busy && ModerationRepository.reasonValid(note),onClick={confirm=true}) { Text(if(stage=="appeal-decision") "Завершить пересмотр" else "Сохранить решение") }
    }
    if(confirm) AlertDialog(onDismissRequest={confirm=false},title={Text("Подтвердить решение?")},text={Text("${ModerationRepository.status(decision)}\n\n$note\n\nРешение учитывается при расчёте санкций. Удаление материала выполняется отдельным действием.")},confirmButton={TextButton(enabled=!busy,onClick={confirm=false;model.submit(id,stage,note,decision)}) { Text("Подтвердить") }},dismissButton={TextButton(onClick={confirm=false}) { Text("Вернуться") }})
}

@Composable private fun ActionForm(id: String, action: String, model: ModerationViewModel, busy: Boolean) {
    var note by rememberSaveable(id,action,model.userId) { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    Text("Отдельное действие после окончательного решения. Если материал изменился, сервер отклонит действие.")
    ReasonField(note,{note=it},"Объяснение действия")
    OutlinedButton(enabled=!busy && ModerationRepository.reasonValid(note),onClick={confirm=true}) { Text(ModerationRepository.actionLabel(action)) }
    if(confirm) AlertDialog(onDismissRequest={confirm=false},title={Text(ModerationRepository.actionLabel(action))},text={Column { Text(ModerationRepository.impact(action)); Text("\nОбъяснение: $note") }},confirmButton={TextButton(enabled=!busy,onClick={confirm=false;model.submit(id,"action",note,action=action)}) { Text("Применить действие") }},dismissButton={TextButton(onClick={confirm=false}) { Text("Отмена") }})
}
