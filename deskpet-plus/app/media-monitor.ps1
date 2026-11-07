$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PetForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int maxCount);
}
'@
$type = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
$task = $method.MakeGenericMethod($type).Invoke($null, @($type::RequestAsync()))
$manager = $task.GetAwaiter().GetResult()
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$propertiesMethod = $method.MakeGenericMethod($propertiesType)
$lastHaruhikageSource = ''
$lastHaruhikageSeen = [DateTime]::MinValue
$last = ''
while ($true) {
  $playing = $false
  $haruhikage = $false
  $lastSourceStillPlaying = $false
  $lastSourceChangedTitle = $false
  try {
    foreach ($session in $manager.GetSessions()) {
      if ($session.SourceAppUserModelId -like '*SakikoDesktopPet*' -or $session.SourceAppUserModelId -like '*electron*') { continue }
      if ($session.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Playing') { continue }
      $playing = $true
      $source = $session.SourceAppUserModelId
      if ($source -eq $lastHaruhikageSource) { $lastSourceStillPlaying = $true }
      try {
        $propertiesTask = $propertiesMethod.Invoke($null, @($session.TryGetMediaPropertiesAsync()))
        if ($propertiesTask.Wait(750)) {
          $title = $propertiesTask.GetAwaiter().GetResult().Title
          if ($title -and $title.Normalize([Text.NormalizationForm]::FormKC) -match '春日影|haruhikage') {
            $haruhikage = $true
            $lastHaruhikageSource = $source
            $lastHaruhikageSeen = [DateTime]::UtcNow
            break
          } elseif ($title -and $source -eq $lastHaruhikageSource) {
            $lastSourceChangedTitle = $true
          }
        }
      } catch {}
    }
  } catch {}
  if (-not $haruhikage -and $lastSourceStillPlaying -and -not $lastSourceChangedTitle -and
      ([DateTime]::UtcNow - $lastHaruhikageSeen).TotalSeconds -lt 4) {
    $haruhikage = $true
  }
  $name = New-Object System.Text.StringBuilder 256
  [void][PetForeground]::GetClassName([PetForeground]::GetForegroundWindow(), $name, 256)
  $foreground = $name.ToString()
  $appOpen = $foreground -ne '' -and $foreground -notin @('Progman','WorkerW','Shell_TrayWnd')
  $key = "$playing|$haruhikage|$appOpen"
  if ($key -ne $last) {
    [Console]::Out.WriteLine((@{ playing=$playing; haruhikage=$haruhikage; appOpen=$appOpen } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    $last = $key
  }
  Start-Sleep -Milliseconds 1200
}
