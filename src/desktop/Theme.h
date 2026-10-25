#pragma once
#include <windows.h>
#include <commctrl.h>
#include <algorithm>
#include <string>

// Shared with the SOLVIA motion presentation. All controls remain native Win32.
namespace ui {
inline constexpr unsigned CanvasHex=0xF3F3E9, InkHex=0x112C2B, MintHex=0xA7EDCF;
inline constexpr COLORREF canvas=RGB(243,243,233), ink=RGB(17,44,43), mint=RGB(167,237,207);
inline constexpr COLORREF paper=RGB(255,255,252), muted=RGB(105,127,116);
inline constexpr COLORREF border=RGB(219,228,215), soft=RGB(233,240,226), selected=RGB(211,239,223);
inline constexpr int sidebar=248, content=288, margin=40;

struct Resources {
    HBRUSH canvasBrush=CreateSolidBrush(canvas), paperBrush=CreateSolidBrush(paper);
    HFONT label=CreateFontW(-14,0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
    ~Resources(){DeleteObject(canvasBrush);DeleteObject(paperBrush);DeleteObject(label);}
};
inline Resources& resources(){static Resources value;return value;}

inline LRESULT CALLBACK buttonProc(HWND h,UINT msg,WPARAM wp,LPARAM lp,UINT_PTR id,DWORD_PTR){
    if(msg==WM_MOUSEMOVE && !GetPropW(h,L"Solvia.Hover")){
        SetPropW(h,L"Solvia.Hover",(HANDLE)1);
        TRACKMOUSEEVENT track{sizeof(track),TME_LEAVE,h,0};TrackMouseEvent(&track);
        InvalidateRect(h,nullptr,FALSE);
    }
    if(msg==WM_MOUSELEAVE){RemovePropW(h,L"Solvia.Hover");InvalidateRect(h,nullptr,FALSE);}
    if(msg==WM_SETFOCUS||msg==WM_KILLFOCUS||msg==WM_ENABLE)InvalidateRect(h,nullptr,FALSE);
    if(msg==WM_NCDESTROY){RemovePropW(h,L"Solvia.Hover");RemoveWindowSubclass(h,buttonProc,id);}
    return DefSubclassProc(h,msg,wp,lp);
}

enum class Icon {None,Overview,Calendar,Patients,Family,Team,Room,Audit,Logout};
inline void drawIcon(HDC dc,Icon icon,int x,int y,COLORREF color){
    auto pen=CreatePen(PS_SOLID,2,color);auto oldPen=SelectObject(dc,pen);
    auto oldBrush=SelectObject(dc,GetStockObject(NULL_BRUSH));
    auto line=[&](int a,int b,int c,int d){MoveToEx(dc,x+a,y+b,nullptr);LineTo(dc,x+c,y+d);};
    auto box=[&](int a,int b,int c,int d){RoundRect(dc,x+a,y+b,x+c,y+d,3,3);};
    switch(icon){
        case Icon::Overview:line(2,19,2,4);line(2,19,21,19);line(7,15,7,10);line(12,15,12,5);line(17,15,17,8);break;
        case Icon::Calendar:box(2,4,21,21);line(2,10,21,10);line(7,1,7,7);line(16,1,16,7);line(7,15,10,15);line(14,15,17,15);break;
        case Icon::Patients:case Icon::Team:Ellipse(dc,x+7,y+2,x+16,y+11);Arc(dc,x+3,y+12,x+21,y+28,x+2,y+20,x+22,y+20);break;
        case Icon::Family:Ellipse(dc,x+2,y+3,x+10,y+11);Ellipse(dc,x+14,y+3,x+22,y+11);line(1,20,3,14);line(3,14,9,14);line(9,14,11,20);line(13,20,15,14);line(15,14,21,14);line(21,14,23,20);break;
        case Icon::Room:box(4,2,20,22);line(15,12,17,12);break;
        case Icon::Audit:box(4,2,20,22);line(8,7,16,7);line(8,12,16,12);line(8,17,14,17);break;
        case Icon::Logout:line(10,3,3,3);line(3,3,3,21);line(3,21,10,21);line(9,12,22,12);line(17,7,22,12);line(22,12,17,17);break;
        default:break;
    }
    SelectObject(dc,oldBrush);SelectObject(dc,oldPen);DeleteObject(pen);
}

inline void drawButton(const DRAWITEMSTRUCT& d,HFONT font,bool primary=false,bool side=false,
                       bool active=false,Icon icon=Icon::None,bool danger=false){
    const bool hover=GetPropW(d.hwndItem,L"Solvia.Hover")!=nullptr;
    const bool down=(d.itemState&ODS_SELECTED)!=0,disabled=(d.itemState&ODS_DISABLED)!=0;
    COLORREF bg=side?(active?mint:ink):(primary?ink:paper);
    COLORREF fg=side?(active?ink:RGB(218,231,220)):(primary?paper:ink);
    if(hover&&!disabled)bg=side?(active?RGB(185,245,218):RGB(37,68,61)):(primary?RGB(37,68,61):soft);
    if(down&&!disabled)bg=side?RGB(133,211,175):selected;
    if(down&&!side)fg=ink;
    if(danger&&!side&&!disabled)fg=RGB(148,62,52);
    if(disabled){bg=soft;fg=muted;}
    if(side){auto background=CreateSolidBrush(ink);FillRect(d.hDC,&d.rcItem,background);DeleteObject(background);}
    else FillRect(d.hDC,&d.rcItem,resources().canvasBrush);
    auto brush=CreateSolidBrush(bg);auto pen=CreatePen(PS_SOLID,1,side||primary?bg:border);
    auto oldBrush=SelectObject(d.hDC,brush);auto oldPen=SelectObject(d.hDC,pen);
    RoundRect(d.hDC,d.rcItem.left,d.rcItem.top,d.rcItem.right,d.rcItem.bottom,14,14);
    SelectObject(d.hDC,oldPen);SelectObject(d.hDC,oldBrush);DeleteObject(pen);DeleteObject(brush);
    auto oldFont=SelectObject(d.hDC,font);SetBkMode(d.hDC,TRANSPARENT);SetTextColor(d.hDC,fg);
    RECT label=d.rcItem;label.left+=side?18:12;label.right-=12;
    if(icon!=Icon::None){drawIcon(d.hDC,icon,label.left,(label.top+label.bottom-24)/2,fg);label.left+=37;}
    int length=GetWindowTextLengthW(d.hwndItem);std::wstring text(length+1,L'\0');
    GetWindowTextW(d.hwndItem,text.data(),length+1);
    DrawTextW(d.hDC,text.c_str(),length,&label,DT_SINGLELINE|DT_VCENTER|DT_END_ELLIPSIS|(side?DT_LEFT:DT_CENTER));
    if(d.itemState&ODS_FOCUS){RECT focus=d.rcItem;InflateRect(&focus,-5,-5);DrawFocusRect(d.hDC,&focus);}
    SelectObject(d.hDC,oldFont);
}

inline HBRUSH controlColors(HDC dc,bool label){
    SetTextColor(dc,label?muted:ink);SetBkColor(dc,label?canvas:paper);
    return label?resources().canvasBrush:resources().paperBrush;
}
} // namespace ui
