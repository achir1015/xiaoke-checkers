package com.achir.xiaokecheckers;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 小柯機器人跳棋遊戲 — Android 版（直立畫面）
 * 用 WebView 開啟和桌面版同一份遊戲程式（放在 APK 的 assets/web）。
 * 網頁從 https://appassets.androidplatform.net/ 載入（安全來源：ES 模組、Worker、IndexedDB、麥克風才能用），
 * 由 shouldInterceptRequest 直接回傳 assets 裡的檔案；音樂支援 Range，可拖曳進度。
 * 離開 App（finish）時 WebView 一併銷毀：AI 計算、音樂、語音通話全部停止。
 */
public class MainActivity extends Activity {
    static final String TAG = "XiaokeCheckers";
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final int REQ_FILES = 1;
    static final int REQ_MIC = 2;
    static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");

    WebView web;
    Bridge bridge;
    ValueCallback<Uri[]> fileCallback;
    PermissionRequest pendingMic;
    String[] pendingRes;
    long lastBack = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        // 下棋時螢幕保持亮著
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        web.setBackgroundColor(0xFF1B1410);
        setContentView(web);
        immersive();
        WebView.setWebContentsDebuggingEnabled(BuildFlags.DEBUG);   // python build.py debug 才開（給 chrome://inspect 測試用）

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);   // 不跟著系統字型大小放大，版面才不會擠在一起
        s.setUserAgentString(s.getUserAgentString() + " XiaokeCheckersAndroid/" + Bridge.version(this));

        bridge = new Bridge(this);
        web.addJavascriptInterface(bridge, "XiaokeAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!ORIGIN.equals(u.getScheme() + "://" + u.getHost())) return null;
                return serve(u.getPath(), req.getRequestHeaders());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (ORIGIN.equals(u.getScheme() + "://" + u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            /** 匯入棋譜、加入自己的音樂：開啟系統的檔案選擇器 */
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                String[] types = p.getAcceptTypes();
                if (types != null) {
                    java.util.List<String> mimes = new java.util.ArrayList<>();
                    boolean audio = false;
                    for (String t : types) for (String x : t.split(",")) { x = x.trim(); if (x.startsWith("audio/")) audio = true; }
                    if (audio) { mimes.add("audio/*"); i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0])); }
                }
                try { startActivityForResult(i, REQ_FILES); }
                catch (Exception e) { fileCallback = null; return false; }
                return true;
            }

            /** 語音通話要用麥克風：先問 Android 的權限，再允許網頁使用 */
            @Override
            public void onPermissionRequest(final PermissionRequest r) {
                java.util.List<String> res = new java.util.ArrayList<>();
                for (String x : r.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(x)) res.add(x);
                if (res.isEmpty()) { r.deny(); return; }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { r.grant(res.toArray(new String[0])); return; }
                pendingMic = r;
                pendingRes = res.toArray(new String[0]);
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        web.loadUrl(ORIGIN + "/index.html");
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req == REQ_MIC && pendingMic != null) {
            boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) pendingMic.grant(pendingRes);
            else { pendingMic.deny(); Toast.makeText(this, "沒有麥克風權限：可以到「設定 → 應用程式 → 小柯跳棋 → 權限」打開", Toast.LENGTH_LONG).show(); }
            pendingMic = null;
        }
    }

    /** 回傳 assets/web 裡的檔案（音樂支援 Range 才能拖曳進度） */
    WebResourceResponse serve(String path, Map<String, String> reqHeaders) {
        try {
            if (path == null || path.equals("/")) path = "/index.html";
            String asset = "web" + Uri.decode(path);
            String m = mime(path);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            h.put("Access-Control-Allow-Origin", ORIGIN);
            String range = null;
            if (reqHeaders != null) for (Map.Entry<String, String> e : reqHeaders.entrySet()) if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
            if (m.startsWith("audio/")) {
                AssetFileDescriptor fd = getAssets().openFd(asset);   // mp3 以不壓縮方式打包，才能取得長度
                long len = fd.getLength();
                fd.close();
                h.put("Accept-Ranges", "bytes");
                if (range != null) {
                    Matcher rm = RANGE.matcher(range);
                    if (rm.find()) {
                        long start = rm.group(1).isEmpty() ? 0 : Long.parseLong(rm.group(1));
                        long end = rm.group(2).isEmpty() ? len - 1 : Math.min(len - 1, Long.parseLong(rm.group(2)));
                        InputStream in = getAssets().open(asset);
                        long skipped = 0;
                        while (skipped < start) { long k = in.skip(start - skipped); if (k <= 0) break; skipped += k; }
                        h.put("Content-Range", "bytes " + start + "-" + end + "/" + len);
                        h.put("Content-Length", String.valueOf(end - start + 1));
                        return new WebResourceResponse(m, null, 206, "Partial Content", h, new Limited(in, end - start + 1));
                    }
                }
                h.put("Content-Length", String.valueOf(len));
                return new WebResourceResponse(m, null, 200, "OK", h, getAssets().open(asset));
            }
            InputStream in = getAssets().open(asset);
            return new WebResourceResponse(m, m.startsWith("text") || m.endsWith("json") || m.endsWith("svg+xml") ? "utf-8" : null, 200, "OK", h, in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
    }

    /** 只讀固定長度的串流（Range 用） */
    static final class Limited extends java.io.FilterInputStream {
        long left;
        Limited(InputStream in, long n) { super(in); left = n; }
        @Override public int read() throws java.io.IOException { if (left <= 0) return -1; int c = super.read(); if (c >= 0) left--; return c; }
        @Override public int read(byte[] b, int off, int len) throws java.io.IOException {
            if (left <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
    }

    static String mime(String p) {
        p = p.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILES && fileCallback != null) {
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    out = new Uri[n];
                    for (int k = 0; k < n; k++) out[k] = data.getClipData().getItemAt(k).getUri();
                } else if (data.getData() != null) out = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(out);
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    /** 返回鍵：交給遊戲處理（關對話框、抽屜、離開對局）；在首頁時按兩次才離開 */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(function(){try{return !!(window.__xkBack&&window.__xkBack())}catch(e){return false}})()", v -> {
            if ("true".equals(v)) return;
            long now = System.currentTimeMillis();
            if (now - lastBack < 2000) { finish(); return; }
            lastBack = now;
            Toast.makeText(this, "再按一次返回鍵離開", Toast.LENGTH_SHORT).show();
        });
    }

    /** 給 Bridge 用：在網頁執行 JavaScript */
    void js(final String code) {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    /** 全螢幕：隱藏狀態列與導覽列，從邊緣滑動才暫時出現（棋盤才不會被擋住） */
    @SuppressWarnings("deprecation")
    void immersive() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onDestroy() {
        bridge.shutdown();
        web.removeJavascriptInterface("XiaokeAndroid");
        web.loadUrl("about:blank");
        web.destroy();
        web = null;
        super.onDestroy();
    }
}
