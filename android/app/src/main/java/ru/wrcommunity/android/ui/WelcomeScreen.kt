package ru.wrcommunity.android.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private data class IntroCard(val label:String,val title:String,val accentTitle:String,val body:String,val accent:Color)
private val introCards=listOf(
    IntroCard("СООБЩЕСТВО WILD RIFT","Твой Рифт.","Твои люди.","Независимое сообщество игроков Wild Rift. Находи клубы, знакомься с игроками и делись опытом — всё в одном месте.",Color(0xffe2c38c)),
    IntroCard("ИГРА ВМЕСТЕ","Одна игра.","Общие интересы.","Познакомься с игроками в клубах. Обсуди любимые роли, чемпионов и планы на следующий матч.",Color(0xff9ac9bd)),
    IntroCard("КЛУБЫ ПО ИНТЕРЕСАМ","Найди", "свой круг.","Выбирай клубы по темам. Читай публикации, смотри фотографии и обсуждения — знакомство начинается с общего интереса.",Color(0xffbcaed3)),
    IntroCard("НАЧНИ ЗНАКОМСТВО","Твой ник.","Твоя история.","Создай аккаунт и расскажи о себе в профиле. Или сначала загляни в открытые клубы — их можно читать без регистрации.",Color(0xffe2c38c))
)

@Composable internal fun WelcomeScreen(name:String?,onExplore:()->Unit,onAccount:(String)->Unit) {
    val pager=rememberPagerState(pageCount={introCards.size})
    val scope=rememberCoroutineScope()
    val ink=Color(0xfff4f1ea)
    val muted=Color(0xffb5b8c1)
    val gold=Color(0xffe2c38c)
    Column(Modifier.fillMaxSize().background(Color(0xff0e1013)).systemBarsPadding()
        .verticalScroll(rememberScrollState()).padding(vertical=20.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal=24.dp),verticalAlignment=Alignment.CenterVertically){
            Surface(shape=RoundedCornerShape(12.dp),color=gold.copy(alpha=.1f)){
                Text("W",Modifier.padding(horizontal=14.dp,vertical=8.dp),color=gold,fontSize=24.sp,fontWeight=FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text("WILD RIFT",color=ink,fontWeight=FontWeight.Bold,letterSpacing=2.sp,style=MaterialTheme.typography.labelLarge)
                Text("COMMUNITY",color=muted,letterSpacing=3.sp,style=MaterialTheme.typography.labelSmall)
            }
        }
        Spacer(Modifier.height(24.dp))
        HorizontalPager(state=pager,contentPadding=PaddingValues(horizontal=24.dp),pageSpacing=12.dp,
            verticalAlignment=Alignment.Top,modifier=Modifier.fillMaxWidth().testTag("welcome-pager")
                .semantics{stateDescription="Карточка ${pager.currentPage+1} из ${introCards.size}"}) { index ->
            val card=introCards[index]
            Surface(color=Color(0xff191b20),shape=RoundedCornerShape(28.dp),modifier=Modifier.fillMaxWidth()){
                Column(Modifier.padding(24.dp)){
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        Text(card.label,color=card.accent,style=MaterialTheme.typography.labelSmall,letterSpacing=1.sp,modifier=Modifier.weight(1f))
                        Text("0${index+1}",color=muted,style=MaterialTheme.typography.labelMedium)
                    }
                    IntroArtwork(index,card.accent,Modifier.fillMaxWidth().height(148.dp).padding(vertical=12.dp))
                    Column(Modifier.semantics{heading()}){
                        Text(card.title,color=ink,fontSize=36.sp,lineHeight=40.sp,fontWeight=FontWeight.Bold)
                        Text(card.accentTitle,color=card.accent,fontSize=36.sp,lineHeight=40.sp,fontWeight=FontWeight.Bold)
                    }
                    Spacer(Modifier.height(18.dp))
                    Text(card.body,color=muted,style=MaterialTheme.typography.bodyLarge)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){
            IconButton(onClick={scope.launch{pager.animateScrollToPage(pager.currentPage-1)}},enabled=pager.currentPage>0,
                modifier=Modifier.testTag("welcome-previous")){
                Icon(Icons.AutoMirrored.Filled.ArrowBack,"Предыдущая карточка",tint=if(pager.currentPage>0)ink else muted.copy(alpha=.35f))
            }
            Row(Modifier.weight(1f),horizontalArrangement=Arrangement.Center){
                repeat(introCards.size){index->
                    IconButton(onClick={scope.launch{pager.animateScrollToPage(index)}},modifier=Modifier.size(48.dp)
                        .testTag("welcome-step-$index").semantics{selected=pager.currentPage==index;contentDescription="Карточка ${index+1} из ${introCards.size}"}){
                        Box(Modifier.size(if(pager.currentPage==index)18.dp else 6.dp,6.dp)
                            .background(if(pager.currentPage==index)gold else muted.copy(alpha=.4f),RoundedCornerShape(3.dp)))
                    }
                }
            }
            IconButton(onClick={scope.launch{pager.animateScrollToPage(pager.currentPage+1)}},enabled=pager.currentPage<introCards.lastIndex,
                modifier=Modifier.testTag("welcome-next")){
                Icon(Icons.AutoMirrored.Filled.ArrowForward,"Следующая карточка",tint=if(pager.currentPage<introCards.lastIndex)ink else muted.copy(alpha=.35f))
            }
        }
        Text("Свайпни, чтобы узнать больше",color=muted,style=MaterialTheme.typography.bodySmall,
            modifier=Modifier.align(Alignment.CenterHorizontally))
        Spacer(Modifier.height(24.dp))
        Column(Modifier.fillMaxWidth().padding(horizontal=24.dp),horizontalAlignment=Alignment.CenterHorizontally){
            if(name!=null){Text("С возвращением, $name",color=ink);Spacer(Modifier.height(16.dp))}
            Button(onClick=onExplore,shape=RoundedCornerShape(16.dp),colors=ButtonDefaults.buttonColors(containerColor=gold,contentColor=Color(0xff282013)),
                modifier=Modifier.fillMaxWidth().heightIn(min=56.dp).testTag("welcome-explore"),contentPadding=PaddingValues(18.dp)){
                Text(if(name==null)"Посмотреть клубы" else "Продолжить",Modifier.weight(1f),fontWeight=FontWeight.Bold)
                Icon(Icons.AutoMirrored.Filled.ArrowForward,null)
            }
            if(name==null){
                Spacer(Modifier.height(12.dp))
                OutlinedButton(onClick={onAccount("login")},shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth().heightIn(min=52.dp).testTag("welcome-login")){Text("Войти",color=ink)}
                TextButton(onClick={onAccount("register")},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("welcome-register")){Text("Создать аккаунт",color=gold)}
            }
            Spacer(Modifier.height(16.dp))
            Text("Независимое сообщество Wild Rift",color=muted,style=MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable private fun IntroArtwork(index:Int,accent:Color,modifier:Modifier) {
    Canvas(modifier){
        val c=center;val r=size.minDimension*.43f
        when(index){
            0->{
                val diamond=Path().apply{moveTo(c.x,c.y-r);lineTo(c.x+r,c.y);lineTo(c.x,c.y+r);lineTo(c.x-r,c.y);close()}
                drawPath(diamond,accent.copy(alpha=.2f),style=Stroke(1.dp.toPx()))
                val inner=Path().apply{moveTo(c.x,c.y-r*.72f);lineTo(c.x+r*.52f,c.y);lineTo(c.x,c.y+r*.72f);lineTo(c.x-r*.52f,c.y);close()}
                drawPath(inner,accent,style=Stroke(1.5.dp.toPx()))
                val rune=Path().apply{moveTo(c.x-r*.36f,c.y-r*.2f);lineTo(c.x-r*.2f,c.y+r*.3f);lineTo(c.x,c.y);lineTo(c.x+r*.2f,c.y+r*.3f);lineTo(c.x+r*.36f,c.y-r*.2f)}
                drawPath(rune,accent,style=Stroke(3.dp.toPx()))
            }
            1->{
                repeat(3){i->
                    val x=c.x+(i-1)*r*1.05f
                    val y=c.y+if(i==1)-r*.15f else r*.15f
                    drawRoundRect(accent.copy(alpha=.07f),Offset(x-r*.42f,y-r*.7f),androidx.compose.ui.geometry.Size(r*.84f,r*1.4f),androidx.compose.ui.geometry.CornerRadius(12.dp.toPx()))
                    drawCircle(accent.copy(alpha=if(i==1)1f else .5f),r*.18f,Offset(x,y-r*.22f),style=Stroke(2.dp.toPx()))
                    drawLine(accent.copy(alpha=.5f),Offset(x-r*.2f,y+r*.22f),Offset(x+r*.2f,y+r*.22f),2.dp.toPx())
                }
            }
            2->{
                repeat(3){i->
                    val x=c.x+(i-1)*r*.8f
                    drawCircle(accent.copy(alpha=.08f),r*.72f,Offset(x,c.y))
                    drawCircle(accent.copy(alpha=.6f),r*.72f,Offset(x,c.y),style=Stroke(1.5.dp.toPx()))
                }
                drawCircle(accent,r*.1f,c)
            }
            else->{
                drawRoundRect(accent.copy(alpha=.08f),Offset(c.x-r*1.2f,c.y-r*.65f),androidx.compose.ui.geometry.Size(r*2.4f,r*1.3f),androidx.compose.ui.geometry.CornerRadius(16.dp.toPx()))
                drawCircle(accent,r*.24f,Offset(c.x-r*.65f,c.y),style=Stroke(2.dp.toPx()))
                drawLine(accent,Offset(c.x-r*.15f,c.y-r*.16f),Offset(c.x+r*.72f,c.y-r*.16f),3.dp.toPx())
                drawLine(accent.copy(alpha=.35f),Offset(c.x-r*.15f,c.y+r*.16f),Offset(c.x+r*.4f,c.y+r*.16f),3.dp.toPx())
            }
        }
    }
}
