package ru.wrcommunity.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ru.wrcommunity.android.data.CommunityApi

@Composable fun RiftHero(eyebrow:String,title:String,subtitle:String,actionLabel:String,onAction:()->Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp))
        .background(Brush.linearGradient(listOf(Color(0xff292820),Color(0xff171c24))))
        .padding(24.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        Text(eyebrow.uppercase(),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary)
        Text(title,style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.ExtraBold)
        Text(subtitle,style=MaterialTheme.typography.bodyLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick=onAction){Text(actionLabel)}
    }
}

@Composable fun SectionHeading(title:String,subtitle:String?=null,action:String?=null,onAction:()->Unit={}) {
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)) {
            Text(title,style=MaterialTheme.typography.titleLarge)
            if(subtitle!=null)Text(subtitle,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if(action!=null)TextButton(onClick=onAction){Text(action)}
    }
}

/** Native fallback for clubs without an uploaded cover; no remote decorative request. */
@Composable fun RiftCover(name:String,accent:String="gold",modifier:Modifier=Modifier) {
    val ink=when(accent){"rose","pink","coral"->Color(0xffc899a5);"blue","azure"->Color(0xff8faec7);"green","emerald"->Color(0xff99b9a8);"violet","purple"->Color(0xffb6a5cb);else->Color(0xffdfc18b)}
    Box(modifier.fillMaxWidth().height(150.dp).background(Brush.linearGradient(listOf(Color(0xff242a34),Color(0xff10151d)))),contentAlignment=Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val center=Offset(size.width*.73f,size.height*.5f)
            val radius=size.height*.55f
            drawCircle(ink.copy(alpha=.14f),radius,center,style=Stroke(1.dp.toPx()))
            drawCircle(ink.copy(alpha=.1f),radius*.68f,center,style=Stroke(1.dp.toPx()))
            val p=Path().apply{moveTo(center.x,center.y-radius*.65f);lineTo(center.x+radius*.48f,center.y);lineTo(center.x,center.y+radius*.65f);lineTo(center.x-radius*.48f,center.y);close()}
            drawPath(p,ink.copy(alpha=.6f),style=Stroke(2.dp.toPx()))
            drawLine(ink.copy(alpha=.25f),Offset(0f,size.height*.82f),Offset(size.width,size.height*.18f),1.dp.toPx())
        }
        Text(name.trim().take(1).uppercase(),Modifier.align(Alignment.CenterStart).padding(start=28.dp),style=MaterialTheme.typography.displayMedium,color=ink)
    }
}

@Composable fun RiftAvatar(name:String,id:String?,api:CommunityApi,size:Dp=40.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer),contentAlignment=Alignment.Center) {
        Text(name.trim().split(Regex("\\s+")).filter{it.isNotEmpty()}.take(2).joinToString(""){it.take(1)}.uppercase(),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSecondaryContainer)
        NativeMedia(id,api,"Аватар $name",Modifier.fillMaxSize())
    }
}

@Composable fun RiftCard(content:@Composable ColumnScope.()->Unit) {
    RiftCard(Modifier,content)
}
@Composable fun RiftCard(modifier:Modifier,content:@Composable ColumnScope.()->Unit) {
    Card(modifier.fillMaxWidth(),shape=RoundedCornerShape(20.dp),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(10.dp),content=content)
    }
}
