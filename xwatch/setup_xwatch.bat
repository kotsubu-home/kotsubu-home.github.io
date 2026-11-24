@echo off
cd /d "%~dp0"
echo ===== Xの予定取得 準備 =====
set PY=
py -3 --version >nul 2>nul && set PY=py -3
if not defined PY (
  python --version >nul 2>nul && set PY=python
)
if not defined PY (
  echo Python が見つかりません。インストールします…
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  echo.
  echo Python を入れました。このウィンドウを閉じて、もう一度 setup_xwatch.bat をダブルクリックしてください。
  pause
  exit /b
)
if not exist venv %PY% -m venv venv
venv\Scripts\python -m pip install --upgrade pip
venv\Scripts\python -m pip install playwright
venv\Scripts\python -m playwright install chromium
echo.
echo ブラウザが開きます。X に（チャイルドアカデミーのアカウントで）ログインして、終わったらブラウザを閉じてください。
venv\Scripts\python x_watch.py --login
echo.
echo 1回だけ試しに取得します…
venv\Scripts\python x_watch.py --once
echo.
echo PCを起動したときに自動で動くように登録します…
set VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\kotsubu_xwatch.vbs
(
  echo Set sh = CreateObject^("WScript.Shell"^)
  echo sh.CurrentDirectory = "%~dp0"
  echo sh.Run """%~dp0venv\Scripts\pythonw.exe"" ""%~dp0x_watch.py""", 0, False
) > "%VBS%"
start "" wscript "%VBS%"
echo.
echo ===== 完了！ 7:00～22:00 の間、30～39分ごとに X を見に行きます =====
echo 動いている記録は xwatch\log.txt で見られます。止めたいときは stop_xwatch.bat
pause
