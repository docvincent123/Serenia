#include <windows.h>
#include <objbase.h>
#include <shellapi.h>
#include <wrl.h>
#include <WebView2.h>

#include <filesystem>
#include <string>
#include <cstdlib>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {
HWND g_window = nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;

std::filesystem::path executableDirectory() {
    wchar_t buffer[32768]{};
    const DWORD length = GetModuleFileNameW(nullptr, buffer, static_cast<DWORD>(sizeof(buffer) / sizeof(buffer[0])));
    if (length == 0 || length >= sizeof(buffer) / sizeof(buffer[0])) {
        return std::filesystem::current_path();
    }
    return std::filesystem::path(buffer).parent_path();
}

std::wstring envValue(const wchar_t* name) {
    DWORD needed = GetEnvironmentVariableW(name, nullptr, 0);
    if (!needed) return {};
    std::wstring value(needed, L'\0');
    GetEnvironmentVariableW(name, value.data(), needed);
    if (!value.empty() && value.back() == L'\0') value.pop_back();
    return value;
}

std::filesystem::path userDataDirectory() {
    auto local = envValue(L"LOCALAPPDATA");
    std::filesystem::path root = local.empty() ? executableDirectory() : std::filesystem::path(local);
    auto path = root / L"QureMed" / L"SOLVIA" / L"WebView2";
    std::error_code ec;
    std::filesystem::create_directories(path, ec);
    return path;
}

void resizeWebView() {
    if (!g_controller || !g_window) return;
    RECT bounds{};
    GetClientRect(g_window, &bounds);
    g_controller->put_Bounds(bounds);
}

void fatal(const wchar_t* message) {
    MessageBoxW(g_window, message, L"SOLVIA", MB_OK | MB_ICONERROR);
    if (g_window) PostMessageW(g_window, WM_CLOSE, 0, 0);
}

std::wstring launchUrl() {
    std::wstring url = L"http://app.solvia.local/index.html";
    const auto api = envValue(L"SOLVIA_API");
    if (!api.empty()) {
        url += L"?api=";
        url += api;
    }
    return url;
}

void createWebView(HWND hwnd) {
    const auto ui = executableDirectory() / L"ui";
    if (!std::filesystem::exists(ui / L"index.html")) {
        fatal(L"Не знайдено React-інтерфейс SOLVIA. Перевірте папку ui поруч із Solvia.exe.");
        return;
    }

    const auto userData = userDataDirectory().wstring();
    const auto uiPath = ui.wstring();

    const HRESULT start = CreateCoreWebView2EnvironmentWithOptions(
        nullptr,
        userData.c_str(),
        nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [hwnd, uiPath](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(result) || !environment) {
                    fatal(L"Не вдалося запустити Microsoft Edge WebView2 Runtime.");
                    return result;
                }

                return environment->CreateCoreWebView2Controller(
                    hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [hwnd, uiPath](HRESULT controllerResult, ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(controllerResult) || !controller) {
                                fatal(L"Не вдалося створити вікно React-інтерфейсу.");
                                return controllerResult;
                            }

                            g_controller = controller;
                            controller->get_CoreWebView2(&g_webview);
                            if (!g_webview) {
                                fatal(L"WebView2 не повернув веб-контрол.");
                                return E_FAIL;
                            }

                            EventRegistrationToken messageToken{};
                            g_webview->add_WebMessageReceived(
                                Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                    [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                        LPWSTR raw = nullptr;
                                        if (FAILED(args->TryGetWebMessageAsString(&raw)) || !raw) return S_OK;
                                        std::wstring message(raw);
                                        CoTaskMemFree(raw);
                                        if (message != L"backup" && message != L"restore") return S_OK;

                                        const auto script = executableDirectory() / L"installer" /
                                            (message == L"backup" ? L"Backup-Database.ps1" : L"Restore-Database.ps1");
                                        if (!std::filesystem::exists(script)) {
                                            MessageBoxW(g_window, L"Не знайдено скрипт обслуговування SOLVIA.", L"SOLVIA", MB_OK | MB_ICONERROR);
                                            return S_OK;
                                        }

                                        std::wstring parameters = L"-NoProfile -ExecutionPolicy Bypass -File \"" + script.wstring() + L"\"";
                                        auto result = reinterpret_cast<INT_PTR>(ShellExecuteW(
                                            g_window, L"runas", L"powershell.exe", parameters.c_str(),
                                            executableDirectory().c_str(), SW_SHOWNORMAL
                                        ));
                                        if (result <= 32 && result != ERROR_CANCELLED) {
                                            MessageBoxW(g_window, L"Не вдалося запустити обслуговування бази.", L"SOLVIA", MB_OK | MB_ICONERROR);
                                        }
                                        return S_OK;
                                    }
                                ).Get(),
                                &messageToken
                            );

                            ComPtr<ICoreWebView2Settings> settings;
                            if (SUCCEEDED(g_webview->get_Settings(&settings)) && settings) {
                                settings->put_AreDefaultContextMenusEnabled(FALSE);
                                settings->put_IsStatusBarEnabled(FALSE);
                                settings->put_AreDevToolsEnabled(FALSE);
                                settings->put_IsZoomControlEnabled(TRUE);
                            }

                            ComPtr<ICoreWebView2_3> webview3;
                            if (FAILED(g_webview.As(&webview3)) || !webview3) {
                                fatal(L"Встановлений WebView2 Runtime занадто старий.");
                                return E_NOINTERFACE;
                            }

                            const HRESULT mapping = webview3->SetVirtualHostNameToFolderMapping(
                                L"app.solvia.local",
                                uiPath.c_str(),
                                COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS
                            );
                            if (FAILED(mapping)) {
                                fatal(L"Не вдалося підключити локальні файли інтерфейсу.");
                                return mapping;
                            }

                            resizeWebView();
                            const auto url = launchUrl();
                            const HRESULT navigate = g_webview->Navigate(url.c_str());
                            if (FAILED(navigate)) {
                                fatal(L"Не вдалося відкрити React-інтерфейс SOLVIA.");
                                return navigate;
                            }
                            return S_OK;
                        }
                    ).Get()
                );
            }
        ).Get()
    );

    if (FAILED(start)) {
        fatal(L"WebView2 Runtime не знайдено або не запускається.");
    }
}

LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE:
            g_window = hwnd;
            createWebView(hwnd);
            return 0;
        case WM_SIZE:
            resizeWebView();
            return 0;
        case WM_GETMINMAXINFO:
            reinterpret_cast<MINMAXINFO*>(lParam)->ptMinTrackSize = {980, 650};
            return 0;
        case WM_CLOSE:
            DestroyWindow(hwnd);
            return 0;
        case WM_DESTROY:
            g_webview.Reset();
            if (g_controller) {
                g_controller->Close();
                g_controller.Reset();
            }
            g_window = nullptr;
            PostQuitMessage(0);
            return 0;
        default:
            return DefWindowProcW(hwnd, message, wParam, lParam);
    }
}
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    const HRESULT com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(com) && com != RPC_E_CHANGED_MODE) {
        MessageBoxW(nullptr, L"Не вдалося ініціалізувати Windows COM.", L"SOLVIA", MB_OK | MB_ICONERROR);
        return 1;
    }

    WNDCLASSW wc{};
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    wc.lpfnWndProc = windowProc;
    wc.lpszClassName = L"SolviaReactShell";

    if (!RegisterClassW(&wc)) {
        if (SUCCEEDED(com)) CoUninitialize();
        return 1;
    }

    HWND window = CreateWindowExW(
        0,
        wc.lpszClassName,
        L"SOLVIA by QureMed • Центр психологічної реабілітації",
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        1440,
        900,
        nullptr,
        nullptr,
        instance,
        nullptr
    );

    if (!window) {
        if (SUCCEEDED(com)) CoUninitialize();
        return 1;
    }

    ShowWindow(window, SW_SHOWMAXIMIZED);
    UpdateWindow(window);

    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    if (SUCCEEDED(com)) CoUninitialize();
    return static_cast<int>(msg.wParam);
}

