package ru.wrcommunity.android.data

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

object NativeLinks {
    fun route(url:String?,origin:String):String? {
        val link=url?.toHttpUrlOrNull() ?: return null
        val base=origin.toHttpUrlOrNull() ?: return null
        if(link.scheme!=base.scheme || link.host!=base.host || link.port!=base.port || link.username.isNotEmpty() || link.password.isNotEmpty())return null
        val segments=link.pathSegments.filter{it.isNotEmpty()}
        if(segments.any{!Regex("[-a-zA-Z0-9_]{1,80}").matches(it)})return null
        if(segments.size==2)return when(segments[0]){
            "clubs"->"content/club/${segments[1]}"
            "posts"->segments[1].toLongOrNull()?.takeIf{it>0}?.let{"content/post/$it"}
            "players"->"discovery/player/${segments[1]}"
            else->null
        }
        if(segments.size!=1)return null
        return mapOf("feed" to "content/feed","clubs" to "content/clubs","players" to "discovery/players",
            "guides" to "content/guides","teams" to "discovery/lfg","events" to "discovery/events",
            "account" to "profile","messages" to "chat/inbox","notifications" to "discovery/notifications",
            "reports" to "moderation/reports","saved" to "content/saved","drafts" to "content/drafts",
            "search" to "content/search","rules" to "rules")[segments[0]]
    }
}
