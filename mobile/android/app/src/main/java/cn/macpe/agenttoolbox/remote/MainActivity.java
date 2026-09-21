package cn.macpe.agenttoolbox.remote;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/**
 * 手机端的壳：连接页 + 网页控制台（由电脑端提供）+ 精灵设置。
 *
 * 配色和电脑端那张网页统一（深蓝底、紫色主按钮、薄荷绿表示在线），
 * 界面全是代码拼的，所以颜色和尺寸都收在下面几个常量里。
 */
public class MainActivity extends Activity {
    private static final String PREFS = "agent_remote", ENDPOINT = "endpoint";
    private static final int VOICE_INPUT = 43, PICK_FILE = 42;

    // ---- 设计 token ----
    private static final int BG = 0xFF0F1117, CARD = 0xFF171A23, LINE = 0xFF262A37, FIELD = 0xFF0F1117;
    private static final int INK = 0xFFEEF0F6, DIM = 0xFFA9B0C3, FAINT = 0xFF6F768A;
    private static final int VIOLET = 0xFF7C5CFF, VIOLET_DEEP = 0xFF5B3DF5, VIOLET_SOFT = 0xFFA98BFF, MINT = 0xFF21E6A5, ROSE = 0xFFFF7BD0, BTN = 0xFF232735;

    private EditText endpointInput, manualShareInput;
    private TextView connectionChip, shareStatus, spriteStatus;
    private Button spriteToggle;
    private ScrollView setupPanel;
    private WebView webView;

    private final Handler ui = new Handler(Looper.getMainLooper());
    // 8 秒没任何回调 = TCP 挂住了（不同 Wi‑Fi / AP 隔离 / VPN），别让人对着「正在连接」干等
    private final Runnable connectTimeout = () -> {
        setChip("8 秒没连上", false);
        shareStatus.setText("电脑没有回应。大概率是手机和电脑不在同一个 Wi‑Fi（访客网络 / AP 隔离 / 开着 VPN 也算）。先用手机浏览器打开 " + originOf(endpoint()) + " 试试：能看到一行 JSON 就是网络通的。");
        setupPanel.setVisibility(View.VISIBLE);
    };

    // ---------------- 生命周期 ----------------

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        buildUi();
        boolean linked = handleDeepLink(getIntent());
        handleIncomingShare(getIntent());
        if (!linked && !endpointInput.getText().toString().trim().isEmpty()) connect();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLink(intent);
        handleIncomingShare(intent);
    }

    @Override protected void onResume() {
        super.onResume();
        refreshSpriteStatus();
    }

    // ---------------- 小工具：尺寸、形状、控件 ----------------

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private GradientDrawable shape(int fill, int radiusDp, int stroke) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(radiusDp));
        if (stroke != 0) d.setStroke(dp(1), stroke);
        return d;
    }

    private TextView text(String value, float sp, int color) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(sp);
        v.setTextColor(color);
        v.setLineSpacing(0, 1.25f);
        return v;
    }

    private TextView title(String value) { TextView v = text(value, 16, INK); v.setTypeface(null, Typeface.BOLD); return v; }
    private TextView body(String value) { TextView v = text(value, 13, DIM); v.setPadding(0, dp(4), 0, dp(14)); return v; }

    /** 三种按钮：primary 紫色渐变、normal 深灰、ghost 只有描边 */
    private Button button(String label, String kind) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(14);
        b.setTypeface(null, Typeface.BOLD);
        b.setPadding(dp(14), 0, dp(14), 0);
        b.setStateListAnimator(null);
        GradientDrawable base;
        if ("primary".equals(kind)) {
            base = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{ VIOLET, VIOLET_DEEP });
            base.setCornerRadius(dp(14));
            b.setTextColor(Color.WHITE);
        } else if ("ghost".equals(kind)) {
            base = shape(Color.TRANSPARENT, 14, LINE);
            b.setTextColor(DIM);
        } else {
            base = shape(BTN, 14, 0);
            b.setTextColor(INK);
        }
        GradientDrawable mask = shape(Color.WHITE, 14, 0);
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), base, mask));
        return b;
    }

    private EditText field(String hint, boolean multiline) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setTextSize(13);
        e.setTextColor(INK);
        e.setHintTextColor(FAINT);
        e.setBackground(shape(FIELD, 14, LINE));
        e.setPadding(dp(14), multiline ? dp(12) : 0, dp(14), multiline ? dp(12) : 0);
        if (multiline) { e.setGravity(Gravity.TOP); e.setMinLines(3); } else e.setSingleLine(true);
        return e;
    }

    private LinearLayout card() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(18), dp(18), dp(18), dp(18));
        c.setBackground(shape(CARD, 18, LINE));
        return c;
    }

    private LinearLayout.LayoutParams cardParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.setMargins(dp(16), dp(12), dp(16), 0);
        return p;
    }

    private LinearLayout row(View... children) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        for (int i = 0; i < children.length; i++) {
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(46), 1);
            if (i > 0) p.setMargins(dp(8), 0, 0, 0);
            r.addView(children[i], p);
        }
        return r;
    }

    private void setChip(String label, boolean online) {
        connectionChip.setText((online ? "● " : "○ ") + label);
        connectionChip.setTextColor(online ? MINT : DIM);
        connectionChip.setBackground(shape(Color.TRANSPARENT, 999, online ? 0x6621E6A5 : LINE));
    }

    // ---------------- 界面 ----------------

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);

        // 头：logo + 眉标 + 标题 + 状态胶囊
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(20), dp(18), dp(20), dp(8));
        TextView logo = text("✦", 22, Color.WHITE);
        logo.setGravity(Gravity.CENTER);
        logo.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{ VIOLET, ROSE }) {{ setCornerRadius(dp(14)); }});
        header.addView(logo, new LinearLayout.LayoutParams(dp(46), dp(46)));
        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.VERTICAL);
        brand.setPadding(dp(12), 0, dp(8), 0);
        TextView eyebrow = text("AGENT TOOLBOX / REMOTE", 10, VIOLET_SOFT);
        eyebrow.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        eyebrow.setLetterSpacing(0.14f);
        brand.addView(eyebrow);
        TextView h1 = text("手机控制台", 22, INK);
        h1.setTypeface(null, Typeface.BOLD);
        brand.addView(h1);
        header.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
        connectionChip = text("", 12, DIM);
        connectionChip.setPadding(dp(10), dp(5), dp(10), dp(5));
        header.addView(connectionChip);
        setChip("未连接", false);
        root.addView(header);

        // 设置面板：连接 / 精灵 / 发给电脑。连上之后整块隐藏，按返回键再叫出来
        setupPanel = new ScrollView(this);
        setupPanel.setFillViewport(true);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(0, 0, 0, dp(24));
        setupPanel.addView(panel, new FrameLayout.LayoutParams(-1, -2));

        // 卡 1：连接
        LinearLayout connectCard = card();
        connectCard.addView(title("连接你的电脑"));
        connectCard.addView(body("手机和电脑连同一个 Wi‑Fi。用下面这个按钮扫电脑上的「连接二维码」—— 用系统相机扫会跳到浏览器，那不是配对。"));
        Button scan = button("⌁ 扫描连接二维码", "primary");
        scan.setOnClickListener(v -> scanPairCode());
        connectCard.addView(scan, new LinearLayout.LayoutParams(-1, dp(50)));
        TextView divider = text("或者手动粘贴地址", 12, FAINT);
        divider.setGravity(Gravity.CENTER);
        divider.setPadding(0, dp(14), 0, dp(6));
        connectCard.addView(divider);
        endpointInput = field("http://192.168.x.x:43127/?token=…", false);
        endpointInput.setText(getSharedPreferences(PREFS, MODE_PRIVATE).getString(ENDPOINT, ""));
        Button connectBtn = button("连接", "normal");
        connectBtn.setOnClickListener(v -> connect());
        Button clearBtn = button("清除", "ghost");
        clearBtn.setOnClickListener(v -> clearConnection());
        LinearLayout connectRow = new LinearLayout(this);
        connectRow.addView(endpointInput, new LinearLayout.LayoutParams(0, dp(46), 1));
        LinearLayout.LayoutParams cbp = new LinearLayout.LayoutParams(dp(76), dp(46)); cbp.setMargins(dp(8), 0, 0, 0);
        connectRow.addView(connectBtn, cbp);
        LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(dp(64), dp(46)); clp.setMargins(dp(8), 0, 0, 0);
        connectRow.addView(clearBtn, clp);
        connectCard.addView(connectRow);
        shareStatus = text("", 12, MINT);
        shareStatus.setPadding(0, dp(10), 0, 0);
        connectCard.addView(shareStatus);
        panel.addView(connectCard, cardParams());

        // 卡 2：精灵（左边就是它本人）
        LinearLayout spriteCard = card();
        LinearLayout intro = new LinearLayout(this);
        intro.setGravity(Gravity.CENTER_VERTICAL);
        SpriteView portrait = new SpriteView(this);
        intro.addView(portrait, new LinearLayout.LayoutParams(dp(68), dp(76)));
        LinearLayout introText = new LinearLayout(this);
        introText.setOrientation(LinearLayout.VERTICAL);
        introText.setPadding(dp(14), 0, 0, 0);
        introText.addView(title("手机精灵"));
        TextView introBody = body("对它说话，它读屏幕、替你点。付款、密码一律停下来问你。");
        introBody.setPadding(0, dp(2), 0, 0);
        introText.addView(introBody);
        intro.addView(introText, new LinearLayout.LayoutParams(0, -2, 1));
        spriteCard.addView(intro);
        spriteStatus = text("", 13, DIM);
        spriteStatus.setPadding(0, dp(12), 0, dp(12));
        spriteCard.addView(spriteStatus);
        Button talk = button("🎤 说句话", "primary");
        talk.setOnClickListener(v -> startSpriteVoice());
        spriteToggle = button("显示精灵", "normal");
        spriteToggle.setOnClickListener(v -> {
            SpriteService s = SpriteService.get();
            if (s == null) { openAccessibilitySettings(); return; }
            s.toggleSprite();
            ui.postDelayed(this::refreshSpriteStatus, 250);
        });
        Button info = button("应用信息", "ghost");
        info.setOnClickListener(v -> {
            try { startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); }
            catch (Exception e) { toast("打不开应用信息页"); }
        });
        spriteCard.addView(row(talk, spriteToggle, info));
        TextView spriteHint = text("若系统提示「受限设置」：应用信息 → 右上角 ⋮ → 允许受限设置，再回来开。", 12, FAINT);
        spriteHint.setPadding(0, dp(10), 0, 0);
        spriteCard.addView(spriteHint);
        panel.addView(spriteCard, cardParams());

        // 卡 3：发给电脑
        LinearLayout shareCard = card();
        shareCard.addView(title("发给电脑"));
        shareCard.addView(body("文字直接进电脑收件箱；文件落到「下载/Agent工具箱/手机精灵」，桌面精灵会冒泡提醒。"));
        manualShareInput = field("输入文字或粘贴链接…", true);
        shareCard.addView(manualShareInput, new LinearLayout.LayoutParams(-1, dp(92)));
        Button send = button("发送文字", "primary");
        send.setOnClickListener(v -> sendManualText());
        Button file = button("选择图片 / 文件", "normal");
        file.setOnClickListener(v -> pickFile());
        LinearLayout shareRow = row(send, file);
        LinearLayout.LayoutParams srp = new LinearLayout.LayoutParams(-1, -2); srp.setMargins(0, dp(8), 0, 0);
        shareCard.addView(shareRow, srp);
        panel.addView(shareCard, cardParams());

        TextView foot = text("手机不能让电脑执行任意命令；登录、付款、验证码、系统权限仍在电脑端确认。", 11, FAINT);
        foot.setGravity(Gravity.CENTER);
        foot.setPadding(dp(28), dp(18), dp(28), 0);
        panel.addView(foot);

        root.addView(setupPanel, new LinearLayout.LayoutParams(-1, 0, 1));

        // 网页控制台
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportZoom(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        webView.setBackgroundColor(BG);
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface public void start() { runOnUiThread(() -> { if (isTrustedRemote(webView.getUrl())) startVoiceInput(); else toast("只允许已配对的电脑页面调用语音输入"); }); }
        }, "AgentToolboxVoice");
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface public void lockLandscape(boolean lock) {
                runOnUiThread(() -> {
                    if (!isTrustedRemote(webView.getUrl())) return;
                    setRequestedOrientation(lock ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                });
            }
        }, "AgentToolboxNative");
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface public String status() {
                SpriteService s = SpriteService.get();
                return "{\"enabled\":" + SpriteService.isEnabled(MainActivity.this) + ",\"running\":" + (s != null) + ",\"visible\":" + (s != null && s.isSpriteShown()) + ",\"busy\":" + (s != null && s.isRunning()) + "}";
            }
            @JavascriptInterface public void listen() { runOnUiThread(() -> { if (isTrustedRemote(webView.getUrl())) startSpriteVoice(); }); }
            @JavascriptInterface public void toggle() { runOnUiThread(() -> { if (!isTrustedRemote(webView.getUrl())) return; SpriteService s = SpriteService.get(); if (s == null) { openAccessibilitySettings(); return; } s.toggleSprite(); }); }
            @JavascriptInterface public void openSettings() { runOnUiThread(() -> { if (isTrustedRemote(webView.getUrl())) openAccessibilitySettings(); }); }
            @JavascriptInterface public void runGoal(String text) { runOnUiThread(() -> { if (!isTrustedRemote(webView.getUrl())) return; SpriteService s = SpriteService.get(); if (s == null) { toast("先开无障碍服务"); openAccessibilitySettings(); return; } s.runGoal(text); }); }
        }, "AgentToolboxSprite");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            private boolean mainFailed = false;
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (!r.isForMainFrame()) return false;
                if (isTrustedRemote(r.getUrl().toString())) return false;
                toast("已阻止离开配对电脑的页面");
                return true;
            }
            @Override public void onPageStarted(WebView v, String u, android.graphics.Bitmap i) {
                mainFailed = false;
                ui.removeCallbacks(connectTimeout); ui.postDelayed(connectTimeout, 8000);
                setChip("正在验证…", false);
                shareStatus.setText("请稍候，正在连接同一 Wi‑Fi 下的电脑");
                setupPanel.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView v, String u) {
                ui.removeCallbacks(connectTimeout);
                if (mainFailed || "about:blank".equals(u)) return;
                setChip("已连接", true);
                shareStatus.setText("");
                setupPanel.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (!r.isForMainFrame()) return;
                ui.removeCallbacks(connectTimeout);
                mainFailed = true;
                setChip("连接失败", false);
                shareStatus.setText("无法连接电脑：" + e.getDescription() + "。请确认手机和电脑在同一 Wi‑Fi，且电脑端手机控制仍在运行。");
                setupPanel.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse e) {
                if (!r.isForMainFrame() || e.getStatusCode() < 400) return;
                ui.removeCallbacks(connectTimeout);
                mainFailed = true;
                setChip("HTTP " + e.getStatusCode(), false);
                shareStatus.setText(e.getStatusCode() == 401 ? "连接码已失效，请在电脑端点击「重新配对」后重新扫描。" : "电脑返回错误，请重新启动手机控制后再扫一次。");
                setupPanel.setVisibility(View.VISIBLE);
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        refreshSpriteStatus();
    }

    private void refreshSpriteStatus() {
        if (spriteStatus == null) return;
        boolean enabled = SpriteService.isEnabled(this);
        SpriteService s = SpriteService.get();
        boolean visible = s != null && s.isSpriteShown();
        if (!enabled) { spriteStatus.setText("○ 无障碍未开启 —— 开了它才能看见屏幕、替你点"); spriteStatus.setTextColor(DIM); spriteToggle.setText("开启无障碍"); }
        else { spriteStatus.setText("● 无障碍已开启 · " + (visible ? "精灵在屏幕下方" : "精灵隐藏中")); spriteStatus.setTextColor(MINT); spriteToggle.setText(visible ? "隐藏精灵" : "显示精灵"); }
    }

    // ---------------- 配对 / 连接 ----------------

    private void scanPairCode() {
        new IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("扫描电脑上的连接二维码").setBeepEnabled(false).setOrientationLocked(false).initiateScan();
    }

    private boolean applyPairValue(String value) {
        Uri uri = Uri.parse(value);
        String endpoint = value;
        if ("agenttoolbox".equals(uri.getScheme()) && "pair".equals(uri.getHost())) endpoint = uri.getQueryParameter("endpoint");
        if (endpoint == null || (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) || Uri.parse(endpoint).getQueryParameter("token") == null) {
            toast("这不是有效的连接二维码");
            setChip("二维码无效", false);
            setupPanel.setVisibility(View.VISIBLE);
            return false;
        }
        endpointInput.setText(endpoint);
        shareStatus.setText("已识别连接码，正在验证…");
        connect();
        return true;
    }

    private boolean handleDeepLink(Intent intent) { return intent != null && intent.getData() != null && applyPairValue(intent.getData().toString()); }

    private boolean isTrustedRemote(String value) {
        try {
            Uri expected = Uri.parse(endpoint()); Uri actual = Uri.parse(value);
            return expected.getScheme() != null && expected.getScheme().equals(actual.getScheme()) && expected.getHost() != null && expected.getHost().equals(actual.getHost()) && expected.getPort() == actual.getPort();
        } catch (Exception e) { return false; }
    }

    private void clearConnection() {
        endpointInput.setText("");
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(ENDPOINT).apply();
        webView.loadUrl("about:blank");
        setupPanel.setVisibility(View.VISIBLE);
        setChip("未连接", false);
    }

    private void connect() {
        String endpoint = endpointInput.getText().toString().trim();
        if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) { toast("请输入电脑端配对地址"); return; }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(ENDPOINT, endpoint).apply();
        setupPanel.setVisibility(View.GONE);
        webView.loadUrl(endpoint);
        setChip("正在连接…", false);
        ui.removeCallbacks(connectTimeout); ui.postDelayed(connectTimeout, 8000);
    }

    private String endpoint() { return getSharedPreferences(PREFS, MODE_PRIVATE).getString(ENDPOINT, ""); }
    private String originOf(String endpoint) { try { Uri u = Uri.parse(endpoint); return u.getScheme() + "://" + u.getAuthority(); } catch (Exception e) { return endpoint; } }

    // ---------------- 语音 / 精灵 ----------------

    private void startVoiceInput() {
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "说出要交给 Agent 的任务");
            startActivityForResult(intent, VOICE_INPUT);
        } catch (ActivityNotFoundException e) { toast("当前手机没有可用的系统语音识别服务"); }
    }

    private void openAccessibilitySettings() {
        try { startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)); toast("找到「Agent 工具箱 · 手机精灵」打开它"); }
        catch (Exception e) { toast("打不开无障碍设置"); }
    }

    private void startSpriteVoice() {
        if (SpriteService.get() == null) { toast("先开无障碍服务，精灵才能干活"); openAccessibilitySettings(); return; }
        startActivity(new Intent(this, VoiceActivity.class));
    }

    // ---------------- 结果回调 ----------------

    @Override protected void onActivityResult(int req, int result, Intent data) {
        IntentResult scan = IntentIntegrator.parseActivityResult(req, result, data);
        if (scan != null) { if (scan.getContents() != null) applyPairValue(scan.getContents()); return; }
        if (req == VOICE_INPUT) {
            if (result == RESULT_OK && data != null) {
                ArrayList<String> values = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (values != null && !values.isEmpty()) webView.evaluateJavascript("window.agentVoiceResult(" + json(values.get(0)) + ")", null);
            }
            return;
        }
        if (req == PICK_FILE && result == RESULT_OK && data != null && data.getData() != null) { sendFile(data.getData()); return; }
        super.onActivityResult(req, result, data);
    }

    // ---------------- 发给电脑 ----------------

    private void pickFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(intent, PICK_FILE);
    }

    private void sendManualText() {
        String text = manualShareInput.getText().toString().trim();
        if (text.isEmpty()) { toast("请先输入文字或链接"); return; }
        postShare("手机手动分享", text, "", "text/plain");
    }

    private void sendFile(Uri uri) {
        runOnUiThread(() -> shareStatus.setText("正在递给电脑…"));
        new Thread(() -> {
            try {
                org.json.JSONObject r = SpriteService.upload(this, uri, null);
                boolean ok = r.optBoolean("ok");
                String name = ok ? r.getJSONObject("saved").getString("name") : r.optString("error", "失败");
                runOnUiThread(() -> shareStatus.setText(ok ? "电脑收到了：" + name + " ✓（在 下载/Agent工具箱/手机精灵）" : "发送失败：" + name));
            } catch (Exception e) { runOnUiThread(() -> shareStatus.setText("发送失败：" + e.getMessage())); }
        }).start();
    }

    private void postShare(String title, String text, String url, String mime) {
        new Thread(() -> {
            try {
                Uri remote = Uri.parse(endpoint());
                String token = remote.getQueryParameter("token");
                if (token == null) throw new IllegalStateException("请先连接电脑");
                URL target = new URL(originOf(endpoint()) + "/api/share?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8.name()));
                String payload = "{\"title\":" + json(title) + ",\"text\":" + json(text) + ",\"url\":" + json(url) + ",\"mime\":" + json(mime) + ",\"data\":\"\"}";
                HttpURLConnection c = (HttpURLConnection) target.openConnection();
                c.setRequestMethod("POST"); c.setDoOutput(true); c.setConnectTimeout(8000); c.setReadTimeout(20000);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = c.getOutputStream()) { out.write(payload.getBytes(StandardCharsets.UTF_8)); }
                int code = c.getResponseCode();
                runOnUiThread(() -> { shareStatus.setText(code >= 200 && code < 300 ? "已发送到电脑收件箱 ✓" : "发送失败：HTTP " + code); if (code < 300) manualShareInput.setText(""); });
            } catch (Exception e) { runOnUiThread(() -> shareStatus.setText("发送失败：" + e.getMessage())); }
        }).start();
    }

    /** 系统分享菜单里「发给 Agent 工具箱」 */
    private void handleIncomingShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String value = intent.getStringExtra(Intent.EXTRA_TEXT);
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (value == null && uri != null) value = uri.toString();
        if (TextUtils.isEmpty(value) || value.trim().isEmpty()) return;
        final String shared = value.trim();
        if (endpoint().isEmpty()) { shareStatus.setText("已收到分享，请先连接电脑"); setupPanel.setVisibility(View.VISIBLE); return; }
        shareStatus.setText("正在同步分享内容…");
        setupPanel.setVisibility(View.VISIBLE);
        postShare("手机分享", shared, "", "text/plain");
    }

    private String json(String value) {
        return "\"" + String.valueOf(value == null ? "" : value).replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\"";
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else if (setupPanel.getVisibility() != View.VISIBLE) setupPanel.setVisibility(View.VISIBLE);
        else super.onBackPressed();
    }

    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show(); }
}
