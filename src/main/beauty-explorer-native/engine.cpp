// Agent Toolbox Explorer artwork renderer. No MToolBox code or binary.
// GDI interception uses the separately licensed MinHook library (see notices).
#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shlobj.h>
#include <gdiplus.h>
#include <string>
#include <memory>
#include <mutex>
#include <unordered_set>
#include <vector>
#include <algorithm>
#include <atomic>
#include "vendor/MinHook.h"

const CLSID BEAUTY_CLSID = {0x70c21916,0x1316,0x4825,{0xaf,0x20,0xde,0xed,0x80,0x1d,0x76,0x90}};
const wchar_t* CONTROL_CLASS = L"AgentToolboxBeautyExplorerV1";
constexpr UINT QUERY = WM_APP + 271, RELOAD = WM_APP + 272, DISABLE = WM_APP + 273;
HMODULE moduleHandle;
std::mutex stateMutex;
struct Frame {
  HBITMAP bitmap = nullptr; int width = 0, height = 0; bool cover = false;
  std::mutex paintMutex;
  ~Frame() { if (bitmap) DeleteObject(bitmap); }
};
std::shared_ptr<Frame> currentFrame;
std::unordered_set<HWND> views;
std::atomic<bool> hooksReady{false};
LONG painted = 0;
thread_local bool inside = false;
thread_local HWND activeView = nullptr;
// Hooks can still run during a worker's GDI cleanup. Keep this TLS trivial so it
// has no container destructor that later DeleteDC notifications could re-enter.
struct DcViews {
  struct Binding { HDC dc; HWND window; } items[256];
  unsigned count;
  HWND find(HDC dc) const { for(unsigned i=0;i<count;i++)if(items[i].dc==dc)return items[i].window; return nullptr; }
  void set(HDC dc,HWND window) { for(unsigned i=0;i<count;i++)if(items[i].dc==dc){items[i].window=window;return;} if(count==256)count=0;items[count++]={dc,window}; }
  void erase(HDC dc) { for(unsigned i=0;i<count;i++)if(items[i].dc==dc){items[i]=items[--count];return;} }
};
thread_local DcViews memoryViews{};
decltype(&BeginPaint) originalBegin;
decltype(&EndPaint) originalEnd;
decltype(&FillRect) originalFill;
decltype(&CreateCompatibleDC) originalCreateDC;
decltype(&DeleteDC) originalDeleteDC;

std::wstring IniPath() {
  std::wstring file(32768,L'\0'); DWORD n = GetModuleFileNameW(moduleHandle, file.data(), 32768);
  if (!n || n >= 32768) return L"";
  file.resize(n); return file.substr(0, file.find_last_of(L"\\/")) + L"\\config.ini";
}
void Trace(const char* step) {
  const auto ini = IniPath();
  if (!GetPrivateProfileIntW(L"beauty", L"diagnostics", 0, ini.c_str())) return;
  const auto name = ini + L".diagnostic.log";
  HANDLE file = CreateFileW(name.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file != INVALID_HANDLE_VALUE) { DWORD written; WriteFile(file, step, DWORD(strlen(step)), &written, nullptr); CloseHandle(file); }
}
bool IsView(HWND window) {
  if (!window) return false;
  wchar_t cls[64] = {}; GetClassNameW(window, cls, 64);
  if (wcscmp(cls, L"DirectUIHWND")) return false;
  HWND parent = GetParent(window); GetClassNameW(parent, cls, 64);
  if (wcscmp(cls, L"SHELLDLL_DefView")) return false;
  DWORD pid = 0; GetWindowThreadProcessId(window, &pid);
  return pid == GetCurrentProcessId();
}
BOOL CALLBACK DiscoverView(HWND window, LPARAM) {
  if (IsView(window)) { std::lock_guard<std::mutex> lock(stateMutex); if (views.size() < 256) views.insert(window); }
  return TRUE;
}
BOOL CALLBACK DiscoverRoot(HWND window, LPARAM) {
  DWORD pid = 0; GetWindowThreadProcessId(window, &pid);
  if (pid == GetCurrentProcessId()) EnumChildWindows(window, DiscoverView, 0);
  return TRUE;
}
void InvalidateViews() {
  EnumWindows(DiscoverRoot, 0);
  std::vector<HWND> targets;
  { std::lock_guard<std::mutex> lock(stateMutex); targets.assign(views.begin(), views.end()); }
  for (HWND window : targets) {
    if (IsView(window)) InvalidateRect(window, nullptr, TRUE);
    else { std::lock_guard<std::mutex> lock(stateMutex); views.erase(window); }
  }
}
bool LoadFrame() {
  const auto ini = IniPath();
  std::shared_ptr<Frame> next;
  if (GetPrivateProfileIntW(L"beauty", L"enabled", 0, ini.c_str())) {
    std::wstring file(32768,L'\0');
    GetPrivateProfileStringW(L"beauty", L"image", L"", file.data(), 32768, ini.c_str());
    WIN32_FILE_ATTRIBUTE_DATA info;
    if (!GetFileAttributesExW(file.c_str(), GetFileExInfoStandard, &info) || info.nFileSizeHigh || info.nFileSizeLow > 25 * 1024 * 1024) return false;
    Gdiplus::Bitmap input(file.c_str(), FALSE);
    const UINT width = input.GetWidth(), height = input.GetHeight();
    if (input.GetLastStatus() != Gdiplus::Ok || !width || !height || width > 4096 || height > 4096 || UINT64(width) * height > 16'000'000) return false;
    Gdiplus::Rect rect(0, 0, width, height); Gdiplus::BitmapData pixels = {};
    if (input.LockBits(&rect, Gdiplus::ImageLockModeRead, PixelFormat32bppPARGB, &pixels) != Gdiplus::Ok) return false;
    BITMAPINFO bmi = {}; bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER); bmi.bmiHeader.biWidth = width;
    bmi.bmiHeader.biHeight = -int(height); bmi.bmiHeader.biPlanes = 1; bmi.bmiHeader.biBitCount = 32; bmi.bmiHeader.biCompression = BI_RGB;
    void* destination = nullptr;
    next = std::make_shared<Frame>(); next->bitmap = CreateDIBSection(nullptr, &bmi, DIB_RGB_COLORS, &destination, nullptr, 0);
    if (destination) for (UINT y = 0; y < height; y++) memcpy(static_cast<BYTE*>(destination) + y * width * 4, static_cast<BYTE*>(pixels.Scan0) + ptrdiff_t(y) * pixels.Stride, width * 4);
    input.UnlockBits(&pixels);
    if (!next->bitmap || !destination) return false;
    next->width = width; next->height = height;
    next->cover = GetPrivateProfileIntW(L"beauty", L"cover", 0, ini.c_str()) != 0;
  }
  { std::lock_guard<std::mutex> lock(stateMutex); currentFrame = std::move(next); InterlockedExchange(&painted, 0); }
  InvalidateViews(); return true;
}
LRESULT CALLBACK ControlProc(HWND window, UINT message, WPARAM w, LPARAM l) {
  if (message == QUERY) {
    std::lock_guard<std::mutex> lock(stateMutex);
    return 0xb001 | (currentFrame ? 0x10000 : 0) | (painted ? 0x20000 : 0) | (hooksReady ? 0x40000 : 0);
  }
  if (message == RELOAD) { try { return LoadFrame() ? 1 : 0; } catch (...) { return 0; } }
  if (message == DISABLE) {
    { std::lock_guard<std::mutex> lock(stateMutex); currentFrame.reset(); }
    InvalidateViews(); return 1;
  }
  return DefWindowProcW(window, message, w, l);
}
HDC WINAPI HookBegin(HWND window, LPPAINTSTRUCT paint) {
  HDC dc = originalBegin(window, paint);
  if (!inside && IsView(window)) {
    activeView = window;
    memoryViews.set(dc,window);
    std::lock_guard<std::mutex> lock(stateMutex); if (views.size() < 256) views.insert(window);
  }
  return dc;
}
BOOL WINAPI HookEnd(HWND window, const PAINTSTRUCT* paint) {
  if (activeView == window) activeView = nullptr;
  memoryViews.erase(paint->hdc); return originalEnd(window, paint);
}
HDC WINAPI HookCreateDC(HDC dc) {
  HDC result = originalCreateDC(dc);
  if (!inside && result) {
    HWND window = WindowFromDC(dc); if (!IsView(window)) window = activeView;
    if (IsView(window)) memoryViews.set(result,window);
  }
  return result;
}
BOOL WINAPI HookDeleteDC(HDC dc) { memoryViews.erase(dc); return originalDeleteDC(dc); }
int WINAPI HookFill(HDC dc, const RECT* rect, HBRUSH brush) {
  const int result = originalFill(dc, rect, brush);
  if (inside || !rect) return result;
  const HWND view = memoryViews.find(dc); if (!IsView(view)) return result;
  std::shared_ptr<Frame> frame;
  { std::lock_guard<std::mutex> lock(stateMutex); frame = currentFrame; }
  if (!frame) return result;
  inside = true;
  {
    std::lock_guard<std::mutex> lock(frame->paintMutex);
    RECT client; GetClientRect(view, &client);
    int width = frame->width, height = frame->height;
    if (frame->cover) {
      const double ratio = std::max(double(client.right) / width, double(client.bottom) / height);
      width = int(width * ratio + .5); height = int(height * ratio + .5);
    } else if (width > client.right * .6 || height > client.bottom * .88) {
      const double ratio = std::min(double(client.right) * .6 / width, double(client.bottom) * .88 / height);
      width = int(width * ratio); height = int(height * ratio);
    }
    const int left = frame->cover ? (client.right - width) / 2 : client.right - width - 8;
    const int top = frame->cover ? (client.bottom - height) / 2 : client.bottom - height;
    HDC source = originalCreateDC(dc);
    if (source) {
      auto old = SelectObject(source, frame->bitmap); const int saved = SaveDC(dc);
      if (saved) {
        IntersectClipRect(dc, rect->left, rect->top, rect->right, rect->bottom);
        BLENDFUNCTION blend = {AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
        if (AlphaBlend(dc, left, top, width, height, source, 0, 0, frame->width, frame->height, blend)) InterlockedIncrement(&painted);
        RestoreDC(dc, saved);
      }
      SelectObject(source, old); originalDeleteDC(source);
    }
  }
  inside = false; return result;
}
template<class T> bool Hook(T target, T replacement, T* original) { return MH_CreateHook(reinterpret_cast<void*>(target), reinterpret_cast<void*>(replacement), reinterpret_cast<void**>(original)) == MH_OK; }
DWORD WINAPI ControlThread(void* parameter) {
  WNDCLASSW cls = {}; cls.lpfnWndProc = ControlProc; cls.hInstance = moduleHandle; cls.lpszClassName = CONTROL_CLASS;
  RegisterClassW(&cls);
  const HWND control = CreateWindowExW(0, CONTROL_CLASS, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, moduleHandle, nullptr);
  SetEvent(static_cast<HANDLE>(parameter));
  if (!control) return 1;
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
  return 0;
}
bool Initialize() {
  Trace("initialize\r\n");
  static std::mutex initializeMutex; std::lock_guard<std::mutex> lock(initializeMutex);
  if (hooksReady) { LoadFrame(); return true; }
  ULONG_PTR token; Gdiplus::GdiplusStartupInput input;
  if (Gdiplus::GdiplusStartup(&token, &input, nullptr) != Gdiplus::Ok) { Trace("gdiplus-failed\r\n"); return false; }
  if (MH_Initialize() != MH_OK) { Trace("minhook-failed\r\n"); return false; }
  const bool created = Hook(BeginPaint, HookBegin, &originalBegin) && Hook(EndPaint, HookEnd, &originalEnd) && Hook(FillRect, HookFill, &originalFill) && Hook(CreateCompatibleDC, HookCreateDC, &originalCreateDC) && Hook(DeleteDC, HookDeleteDC, &originalDeleteDC);
  if (!created || MH_EnableHook(MH_ALL_HOOKS) != MH_OK) { Trace("hooks-failed\r\n"); MH_Uninitialize(); return false; }
  // Hook targets remain valid until normal Explorer process exit. Disable only stops artwork.
  HMODULE pinned; GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN, reinterpret_cast<LPCWSTR>(&Initialize), &pinned);
  hooksReady = true;
  // Shell activation can use a short-lived COM thread. Keep the command window on
  // its own pumping thread so apply/restore remain reachable after activation ends.
  HANDLE started = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!started) return false;
  HANDLE thread = CreateThread(nullptr, 0, ControlThread, started, 0, nullptr);
  if (!thread) { CloseHandle(started); return false; }
  WaitForSingleObject(started, INFINITE); CloseHandle(started); CloseHandle(thread);
  LoadFrame(); Trace("ready\r\n"); return true;
}
class Site final : public IObjectWithSite {
  LONG references = 1;
public:
  Site() { try { Initialize(); } catch (...) {} }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** out) override { if (!out) return E_POINTER; *out = nullptr; if (id != IID_IUnknown && id != IID_IObjectWithSite) return E_NOINTERFACE; *out = static_cast<IObjectWithSite*>(this); AddRef(); return S_OK; }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&references); }
  ULONG STDMETHODCALLTYPE Release() override { ULONG count = InterlockedDecrement(&references); if (!count) delete this; return count; }
  HRESULT STDMETHODCALLTYPE SetSite(IUnknown* site) override { if (site) try { return Initialize() ? S_OK : E_FAIL; } catch (...) { return E_FAIL; } return S_OK; }
  HRESULT STDMETHODCALLTYPE GetSite(REFIID, void** out) override { if (out) *out = nullptr; return E_NOINTERFACE; }
};
class Factory final : public IClassFactory {
  LONG references = 1;
public:
  Factory() { try { Initialize(); } catch (...) {} }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** out) override { if (!out) return E_POINTER; *out = nullptr; if (id != IID_IUnknown && id != IID_IClassFactory) return E_NOINTERFACE; *out = static_cast<IClassFactory*>(this); AddRef(); return S_OK; }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&references); }
  ULONG STDMETHODCALLTYPE Release() override { ULONG count = InterlockedDecrement(&references); if (!count) delete this; return count; }
  HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID id, void** out) override {
    if (outer) return CLASS_E_NOAGGREGATION;
    auto object = new Site(); HRESULT result = object->QueryInterface(id, out); object->Release(); return result;
  }
  HRESULT STDMETHODCALLTYPE LockServer(BOOL) override { return S_OK; }
};
STDAPI DllGetClassObject(REFCLSID cls, REFIID id, void** out) { Trace("get-class\r\n"); if (cls != BEAUTY_CLSID) { Trace("class-mismatch\r\n"); return CLASS_E_CLASSNOTAVAILABLE; } auto factory = new Factory(); HRESULT result = factory->QueryInterface(id, out); factory->Release(); return result; }
STDAPI DllCanUnloadNow() { return S_FALSE; }
extern "C" LRESULT CALLBACK ToolboxBeautyAttach(int code, WPARAM w, LPARAM l) {
  if (code >= 0 && l) {
    const auto message = reinterpret_cast<const CWPSTRUCT*>(l);
    if (message->message == WM_APP + 274 && message->wParam == 0xB001 && message->lParam == 0) {
      try { Initialize(); } catch (...) {}
    }
  }
  return CallNextHookEx(nullptr, code, w, l);
}
BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, void*) {
  if (reason == DLL_PROCESS_ATTACH) {
    moduleHandle = instance; DisableThreadLibraryCalls(instance);
    // This entry point receives thread attach/detach on small-stack Windows
    // workers too. Never reserve 128 KiB of automatic path buffers here.
    std::wstring exe(32768,L'\0'), windows(32768,L'\0');
    DWORD n=GetModuleFileNameW(nullptr,exe.data(),32768),w=GetWindowsDirectoryW(windows.data(),32768);
    if(!n||n>=32768||!w||w>=32768)return FALSE;
    exe.resize(n);windows.resize(w);
    const std::wstring path(exe), expected = windows + L"\\explorer.exe";
    const auto name = path.substr(path.find_last_of(L"\\/") + 1);
    const bool admitted = _wcsicmp(path.c_str(), expected.c_str()) == 0 || name == L"ToolboxBeautyTestHost.exe";
    if (!admitted) {
      const auto report = IniPath() + L".rejected-host.txt";
      HANDLE file = CreateFileW(report.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
      if (file != INVALID_HANDLE_VALUE) { DWORD written; WriteFile(file, path.c_str(), DWORD(path.size() * sizeof(wchar_t)), &written, nullptr); CloseHandle(file); }
    }
    return admitted;
  }
  return TRUE;
}
