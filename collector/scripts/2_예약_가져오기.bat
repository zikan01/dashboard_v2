@echo off
rem 예약 가져오기 — 네이버 예약자관리에서 상세 엑셀을 내려받아 대시보드에 자동 반영합니다.
rem collector.exe와 config.json이 이 스크립트 상위 폴더(collector\)에 있어야 합니다.

cd /d "%~dp0.."
if exist collector.exe (
  collector.exe
) else (
  node dist\index.js
)
