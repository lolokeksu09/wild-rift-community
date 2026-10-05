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
import ru.wrcommunity.android.ui.CommunityApp
import ru.wrcommunity.android.ui.CommunityTheme

class MainActivity : ComponentActivity() {
    private val api by lazy { CommunityApi(BuildConfig.API_ORIGIN) }
    private val model: GuestViewModel by viewModels {
        viewModelFactory { initializer { GuestViewModel(createSavedStateHandle(),CommunityRepository(api)) } }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle=SystemBarStyle.dark(android.graphics.Color.rgb(12,14,18)))
        setContent { CommunityTheme { CommunityApp(model,api) } }
    }
}
