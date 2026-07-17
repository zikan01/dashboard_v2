@echo off
rem 수집 전용 브라우저 열기 — 여기서 네이버에 한 번 로그인해 두면
rem 수집기가 이 브라우저에 연결해 자동으로 파일을 내려받습니다.
rem (일반 크롬과 프로필이 분리되어 있어 기존 브라우저에는 영향 없음)

set PROFILE=%LOCALAPPDATA%\GomawoCollector\profile
if not exist "%PROFILE%" mkdir "%PROFILE%"

set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" (
  echo 크롬을 찾을 수 없습니다. 크롬 설치 후 다시 실행해 주세요.
  pause
  exit /b 1
)

start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check "https://partner.booking.naver.com/bizes/1122869/booking"
