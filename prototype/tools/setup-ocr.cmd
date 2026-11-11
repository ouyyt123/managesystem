@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
set "PY="

if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" set "PY=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not defined PY for /f "delims=" %%I in ('where python 2^>nul') do if not defined PY set "PY=%%I"

if not defined PY (
  echo.
  echo [ERROR] Python was not found.
  echo Install Python 3.10+ from https://python.org/ and run this script again.
  echo.
  pause
  exit /b 1
)

echo.
echo Installing local OCR engine (RapidOCR) with:
echo   %PY%
echo This only needs to run once; models are downloaded into the Python environment.
echo.

"%PY%" -m pip install rapidocr_onnxruntime
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
  echo OCR setup finished. Restart the prototype and try uploading an ERP screenshot.
) else (
  echo OCR setup failed with exit code %CODE%. Check the network and try again.
)
echo.
pause
exit /b %CODE%
