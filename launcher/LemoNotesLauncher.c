#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>

static void JoinPath(wchar_t *out, size_t count, const wchar_t *dir, const wchar_t *name)
{
    _snwprintf(out, count, L"%s\\%s", dir, name);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR commandLine, int show)
{
    (void)instance;
    (void)previous;
    (void)commandLine;
    (void)show;

    wchar_t base[MAX_PATH];
    DWORD length = GetModuleFileNameW(NULL, base, MAX_PATH);
    if (length == 0 || length >= MAX_PATH) {
        return 1;
    }

    wchar_t *slash = wcsrchr(base, L'\\');
    if (slash == NULL) {
        return 1;
    }
    *slash = L'\0';

    wchar_t core[MAX_PATH];
    JoinPath(core, MAX_PATH, base, L"LemoNotesCore.exe");

    if (GetFileAttributesW(core) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(
            NULL,
            L"No encuentro LemoNotesCore.exe.\r\n\r\n"
            L"Descomprime el ZIP completo y ejecuta LemoNotes.exe desde la carpeta que contiene resources.",
            L"LemoNotes",
            MB_OK | MB_ICONERROR
        );
        return 1;
    }

    wchar_t command[MAX_PATH * 2];
    _snwprintf(command, MAX_PATH * 2, L"\"%s\" --no-sandbox", core);

    STARTUPINFOW startup;
    ZeroMemory(&startup, sizeof(startup));
    startup.cb = sizeof(startup);

    PROCESS_INFORMATION process;
    ZeroMemory(&process, sizeof(process));

    if (!CreateProcessW(core, command, NULL, NULL, FALSE, 0, NULL, base, &startup, &process)) {
        wchar_t message[512];
        _snwprintf(
            message,
            512,
            L"No he podido abrir el núcleo de LemoNotes.\r\n\r\nCódigo de error: %lu",
            GetLastError()
        );
        MessageBoxW(NULL, message, L"LemoNotes", MB_OK | MB_ICONERROR);
        return 1;
    }

    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 0;
}
