#pragma once
#include <QVariant>
#include <QPainter>
#include <QPdfWriter>
#include <QSaveFile>
#include <QTextDocument>
#include <QUrl>
namespace CarePdf {
inline QString text(const QVariant&value){return value.toString().toHtmlEscaped().replace("\n","<br>");}
inline bool save(const QUrl&url,const QString&title,const QString&html){
 if(!url.isLocalFile())return false;
 QSaveFile file(url.toLocalFile());if(!file.open(QIODevice::WriteOnly))return false;
 bool success=false;
 {
  QPdfWriter writer(&file);writer.setResolution(96);writer.setPageSize(QPageSize(QPageSize::A4));writer.setPageMargins(QMarginsF(16,16,16,16));writer.setTitle(title);writer.setCreator("Lemvori Care");
  QTextDocument document;document.setHtml("<html><body style='font-family:Sans Serif;font-size:11pt;color:#11212D'>"+html+"</body></html>");document.setPageSize(QSizeF(writer.width(),writer.height()));
  QPainter painter(&writer);
  if(painter.isActive()){
   success=true;
   for(int page=0;page<document.pageCount();++page){if(page>0&&!writer.newPage()){success=false;break;}painter.save();painter.translate(0,-page*writer.height());document.drawContents(&painter,QRectF(0,page*writer.height(),writer.width(),writer.height()));painter.restore();}
   painter.end();
  }
 }
 return success&&file.commit();
}
}
