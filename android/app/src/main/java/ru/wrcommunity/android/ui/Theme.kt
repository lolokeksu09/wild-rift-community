package ru.wrcommunity.android.ui

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import ru.wrcommunity.android.R

private val Colors=darkColorScheme(
    primary=Color(0xffdfc18b),onPrimary=Color(0xff282013),primaryContainer=Color(0xff3b3325),onPrimaryContainer=Color(0xfff2deb7),
    secondary=Color(0xffbdc7d4),onSecondary=Color(0xff202936),secondaryContainer=Color(0xff2c3542),onSecondaryContainer=Color(0xffe0e7ef),
    tertiary=Color(0xffa4c9b4),onTertiary=Color(0xff1d3429),tertiaryContainer=Color(0xff2e4438),onTertiaryContainer=Color(0xffc4e4d1),
    background=Color(0xff0c0e12),onBackground=Color(0xfff3f0e9),
    surface=Color(0xff14171d),onSurface=Color(0xfff3f0e9),
    surfaceVariant=Color(0xff1c2028),onSurfaceVariant=Color(0xffa2a8b3),
    surfaceContainerLowest=Color(0xff0b0d11),surfaceContainerLow=Color(0xff181d25),
    surfaceContainer=Color(0xff1d232c),surfaceContainerHigh=Color(0xff252c36),surfaceContainerHighest=Color(0xff303844),
    inverseSurface=Color(0xffe5e1da),inverseOnSurface=Color(0xff252a31),inversePrimary=Color(0xff725b31),
    outline=Color(0xff707782),outlineVariant=Color(0xff39414c),surfaceTint=Color(0xffdfc18b),
    error=Color(0xffffb4ab),onError=Color(0xff690005),errorContainer=Color(0xff512328),onErrorContainer=Color(0xffffdad6))
private val Manrope=FontFamily(Font(R.font.manrope_medium,FontWeight.Normal),Font(R.font.manrope_medium,FontWeight.Medium),Font(R.font.manrope_extrabold,FontWeight.Bold),Font(R.font.manrope_extrabold,FontWeight.ExtraBold))
private val Base=Typography()
private val RiftTypography=Typography(
    displayLarge=Base.displayLarge.copy(fontFamily=Manrope,fontWeight=FontWeight.ExtraBold),displayMedium=Base.displayMedium.copy(fontFamily=Manrope,fontWeight=FontWeight.ExtraBold),displaySmall=Base.displaySmall.copy(fontFamily=Manrope,fontWeight=FontWeight.ExtraBold),
    headlineLarge=Base.headlineLarge.copy(fontFamily=Manrope,fontWeight=FontWeight.Bold),headlineMedium=Base.headlineMedium.copy(fontFamily=Manrope,fontWeight=FontWeight.Bold),headlineSmall=Base.headlineSmall.copy(fontFamily=Manrope,fontWeight=FontWeight.Bold),
    titleLarge=Base.titleLarge.copy(fontFamily=Manrope,fontWeight=FontWeight.Bold),titleMedium=Base.titleMedium.copy(fontFamily=Manrope,fontWeight=FontWeight.Bold),titleSmall=Base.titleSmall.copy(fontFamily=Manrope,fontWeight=FontWeight.Bold),
    bodyLarge=Base.bodyLarge.copy(fontFamily=Manrope),bodyMedium=Base.bodyMedium.copy(fontFamily=Manrope),bodySmall=Base.bodySmall.copy(fontFamily=Manrope),
    labelLarge=Base.labelLarge.copy(fontFamily=Manrope),labelMedium=Base.labelMedium.copy(fontFamily=Manrope),labelSmall=Base.labelSmall.copy(fontFamily=Manrope))
@Composable fun CommunityTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme=Colors,typography=RiftTypography,shapes=Shapes(small=RoundedCornerShape(12.dp),medium=RoundedCornerShape(18.dp),large=RoundedCornerShape(24.dp)),content=content)
}
