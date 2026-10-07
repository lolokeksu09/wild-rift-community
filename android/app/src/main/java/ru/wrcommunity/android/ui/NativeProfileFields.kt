@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package ru.wrcommunity.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.wrcommunity.android.data.*

@Composable fun NativeProfileFields(user:Account,busy:Boolean,client:FeatureClient,
    save:(JSONObject,String?,String?)->Unit) {
    var avatar by rememberSaveable(user.id,user.avatarId){mutableStateOf(user.avatarId)}
    var cover by rememberSaveable(user.id,user.coverId){mutableStateOf(user.coverId)}
    var roles by rememberSaveable(user.id,user.roles){mutableStateOf(user.roles)}
    var champions by rememberSaveable(user.id,user.champions){mutableStateOf(user.champions.joinToString(", "))}
    var time by rememberSaveable(user.id,user.game["playTime"]){mutableStateOf(user.game["playTime"] ?: "")}
    var mic by rememberSaveable(user.id,user.microphone){mutableStateOf(user.microphone)}
    var riotVisible by rememberSaveable(user.id,user.riotVisible){mutableStateOf(user.riotVisible)}
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
        SectionHeading("Твой стиль игры","Пара деталей поможет найти подходящую компанию.")
        RiftCard {
            Text("Фотографии профиля",style=MaterialTheme.typography.titleMedium)
            Text("Аватар для знакомства, обложка для твоей истории.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            NativeImagePicker(client,avatar,{avatar=it},"Аватар")
            NativeImagePicker(client,cover,{cover=it},"Обложка профиля")
        }
        RiftCard {
        Text("Любимые роли · до двух",style=MaterialTheme.typography.titleMedium)
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("baron" to "Барон","jungle" to "Лес","mid" to "Центр","dragon" to "Дракон","support" to "Поддержка").forEach{(value,label)->FilterChip(selected=value in roles,onClick={if(value in roles)roles=roles-value else if(roles.size<2)roles=roles+value},enabled=!busy,label={Text(label)})}
        }
        OutlinedTextField(champions,{champions=it.take(124)},label={Text("Чемпионы · до трёх через запятую")},enabled=!busy,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(time,{time=it.take(100)},label={Text("Когда играешь")},enabled=!busy,modifier=Modifier.fillMaxWidth())
        Text("Микрофон")
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("unknown" to "Не указан","yes" to "Есть","no" to "Нет").forEach{(value,label)->FilterChip(mic==value,{mic=value},enabled=!busy,label={Text(label)})}}
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("Показывать Riot ID",Modifier.weight(1f));Switch(riotVisible,{riotVisible=it},enabled=!busy)}
        val names=champions.split(',').map{it.trim()}.filter{it.isNotEmpty()}
        Button(onClick={save(JSONObject().put("roles",JSONArray(roles)).put("champions",JSONArray(names)).put("playTime",time).put("microphone",mic).put("riotVisible",riotVisible),avatar,cover)},
            enabled=!busy && names.size<=3 && names.distinct().size==names.size && names.all{it.length<=40},modifier=Modifier.fillMaxWidth()){Text("Сохранить стиль игры и фото")}
        }
    }
}
