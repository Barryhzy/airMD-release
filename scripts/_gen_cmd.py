"""生成 Windows 批处理脚本。

单独用脚本生成，是为了绕开命令行里反斜杠被自动转换的问题：
cmd 需要真正的 \\ 路径分隔符，而这里用 BS 常量拼接，源文件里不出现反斜杠。
"""

import os

BS = chr(92)  # 反斜杠
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

HEADER = """@echo off
chcp 936 >nul
setlocal enableextensions
title {title}
cd /d "%~dp0.."
"""

ENV_SETUP = """
if "%MINGW_BIN%"=="" set "MINGW_BIN=C:{bs}dj-tools{bs}mingw64{bs}bin"
set "PATH=%MINGW_BIN%;%USERPROFILE%{bs}.cargo{bs}bin;%PATH%"
set "CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=%MINGW_BIN%{bs}x86_64-w64-mingw32-gcc.exe"

echo ============================================================
echo  {heading}
echo  目录  : %CD%
echo  工具链: %MINGW_BIN%
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node
where cargo >nul 2>nul
if errorlevel 1 goto no_cargo
if not exist "%MINGW_BIN%{bs}x86_64-w64-mingw32-gcc.exe" goto no_mingw

rem 并发构建会互相删 target 里的临时目录，直接拒绝
tasklist /FI "IMAGENAME eq cargo.exe" 2>nul | find /I "cargo.exe" >nul
if not errorlevel 1 goto busy
tasklist /FI "IMAGENAME eq rustc.exe" 2>nul | find /I "rustc.exe" >nul
if not errorlevel 1 goto busy
"""

TAIL = """
:no_node
echo [错误] 找不到 node，请先安装 Node.js 20 以上版本。
pause
exit /b 1

:no_cargo
echo [错误] 找不到 cargo，请先安装 Rust，并把 %USERPROFILE%{bs}.cargo{bs}bin 加入 PATH。
pause
exit /b 1

:no_mingw
echo [错误] 找不到 mingw-w64 工具链：%MINGW_BIN%
echo 可通过环境变量 MINGW_BIN 指定，例如 C:{bs}msys64{bs}mingw64{bs}bin
pause
exit /b 1

:busy
echo [提示] 已经有一个 Rust 编译进程在跑。
echo 两个构建同时进行会互相删除临时文件，导致
echo   failed to add native library ...dll_imports.lib: 系统找不到指定的文件
echo 请先关掉另一个构建窗口（或结束后台 cargo / rustc 进程）再来。
pause
exit /b 1
"""

DEV_BODY = """
echo 正在启动前端开发服务器并编译 Rust，首次约 2-5 分钟...
echo 应用窗口出现后即可使用；关闭本窗口即退出。
echo.
call npx tauri dev
echo.
echo 开发模式已退出。
pause
exit /b 0
"""

BUILD_BODY = """
echo [1/2] 构建前端...
call npm run build
if errorlevel 1 goto fail

echo.
echo [2/2] 编译并打包桌面端，首次约 10-20 分钟，请保持窗口打开...
echo.
call npx tauri build
if errorlevel 1 goto fail

echo.
echo ============================================================
echo  完成！安装包在 src-tauri{bs}target{bs}release{bs}bundle{bs}nsis{bs}
echo ============================================================
pause
exit /b 0

:fail
echo.
echo [失败] 构建中断，请把上面的报错发给我。
pause
exit /b 1
"""


def write(name: str, title: str, heading: str, body: str) -> None:
    text = (
        HEADER.format(title=title)
        + ENV_SETUP.format(bs=BS, heading=heading)
        + body.replace("{bs}", BS)
        + TAIL.replace("{bs}", BS)
    )
    path = os.path.join(SCRIPT_DIR, name)
    with open(path, "w", encoding="gbk", newline="\r\n") as fh:
        fh.write(text)
    print("written", path, len(text))


write("dev.cmd", "airMD - 开发模式", "airMD - 桌面开发模式", DEV_BODY)
write("build.cmd", "airMD - 打包", "airMD - 打包安装包", BUILD_BODY)
