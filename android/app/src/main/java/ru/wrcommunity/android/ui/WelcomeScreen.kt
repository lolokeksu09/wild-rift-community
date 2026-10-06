package ru.wrcommunity.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.wrcommunity.android.R

private data class IntroCover(val artwork:Int,val title:String,val body:String)
private val introCovers=listOf(
    IntroCover(R.drawable.intro_community,"Твой Рифт.\nТвои люди.","Независимое сообщество Wild Rift. Знакомься с игроками, находи клубы и делись опытом."),
    IntroCover(R.drawable.intro_players,"Есть с кем\nразделить игру.","Обсуждай чемпионов, любимые роли и следующий матч с людьми, которым близка твоя игра."),
    IntroCover(R.drawable.intro_clubs,"Найди\nсвой круг.","Выбирай клубы по интересам. Читай истории, смотри фотографии и знакомься с сообществом."),
    IntroCover(R.drawable.intro_profile,"Здесь начинается\nтвоя история.","Создай профиль и расскажи о себе. Открытые клубы можно посмотреть и без регистрации.")
)

@Composable internal fun WelcomeScreen(name:String?,onExplore:()->Unit,onAccount:(String)->Unit) {
    val pager=rememberPagerState(pageCount={introCovers.size})
    val scope=rememberCoroutineScope()
    val density=LocalDensity.current
    var footerHeightPx by remember { mutableIntStateOf(0) }
    val footerHeight=if(footerHeightPx==0)216.dp else with(density){footerHeightPx.toDp()}
    val white=Color(0xfff8f8f3)
    val scrim=remember { Brush.verticalGradient(
        0f to Color.Black.copy(alpha=.5f),
        .18f to Color.Transparent,
        .4f to Color.Transparent,
        .62f to Color(0xff060a10).copy(alpha=.55f),
        .82f to Color(0xff060a10).copy(alpha=.93f),
        1f to Color(0xff060a10)) }
    Box(Modifier.fillMaxSize().background(Color(0xff060a10)).testTag("welcome-fullscreen")) {
        HorizontalPager(state=pager,modifier=Modifier.fillMaxSize().testTag("welcome-pager")
            .semantics { stateDescription="Карточка ${pager.currentPage+1} из ${introCovers.size}" }) { index ->
            val cover=introCovers[index]
            Box(Modifier.fillMaxSize()) {
                Image(painterResource(cover.artwork),contentDescription=null,contentScale=ContentScale.Crop,
                    modifier=Modifier.fillMaxSize().testTag("welcome-cover-$index"))
                Box(Modifier.matchParentSize().background(scrim))
                Column(Modifier.fillMaxSize().padding(horizontal=28.dp)
                    .padding(top=100.dp,bottom=footerHeight+18.dp),verticalArrangement=Arrangement.Bottom) {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        Text(cover.title,color=white,fontSize=46.sp,lineHeight=48.sp,letterSpacing=(-1.2).sp,
                            fontWeight=FontWeight.Black,modifier=Modifier.semantics { heading() })
                        Spacer(Modifier.height(16.dp))
                        Text(cover.body,color=white.copy(alpha=.84f),fontSize=16.sp,lineHeight=23.sp)
                    }
                }
            }
        }
        Column(Modifier.align(Alignment.TopStart).statusBarsPadding().padding(start=28.dp,top=14.dp)) {
            Text("Wild Rift",color=white,fontSize=17.sp,fontWeight=FontWeight.Bold,letterSpacing=(-.3).sp)
            Text("Community",color=white.copy(alpha=.75f),fontSize=12.sp,letterSpacing=.6.sp)
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().onSizeChanged { footerHeightPx=it.height }
            .navigationBarsPadding().padding(horizontal=24.dp).padding(bottom=12.dp),
            horizontalAlignment=Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                IconButton(onClick={scope.launch { pager.animateScrollToPage(pager.currentPage-1) }},enabled=pager.currentPage>0,
                    modifier=Modifier.testTag("welcome-previous")) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack,"Предыдущая обложка",tint=white.copy(alpha=if(pager.currentPage>0).85f else .3f))
                }
                Row(Modifier.weight(1f),horizontalArrangement=Arrangement.Center) {
                    repeat(introCovers.size) { index ->
                        IconButton(onClick={scope.launch { pager.animateScrollToPage(index) }},modifier=Modifier.size(48.dp)
                            .testTag("welcome-step-$index").semantics { selected=pager.currentPage==index;contentDescription="Карточка ${index+1} из ${introCovers.size}" }) {
                            Box(Modifier.size(if(pager.currentPage==index)22.dp else 5.dp,5.dp)
                                .background(white.copy(alpha=if(pager.currentPage==index)1f else .35f),RoundedCornerShape(3.dp)))
                        }
                    }
                }
                IconButton(onClick={scope.launch { pager.animateScrollToPage(pager.currentPage+1) }},enabled=pager.currentPage<introCovers.lastIndex,
                    modifier=Modifier.testTag("welcome-next")) {
                    Icon(Icons.AutoMirrored.Filled.ArrowForward,"Следующая обложка",tint=white.copy(alpha=if(pager.currentPage<introCovers.lastIndex).85f else .3f))
                }
            }
            Spacer(Modifier.height(8.dp))
            if(name!=null) {
                Text("С возвращением, $name",color=white.copy(alpha=.85f),style=MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(12.dp))
            }
            Button(onClick=onExplore,shape=RoundedCornerShape(14.dp),colors=ButtonDefaults.buttonColors(containerColor=white,contentColor=Color(0xff10141b)),
                modifier=Modifier.fillMaxWidth().heightIn(min=54.dp).testTag("welcome-explore"),contentPadding=PaddingValues(horizontal=20.dp,vertical=14.dp)) {
                Text(if(name==null)"Посмотреть клубы" else "Продолжить",fontWeight=FontWeight.Bold,fontSize=16.sp)
            }
            if(name==null) {
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.Center) {
                    TextButton(onClick={onAccount("login")},modifier=Modifier.weight(1f).heightIn(min=48.dp).testTag("welcome-login")) {
                        Text("Войти",color=white,fontSize=14.sp)
                    }
                    TextButton(onClick={onAccount("register")},modifier=Modifier.weight(1f).heightIn(min=48.dp).testTag("welcome-register")) {
                        Text("Создать аккаунт",color=white,fontSize=14.sp)
                    }
                }
            }
        }
    }
}
