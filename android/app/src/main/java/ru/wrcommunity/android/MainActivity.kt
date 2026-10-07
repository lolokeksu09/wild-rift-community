package ru.wrcommunity.android

import android.os.Bundle
import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.viewModels
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ru.wrcommunity.android.data.*
import ru.wrcommunity.android.features.GuestViewModel
import ru.wrcommunity.android.features.AccountViewModel
import ru.wrcommunity.android.ui.NativeCommunityApp
import ru.wrcommunity.android.features.*
import ru.wrcommunity.android.ui.CommunityTheme
import okhttp3.HttpUrl.Companion.toHttpUrl

class MainActivity : ComponentActivity() {
    private val cookies by lazy { SessionCookies(BuildConfig.API_ORIGIN.toHttpUrl(),EncryptedSessionStore(applicationContext)) }
    private val api by lazy { CommunityApi(BuildConfig.API_ORIGIN,sessions=cookies) }
    private val model: GuestViewModel by viewModels {
        viewModelFactory { initializer { GuestViewModel(createSavedStateHandle(),CommunityRepository(api)) } }
    }
    private val account: AccountViewModel by viewModels {
        viewModelFactory { initializer { AccountViewModel(AccountRepository(api,cookies)) } }
    }
    private val featureClient by lazy { FeatureClient(api,account::csrfToken,{account.state.value.user?.id},{account.state.value.boundary},account::expireSession,account::refresh) }
    private val content:ContentViewModel by viewModels{viewModelFactory{initializer{ContentViewModel(featureClient)}}}
    private val messaging:MessagingViewModel by viewModels{viewModelFactory{initializer{MessagingViewModel(featureClient)}}}
    private val discovery:DiscoveryViewModel by viewModels{viewModelFactory{initializer{DiscoveryViewModel(featureClient)}}}
    private val moderation:ModerationViewModel by viewModels{viewModelFactory{initializer{ModerationViewModel(featureClient)}}}
    private var incomingRoute by mutableStateOf<String?>(null)
    override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);incomingRoute=NativeLinks.route(intent.dataString,BuildConfig.API_ORIGIN)}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        incomingRoute=NativeLinks.route(intent.dataString,BuildConfig.API_ORIGIN)
        enableEdgeToEdge(statusBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle=SystemBarStyle.dark(android.graphics.Color.rgb(12,14,18)))
        setContent { CommunityTheme { NativeCommunityApp(model,account,featureClient,content,messaging,discovery,moderation,incomingRoute) } }
    }
    override fun onStart(){super.onStart();if(account.state.value.ready)account.refresh()}
}
