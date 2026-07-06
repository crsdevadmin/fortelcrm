@echo off
echo Swapping main.py...
del "backend\main.py"
if errorlevel 1 (
    echo FAILED - file is still locked. Close all terminals running uvicorn and try again.
    pause
    exit /b 1
)
ren "backend\main_updated.py" "main.py"
echo Done! Now restart uvicorn.
pause
