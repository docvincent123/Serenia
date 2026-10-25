#include "Api.h"
#include <windowsx.h>
#include <commctrl.h>
#include <d2d1.h>
#include <dwrite.h>
#include <wrl/client.h>
#include <algorithm>
#include <ctime>
#include <functional>
#include <memory>
#include <vector>
#include "Theme.h"
using Microsoft::WRL::ComPtr;
namespace {
HFONT font=nullptr;
HINSTANCE instance;
std::wstring readText(HWND h){int n=GetWindowTextLengthW(h);std::wstring s(n+1,L'\0');GetWindowTextW(h,s.data(),n+1);s.resize(n);return s;}
std::string dateToday(){std::time_t t=std::time(nullptr);std::tm tm{};localtime_s(&tm,&t);char b[16];std::strftime(b,sizeof b,"%Y-%m-%d",&tm);return b;}
std::wstring value(const J&row,const char*key){if(!row.contains(key)||row[key].is_null())return L"—";return wide(row[key].is_string()?row[key].get<std::string>():row[key].dump());}
std::wstring roleName(const std::string&r){if(r=="admin")return L"Адміністратор";if(r=="reception")return L"Реєстратура";if(r=="psychologist")return L"Психолог";return L"Керівник центру";}
HWND control(HWND owner,const wchar_t*cls,const std::wstring&text,DWORD style,int x,int y,int w,int h,int id){
    const bool button=wcscmp(cls,L"BUTTON")==0;
    if(button)style=(style&~0xFUL)|BS_OWNERDRAW;
    auto c=CreateWindowExW(0,cls,text.c_str(),WS_CHILD|WS_VISIBLE|style,x,y,w,h,owner,(HMENU)(INT_PTR)id,instance,nullptr);
    SendMessageW(c,WM_SETFONT,(WPARAM)font,TRUE);
    if(button)SetWindowSubclass(c,ui::buttonProc,1,0);
    if(wcscmp(cls,L"EDIT")==0){SendMessageW(c,EM_SETMARGINS,EC_LEFTMARGIN|EC_RIGHTMARGIN,MAKELPARAM(10,10));}
    return c;
}
struct Choice{std::wstring label;J value;};
struct Field{std::string key;std::wstring label;std::string initial;std::vector<Choice> choices;bool multiline=false;bool password=false;bool multiple=false;bool readonly=false;};
struct Form{std::vector<Field> fields;std::vector<HWND> controls;std::function<void(const J&)> submit;bool accepted=false;HWND owner=nullptr;};
LRESULT CALLBACK formProc(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp){auto*f=(Form*)GetWindowLongPtrW(hwnd,GWLP_USERDATA);if(msg==WM_NCCREATE){f=(Form*)((CREATESTRUCTW*)lp)->lpCreateParams;SetWindowLongPtrW(hwnd,GWLP_USERDATA,(LONG_PTR)f);}if(!f)return DefWindowProcW(hwnd,msg,wp,lp);if(msg==WM_CTLCOLORSTATIC||msg==WM_CTLCOLOREDIT||msg==WM_CTLCOLORLISTBOX)return (LRESULT)ui::controlColors((HDC)wp,msg==WM_CTLCOLORSTATIC);if(msg==WM_DRAWITEM){auto*d=(DRAWITEMSTRUCT*)lp;if(d->CtlType==ODT_BUTTON){ui::drawButton(*d,font,d->CtlID==IDOK);return TRUE;}}if(msg==WM_CREATE){int y=18;int i=0;for(auto&field:f->fields){control(hwnd,L"STATIC",field.label,0,24,y,624,22,0);y+=25;HWND h;int height=field.multiple?90:field.multiline?80:30;if(field.multiple){h=control(hwnd,L"LISTBOX",L"",WS_BORDER|WS_VSCROLL|WS_TABSTOP|LBS_EXTENDEDSEL|LBS_NOINTEGRALHEIGHT,24,y,624,height,100+i);for(auto&ch:field.choices)SendMessageW(h,LB_ADDSTRING,0,(LPARAM)ch.label.c_str());}else if(!field.choices.empty()){h=control(hwnd,L"COMBOBOX",L"",WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,24,y,624,260,100+i);int selected=0;for(size_t j=0;j<field.choices.size();++j){SendMessageW(h,CB_ADDSTRING,0,(LPARAM)field.choices[j].label.c_str());if(field.choices[j].value.dump()==field.initial||field.choices[j].value==field.initial)selected=(int)j;}SendMessageW(h,CB_SETCURSEL,selected,0);}else{h=control(hwnd,L"EDIT",wide(field.initial),WS_BORDER|WS_TABSTOP|(field.password?ES_PASSWORD:0)|(field.readonly?ES_READONLY:0)|(field.multiline?ES_MULTILINE|ES_AUTOVSCROLL|WS_VSCROLL|ES_WANTRETURN:ES_AUTOHSCROLL),24,y,624,height,100+i);SendMessageW(h,EM_SETLIMITTEXT,field.multiline?10000:256,0);}f->controls.push_back(h);y+=height+12;++i;}control(hwnd,L"BUTTON",L"Скасувати",WS_TABSTOP,360,y+6,130,36,IDCANCEL);control(hwnd,L"BUTTON",L"Зберегти",WS_TABSTOP|BS_DEFPUSHBUTTON,506,y+6,142,36,IDOK);if(!f->controls.empty())SetFocus(f->controls.front());return 0;}if(msg==WM_COMMAND&&LOWORD(wp)==IDOK){J b=J::object();for(size_t i=0;i<f->fields.size();++i){auto&field=f->fields[i];HWND h=f->controls[i];if(field.multiple){J ids=J::array();for(size_t j=0;j<field.choices.size();++j)if(SendMessageW(h,LB_GETSEL,j,0)>0)ids.push_back(field.choices[j].value);b[field.key]=ids;}else if(!field.choices.empty()){auto idx=(int)SendMessageW(h,CB_GETCURSEL,0,0);if(idx<0)return 0;b[field.key]=field.choices[idx].value;}else b[field.key]=utf8(readText(h));}EnableWindow(GetDlgItem(hwnd,IDOK),FALSE);try{f->submit(b);f->accepted=true;DestroyWindow(hwnd);}catch(const std::exception&e){MessageBoxW(hwnd,wide(e.what()).c_str(),L"Перевірте дані",MB_OK|MB_ICONWARNING);EnableWindow(GetDlgItem(hwnd,IDOK),TRUE);}return 0;}if(msg==WM_CLOSE||(msg==WM_COMMAND&&LOWORD(wp)==IDCANCEL)){DestroyWindow(hwnd);return 0;}return DefWindowProcW(hwnd,msg,wp,lp);}
bool form(HWND owner,const std::wstring&title,std::vector<Field>fields,std::function<void(const J&)>submit){Form f{std::move(fields),{},std::move(submit),false,owner};int height=105;for(auto&x:f.fields)height+=25+(x.multiple?90:x.multiline?80:30)+12;RECT area{};SystemParametersInfoW(SPI_GETWORKAREA,0,&area,0);int w=690,h=height+30;HWND window=CreateWindowExW(WS_EX_DLGMODALFRAME,L"SolviaForm",title.c_str(),WS_CAPTION|WS_SYSMENU,(area.right-w)/2,std::max(0L,(area.bottom-h)/2),w,h,owner,nullptr,instance,&f);if(!window)throw std::runtime_error("Не вдалося відкрити форму");EnableWindow(owner,FALSE);ShowWindow(window,SW_SHOW);MSG msg{};while(IsWindow(window)&&GetMessageW(&msg,nullptr,0,0)>0){
if(msg.message==WM_KEYDOWN&&msg.wParam==VK_RETURN){wchar_t cls[32]{};GetClassNameW(msg.hwnd,cls,32);bool multiline=wcscmp(cls,L"EDIT")==0&&(GetWindowLongPtrW(msg.hwnd,GWL_STYLE)&ES_MULTILINE);if(!multiline){int action=wcscmp(cls,L"Button")==0&&GetDlgCtrlID(msg.hwnd)==IDCANCEL?IDCANCEL:IDOK;SendMessageW(window,WM_COMMAND,action,0);continue;}}
if(!IsDialogMessageW(window,&msg)){TranslateMessage(&msg);DispatchMessageW(&msg);}}EnableWindow(owner,TRUE);SetForegroundWindow(owner);return f.accepted;}
std::vector<Choice> choices(const J&rows){std::vector<Choice> out;for(auto&r:rows)out.push_back({value(r,"name"),r["id"]});return out;}
void clipboard(HWND owner,const std::wstring&text){if(!OpenClipboard(owner))throw std::runtime_error("Буфер обміну недоступний");EmptyClipboard();auto mem=GlobalAlloc(GMEM_MOVEABLE,(text.size()+1)*sizeof(wchar_t));if(!mem){CloseClipboard();throw std::runtime_error("Недостатньо пам’яті");}auto data=GlobalLock(mem);if(!data){GlobalFree(mem);CloseClipboard();throw std::runtime_error("Недостатньо пам’яті");}memcpy(data,text.c_str(),(text.size()+1)*sizeof(wchar_t));GlobalUnlock(mem);if(!SetClipboardData(CF_UNICODETEXT,mem))GlobalFree(mem);CloseClipboard();}
}
class App{HIMAGELIST rowHeight{};HWND window{},table{},login{},password{},server{},date{},search{},logoutButton{};int tableTop=276;std::vector<HWND> widgets;std::vector<std::pair<std::wstring,std::string>> nav;std::vector<HWND> navButtons;std::vector<HWND> actions;ComPtr<ID2D1Factory> factory;ComPtr<IDWriteFactory> writer;ComPtr<ID2D1HwndRenderTarget> target;Api api;J user,meta,rows=J::array(),shown=J::array(),stats=J::object(),card;std::string page="calendar",selectedDay=dateToday();bool signedIn=false;std::wstring title=L"Ваш простір турботи",subtitle=L"Увійдіть, щоб почати роботу";std::vector<std::pair<std::wstring,int>> columns;
void text(const std::wstring&s,float x,float y,float w,float h,float size,D2D1_COLOR_F color,bool bold=false){ComPtr<IDWriteTextFormat>format;ComPtr<ID2D1SolidColorBrush>brush;writer->CreateTextFormat(L"Segoe UI",nullptr,bold?DWRITE_FONT_WEIGHT_SEMI_BOLD:DWRITE_FONT_WEIGHT_NORMAL,DWRITE_FONT_STYLE_NORMAL,DWRITE_FONT_STRETCH_NORMAL,size,L"uk-UA",&format);format->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);target->CreateSolidColorBrush(color,&brush);target->DrawText(s.c_str(),(UINT32)s.size(),format.Get(),D2D1::RectF(x,y,x+w,y+h),brush.Get());}
void rect(float x,float y,float w,float h,D2D1_COLOR_F color,float radius=0){ComPtr<ID2D1SolidColorBrush>b;target->CreateSolidColorBrush(color,&b);target->FillRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(x,y,x+w,y+h),radius,radius),b.Get());}
void makeTarget(){if(target)return;RECT r{};GetClientRect(window,&r);factory->CreateHwndRenderTarget(D2D1::RenderTargetProperties(),D2D1::HwndRenderTargetProperties(window,D2D1::SizeU(r.right,r.bottom)),&target);if(target)target->SetDpi(96,96);}
void brand(float x,float y){
    auto color=D2D1::ColorF(ui::MintHex);
    rect(x,y+8,4,23,color,2);rect(x+8,y,4,36,color,2);rect(x+16,y+12,4,18,color,2);
    text(L"SOLVIA",x+34,y+1,165,40,26,D2D1::ColorF(0xF4F6EC),true);
}
void paint(){
    makeTarget();if(!target)return;
    RECT r{};GetClientRect(window,&r);
    auto ink=D2D1::ColorF(ui::InkHex),muted=D2D1::ColorF(0x697F74),paper=D2D1::ColorF(0xFFFFFC);
    target->BeginDraw();target->Clear(D2D1::ColorF(ui::CanvasHex));
    rect(0,0,ui::sidebar,(float)r.bottom,ink);
    brand(27,38);text(L"Психологічний центр",28,94,202,25,12,D2D1::ColorF(0xA9C4B5));
    rect(28,143,190,1,D2D1::ColorF(0x34524A));
    text(signedIn?L"РОБОЧИЙ ПРОСТІР":L"ВАШ ПРОСТІР ТУРБОТИ",28,163,205,22,10,D2D1::ColorF(0xA9C4B5),true);
    text(L"SOLVIA  /  ЦЕНТР ТУРБОТИ",ui::content,32,650,25,11,muted,true);
    text(title,ui::content,73,(float)r.right-ui::content-ui::margin,48,32,ink,true);
    text(subtitle,ui::content+1,126,(float)r.right-ui::content-ui::margin,34,14,muted);
    rect(ui::content,166,(float)r.right-ui::content-ui::margin,1,D2D1::ColorF(0xDBE4D7));
    if(!signedIn){
        rect(ui::content,195,620,414,paper,20);
        text(L"Сервер центру",312,218,560,25,12,muted,true);
        text(L"Логін",312,312,560,25,12,muted,true);
        text(L"Пароль",312,406,560,25,12,muted,true);
        text(L"Вхід до персонального робочого простору",312,564,560,25,11,muted);
        text(L"Менше рутини.",ui::content,652,800,40,27,ink,true);
        text(L"Більше уваги людині.",ui::content,692,800,40,27,ink,true);
        if(r.right>1450){
            float x=990;rect(x,246,(float)r.right-x-50,310,D2D1::ColorF(0xD3EFDF),22);
            text(L"Один простір.",x+28,285,(float)r.right-x-85,45,28,ink,true);
            text(L"Уся команда.",x+28,333,(float)r.right-x-85,45,28,ink,true);
            text(L"Записи. Консультації. Підсумки.",x+28,415,(float)r.right-x-85,30,14,muted);
        }
    }else{
        float width=(float)r.right-ui::content-ui::margin;
        if(page=="dashboard"){
            float cardWidth=(width-48)/4;
            const wchar_t*labels[]={L"Пацієнтів у базі",L"Нові за місяць",L"Консультацій",L"Повторних прийомів"};
            const char*keys[]={"total_patients","new_patients","consultations","repeat_visits"};
            for(int i=0;i<4;++i){
                float x=ui::content+i*(cardWidth+16);
                rect(x,192,cardWidth,125,i==0?D2D1::ColorF(0xD3EFDF):paper,15);
                text(labels[i],x+20,210,cardWidth-34,25,12,muted,true);
                text(value(stats,keys[i]),x+20,244,cardWidth-35,51,37,ink,true);
            }
            text(L"Завантаження психологів",ui::content,351,width,32,21,ink,true);
            auto cancelled=stats.value("appointments",J::object()).value("cancelled",0);
            text(L"Поточний місяць   /   Скасовано записів: "+std::to_wstring(cancelled),ui::content,385,width,24,12,muted);
        }else if(page=="card"){
            rect(ui::content,184,width,87,D2D1::ColorF(0xD3EFDF),15);
            text(value(card,"category")+L"   ·   "+value(card,"dob")+L"   ·   "+value(card,"phone"),ui::content+20,201,width-40,27,14,ink,true);
            text(L"Сім’я: "+value(card,"family")+L"   /   "+value(card,"family_role"),ui::content+20,238,width-40,24,12,muted);
        }
        rect(ui::content-1,(float)tableTop-1,width+2,(float)r.bottom-tableTop-25,paper,12);
        rect(16,(float)r.bottom-135,216,78,D2D1::ColorF(0x1F4039),12);
        text(roleName(user.value("role","")),30,(float)r.bottom-119,185,25,11,D2D1::ColorF(0xA9C4B5));
        text(value(user,"name"),30,(float)r.bottom-92,185,25,13,D2D1::ColorF(0xF4F6EC),true);
    }
    text(L"QureMed Industries",28,(float)r.bottom-34,200,22,11,D2D1::ColorF(0xA9C4B5));
    auto hr=target->EndDraw();if(hr==D2DERR_RECREATE_TARGET)target.Reset();
}
HWND add(const wchar_t*cls,const std::wstring&t,DWORD style,int x,int y,int w,int h,int id){if(wcscmp(cls,L"BUTTON")==0)style=(style&~0xFUL)|BS_OWNERDRAW;auto c=control(window,cls,t,style,x,y,w,h,id);widgets.push_back(c);return c;}
void clear(){for(auto h:widgets)DestroyWindow(h);if(rowHeight){ImageList_Destroy(rowHeight);rowHeight=nullptr;}widgets.clear();navButtons.clear();actions.clear();table=login=password=server=date=search=logoutButton=nullptr;}
void action(const std::wstring&t,int id){auto h=add(L"BUTTON",t,WS_TABSTOP,0,0,145,34,id);actions.push_back(h);}
void layout(){
    RECT r{};GetClientRect(window,&r);
    if(logoutButton)MoveWindow(logoutButton,20,r.bottom-191,208,42,TRUE);
    int y=page=="card"?290:search?238:204,x=ui::content;
    if(search)MoveWindow(search,ui::content,184,std::min(520L,r.right-ui::content-ui::margin),38,TRUE);
    if(date){MoveWindow(date,x,y,138,40,TRUE);x+=150;}
    HDC dc=GetDC(window);auto oldFont=SelectObject(dc,font);
    for(auto h:actions){
        auto label=readText(h);SIZE size{};GetTextExtentPoint32W(dc,label.c_str(),(int)label.size(),&size);
        int width=std::clamp((int)size.cx+34,116,230);
        if(x+width>r.right-ui::margin&&x>ui::content){x=ui::content;y+=50;}
        MoveWindow(h,x,y,width,40,TRUE);x+=width+10;
    }
    SelectObject(dc,oldFont);ReleaseDC(window,dc);
    tableTop=page=="dashboard"?426:y+64;
    if(table)MoveWindow(table,ui::content+12,tableTop+6,std::max(300L,r.right-ui::content-ui::margin-24),std::max(90L,r.bottom-tableTop-44),TRUE);
    InvalidateRect(window,nullptr,FALSE);
}
void loginPage(){clear();signedIn=false;user=J();card=J();rows=J::array();shown=J::array();stats=J::object();api.token.clear();title=L"Раді бачити вас у SOLVIA";subtitle=L"Увійдіть до свого робочого простору";
server=add(L"EDIT",api.base,WS_BORDER|WS_TABSTOP|ES_AUTOHSCROLL,312,247,572,40,11);
login=add(L"EDIT",L"",WS_BORDER|WS_TABSTOP|ES_AUTOHSCROLL,312,341,572,40,12);
password=add(L"EDIT",L"",WS_BORDER|WS_TABSTOP|ES_PASSWORD,312,435,572,40,13);
add(L"BUTTON",L"Увійти до центру",WS_TABSTOP|BS_DEFPUSHBUTTON,312,500,572,46,14);
SetFocus(login);InvalidateRect(window,nullptr,FALSE);
}
void shell(){clear();std::string role=user.value("role","");nav.clear();if(role=="admin"||role=="director")nav.push_back({L"Огляд центру","dashboard"});if(role!="director"){nav.push_back({L"Календар","calendar"});nav.push_back({role=="psychologist"?L"Мої пацієнти":L"Пацієнти","patients"});}if(role=="admin"||role=="reception")nav.push_back({L"Сім’ї","families"});if(role=="admin"){nav.push_back({L"Команда","users"});nav.push_back({L"Кабінети","rooms"});nav.push_back({L"Журнал дій","audit"});}for(size_t i=0;i<nav.size();++i)navButtons.push_back(add(L"BUTTON",nav[i].first,WS_TABSTOP,20,198+(int)i*50,208,42,100+(int)i));logoutButton=add(L"BUTTON",L"Вийти",WS_TABSTOP,20,560,208,42,90);}
void setupTable(const std::vector<std::pair<std::wstring,int>>&cols){columns=cols;table=add(WC_LISTVIEWW,L"",WS_TABSTOP|LVS_REPORT|LVS_SINGLESEL|LVS_SHOWSELALWAYS,278,264,800,400,50);SetWindowSubclass(table,ui::tableProc,2,0);rowHeight=ImageList_Create(1,48,ILC_COLOR32,1,1);ListView_SetImageList(table,rowHeight,LVSIL_SMALL);ListView_SetExtendedListViewStyle(table,LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER|LVS_EX_LABELTIP);ListView_SetBkColor(table,ui::paper);ListView_SetTextBkColor(table,ui::paper);ListView_SetTextColor(table,ui::ink);auto header=ListView_GetHeader(table);SendMessageW(header,WM_SETFONT,(WPARAM)ui::resources().label,TRUE);int i=0;for(auto&[name,width]:cols){LVCOLUMNW c{};c.mask=LVCF_TEXT|LVCF_WIDTH;c.pszText=const_cast<wchar_t*>(name.c_str());c.cx=width;ListView_InsertColumn(table,i++,&c);}}
void row(const std::vector<std::wstring>&cells){int i=ListView_GetItemCount(table);LVITEMW item{};item.mask=LVIF_TEXT;item.iItem=i;item.pszText=const_cast<wchar_t*>(cells[0].c_str());ListView_InsertItem(table,&item);for(size_t j=1;j<cells.size();++j)ListView_SetItemText(table,i,(int)j,const_cast<wchar_t*>(cells[j].c_str()));}
std::wstring statusName(const J&a){auto s=a.value("status","");return s=="completed"?L"Проведено":s=="cancelled"?L"Скасовано":L"Заплановано";}
void fill(){ListView_DeleteAllItems(table);shown=J::array();auto filter=search?utf8(readText(search)):"";for(auto&a:rows){if(!filter.empty()&&a.value("name","").find(filter)==std::string::npos&&a.value("phone","").find(filter)==std::string::npos)continue;shown.push_back(a);if(page=="patients")row({value(a,"name"),value(a,"category"),value(a,"phone"),value(a,"psychologist"),value(a,"family")});else if(page=="calendar"){std::wstring names;for(auto&p:a["patients"]){if(!names.empty())names+=L", ";names+=value(p,"name");}row({value(a,"start").substr(11)+L" – "+value(a,"end").substr(11),names,value(a,"psychologist"),value(a,"room"),a["kind"]=="group"?L"Групове":L"Індивідуальне",statusName(a)});}else if(page=="dashboard")row({value(a,"name"),value(a,"appointments"),value(a,"hours")});else if(page=="users")row({value(a,"name"),value(a,"login"),roleName(a.value("role",""))});else if(page=="audit")row({value(a,"created"),value(a,"actor"),value(a,"event"),value(a,"entity"),value(a,"entity_id")});else if(page=="card")row({value(a,"created"),value(a,"note"),value(a,"goals"),value(a,"next_plan"),value(a,"homework")});else row({value(a,"name"),value(a,"id")});}layout();}
void load(const std::string&p){page=p;meta=api.call("GET","/api/meta");shell();if(page=="dashboard"){title=L"Огляд центру";subtitle=L"Підсумки поточного місяця • без приватних записів";stats=api.call("GET","/api/stats");rows=stats["load"];setupTable({{L"Психолог",390},{L"Записів",170},{L"Годин у розкладі",210}});}else if(page=="calendar"){title=L"Календар центру";subtitle=L"Простір для кожної зустрічі • 08:00–20:00";date=add(L"EDIT",wide(selectedDay),WS_BORDER|WS_TABSTOP,0,0,126,34,20);action(L"Оновити день",21);if(user["role"]!="psychologist"){action(L"Новий запис",22);action(L"Вільні години",23);action(L"Перенести",24);action(L"Скасувати запис",25);}else action(L"Відкрити пацієнта",26);rows=api.call("GET","/api/appointments?date="+selectedDay);setupTable({{L"Час",135},{L"Пацієнти",250},{L"Психолог",210},{L"Кабінет",145},{L"Тип",125},{L"Статус",130}});}else if(page=="patients"){title=user["role"]=="psychologist"?L"Мої пацієнти":L"Пацієнти";subtitle=L"Окремий шлях відновлення для кожної людини";search=add(L"EDIT",L"",WS_BORDER|WS_TABSTOP|ES_AUTOHSCROLL,0,0,450,28,30);SendMessageW(search,EM_SETCUEBANNER,TRUE,(LPARAM)L"Пошук за ПІБ або телефоном (з урахуванням регістру)");action(L"Відкрити картку",31);if(user["role"]!="psychologist")action(L"Додати пацієнта",32);action(L"Оновити",33);rows=api.call("GET","/api/patients");setupTable({{L"ПІБ",250},{L"Категорія",180},{L"Телефон",160},{L"Психолог",210},{L"Сім’я",170}});}else if(page=="card"){card=api.call("GET","/api/patients/"+std::to_string(card["id"].get<int>()));title=value(card,"name");subtitle=user["role"]=="psychologist"?L"Особиста картка • записи доступні лише призначеному психологу":L"Реєстраційна картка • приватні нотатки недоступні";date=add(L"EDIT",wide(selectedDay),WS_BORDER|WS_TABSTOP,0,0,126,34,20);action(L"Назад",34);if(user["role"]=="psychologist"){action(L"Консультація",35);action(L"Призначити анкету",36);action(L"Динаміка",37);}rows=card.value("consultations",J::array());setupTable({{L"Дата",180},{L"Нотатка",240},{L"Цілі",180},{L"Наступна сесія",210},{L"Домашні завдання",210}});}else if(page=="families"){title=L"Сім’ї";subtitle=L"Спільна сім’я — окремі приватні картки";action(L"Додати сім’ю",40);action(L"Учасники",42);rows=api.call("GET","/api/families");setupTable({{L"Назва сім’ї",500},{L"Номер",130}});}else if(page=="users"){title=L"Команда центру";subtitle=L"Індивідуальні облікові записи та чіткі ролі";action(L"Додати працівника",41);rows=api.call("GET","/api/users");setupTable({{L"Ім’я",310},{L"Логін",240},{L"Роль",250}});}else if(page=="rooms"){title=L"Кабінети";subtitle=L"Місця для індивідуальних і групових зустрічей";action(L"Додати кабінет",43);rows=meta["rooms"];setupTable({{L"Кабінет",500},{L"Номер",140}});}else{title=L"Журнал дій";subtitle=L"Хто і коли працював із системою • без текстів консультацій";rows=api.call("GET","/api/audit");setupTable({{L"Час",185},{L"Працівник",220},{L"Дія",100},{L"Об’єкт",145},{L"Номер",100}});}fill();}
J selection(){int i=ListView_GetNextItem(table,-1,LVNI_SELECTED);if(i<0||i>=(int)shown.size())throw std::runtime_error("Спочатку оберіть рядок");return shown[i];}
void openPatient(int id){card={{"id",id}};load("card");}
void newPatient(){auto families=api.call("GET","/api/families");auto fc=choices(families);fc.insert(fc.begin(),{L"Без сімейного зв’язку",nullptr});std::vector<Choice>cats;for(auto&c:meta["categories"])cats.push_back({wide(c.get<std::string>()),c});auto psy=choices(meta["psychologists"]);if(psy.empty())throw std::runtime_error("Адміністратор має спочатку додати психолога");if(form(window,L"Новий пацієнт",{{"name",L"ПІБ"},{"phone",L"Телефон"},{"dob",L"Дата народження (YYYY-MM-DD)"},{"category",L"Категорія","",cats},{"psychologist_id",L"Психолог","",psy},{"family_id",L"Сім’я","",fc},{"family_role",L"Роль у сім’ї (за потреби)"}},[&](const J&b){api.call("POST","/api/patients",b);}))load("patients");}
void booking(bool edit){J old;if(edit)old=selection();auto patients=api.call("GET","/api/patients");auto pc=choices(patients),psy=choices(meta["psychologists"]),rooms=choices(meta["rooms"]);if(pc.empty()||psy.empty()||rooms.empty())throw std::runtime_error("Додайте пацієнта, психолога й кабінет");selectedDay=date?utf8(readText(date)):selectedDay;auto start=edit?old["start"].get<std::string>():selectedDay+"T09:00";auto end=edit?old["end"].get<std::string>():selectedDay+"T10:00";std::vector<Field> fields={{"psychologist_id",L"Психолог",edit?old["psychologist_id"].dump():"",psy},{"room_id",L"Кабінет",edit?old["room_id"].dump():"",rooms},{"start",L"Початок (YYYY-MM-DDTHH:MM)",start},{"end",L"Кінець (YYYY-MM-DDTHH:MM)",end},{"kind",L"Тип зустрічі",edit?old["kind"].get<std::string>():"individual",{{L"Індивідуальна","individual"},{L"Групове заняття","group"}}}};
if(edit){std::wstring names;for(auto&p:old["patients"])names+=value(p,"name")+L"; ";fields.push_back({"display",L"Учасники (зберігаються при перенесенні)",utf8(names),{},false,false,false,true});}else fields.push_back({"patient_ids",L"Учасники • Ctrl + клік для групи; один призначений психолог","",pc,false,false,true});
if(form(window,edit?L"Перенести запис":L"Новий запис",fields,[&](const J&input){J b=input;if(edit){b.erase("display");b["patient_ids"]=J::array();for(auto&p:old["patients"])b["patient_ids"].push_back(p["id"]);}api.call(edit?"PATCH":"POST",edit?"/api/appointments/"+old["id"].dump():"/api/appointments",b);}))load("calendar");}
void slots(){selectedDay=utf8(readText(date));auto psy=choices(meta["psychologists"]),rooms=choices(meta["rooms"]);if(psy.empty()||rooms.empty())throw std::runtime_error("Додайте психолога й кабінет");form(window,L"Вільні години",{{"psychologist_id",L"Психолог","",psy},{"room_id",L"Кабінет","",rooms},{"date",L"Дата",selectedDay}},[&](const J&b){auto s=api.call("GET","/api/slots?date="+b["date"].get<std::string>()+"&psychologist_id="+b["psychologist_id"].dump()+"&room_id="+b["room_id"].dump());std::wstring msg=L"Вільні годинні слоти:\n\n";for(auto&v:s)msg+=wide(v.get<std::string>())+L"   ";if(s.empty())msg+=L"Вільних годин немає";msg+=L"\n\nПри збереженні запису також перевіряється зайнятість пацієнта.";MessageBoxW(window,msg.c_str(),L"Календар доступності",MB_OK);});}
void consultation(){selectedDay=utf8(readText(date));auto apps=api.call("GET","/api/appointments?date="+selectedDay);std::vector<Choice> opts;for(auto&a:apps)if(a["status"]=="scheduled")for(auto&p:a["patients"])if(p["id"]==card["id"]){bool done=false;for(auto&c:card.value("consultations",J::array()))if(c["appointment_id"]==a["id"])done=true;if(!done)opts.push_back({value(a,"start")+L" • "+value(a,"room"),a["id"]});}if(opts.empty())throw std::runtime_error("На обрану дату немає незавершеного запису цього пацієнта. Перевірте дату над таблицею.");if(form(window,L"Підсумок консультації",{{"appointment_id",L"Запис","",opts},{"note",L"Приватна нотатка (обов’язково)","",{},true},{"goals",L"Цілі роботи","",{},true},{"next_plan",L"План наступної консультації","",{},true},{"homework",L"Домашні завдання","",{},true}},[&](const J&input){J b=input;b["patient_id"]=card["id"];api.call("POST","/api/consultations",b);}))load("card");}
void assessments(){auto a=api.call("GET","/api/patients/"+card["id"].dump());std::string output="Самопочуття сьогодні • 3 запитання, кожне 0–10.\r\nАвторська анкета, не діагностичний інструмент.\r\nБільший бал означає краще суб’єктивне самопочуття.\r\n\r\n";J previous=nullptr;for(auto&r:a["assessments"]){output+=r["created"].get<std::string>()+"  |  ";if(r["completed"].is_null())output+="Очікує відповідей";else{output+=r["score"].dump()+" / 30";if(!previous.is_null()){int diff=r["score"].get<int>()-previous.get<int>();output+="  |  зміна "+std::string(diff>=0?"+":"")+std::to_string(diff);}previous=r["score"];output+="  |  відповіді "+r["answers"].get<std::string>();}output+="\r\n";}if(a["assessments"].empty())output+="Анкет ще немає.";form(window,L"Динаміка самопочуття",{{"text",L"Історія результатів",output,{},true,false,false,true}},[](const J&){});}
void command(int id){if(id==14){api.base=readText(server);while(!api.base.empty()&&api.base.back()==L'/')api.base.pop_back();auto result=api.call("POST","/api/login",{{"login",utf8(readText(login))},{"password",utf8(readText(password))}});SetWindowTextW(password,L"");api.token=result["token"];user=result["user"];signedIn=true;load(user["role"]=="admin"||user["role"]=="director"?"dashboard":"calendar");return;}if(!signedIn)return;if(id==90){try{api.call("POST","/api/logout");}catch(...){MessageBoxW(window,L"Сервер недоступний. Локальний сеанс закрито; серверний токен спливе автоматично.",L"SOLVIA",MB_OK);}loginPage();return;}if(id>=100&&id<100+(int)nav.size()){load(nav[id-100].second);return;}if(id==21){selectedDay=utf8(readText(date));load("calendar");}else if(id==22)booking(false);else if(id==23)slots();else if(id==24)booking(true);else if(id==25){auto a=selection();if(MessageBoxW(window,L"Скасувати цей запис?",L"SOLVIA",MB_YESNO|MB_ICONQUESTION)==IDYES){api.call("PATCH","/api/appointments/"+a["id"].dump(),{{"status","cancelled"}});load("calendar");}}else if(id==26){auto a=selection();if(a["patients"].size()==1)openPatient(a["patients"][0]["id"]);else{int pid=0;form(window,L"Учасник заняття",{{"id",L"Пацієнт","",choices(a["patients"])}},[&](const J&b){pid=b["id"];});if(pid)openPatient(pid);}}else if(id==31)openPatient(selection()["id"]);else if(id==32)newPatient();else if(id==33)load("patients");else if(id==34)load("patients");else if(id==35)consultation();else if(id==36){auto result=api.call("POST","/api/assessments",{{"patient_id",card["id"]}});auto link=api.base+wide(result["link"].get<std::string>());clipboard(window,link);MessageBoxW(window,(L"Посилання скопійовано. Воно діє 7 днів і приймає одну відповідь.\n\n"+link+L"\n\nДля іншого пристрою потрібна мережева HTTPS-адреса сервера.").c_str(),L"Анкету призначено",MB_OK);load("card");}else if(id==37)assessments();else if(id==40){if(form(window,L"Нова сім’я",{{"name",L"Назва сім’ї"}},[&](const J&b){api.call("POST","/api/families",b);}))load("families");}else if(id==41){if(form(window,L"Новий працівник",{{"name",L"ПІБ"},{"login",L"Логін"},{"password",L"Пароль (мінімум 12 символів)","",{},false,true},{"role",L"Роль","psychologist",{{L"Психолог","psychologist"},{L"Реєстратура","reception"},{L"Керівник центру","director"},{L"Адміністратор","admin"}}}},[&](const J&b){api.call("POST","/api/users",b);}))load("users");}else if(id==42){auto family=selection();auto all=api.call("GET","/api/patients");std::wstring text=L"";for(auto&p:all)if(p["family_id"]==family["id"])text+=value(p,"name")+L" • "+value(p,"family_role")+L"\n";MessageBoxW(window,text.empty()?L"Ще немає учасників. Оберіть сім’ю при реєстрації пацієнта.":text.c_str(),value(family,"name").c_str(),MB_OK);}else if(id==43){if(form(window,L"Новий кабінет",{{"name",L"Назва кабінету"}},[&](const J&b){api.call("POST","/api/rooms",b);}))load("rooms");}}
void doubleClick(){if(page=="patients")command(31);else if(page=="calendar")command(26);else if(page=="card"){auto a=selection();form(window,L"Консультація • лише читання",{{"note",L"Нотатка",a.value("note",""),{},true,false,false,true},{"goals",L"Цілі",a.value("goals",""),{},true,false,false,true},{"next_plan",L"Наступна консультація",a.value("next_plan",""),{},true,false,false,true},{"homework",L"Домашні завдання",a.value("homework",""),{},true,false,false,true}},[](const J&){});}}
public:
static LRESULT CALLBACK proc(HWND h,UINT msg,WPARAM wp,LPARAM lp){auto*a=(App*)GetWindowLongPtrW(h,GWLP_USERDATA);if(msg==WM_NCCREATE){a=(App*)((CREATESTRUCTW*)lp)->lpCreateParams;a->window=h;SetWindowLongPtrW(h,GWLP_USERDATA,(LONG_PTR)a);}return a?a->handle(msg,wp,lp):DefWindowProcW(h,msg,wp,lp);}
LRESULT handle(UINT msg,WPARAM wp,LPARAM lp){try{switch(msg){case WM_CREATE:loginPage();return 0;case WM_COMMAND:if(LOWORD(wp)==30&&HIWORD(wp)==EN_CHANGE){fill();return 0;}if(HIWORD(wp)==BN_CLICKED)command(LOWORD(wp));return 0;case WM_CTLCOLORSTATIC:case WM_CTLCOLOREDIT:case WM_CTLCOLORLISTBOX:return (LRESULT)ui::controlColors((HDC)wp,msg==WM_CTLCOLORSTATIC);
case WM_DRAWITEM:{
    auto*d=(DRAWITEMSTRUCT*)lp;if(d->CtlType!=ODT_BUTTON)break;
    int id=(int)d->CtlID;bool side=id>=100||id==90;
    bool active=id>=100&&id<100+(int)nav.size()&&(nav[id-100].second==page||(page=="card"&&nav[id-100].second=="patients"));
    ui::Icon icon=ui::Icon::None;
    if(id==90)icon=ui::Icon::Logout;
    if(id>=100&&id<100+(int)nav.size()){
        const auto&p=nav[id-100].second;
        icon=p=="dashboard"?ui::Icon::Overview:p=="calendar"?ui::Icon::Calendar:p=="patients"?ui::Icon::Patients:p=="families"?ui::Icon::Family:p=="users"?ui::Icon::Team:p=="rooms"?ui::Icon::Room:ui::Icon::Audit;
    }
    ui::drawButton(*d,font,id==14||id==22||id==32||id==35||id==41,side,active,icon,id==25);return TRUE;
}
case WM_NOTIFY:{
    auto*header=(NMHDR*)lp;
    if(header->idFrom==50&&header->code==NM_DBLCLK){doubleClick();return 0;}
    if(header->code==NM_CUSTOMDRAW&&header->hwndFrom==table){
        auto*draw=(NMLVCUSTOMDRAW*)lp;
        if(draw->nmcd.dwDrawStage==CDDS_PREPAINT)return CDRF_NOTIFYITEMDRAW|CDRF_NOTIFYPOSTPAINT;
        if(draw->nmcd.dwDrawStage==CDDS_POSTPAINT&&shown.empty()){
            RECT area{};GetClientRect(table,&area);area.left+=24;area.right-=24;area.top=80;
            SetBkMode(draw->nmcd.hdc,TRANSPARENT);SetTextColor(draw->nmcd.hdc,ui::muted);
            auto old=SelectObject(draw->nmcd.hdc,font);
            ::DrawTextW(draw->nmcd.hdc,L"Записів поки немає. Оновіть дані або скористайтеся діями вище.",-1,&area,DT_CENTER|DT_WORDBREAK);
            SelectObject(draw->nmcd.hdc,old);return CDRF_DODEFAULT;
        }
        if(draw->nmcd.dwDrawStage==CDDS_ITEMPREPAINT){
            const bool selected=ListView_GetItemState(table,(int)draw->nmcd.dwItemSpec,LVIS_SELECTED)!=0;
            draw->clrText=ui::ink;draw->clrTextBk=selected?ui::selected:(draw->nmcd.dwItemSpec%2?RGB(246,248,240):ui::paper);
            return CDRF_NEWFONT;
        }
    }
    if(table&&header->hwndFrom==ListView_GetHeader(table)&&header->code==NM_CUSTOMDRAW){
        auto*draw=(NMCUSTOMDRAW*)lp;
        if(draw->dwDrawStage==CDDS_PREPAINT)return CDRF_NOTIFYITEMDRAW;
        if(draw->dwDrawStage==CDDS_ITEMPREPAINT){
            auto brush=CreateSolidBrush(ui::soft);FillRect(draw->hdc,&draw->rc,brush);DeleteObject(brush);
            HDITEMW item{};wchar_t label[160]{};item.mask=HDI_TEXT;item.pszText=label;item.cchTextMax=160;
            Header_GetItem(header->hwndFrom,(int)draw->dwItemSpec,&item);
            RECT rect=draw->rc;rect.left+=12;rect.right-=8;
            auto old=SelectObject(draw->hdc,ui::resources().label);SetTextColor(draw->hdc,ui::muted);SetBkMode(draw->hdc,TRANSPARENT);
            ::DrawTextW(draw->hdc,label,-1,&rect,DT_SINGLELINE|DT_VCENTER|DT_END_ELLIPSIS);
            SelectObject(draw->hdc,old);return CDRF_SKIPDEFAULT;
        }
    }
    return 0;
}case WM_SIZE:if(target)target->Resize(D2D1::SizeU(std::max(1,(int)LOWORD(lp)),std::max(1,(int)HIWORD(lp))));layout();return 0;case WM_GETMINMAXINFO:((MINMAXINFO*)lp)->ptMinTrackSize={1280,780};return 0;case WM_PAINT:{PAINTSTRUCT ps{};BeginPaint(window,&ps);paint();EndPaint(window,&ps);return 0;}case WM_ERASEBKGND:return 1;case WM_CLOSE:DestroyWindow(window);return 0;case WM_DESTROY:api.token.clear();PostQuitMessage(0);return 0;}}catch(const std::exception&e){MessageBoxW(window,wide(e.what()).c_str(),L"SOLVIA",MB_OK|MB_ICONWARNING);}return DefWindowProcW(window,msg,wp,lp);}
int run(){if(FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED,factory.GetAddressOf()))||FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED,__uuidof(IDWriteFactory),(IUnknown**)writer.GetAddressOf())))return 1;wchar_t env[2048]{};DWORD n=GetEnvironmentVariableW(L"SOLVIA_API",env,2048);if(n&&n<2048)api.base=env;WNDCLASSW wc{};wc.hInstance=instance;wc.hCursor=LoadCursor(nullptr,IDC_ARROW);wc.lpfnWndProc=proc;wc.lpszClassName=L"SolviaMain";RegisterClassW(&wc);WNDCLASSW fc{};fc.hInstance=instance;fc.hCursor=wc.hCursor;fc.lpfnWndProc=formProc;fc.lpszClassName=L"SolviaForm";fc.hbrBackground=ui::resources().canvasBrush;RegisterClassW(&fc);window=CreateWindowExW(0,L"SolviaMain",L"SOLVIA by QureMed • Центр психологічної реабілітації",WS_OVERLAPPEDWINDOW|WS_CLIPCHILDREN,CW_USEDEFAULT,CW_USEDEFAULT,1380,860,nullptr,nullptr,instance,this);if(!window)return 1;ShowWindow(window,SW_SHOWMAXIMIZED);MSG msg{};while(GetMessageW(&msg,nullptr,0,0)>0){if(msg.message==WM_KEYDOWN&&msg.wParam==VK_F5&&signedIn){try{load(page);}catch(const std::exception&e){MessageBoxW(window,wide(e.what()).c_str(),L"SOLVIA",MB_OK);}continue;}if(msg.message==WM_KEYDOWN&&msg.wParam==VK_RETURN&&!signedIn){SendMessageW(window,WM_COMMAND,14,0);continue;}if(!IsDialogMessageW(window,&msg)){TranslateMessage(&msg);DispatchMessageW(&msg);}}return (int)msg.wParam;}
};
int WINAPI wWinMain(HINSTANCE h,HINSTANCE,PWSTR,int){instance=h;SetProcessDPIAware();INITCOMMONCONTROLSEX cc{sizeof cc,ICC_LISTVIEW_CLASSES|ICC_STANDARD_CLASSES};InitCommonControlsEx(&cc);font=CreateFontW(-16,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");App app;auto result=app.run();DeleteObject(font);return result;}
