param(
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^android-v[0-9]+\.[0-9]+\.[0-9]+-preview(?:\.[0-9]+)?$')][string]$Tag,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory = $true)][string]$NotesPath
)
$ErrorActionPreference = 'Stop'
$releaseRepo = 'lolokeksu09/wild-rift-community'
$releaseApi = "https://api.github.com/repos/$releaseRepo"
$apkFile = Get-Item -LiteralPath $ApkPath
if ($apkFile.Extension -ne '.apk' -or $apkFile.Length -le 0) { throw 'Expected a nonempty APK.' }
$apkHash = (Get-FileHash -LiteralPath $apkFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$releaseNotes = Get-Content -LiteralPath $NotesPath -Raw -Encoding UTF8
$oldPrompt = $env:GIT_TERMINAL_PROMPT
$releaseHeaders = $null
try {
    $env:GIT_TERMINAL_PROMPT = '0'
    $credentialLines = "protocol=https`nhost=github.com`n`n" | git credential fill
    if ($LASTEXITCODE -ne 0) { throw 'GitHub credential helper failed.' }
    $credentialSecret = ($credentialLines | Where-Object { $_.StartsWith('password=') } | Select-Object -First 1)
    if (-not $credentialSecret) { throw 'No existing GitHub credential is available.' }
    $releaseHeaders = @{
        Authorization = 'Bearer ' + $credentialSecret.Substring(9)
        Accept = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2026-03-10'
        'User-Agent' = 'wr-community-android-publisher'
    }
    $credentialLines = $null
    $credentialSecret = $null
    $repoInfo = Invoke-RestMethod -Uri $releaseApi -Headers $releaseHeaders
    if ($repoInfo.full_name -ne $releaseRepo) { throw 'Unexpected repository.' }
    $release = $null
    try { $release = Invoke-RestMethod -Uri "$releaseApi/releases/tags/$Tag" -Headers $releaseHeaders }
    catch { if ([int]$_.Exception.Response.StatusCode -ne 404) { throw } }
    if ($release) {
        $tagRef = Invoke-RestMethod -Uri "$releaseApi/git/ref/tags/$Tag" -Headers $releaseHeaders
        if ($tagRef.object.sha -ne $SourceCommit) { throw 'Existing tag has a different source commit.' }
    } else {
        $payload = @{ tag_name=$Tag; target_commitish=$SourceCommit; name="Android $($Tag.Substring(9))";
            body=$releaseNotes; draft=$true; prerelease=$true; make_latest='false' } | ConvertTo-Json
        $release = Invoke-RestMethod -Method Post -Uri "$releaseApi/releases" -Headers $releaseHeaders -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    }
    $uploadBase = $release.upload_url -replace '\{.*$', ''
    if (([uri]$uploadBase).Host -ne 'uploads.github.com') { throw 'Unexpected asset upload host.' }
    $asset = @($release.assets | Where-Object { $_.name -eq $apkFile.Name })
    if ($asset.Count -gt 1) { throw 'Duplicate APK assets.' }
    if ($asset.Count -eq 1) {
        if ($asset[0].digest -ne "sha256:$apkHash") { throw 'Existing APK differs; use a new version, do not overwrite.' }
    } else {
        if (-not $release.draft) { throw 'Published release is missing this APK; use a new version.' }
        $uploadUrl = $uploadBase + '?name=' + [uri]::EscapeDataString($apkFile.Name)
        $uploaded = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $releaseHeaders -ContentType 'application/vnd.android.package-archive' -InFile $apkFile.FullName
        if ($uploaded.digest -ne "sha256:$apkHash" -or $uploaded.size -ne $apkFile.Length) { throw 'Uploaded APK verification failed; release remains a draft.' }
    }
    if ($release.draft) {
        $publishBody = @{draft=$false; prerelease=$true; make_latest='false'} | ConvertTo-Json
        $release = Invoke-RestMethod -Method Patch -Uri "$releaseApi/releases/$($release.id)" -Headers $releaseHeaders -ContentType 'application/json' -Body $publishBody
    }
    $verified = Invoke-RestMethod -Uri "$releaseApi/releases/tags/$Tag" -Headers $releaseHeaders
    $verifiedApk = @($verified.assets | Where-Object { $_.name -eq $apkFile.Name })
    if ($verified.draft -or -not $verified.prerelease -or $verifiedApk.Count -ne 1 -or $verifiedApk[0].digest -ne "sha256:$apkHash" -or $verifiedApk[0].state -ne 'uploaded') { throw 'Published release verification failed.' }
    [pscustomobject]@{ release=$verified.html_url; apk=$verifiedApk[0].browser_download_url; sha256=$apkHash; bytes=$verifiedApk[0].size; private=$repoInfo.private } | ConvertTo-Json -Compress
} catch {
    $httpStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    Write-Error "Android release publication did not complete (HTTP $httpStatus). Credentials were not logged. Check the release draft and source parameters before retrying."
    exit 1
} finally {
    if ($releaseHeaders) { $releaseHeaders.Clear() }
    $credentialLines = $null
    $credentialSecret = $null
    $env:GIT_TERMINAL_PROMPT = $oldPrompt
}
