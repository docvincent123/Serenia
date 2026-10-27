package com.quremed.solvia

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONObject
import java.util.concurrent.Executors

/** A maintenance notice never replaces the underlying screen or consultation draft. */
class ServiceStatusMonitor(private val activity: Activity, private val server: () -> String,
                           private val request: (String) -> JSONObject) {
    private val handler=Handler(Looper.getMainLooper())
    private val io=Executors.newSingleThreadExecutor()
    private var active=false
    private var running=false
    private var dialog: AlertDialog?=null
    private var text: TextView?=null
    private var quietUntil=0L
    private val tick=object:Runnable { override fun run(){check();if(active)handler.postDelayed(this,15000)} }
    fun resume(){active=true;handler.removeCallbacks(tick);handler.post(tick)}
    fun pause(){active=false;handler.removeCallbacks(tick)}
    fun close(){pause();dialog?.dismiss();dialog=null;io.shutdownNow()}
    fun check(){
        if(!active||running||server().isBlank())return
        running=true;val base=server()
        io.execute {
            try {
                val info=request(base)
                activity.runOnUiThread {
                    running=false
                    if(!active||activity.isDestroyed||server()!=base)return@runOnUiThread
                    if(info.optString("mode")=="ready"){dialog?.dismiss();dialog=null;quietUntil=0;return@runOnUiThread}
                    if(info.optString("mode")!="maintenance")return@runOnUiThread
                    val until=info.optLong("expected_until")
                    val minutes=((until-System.currentTimeMillis()/1000+59)/60).coerceAtLeast(0)
                    val estimate=if(until==0L) "Час завершення ще не вказаний." else if(minutes>0) "Орієнтовно залишилось $minutes хв." else "Оновлення триває довше запланованого."
                    val message=info.optString("message").ifBlank { "Адміністратор оновлює SOLVIA." }+"\n\n"+estimate+"\n\nПідключення відновиться автоматично. Перед закриттям програми збережіть текст у локальній чернетці."
                    if(dialog?.isShowing==true){text?.text=message;return@runOnUiThread}
                    if(System.currentTimeMillis()<quietUntil)return@runOnUiThread
                    val body=LinearLayout(activity).apply { orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER;setPadding(32,24,32,20) }
                    body.addView(ProgressBar(activity))
                    text=MobileUi.label(activity,message,16f).apply { setPadding(0,24,0,0) };body.addView(text)
                    dialog=AlertDialog.Builder(activity).setTitle("Сервер на оновленні").setView(body)
                        .setPositiveButton("Перевірити") { _,_->quietUntil=0;dialog=null;check() }
                        .setNegativeButton("До чернетки") { _,_->quietUntil=System.currentTimeMillis()+300000;dialog=null }
                        .setOnCancelListener { quietUntil=System.currentTimeMillis()+300000;dialog=null }.create()
                    dialog?.show()
                }
            }catch(_:Exception){activity.runOnUiThread { running=false }}
        }
    }
}
