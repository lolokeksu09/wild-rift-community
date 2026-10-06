package ru.wrcommunity.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun WelcomeScreen(name:String?,onExplore:()->Unit,onAccount:(String)->Unit) {
    val gold=Color(0xffdfc18b)
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xff191521),Color(0xff0c0e12),Color(0xff17151b))))){
        Column(Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal=24.dp,vertical=24.dp),
            horizontalAlignment=Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Surface(shape=RoundedCornerShape(12.dp),color=gold.copy(alpha=.12f)){
                    Text("W",Modifier.padding(horizontal=14.dp,vertical=8.dp),color=gold,fontSize=24.sp,fontWeight=FontWeight.Bold)
                }
                Spacer(Modifier.width(12.dp))
                Column { Text("WILD RIFT",fontWeight=FontWeight.Bold,letterSpacing=2.sp,style=MaterialTheme.typography.labelLarge)
                    Text("COMMUNITY",color=MaterialTheme.colorScheme.onSurfaceVariant,letterSpacing=3.sp,style=MaterialTheme.typography.labelSmall) }
            }
            Spacer(Modifier.height(24.dp))
            RiftEmblem(gold,Modifier.size(220.dp))
            Spacer(Modifier.height(16.dp))
            Text("МЕСТО ДЛЯ СВОЕГО КРУГА",color=gold,letterSpacing=2.sp,style=MaterialTheme.typography.labelSmall,textAlign=TextAlign.Center)
            Spacer(Modifier.height(16.dp))
            Column(Modifier.semantics{heading()},horizontalAlignment=Alignment.CenterHorizontally){
                Text("Твой Рифт.",fontSize=44.sp,lineHeight=50.sp,fontWeight=FontWeight.Bold,textAlign=TextAlign.Center)
                Text("Твои люди.",color=gold,fontSize=44.sp,lineHeight=50.sp,fontWeight=FontWeight.Bold,textAlign=TextAlign.Center)
            }
            Spacer(Modifier.height(20.dp))
            Text("Найди компанию на следующий матч.\nОбщайся, делись опытом и оставайся\nна связи после игры.",color=MaterialTheme.colorScheme.onSurfaceVariant,textAlign=TextAlign.Center,style=MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(28.dp))
            if(name!=null){Text("С возвращением, $name",textAlign=TextAlign.Center);Spacer(Modifier.height(16.dp))}
            Button(onClick=onExplore,shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth().heightIn(min=56.dp).testTag("welcome-explore"),contentPadding=PaddingValues(18.dp)){
                Text(if(name==null)"Найти компанию" else "Продолжить",Modifier.weight(1f),fontWeight=FontWeight.Bold)
                Icon(Icons.AutoMirrored.Filled.ArrowForward,null)
            }
            if(name==null){
                Spacer(Modifier.height(12.dp))
                OutlinedButton(onClick={onAccount("login")},shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth().heightIn(min=52.dp).testTag("welcome-login")){Text("Войти")}
                TextButton(onClick={onAccount("register")},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("welcome-register")){Text("Создать аккаунт")}
            }
            Spacer(Modifier.height(20.dp))
            Text("Клубы по интересам · Игра вместе · Общение",textAlign=TextAlign.Center,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(24.dp))
            Text("Независимое сообщество Wild Rift",textAlign=TextAlign.Center,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable private fun RiftEmblem(gold:Color,modifier:Modifier) {
    Canvas(modifier){
        val c=center;val r=size.minDimension*.43f
        drawCircle(brush=Brush.radialGradient(listOf(gold.copy(alpha=.12f),Color.Transparent),center=c,radius=r*1.15f),radius=r*1.15f,center=c)
        drawCircle(gold.copy(alpha=.18f),r,style=Stroke(1.dp.toPx()))
        val diamond=Path().apply{moveTo(c.x,c.y-r*.85f);lineTo(c.x+r*.85f,c.y);lineTo(c.x,c.y+r*.85f);lineTo(c.x-r*.85f,c.y);close()}
        drawPath(diamond,gold.copy(alpha=.45f),style=Stroke(1.dp.toPx()))
        val inner=Path().apply{moveTo(c.x,c.y-r*.56f);lineTo(c.x+r*.42f,c.y);lineTo(c.x,c.y+r*.56f);lineTo(c.x-r*.42f,c.y);close()}
        drawPath(inner,gold,style=Stroke(1.5.dp.toPx()))
        val rune=Path().apply{moveTo(c.x-r*.28f,c.y-r*.15f);lineTo(c.x-r*.15f,c.y+r*.25f);lineTo(c.x,c.y);lineTo(c.x+r*.15f,c.y+r*.25f);lineTo(c.x+r*.28f,c.y-r*.15f)}
        drawPath(rune,gold,style=Stroke(3.dp.toPx()))
        drawLine(gold,Offset(c.x,c.y-r*.4f),Offset(c.x,c.y-r*.23f),2.dp.toPx())
    }
}
