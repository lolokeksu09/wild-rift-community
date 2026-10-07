package ru.wrcommunity.android.ui

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Colors=darkColorScheme(
    primary=Color(0xffdfc18b),onPrimary=Color(0xff282013),secondary=Color(0xffb8aacb),
    background=Color(0xff0c0e12),onBackground=Color(0xfff3f0e9),
    surface=Color(0xff14171d),onSurface=Color(0xfff3f0e9),
    surfaceVariant=Color(0xff1c2028),onSurfaceVariant=Color(0xffa2a8b3),
    outline=Color(0xff707782),error=Color(0xffffb4ab))
@Composable fun CommunityTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme=Colors,typography=Typography(),content=content)
}
