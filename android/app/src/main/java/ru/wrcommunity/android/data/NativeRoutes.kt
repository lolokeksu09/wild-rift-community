package ru.wrcommunity.android.data

data class AuthDestination(val route:String,val create:Boolean=false)

object NativeRoutes {
    fun post(id:Long,comment:Long?=null):String {
        require(id in 1..9007199254740991L)
        return "content/post/$id"+if(comment!=null&&comment in 1..9007199254740990L)"/comment/$comment"else ""
    }
    fun comment(route:String):Long?=Regex("content/post/[1-9][0-9]*/comment/([1-9][0-9]*)").matchEntire(route)
        ?.groupValues?.get(1)?.toLongOrNull()?.takeIf{it<=9007199254740990L}
    fun auth(target:String):AuthDestination? {
        if(!target.startsWith("auth/"))return null
        val value=target.removePrefix("auth/")
        if(value.startsWith("create/"))return value.removePrefix("create/").takeIf{it in listOf("discovery/lfg","discovery/events")}?.let{AuthDestination(it,true)}
        return value.takeIf{it.matches(Regex("(content|discovery|chat|moderation)/[A-Za-z0-9_/-]+"))}?.let{AuthDestination(it)}
    }
    fun requiresAccount(route:String)=route.startsWith("chat/")||route.startsWith("moderation/")||
        route in listOf("content/saved","content/drafts","content/notifications","content/create-club","discovery/saved","discovery/notifications")||
        listOf("content/create/","content/create-poll/","content/create-guide/","content/edit/","content/draft/","content/settings/","content/members/","content/invites/","content/audit/","discovery/group/","discovery/event/").any{route.startsWith(it)}
    fun tab(route:String)=when {
        route=="profile"->"profile"
        route.startsWith("chat/")&&!route.startsWith("chat/club/")->"chat"
        route=="catalog"||route.startsWith("content/")||route.startsWith("chat/club/")->"clubs"
        else->"home"
    }
}
