// Isolated renderer contract test: no registration or actual Explorer mutation.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shlobj.h>
#include <fstream>
#include <string>
#include <stdexcept>
const CLSID CLS = {0x70c21916,0x1316,0x4825,{0xaf,0x20,0xde,0xed,0x80,0x1d,0x76,0x90}};
COLORREF pixel = 0;
LRESULT CALLBACK Paint(HWND window, UINT message, WPARAM w, LPARAM l) {
  if (message == WM_PAINT) {
    PAINTSTRUCT ps; HDC dc = BeginPaint(window, &ps), memory = CreateCompatibleDC(dc);
    HBITMAP bitmap = CreateCompatibleBitmap(dc, 400, 300); auto previous = SelectObject(memory, bitmap);
    RECT rect = {0,0,400,300}; FillRect(memory, &rect, reinterpret_cast<HBRUSH>(GetStockObject(WHITE_BRUSH)));
    pixel = GetPixel(memory, 380, 280); BitBlt(dc,0,0,400,300,memory,0,0,SRCCOPY);
    SelectObject(memory, previous); DeleteObject(bitmap); DeleteDC(memory); EndPaint(window, &ps); return 0;
  }
  return DefWindowProcW(window,message,w,l);
}
int main() {
  try {
    HMODULE dll = LoadLibraryW(L"ToolboxBeautyExplorer.dll"); if (!dll) throw std::runtime_error("DLL load failed");
    auto get = reinterpret_cast<HRESULT(*)(REFCLSID,REFIID,void**)>(GetProcAddress(dll,"DllGetClassObject"));
    IClassFactory* factory = nullptr; IObjectWithSite* site = nullptr;
    if (!get || FAILED(get(CLS,IID_IClassFactory,reinterpret_cast<void**>(&factory))) || FAILED(factory->CreateInstance(nullptr,IID_IObjectWithSite,reinterpret_cast<void**>(&site)))) throw std::runtime_error("Factory failed");
    if (FAILED(site->SetSite(reinterpret_cast<IUnknown*>(1)))) throw std::runtime_error("Hook initialization failed");
    const auto instance = GetModuleHandleW(nullptr);
    WNDCLASSW c = {}; c.lpfnWndProc=DefWindowProcW; c.hInstance=instance; c.lpszClassName=L"ToolboxBeautyTestRoot";RegisterClassW(&c);
    c.lpszClassName=L"SHELLDLL_DefView"; RegisterClassW(&c);
    c.lpszClassName=L"DirectUIHWND";c.lpfnWndProc=Paint;RegisterClassW(&c);
    HWND root=CreateWindowW(L"ToolboxBeautyTestRoot",L"Native renderer isolated test",WS_OVERLAPPEDWINDOW,0,0,430,350,nullptr,nullptr,instance,nullptr);
    HWND shell=CreateWindowW(L"SHELLDLL_DefView",L"",WS_CHILD|WS_VISIBLE,0,0,400,300,root,nullptr,instance,nullptr);
    HWND view=CreateWindowW(L"DirectUIHWND",L"",WS_CHILD|WS_VISIBLE,0,0,400,300,shell,nullptr,instance,nullptr);
    const HWND control=FindWindowExW(HWND_MESSAGE,nullptr,L"AgentToolboxBeautyExplorerV1",nullptr);
    if (!control || (SendMessageW(control,WM_APP+271,0,0)&0xffff)!=0xb001) throw std::runtime_error("Native status missing");
    SendMessageW(view,WM_PAINT,0,0);
    if (pixel!=RGB(255,0,0)) throw std::runtime_error("Actual GDI artwork was not painted");
    if (SendMessageW(control,WM_APP+273,0,0)!=1) throw std::runtime_error("Disable failed");
    SendMessageW(view,WM_PAINT,0,0);if(pixel!=RGB(255,255,255))throw std::runtime_error("Disable did not restore native pixels");
    if(SendMessageW(control,WM_APP+272,0,0)!=1)throw std::runtime_error("Reload failed");
    SendMessageW(view,WM_PAINT,0,0);if(pixel!=RGB(255,0,0))throw std::runtime_error("Hot reload did not repaint");
    site->Release();factory->Release();DestroyWindow(root);
    std::ofstream("test-result.json")<<"{\"ok\":true,\"realGdiPainting\":true,\"liveDisableRestoredPixels\":true,\"hotReload\":true,\"registrationWritten\":false}";
    return 0;
  } catch (const std::exception& error) { std::ofstream("test-result.json")<<"{\"ok\":false,\"error\":\""<<error.what()<<"\"}"; return 1; }
}
