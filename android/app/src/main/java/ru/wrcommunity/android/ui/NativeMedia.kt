package ru.wrcommunity.android.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.wrcommunity.android.data.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.UUID

@Composable fun NativeMedia(id:String?,api:CommunityApi,description:String,modifier:Modifier=Modifier) {
    val bitmap by produceState<Bitmap?>(null,id,api){
        value=null
        if(id!=null)try{val bytes=api.image(id);value=withContext(Dispatchers.Default){BitmapFactory.decodeByteArray(bytes,0,bytes.size)}}
        catch(e:CancellationException){throw e}catch(_:Exception){}
    }
    bitmap?.let{Image(it.asImageBitmap(),description,modifier,contentScale=ContentScale.Crop)}
}

@Composable fun NativeImagePicker(client:FeatureClient,value:String?,onChange:(String?)->Unit,label:String="Фотография") {
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    val latestChange by rememberUpdatedState(onChange)
    val launcher=rememberLauncherForActivityResult(ActivityResultContracts.GetContent()){uri->
        if(uri!=null && !busy){busy=true;error=null;scope.launch{
            try {
                val bytes=withContext(Dispatchers.IO){
                    val input=context.contentResolver.openInputStream(uri) ?: error("Файл недоступен")
                    val original=input.use{stream->val out=ByteArrayOutputStream();val buf=ByteArray(8192)
                        while(true){val n=stream.read(buf);if(n<0)break;require(out.size()+n<=20*1024*1024){"Выбери изображение до 20 МБ."};out.write(buf,0,n)};out.toByteArray()}
                    val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeByteArray(original,0,original.size,bounds)
                    require(bounds.outWidth>0 && bounds.outHeight>0 && bounds.outWidth.toLong()*bounds.outHeight<=100_000_000L){"Не удалось прочитать фотографию."}
                    var sample=1;while(bounds.outWidth/sample>1600 || bounds.outHeight/sample>1600)sample*=2
                    val decoded=BitmapFactory.decodeByteArray(original,0,original.size,BitmapFactory.Options().apply{inSampleSize=sample}) ?: error("Не удалось прочитать фотографию.")
                    val orientation=runCatching{ExifInterface(ByteArrayInputStream(original)).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL)}.getOrDefault(1)
                    val matrix=Matrix().apply{when(orientation){
                        ExifInterface.ORIENTATION_FLIP_HORIZONTAL->setScale(-1f,1f)
                        ExifInterface.ORIENTATION_ROTATE_180->setRotate(180f)
                        ExifInterface.ORIENTATION_FLIP_VERTICAL->setScale(1f,-1f)
                        ExifInterface.ORIENTATION_TRANSPOSE->{setRotate(90f);postScale(-1f,1f)}
                        ExifInterface.ORIENTATION_ROTATE_90->setRotate(90f)
                        ExifInterface.ORIENTATION_TRANSVERSE->{setRotate(270f);postScale(-1f,1f)}
                        ExifInterface.ORIENTATION_ROTATE_270->setRotate(270f)
                    }}
                    val image=if(matrix.isIdentity)decoded else Bitmap.createBitmap(decoded,0,0,decoded.width,decoded.height,matrix,true)
                    val out=ByteArrayOutputStream();image.compress(Bitmap.CompressFormat.JPEG,88,out)
                    if(image!==decoded)image.recycle();decoded.recycle();out.toByteArray()
                }
                val uploaded=client.upload(bytes,"image/jpeg",UUID.randomUUID().toString())
                latestChange(uploaded.getJSONObject("image").getString("id"))
            } catch(e:CancellationException){throw e}
            catch(e:Exception){error=if(e is ApiException)e.message else e.message?.takeIf{it.contains("фотограф")||it.contains("МБ")} ?: "Не удалось загрузить фотографию. Проверь связь."}
            finally{busy=false}
        }}
    }
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
        if(value!=null)Surface(shape=RoundedCornerShape(16.dp)){NativeMedia(value,client.api,label,Modifier.fillMaxWidth().height(160.dp))}
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            OutlinedButton(onClick={launcher.launch("image/*")},enabled=!busy){Text(if(busy)"Загрузка…" else if(value==null)"Добавить: $label" else "Заменить фотографию")}
            if(value!=null)TextButton(onClick={onChange(null)},enabled=!busy){Text("Убрать")}
        }
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}
