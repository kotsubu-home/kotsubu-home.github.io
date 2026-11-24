@echo off
chcp 65001 >nul
echo Xの予定取得を止めます（PCの起動時にも動かなくなります）
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\kotsubu_xwatch.vbs" 2>nul
wmic process where "name='pythonw.exe' and commandline like '%%x_watch.py%%'" call terminate >nul 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*x_watch.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo 止めました。また動かすときは setup_xwatch.bat
pause
