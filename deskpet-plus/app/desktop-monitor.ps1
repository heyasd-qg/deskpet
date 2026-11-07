$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PetDesktopState {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window,StringBuilder name,int max);
  public static uint IdleMilliseconds() { var info=new LASTINPUTINFO();info.cbSize=(uint)Marshal.SizeOf(info);if(!GetLastInputInfo(ref info))return 0;return unchecked((uint)Environment.TickCount-info.dwTime); }
}
'@
[void][PetDesktopState]::SetProcessDPIAware()
while ($true) {
  $window = [PetDesktopState]::GetForegroundWindow()
  [uint32]$foregroundProcess = 0
  [void][PetDesktopState]::GetWindowThreadProcessId($window, [ref]$foregroundProcess)
  $name = New-Object System.Text.StringBuilder 256
  [void][PetDesktopState]::GetClassName($window, $name, 256)
  $rect = New-Object PetDesktopState+RECT
  $info = New-Object PetDesktopState+MONITORINFO
  $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
  $fullscreen = $false
  if ($foregroundProcess -ne [uint32]$env:PET_OWNER_PID -and $name.ToString() -notin @('Progman','WorkerW','Shell_TrayWnd') -and
      [PetDesktopState]::GetWindowRect($window, [ref]$rect) -and
      [PetDesktopState]::GetMonitorInfo([PetDesktopState]::MonitorFromWindow($window, 2), [ref]$info)) {
    $fullscreen = $rect.Left -le ($info.rcMonitor.Left + 2) -and $rect.Top -le ($info.rcMonitor.Top + 2) -and
      $rect.Right -ge ($info.rcMonitor.Right - 2) -and $rect.Bottom -ge ($info.rcMonitor.Bottom - 2)
  }
  [Console]::Out.WriteLine((@{ idleMs=[PetDesktopState]::IdleMilliseconds(); fullscreen=$fullscreen;
    rect=@{ x=$info.rcMonitor.Left; y=$info.rcMonitor.Top; width=$info.rcMonitor.Right-$info.rcMonitor.Left; height=$info.rcMonitor.Bottom-$info.rcMonitor.Top } } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 250
}
