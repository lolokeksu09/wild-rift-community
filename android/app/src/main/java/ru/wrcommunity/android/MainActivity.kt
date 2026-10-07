package ru.wrcommunity.android

import android.os.Bundle
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
import ru.wrcommunity.android.ui.AccountCommunityApp
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
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle=SystemBarStyle.dark(android.graphics.Color.rgb(12,14,18)))
        setContent { CommunityTheme { AccountCommunityApp(model,account,api) } }
    }
    override fun onStart(){super.onStart();if(account.state.value.ready)account.refresh()}
}
