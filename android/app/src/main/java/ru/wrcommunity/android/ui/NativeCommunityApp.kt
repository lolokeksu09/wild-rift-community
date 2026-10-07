package ru.wrcommunity.android.ui

import android.content.Intent
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.wrcommunity.android.BuildConfig
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun NativeCommunityApp(guest:GuestViewModel,account:AccountViewModel,client:FeatureClient,
    content:ContentViewModel,messaging:MessagingViewModel,discovery:DiscoveryViewModel,moderation:ModerationViewModel,
    deepLink:String?=null) {
    val identity by account.state.collectAsStateWithLifecycle()
    val guestState by guest.state.collectAsStateWithLifecycle()
    var appliedBoundary by remember{mutableStateOf<Long?>(null)}
    var welcome by rememberSaveable{mutableStateOf(deepLink==null)}
    var route by rememberSaveable{mutableStateOf(deepLink ?: "catalog")}
    var history by rememberSaveable{mutableStateOf(listOf<String>())}
    var authMode by rememberSaveable{mutableStateOf("login")}
    var tab by rememberSaveable{mutableStateOf("clubs")}
    fun navigate(target:String){if(target==route)return;history=history+route;route=target;account.clearCodes()}
    LaunchedEffect(deepLink){if(deepLink!=null){welcome=false;history=emptyList();route=deepLink}}
    LaunchedEffect(identity.boundary){
        guest.resetForAccountChange(identity.boundary);content.reset();messaging.reset();discovery.reset();moderation.reset()
        if(identity.user==null && identity.boundary>0){history=emptyList();route="profile";tab="profile"}
        appliedBoundary=identity.boundary
    }
    BackHandler(!welcome && (route!="catalog"||guestState.screen==0)){
        if(history.isNotEmpty()){route=history.last();history=history.dropLast(1)}
        else if(route!="catalog"){route="catalog";tab="clubs"} else welcome=true
    }
    val activity=LocalActivity.current
    DisposableEffect(route){
        if(route=="profile"||route.startsWith("chat/")||route.startsWith("moderation/"))activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose{activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)}
    }
    if(appliedBoundary!=identity.boundary){Box(Modifier.fillMaxSize(),contentAlignment=androidx.compose.ui.Alignment.Center){CircularProgressIndicator()};return}
    if(welcome){
        WelcomeScreen(identity.user?.name,onExplore={welcome=false;route="catalog";tab="clubs"},onAccount={mode->
            authMode=mode;welcome=false;route="profile";tab="profile";account.refresh()})
        return
    }
    val context=LocalContext.current
    val publicPath=when {
        route.startsWith("content/club/")->"/clubs/"+route.substringAfterLast('/')
        route.startsWith("content/post/")->"/posts/"+route.substringAfterLast('/')
        route.startsWith("discovery/player/")->"/players/"+route.substringAfterLast('/')
        else->null
    }
    Scaffold(topBar={if(route!="catalog")TopAppBar(title={Text(if(route=="profile")"Профиль" else "Wild Rift Community")},
        navigationIcon={IconButton(onClick={if(history.isNotEmpty()){route=history.last();history=history.dropLast(1)}else{route="catalog";tab="clubs"}}){Icon(Icons.AutoMirrored.Filled.ArrowBack,"Назад")}},
        actions={if(publicPath!=null)IconButton(onClick={val intent=Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,BuildConfig.API_ORIGIN+publicPath);context.startActivity(Intent.createChooser(intent,"Поделиться"))}){Icon(Icons.Default.Share,"Поделиться ссылкой")}
            IconButton(onClick={navigate("discovery/notifications")}){Icon(Icons.Default.NotificationsNone,"Уведомления")}
            IconButton(onClick={navigate("more")}){Icon(Icons.Default.MoreHoriz,"Все разделы")}})},
        bottomBar={NavigationBar{
            val tabs=listOf("home" to "Главная","clubs" to "Клубы","chat" to "Сообщения","profile" to "Профиль")
            tabs.forEach{(key,label)->NavigationBarItem(selected=tab==key,onClick={
                tab=key;history=emptyList();account.clearCodes()
                route=when(key){"home"->"discovery/home";"clubs"->"catalog";"chat"->"chat/inbox";else->"profile"}
                if(key=="profile")account.refresh()
            },icon={Icon(when(key){"home"->Icons.Default.Home;"clubs"->Icons.Default.Groups;"chat"->Icons.Default.ChatBubbleOutline;else->Icons.Default.PersonOutline},null)},label={Text(label)})}
        }}){padding->Column(Modifier.fillMaxSize().padding(padding)){
        if(identity.user==null && route!="profile" && route!="catalog")Row(Modifier.fillMaxWidth().padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween){
            Text("Ты смотришь как гость",Modifier.weight(1f).padding(top=12.dp),style=MaterialTheme.typography.bodySmall)
            TextButton(onClick={navigate("profile")}){Text("Войти")}
        }
        key(identity.boundary){Box(Modifier.fillMaxSize()){
            when {
                route=="catalog"->CommunityApp(guest,client.api,identity.user?.handle,onNavigate=::navigate)
                route=="profile"->AccountScreen(identity,account,authMode,client)
                route=="more"->NativeMenu(identity.user?.moderator==true,::navigate)
                route.startsWith("content/")->ContentSection(content,route,::navigate)
                route.startsWith("chat/")->MessagingSection(messaging,route,::navigate)
                route.startsWith("discovery/")->DiscoverySection(discovery,route,::navigate)
                route.startsWith("moderation/")->ModerationSection(moderation,route,::navigate)
                route=="rules"->NativeRules()
                else->NativeMenu(identity.user?.moderator==true,::navigate)
            }
        }}
    }}
}

@Composable private fun NativeMenu(moderator:Boolean,navigate:(String)->Unit){
    val sections=listOf(
        "Сообщество" to listOf("Лента публикаций" to "content/feed","Все клубы и участие" to "content/clubs","Создать клуб" to "content/create-club","Найти публикацию" to "content/search","Руководства" to "content/guides","Черновики" to "content/drafts","Сохранённое" to "content/saved"),
        "Игра вместе" to listOf("Найти напарника" to "discovery/players","Люди сообщества" to "discovery/members","Команды и объявления" to "discovery/lfg","Игровые вечера" to "discovery/events"),
        "Личное" to listOf("Уведомления" to "discovery/notifications","Знакомства и приватность" to "chat/privacy","Заблокированные" to "chat/blocks","Мои жалобы и обжалования" to "moderation/reports","Правила сообщества" to "rules")
    )
    LazyColumn(modifier=Modifier.testTag("native-menu"),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        item{Text("Все возможности",style=MaterialTheme.typography.headlineMedium)}
        sections.forEach{(title,links)->item{Text(title,style=MaterialTheme.typography.titleLarge)};links.forEach{(label,target)->item{OutlinedButton(onClick={navigate(target)},modifier=Modifier.fillMaxWidth()){Text(label)}}}}
        if(moderator)item{OutlinedButton(onClick={navigate("moderation/queue")},modifier=Modifier.fillMaxWidth()){Text("Очередь модерации")}}
    }
}
@Composable private fun NativeRules(){LazyColumn(contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
    item{Text("Правила сообщества",style=MaterialTheme.typography.headlineMedium)}
    item{Text("За каждым ником — человек. Сохраним место, в которое приятно возвращаться.")}
    item{Text("Уважай свою компанию",style=MaterialTheme.typography.titleLarge)}
    item{Text("Обсуждай действия в игре, а не оскорбляй игроков. Травля, угрозы и дискриминация недопустимы.")}
    item{Text("Делись опытом честно",style=MaterialTheme.typography.titleLarge)}
    item{Text("Не выдавай себя за другого человека или сотрудника Riot. Указывай, когда материал устарел или содержит личное мнение. Ранг и игровые поля заполняются участниками и не проверяются по данным игры.")}
    item{Text("Береги личные данные",style=MaterialTheme.typography.titleLarge)}
    item{Text("Не публикуй чужие контакты, пароли, резервные коды и личную переписку без разрешения. Соблюдай правила своего клуба и избегай спама.")}
    item{Text("Демонстрационные боты",style=MaterialTheme.typography.titleLarge)}
    item{Text("Профили с отметкой «Бот» и их публикации созданы для наполнения ранней версии. Это не живые игроки, они не собирают реальные команды и не ведут личные беседы.")}
    item{Text("Сообщить о нарушении",style=MaterialTheme.typography.titleLarge)}
    item{Text("Используй кнопку жалобы у сообщения, публикации, комментария или в профиле игрока. Своё обращение и результат можно посмотреть в разделе «Жалобы» после входа.")}
}}
