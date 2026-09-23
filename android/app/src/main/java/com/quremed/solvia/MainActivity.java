package com.quremed.solvia;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final String PREFS = "solvia_settings";
    private final int background = Color.rgb(244, 247, 244);
    private final int ink = Color.rgb(21, 58, 48);

    private LinearLayout root;
    private WebView web;
    private TextView status;
    private String origin = "";
    private boolean loadFailed;

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(background);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(
                insets.getSystemWindowInsetLeft(),
                insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(),
                insets.getSystemWindowInsetBottom()
            );
            return insets;
        });
        setContentView(root);

        String saved = prefs().getString("server", "");
        if (saved.isEmpty()) setup();
        else {
            try { connect(normalize(saved)); }
            catch (Exception e) { setup(); }
        }
    }

    private TextView text(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(ink);
        view.setPadding(22, 14, 22, 14);
        return view;
    }

    private Button button(String title) {
        Button button = new Button(this);
        button.setText(title);
        button.setAllCaps(false);
        return button;
    }

    private void destroyBrowser() {
        if (web != null) {
            root.removeView(web);
            web.stopLoading();
            web.destroy();
            web = null;
        }
    }

    private void setup() {
        destroyBrowser();
        root.removeAllViews();
        origin = "";

        root.addView(text("SOLVIA by QureMed", 16));
        root.addView(text("Психологічний центр\nу вашому планшеті", 30));
        root.addView(text(
            "Підключіться до Wi-Fi центру. На серверному ПК після встановлення SOLVIA буде показана адреса виду https://192.168.x.x. Введіть її один раз — застосунок запам’ятає сервер.",
            16
        ));

        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setHint("https://192.168.1.100");
        address.setTextColor(ink);
        address.setHintTextColor(Color.GRAY);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(prefs().getString("server", "https://192.168.1.100"));
        root.addView(address);

        status = text(
            "Якщо Android не довіряє серверу — встановіть файл QureMed-Local-CA.crt із серверного ПК як CA-сертифікат.",
            13
        );
        root.addView(status);

        Button connect = button("Підключитися до центру");
        root.addView(connect);
        connect.setOnClickListener(v -> {
            try { connect(normalize(address.getText().toString())); }
            catch (Exception e) { status.setText("Введіть тільки HTTPS-адресу серверного ПК без шляху, логіна чи пароля."); }
        });
    }

    static String normalize(String value) throws Exception {
        String s = value.trim();
        if (!s.contains("://")) s = "https://" + s;
        URI uri = new URI(s);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null ||
            uri.getQuery() != null || uri.getFragment() != null ||
            (!uri.getPath().isEmpty() && !uri.getPath().equals("/")) ||
            uri.getPort() == 0 || uri.getPort() > 65535) throw new IllegalArgumentException();

        return new URI(
            "https", null, uri.getHost().toLowerCase(Locale.ROOT),
            uri.getPort() == 443 ? -1 : uri.getPort(), null, null, null
        ).toString();
    }

    private boolean sameOrigin(String value) {
        try {
            URI u = new URI(value), o = new URI(origin);
            return "https".equalsIgnoreCase(u.getScheme()) &&
                o.getHost().equalsIgnoreCase(u.getHost()) &&
                (u.getPort() == -1 ? 443 : u.getPort()) == (o.getPort() == -1 ? 443 : o.getPort()) &&
                u.getUserInfo() == null;
        } catch (Exception e) {
            return false;
        }
    }

    private String sslMessage(SslError error) {
        switch (error.getPrimaryError()) {
            case SslError.SSL_UNTRUSTED:
                return "Android не довіряє локальному сертифікату. Встановіть QureMed-Local-CA.crt як CA-сертифікат і перезапустіть SOLVIA.";
            case SslError.SSL_IDMISMATCH:
                return "IP сервера змінився. На серверному ПК запустіть Repair-Network.ps1 і введіть нову адресу в застосунку.";
            case SslError.SSL_EXPIRED:
            case SslError.SSL_NOTYETVALID:
            case SslError.SSL_DATE_INVALID:
                return "Перевірте автоматичні дату й час на серверному ПК та планшеті.";
            default:
                return "HTTPS-сертифікат відхилено Android. Код TLS: " + error.getPrimaryError();
        }
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private void connect(String server) {
        destroyBrowser();
        root.removeAllViews();
        origin = server;

        LinearLayout toolbar = new LinearLayout(this);
        Button settings = button("Сервер");
        Button reload = button("Оновити");
        toolbar.addView(settings);
        toolbar.addView(reload);
        root.addView(toolbar);

        status = text("Підключення…", 12);
        root.addView(status);

        settings.setOnClickListener(v -> new AlertDialog.Builder(this)
            .setMessage("Змінити адресу сервера SOLVIA?")
            .setNegativeButton("Назад", null)
            .setPositiveButton("Змінити", (d, w) -> setup())
            .show());

        web = new WebView(this);
        web.setBackgroundColor(background);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " SolviaAndroid/0.3");

        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        reload.setOnClickListener(v -> web.reload());

        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                loadFailed = false;
                status.setText("Підключення…");
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !sameOrigin(request.getUrl().toString());
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (!sameOrigin(url) && !url.startsWith("data:") && !url.startsWith("blob:" + origin + "/")) {
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                loadFailed = true;
                status.setText(sslMessage(error));
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    loadFailed = true;
                    status.setText("Сервер недоступний. Перевірте Wi-Fi центру, адресу сервера та чи запущений серверний ПК.");
                }
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (sameOrigin(url) && !loadFailed) {
                    prefs().edit().putString("server", origin).apply();
                    status.setText("Підключено · " + origin);
                }
            }
        });

        web.loadUrl(origin);
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override protected void onDestroy() {
        destroyBrowser();
        super.onDestroy();
    }
}
