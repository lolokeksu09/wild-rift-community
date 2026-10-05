package ru.wrcommunity.android.ui

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun CommunityApp(model: GuestViewModel, api: CommunityApi) {
    val state by model.state.collectAsStateWithLifecycle()
    val catalogScroll=rememberLazyListState()
    val clubScroll=rememberSaveable(state.club.data?.club?.id, saver=LazyListState.Saver){ LazyListState() }
    BackHandler(enabled=state.screen>0){ model.back() }
    Scaffold(
        topBar={ TopAppBar(title={ Text(if(state.screen==0)"Клубы" else if(state.screen==1)"Клуб" else "Публикация") },
            navigationIcon={ if(state.screen>0) IconButton(onClick=model::back){
                Icon(Icons.AutoMirrored.Filled.ArrowBack,contentDescription="Назад")
            }},
            actions={ Surface(shape=RoundedCornerShape(16.dp),color=MaterialTheme.colorScheme.surfaceVariant,modifier=Modifier.padding(end=16.dp)){ Row(Modifier.padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Default.PersonOutline,null,Modifier.size(18.dp));Spacer(Modifier.width(6.dp));Text("Гость",style=MaterialTheme.typography.labelLarge)} } }) }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).imePadding()) {
            AnimatedContent(targetState=state.screen,transitionSpec={
                (fadeIn(tween(180))+slideInHorizontally(tween(240)){it/10}) togetherWith
                    (fadeOut(tween(120))+slideOutHorizontally(tween(240)){-it/10})
            },label="Переход экрана") { screen ->
                when(screen) {
                    0 -> CatalogScreen(state,model,catalogScroll,api)
                    1 -> ClubScreen(state.club,model,clubScroll,api)
                    else -> PostScreen(state.post,model,api)
                }
            }
        }
    }
}

@Composable private fun CatalogScreen(state: GuestState, model: GuestViewModel, scroll: LazyListState, api: CommunityApi) {
    val keyboard=LocalSoftwareKeyboardController.current
    LaunchedEffect(state.catalog.busy){ if(state.catalog.busy) scroll.scrollToItem(0) }
    LazyColumn(state=scroll,modifier=Modifier.fillMaxSize().testTag("catalog-list"),contentPadding=PaddingValues(16.dp),
        verticalArrangement=Arrangement.spacedBy(16.dp)) {
        item {
            Text("Найди свою компанию",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("Клубы, разговоры и люди, с которыми хочется играть.",color=MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(value=state.query,onValueChange=model::query,label={Text("Поиск клубов")},
                leadingIcon={Icon(Icons.Default.Search,null)},singleLine=true,
                keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),
                keyboardActions=KeyboardActions(onSearch={keyboard?.hide();model.catalog()}),
                trailingIcon={IconButton(onClick={keyboard?.hide();model.catalog()}){Icon(Icons.AutoMirrored.Filled.ArrowForward, "Найти клубы")}},
                shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth())
        }
        item {
            LazyRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                item { FilterChip(state.tag.isEmpty(),{model.filter(tag="")},label={Text("Все темы")}) }
                items(state.catalog.data?.tags ?: emptyList(),key={it}) { tag ->
                    FilterChip(state.tag==tag,{model.filter(tag=tag)},label={Text(tag)})
                }
            }
            LazyRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                items(listOf("name" to "По названию","new" to "Новые","discussion" to "Обсуждаемые")){ (value,label) ->
                    FilterChip(state.sort==value,{model.filter(sort=value)},label={Text(label)})
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){
                Text(state.catalog.data?.let{"Открытые клубы · ${it.total}"} ?: "Открытые клубы",fontWeight=FontWeight.SemiBold)
                IconButton(onClick={model.catalog()},enabled=!state.catalog.busy){Icon(Icons.Default.Refresh,"Обновить каталог")}
            }
        }
        if(state.catalog.busy) item { Loading() }
        state.catalog.error?.let { failure -> item { ErrorCard(failure){model.catalog(more=state.catalog.data!=null)} } }
        state.catalog.data?.let { catalog ->
            if(catalog.page.items.isEmpty())item {
                Empty("Клубы не найдены","Попробуй другую тему или поисковый запрос.")
                TextButton(onClick={model.query("");model.filter(tag="")}){Text("Сбросить поиск")}
            }
            items(catalog.page.items,key={it.id}) { club -> ClubCard(club,api){ model.openClub(club.id) } }
            if(state.catalog.next!=null)item { More(state.catalog.moreBusy,"Ещё клубы"){model.catalog(more=true)} }
        }
        item { Text("Гостевой просмотр открытых клубов. Вход и переписка появятся в следующих обновлениях.",
            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
@Composable private fun ClubCard(club: Club, api: CommunityApi, open: () -> Unit) {
    Card(onClick=open,shape=RoundedCornerShape(20.dp),modifier=Modifier.fillMaxWidth()){
        Media(club.coverId,api,"Обложка клуба ${club.name}",Modifier.fillMaxWidth().height(148.dp))
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Text(club.name,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold)
            Text(club.description,style=MaterialTheme.typography.bodyMedium,maxLines=3,overflow=TextOverflow.Ellipsis)
            Text(club.tags.joinToString(" · "),color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.labelLarge)
            Text("${club.members} участников"+if(club.bots>0)" · ${club.bots} демо-ботов" else "",
                color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)
            if(club.isDemo) DemoLabel("Демонстрационный клуб")
        }
    }
}
@Composable private fun ClubScreen(load: Load<ClubContent>, model: GuestViewModel, scroll: LazyListState, api: CommunityApi) {
    LazyColumn(state=scroll,modifier=Modifier.fillMaxSize().testTag("club-list"),contentPadding=PaddingValues(16.dp),
        verticalArrangement=Arrangement.spacedBy(16.dp)) {
        if(load.busy)item{Loading()}
        load.error?.let { item{ErrorCard(it){model.loadClub(more=load.data!=null)}} }
        load.data?.let { content ->
            item {
                Card(shape=RoundedCornerShape(24.dp)){
                    Media(content.club.coverId,api,"Обложка клуба",Modifier.fillMaxWidth().height(180.dp))
                    Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                        Text(content.club.name,style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold)
                        Text(content.club.description)
                        Text(content.club.tags.joinToString(" · "),color=MaterialTheme.colorScheme.primary)
                        if(content.club.isDemo)DemoLabel("Демонстрационный клуб")
                        var rules by rememberSaveable(content.club.id){mutableStateOf(false)}
                        TextButton(onClick={rules=!rules}){Text(if(rules)"Скрыть правила" else "Правила клуба")}
                        AnimatedVisibility(rules){Text(content.club.rules,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                    }
                }
            }
            item { Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween){
                Text("Публикации",style=MaterialTheme.typography.titleLarge)
                IconButton(onClick={model.loadClub()}){Icon(Icons.Default.Refresh,"Обновить клуб")}
            }}
            if(content.club.access!="open")item{Empty("Закрытый клуб","Для чтения нужно членство. Вход будет доступен в следующем обновлении.")}
            else if(content.posts.isEmpty())item{Empty("Пока нет публикаций","Здесь появятся обсуждения участников.")}
            items(content.posts,key={it.id}){post->PostCard(post){model.openPost(post.id)}}
            if(load.next!=null)item{More(load.moreBusy,"Ещё публикации"){model.loadClub(more=true)}}
        }
    }
}
@Composable private fun PostCard(post: Post, open: () -> Unit) {
    Card(onClick=open,shape=RoundedCornerShape(20.dp),modifier=Modifier.fillMaxWidth()){
        Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text(post.title,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold)
            Text(post.body,maxLines=3,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${post.author} · ${date(post.createdAt)}",style=MaterialTheme.typography.labelMedium)
            if(post.isBot)DemoLabel("Публикация демо-бота")
            Text("Читать обсуждение",color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.labelLarge)
        }
    }
}
@Composable private fun PostScreen(load: Load<PostContent>, model: GuestViewModel, api: CommunityApi) {
    var photo by rememberSaveable(load.data?.post?.id){mutableStateOf(false)}
    if(photo && load.data?.post?.imageId!=null) Dialog(onDismissRequest={photo=false},
        properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){
            Box(Modifier.fillMaxSize().systemBarsPadding()){
                Media(load.data.post.imageId,api,"Фотография публикации",Modifier.fillMaxSize(),ContentScale.Fit)
                IconButton(onClick={photo=false},modifier=Modifier.align(Alignment.TopEnd).padding(16.dp)){
                    Icon(Icons.Default.Close,"Закрыть фотографию")
                }
            }
        }
    }
    LazyColumn(modifier=Modifier.fillMaxSize().testTag("post-list"),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
        if(load.busy)item{Loading()}
        load.error?.let{item{ErrorCard(it){model.loadPost(more=load.data!=null)}}}
        load.data?.let { content ->
            item {
                Text(content.post.title,style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                Text("${content.post.author} · ${date(content.post.createdAt)}",color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(content.post.isBot){Spacer(Modifier.height(8.dp));DemoLabel("Публикация демо-бота")}
            }
            if(content.post.imageId!=null)item{
                Card(onClick={photo=true},shape=RoundedCornerShape(20.dp)){
                    Media(content.post.imageId,api,"Открыть фотографию",Modifier.fillMaxWidth().height(240.dp))
                }
            }
            item{Text(content.post.body,style=MaterialTheme.typography.bodyLarge)}
            item{HorizontalDivider()}
            item{Text("Обсуждение",style=MaterialTheme.typography.titleLarge)}
            if(content.comments.isEmpty())item{Empty("Пока без ответов","Комментарии участников появятся здесь.")}
            if(load.next!=null)item{More(load.moreBusy,"Предыдущие комментарии"){model.loadPost(more=true)}}
            items(content.comments,key={it.id}){comment->
                Card(shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth()){
                    Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                        Text(comment.author,fontWeight=FontWeight.SemiBold)
                        if(comment.isBot)DemoLabel("Демо-бот")
                        Text(comment.body)
                    }
                }
            }
            item{Text("Сейчас доступно чтение. Возможность отвечать появится после добавления входа.",
                style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
    }
}
@Composable private fun Media(id: String?, api: CommunityApi, description: String, modifier: Modifier,
                             scale: ContentScale=ContentScale.Crop) {
    val bitmap by produceState<ImageBitmap?>(null,id) {
        value=null
        if(id!=null) try {
            val bytes=api.image(id)
            value=withContext(Dispatchers.Default){BitmapFactory.decodeByteArray(bytes,0,bytes.size)?.asImageBitmap()}
        } catch(e: kotlinx.coroutines.CancellationException){throw e} catch(_:Exception){value=null}
    }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant),contentAlignment=Alignment.Center){
        bitmap?.let{Image(it,description,Modifier.fillMaxSize(),contentScale=scale)}
            ?: Icon(Icons.Default.Groups,description,tint=MaterialTheme.colorScheme.primary,modifier=Modifier.size(48.dp))
    }
}
@Composable private fun Loading(){Box(Modifier.fillMaxWidth().padding(32.dp),contentAlignment=Alignment.Center){
    CircularProgressIndicator(Modifier.semantics{contentDescription="Загрузка"})}}
@Composable private fun ErrorCard(failure: Failure, retry: () -> Unit){
    Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surfaceVariant)){
        Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Icon(if(failure.denied)Icons.Default.Lock else Icons.Default.CloudOff,null)
            Text(failure.message,modifier=Modifier.semantics{liveRegion=LiveRegionMode.Polite})
            Button(onClick=retry){Text("Повторить")}
        }
    }
}
@Composable private fun Empty(title: String, text: String){Column(Modifier.fillMaxWidth().padding(vertical=24.dp),
    verticalArrangement=Arrangement.spacedBy(8.dp)){Text(title,style=MaterialTheme.typography.titleMedium);Text(text,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
@Composable private fun More(busy: Boolean, label: String, next: () -> Unit){
    if(busy)Loading() else OutlinedButton(onClick=next,modifier=Modifier.fillMaxWidth()){Text(label)}
}
@Composable private fun DemoLabel(text:String){Text(text,color=MaterialTheme.colorScheme.secondary,style=MaterialTheme.typography.labelMedium)}
private fun date(value:Long)=DateTimeFormatter.ofPattern("d MMM, HH:mm",Locale.forLanguageTag("ru")).withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(value))
