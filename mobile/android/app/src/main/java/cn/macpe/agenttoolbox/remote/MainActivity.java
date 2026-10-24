package cn.macpe.agenttoolbox.remote;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
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
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
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
import java.util.List;

/**
 * 手机端的壳：连接页 + 网页控制台（由电脑端提供）+ 精灵设置。
 *
 * 配色和电脑端那张网页统一（深蓝底、紫色主按钮、薄荷绿表示在线），
 * 界面全是代码拼的，所以颜色和尺寸都收在下面几个常量里。
 */
public class MainActivity extends Activity {
    private static final String PREFS = "agent_remote", ENDPOINT = "endpoint";
    private static final int VOICE_INPUT = 43, PICK_FILE = 42, TAKE_PHOTO = 44, VOICE_TASK = 45, NOTIF_PERM = 46;
    private Uri photoUri;

    // ---- 设计 token（Bilibili 风：B 站粉做主色、B 站蓝做辅色，深色底 + 大圆角）----
    private static final int BG = 0xFF0F1117, CARD = 0xFF171A23, CARD_HI = 0xFF1C2130, LINE = 0xFF262A37, FIELD = 0xFF0F1117;
    private static final int INK = 0xFFEEF0F6, DIM = 0xFFA9B0C3, FAINT = 0xFF6F768A;
    // B 站粉 #FB7299 / 深粉 #E85C84 / B 站蓝 #00AEEC；旧 VIOLET/MINT 名保留但指到新色，省得全局改引用
    private static final int PINK = 0xFFFB7299, PINK_DEEP = 0xFFE85C84, PINK_SOFT = 0xFFFF9BB7, BLUE = 0xFF00AEEC, BLUE_SOFT = 0xFF4FC8F5, MINT = 0xFF21E6A5, BTN = 0xFF232735;
    private static final int VIOLET = PINK, VIOLET_DEEP = PINK_DEEP, VIOLET_SOFT = PINK_SOFT, ROSE = BLUE;
    // 圆角：卡片 20、按钮做成胶囊 22、输入框 16
    private static final int R_CARD = 20, R_BTN = 22, R_FIELD = 16;
    // 内容最大宽度：手机占满，平板/折叠屏/横屏时居中留白，不被拉成一条
    private static final int MAX_CONTENT_DP = 600;

    private EditText endpointInput, manualShareInput;
    private TextView connectionChip, shareStatus, spriteStatus, sendLogView;
    private Button spriteToggle;
    private ScrollView setupPanel;
    private LinearLayout panel;
    // 1 最近电脑  2 精灵指令  3 发送记录 —— 可刷新的小区块
    private LinearLayout recentRail, recentWrap, spriteRail, sendLogWrap;
    private WebView webView;
    // 所有按内容宽度居中的块（卡片、头、脚）；窗口尺寸变化时统一重算宽度
    private final List<View> widthCapped = new ArrayList<>();
    // 在线状态胶囊的呼吸动效
    private android.animation.ValueAnimator chipPulse;

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

    @Override public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // 旋转 / 折叠屏展开 / 分屏改变窗口大小：重算居中内容宽度（Activity 不重建，WebView 状态不丢）
        int cw = contentWidthPx();
        for (View v : widthCapped) {
            if (v == null) continue;
            ViewGroup.LayoutParams lp = v.getLayoutParams();
            if (lp != null) { lp.width = cw; v.setLayoutParams(lp); }
        }
    }

    @Override protected void onResume() {
        super.onResume();
        refreshSpriteStatus();
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED && !getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("askedNotif", false)) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("askedNotif", true).apply();
            requestPermissions(new String[]{ "android.permission.POST_NOTIFICATIONS" }, NOTIF_PERM);
        }
    }

    // ---------------- 小工具：尺寸、形状、控件 ----------------

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    /** 居中内容的实际像素宽度：窄屏占满（两侧各留 16dp），宽屏封顶到 MAX_CONTENT_DP */
    private int contentWidthPx() {
        int screen = getResources().getDisplayMetrics().widthPixels;
        return Math.min(screen - dp(32), dp(MAX_CONTENT_DP));
    }

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
        b.setMaxLines(1);
        // 窄屏 / 三按钮一行时，emoji+文字放不下就自动缩字号，不截断
        b.setAutoSizeTextTypeUniformWithConfiguration(11, 14, 1, TypedValue.COMPLEX_UNIT_SP);
        GradientDrawable base;
        if ("primary".equals(kind)) {
            // B 站粉 → 深粉渐变
            base = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[]{ PINK, PINK_DEEP });
            base.setCornerRadius(dp(R_BTN));
            b.setTextColor(Color.WHITE);
        } else if ("ghost".equals(kind)) {
            base = shape(Color.TRANSPARENT, R_BTN, LINE);
            b.setTextColor(DIM);
        } else {
            base = shape(BTN, R_BTN, 0);
            b.setTextColor(INK);
        }
        GradientDrawable mask = shape(Color.WHITE, R_BTN, 0);
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), base, mask));
        // 轻触感：按下时震一下，不拦截点击
        b.setOnTouchListener((v, e) -> { if (e.getActionMasked() == android.view.MotionEvent.ACTION_DOWN) v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY); return false; });
        return b;
    }

    private EditText field(String hint, boolean multiline) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setTextSize(13);
        e.setTextColor(INK);
        e.setHintTextColor(FAINT);
        e.setBackground(shape(FIELD, R_FIELD, LINE));
        e.setPadding(dp(14), multiline ? dp(12) : 0, dp(14), multiline ? dp(12) : 0);
        if (multiline) { e.setGravity(Gravity.TOP); e.setMinLines(3); } else e.setSingleLine(true);
        return e;
    }

    private LinearLayout card() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(18), dp(18), dp(18), dp(18));
        // 顶部略亮的竖向微渐变，深色下给卡片一点体积感
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{ CARD_HI, CARD });
        bg.setCornerRadius(dp(R_CARD));
        bg.setStroke(dp(1), LINE);
        c.setBackground(bg);
        return c;
    }

    /** 卡片宽度 = 居中内容宽度；两侧留白由内容封顶产生，不再写死左右 margin */
    private LinearLayout.LayoutParams cardParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(contentWidthPx(), -2);
        p.gravity = Gravity.CENTER_HORIZONTAL;
        p.setMargins(0, dp(12), 0, 0);
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

    /** 一颗可点的胶囊标签（B 站那种圆角小 tag） */
    private TextView chip(String label, boolean accent) {
        TextView t = text(label, 12.5f, accent ? PINK : INK);
        t.setMaxLines(1);
        t.setPadding(dp(13), dp(8), dp(13), dp(8));
        t.setBackground(shape(accent ? 0x1AFB7299 : BTN, 999, accent ? 0x55FB7299 : LINE));
        t.setOnTouchListener((v, e) -> { if (e.getActionMasked() == android.view.MotionEvent.ACTION_DOWN) v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY); return false; });
        return t;
    }

    /** 横向可滚的标签轨：把若干 (文字→点击) 铺成一排 */
    private android.widget.HorizontalScrollView chipRail(LinearLayout into) {
        android.widget.HorizontalScrollView hs = new android.widget.HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        hs.setOverScrollMode(View.OVER_SCROLL_NEVER);
        into.setOrientation(LinearLayout.HORIZONTAL);
        hs.addView(into, new FrameLayout.LayoutParams(-2, -2));
        return hs;
    }

    private void fillChips(LinearLayout rail, java.util.List<String> labels, boolean accentFirst, final ChipTap onTap) {
        rail.removeAllViews();
        for (int i = 0; i < labels.size(); i++) {
            final String label = labels.get(i);
            TextView c = chip(label, accentFirst && i == 0);
            c.setOnClickListener(v -> onTap.tap(label));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2);
            if (i > 0) p.setMargins(dp(8), 0, 0, 0);
            rail.addView(c, p);
        }
    }
    interface ChipTap { void tap(String value); }

    // ---- 小列表持久化：最近电脑 / 精灵指令历史 / 发送记录，都用换行拼存 ----
    private java.util.List<String> listPref(String key) {
        String raw = getSharedPreferences(PREFS, MODE_PRIVATE).getString(key, "");
        java.util.List<String> out = new ArrayList<>();
        if (raw != null) for (String s : raw.split("\n")) if (!s.trim().isEmpty()) out.add(s);
        return out;
    }

    private void pushPref(String key, String value, int max) {
        if (value == null || value.trim().isEmpty()) return;
        value = value.trim();
        java.util.List<String> cur = listPref(key);
        cur.remove(value);                  // 去重：已有的提到最前
        cur.add(0, value);
        while (cur.size() > max) cur.remove(cur.size() - 1);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(key, TextUtils.join("\n", cur)).apply();
    }

    static void recordSpriteGoal(android.content.Context ctx, String goal) {
        if (goal == null || goal.trim().isEmpty()) return;
        android.content.SharedPreferences sp = ctx.getSharedPreferences("agent_remote", MODE_PRIVATE);
        java.util.List<String> cur = new ArrayList<>();
        for (String s : sp.getString("spritehist", "").split("\n")) if (!s.trim().isEmpty()) cur.add(s);
        cur.remove(goal.trim()); cur.add(0, goal.trim());
        while (cur.size() > 6) cur.remove(cur.size() - 1);
        sp.edit().putString("spritehist", TextUtils.join("\n", cur)).apply();
    }

    private void setChip(String label, boolean online) {
        connectionChip.setText((online ? "● " : "○ ") + label);
        connectionChip.setTextColor(online ? BLUE : DIM);
        connectionChip.setBackground(shape(online ? 0x1A00AEEC : Color.TRANSPARENT, 999, online ? 0x6600AEEC : LINE));
        // 连上后胶囊轻轻呼吸，像 B 站的「在线」小点
        if (online) {
            if (chipPulse == null) {
                chipPulse = android.animation.ValueAnimator.ofFloat(0.55f, 1f);
                chipPulse.setDuration(1100);
                chipPulse.setRepeatCount(android.animation.ValueAnimator.INFINITE);
                chipPulse.setRepeatMode(android.animation.ValueAnimator.REVERSE);
                chipPulse.addUpdateListener(a -> { if (connectionChip != null) connectionChip.setAlpha((float) a.getAnimatedValue()); });
                chipPulse.start();
            }
        } else {
            if (chipPulse != null) { chipPulse.cancel(); chipPulse = null; }
            if (connectionChip != null) connectionChip.setAlpha(1f);
        }
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
        // 头也跟着内容宽度居中，平板/横屏时不贴左
        LinearLayout headerWrap = new LinearLayout(this);
        headerWrap.setGravity(Gravity.CENTER_HORIZONTAL);
        LinearLayout.LayoutParams headerLp = new LinearLayout.LayoutParams(contentWidthPx(), -2);
        headerWrap.addView(header, headerLp);
        root.addView(headerWrap);
        widthCapped.add(header);

        // 设置面板：连接 / 精灵 / 发给电脑。连上之后整块隐藏，按返回键再叫出来
        setupPanel = new ScrollView(this);
        setupPanel.setFillViewport(true);
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
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
        // 1) 最近连过的电脑：点一下直接重连，不用再扫码
        recentWrap = new LinearLayout(this);
        recentWrap.setOrientation(LinearLayout.VERTICAL);
        TextView recentLabel = text("最近的电脑 · 点一下重连", 12, FAINT);
        recentLabel.setPadding(0, dp(14), 0, dp(8));
        recentWrap.addView(recentLabel);
        recentRail = new LinearLayout(this);
        recentWrap.addView(chipRail(recentRail));
        connectCard.addView(recentWrap);
        shareStatus = text("", 12, MINT);
        shareStatus.setPadding(0, dp(10), 0, 0);
        connectCard.addView(shareStatus);
        panel.addView(connectCard, cardParams());
        renderRecents();

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
        // 2) 常用指令 + 最近说过的：点一下直接让精灵干，省得每次开口
        TextView cmdLabel = text("常用指令 · 点一下直接执行", 12, FAINT);
        cmdLabel.setPadding(0, dp(14), 0, dp(8));
        spriteCard.addView(cmdLabel);
        spriteRail = new LinearLayout(this);
        spriteCard.addView(chipRail(spriteRail));
        TextView spriteHint = text("若系统提示「受限设置」：应用信息 → 右上角 ⋮ → 允许受限设置，再回来开。", 12, FAINT);
        spriteHint.setPadding(0, dp(12), 0, 0);
        spriteCard.addView(spriteHint);
        panel.addView(spriteCard, cardParams());
        renderSpriteChips();

        // 卡 2.5：快捷 —— 拍照 / 剪贴板双向 / 语音记任务 / 记笔记
        LinearLayout quickCard = card();
        quickCard.addView(title("快捷"));
        quickCard.addView(body("手机上最常干的几件事，一步到位。都走已配对的电脑。"));
        Button photo = button("📸 拍照发给电脑", "primary"); photo.setOnClickListener(v -> takePhoto());
        Button voiceTask = button("🎤 说一句记任务", "normal"); voiceTask.setOnClickListener(v -> voiceTask());
        quickCard.addView(row(photo, voiceTask));
        Button clipUp = button("📋 手机剪贴板 → 电脑", "normal"); clipUp.setOnClickListener(v -> pushClipboard());
        Button clipDown = button("⬇ 电脑剪贴板 → 手机", "normal"); clipDown.setOnClickListener(v -> pullClipboard());
        LinearLayout clipRow = row(clipUp, clipDown);
        LinearLayout.LayoutParams crp = new LinearLayout.LayoutParams(-1, -2); crp.setMargins(0, dp(8), 0, 0);
        quickCard.addView(clipRow, crp);
        panel.addView(quickCard, cardParams());

        // 卡 3：发给电脑
        LinearLayout shareCard = card();
        shareCard.addView(title("发给电脑"));
        shareCard.addView(body("文字直接进电脑收件箱；文件落到「下载/Agent工具箱/手机精灵」，桌面精灵会冒泡提醒。"));
        manualShareInput = field("输入文字或粘贴链接…", true);
        shareCard.addView(manualShareInput, new LinearLayout.LayoutParams(-1, dp(92)));
        Button send = button("发送文字", "primary");
        send.setOnClickListener(v -> sendManualText());
        Button noteBtn = button("记成笔记", "ghost");
        noteBtn.setOnClickListener(v -> { String t = manualShareInput.getText().toString().trim(); if (t.isEmpty()) { toast("先写点什么"); return; } command("note.add", "{\"text\":" + json(t) + "}", ok -> { shareStatus.setText(ok ? "记进电脑的笔记了 ✓" : "没记上"); if (ok) manualShareInput.setText(""); }); });
        Button file = button("选择图片 / 文件", "normal");
        file.setOnClickListener(v -> pickFile());
        LinearLayout shareRow = row(send, noteBtn, file);
        LinearLayout.LayoutParams srp = new LinearLayout.LayoutParams(-1, -2); srp.setMargins(0, dp(8), 0, 0);
        shareCard.addView(shareRow, srp);
        // 3) 最近发送：发过什么回看一眼（图片/文件可多选一次发）
        sendLogWrap = new LinearLayout(this);
        sendLogWrap.setOrientation(LinearLayout.VERTICAL);
        TextView sendLogLabel = text("最近发送", 12, FAINT);
        sendLogLabel.setPadding(0, dp(14), 0, dp(6));
        sendLogWrap.addView(sendLogLabel);
        sendLogView = text("", 12, DIM);
        sendLogWrap.addView(sendLogView);
        shareCard.addView(sendLogWrap);
        panel.addView(shareCard, cardParams());
        renderSendLog();

        TextView foot = text("手机不能让电脑执行任意命令；登录、付款、验证码、系统权限仍在电脑端确认。", 11, FAINT);
        foot.setGravity(Gravity.CENTER);
        foot.setPadding(dp(28), dp(18), dp(28), 0);
        LinearLayout.LayoutParams footLp = new LinearLayout.LayoutParams(contentWidthPx(), -2);
        footLp.gravity = Gravity.CENTER_HORIZONTAL;
        panel.addView(foot, footLp);
        // 收集所有需要随窗口宽度重算的块（卡片 + 脚），头已在上面登记
        for (int i = 0; i < panel.getChildCount(); i++) widthCapped.add(panel.getChildAt(i));

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
        else { spriteStatus.setText("● 无障碍已开启 · " + (visible ? "精灵在屏幕下方" : "精灵隐藏中")); spriteStatus.setTextColor(BLUE); spriteToggle.setText(visible ? "隐藏精灵" : "显示精灵"); }
    }

    // ---- 三个可刷新小区块 ----

    /** 1 最近电脑：host:port 当标签，点一下回填地址并连 */
    private void renderRecents() {
        if (recentWrap == null) return;
        java.util.List<String> recents = listPref("recents");
        if (recents.isEmpty()) { recentWrap.setVisibility(View.GONE); return; }
        recentWrap.setVisibility(View.VISIBLE);
        java.util.List<String> labels = new ArrayList<>();
        for (String ep : recents) labels.add(originOf(ep).replaceFirst("^https?://", ""));
        fillChips(recentRail, labels, false, label -> {
            for (String ep : listPref("recents"))
                if (originOf(ep).replaceFirst("^https?://", "").equals(label)) { endpointInput.setText(ep); connect(); return; }
        });
    }

    private static final String[] SPRITE_QUICK = { "读一下屏幕上有什么", "点第一个", "向下滑一屏", "返回上一页", "回到桌面" };

    /** 2 常用指令 + 历史：固定几条在前，最近说过的接在后 */
    private void renderSpriteChips() {
        if (spriteRail == null) return;
        java.util.List<String> labels = new ArrayList<>();
        for (String s : SPRITE_QUICK) labels.add(s);
        for (String h : listPref("spritehist")) if (!labels.contains(h)) labels.add(h);
        fillChips(spriteRail, labels, false, this::runSpriteGoal);
    }

    private void runSpriteGoal(String goal) {
        SpriteService s = SpriteService.get();
        if (s == null) { toast("先开无障碍服务，精灵才能干活"); openAccessibilitySettings(); return; }
        s.runGoal(goal);
        pushPref("spritehist", goal, 6);
        renderSpriteChips();
        toast("交给精灵：" + goal);
    }

    /** 3 最近发送：一行一条，最新在上 */
    private void renderSendLog() {
        if (sendLogWrap == null) return;
        java.util.List<String> log = listPref("sendlog");
        if (log.isEmpty()) { sendLogWrap.setVisibility(View.GONE); return; }
        sendLogWrap.setVisibility(View.VISIBLE);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < log.size(); i++) { if (i > 0) sb.append("\n"); sb.append("· ").append(log.get(i)); }
        sendLogView.setText(sb.toString());
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
        pushPref("recents", endpoint, 4);
        renderRecents();
        setupPanel.setVisibility(View.GONE);
        webView.loadUrl(endpoint);
        setChip("正在连接…", false);
        ui.removeCallbacks(connectTimeout); ui.postDelayed(connectTimeout, 8000);
    }

    private String endpoint() { return getSharedPreferences(PREFS, MODE_PRIVATE).getString(ENDPOINT, ""); }
    private String originOf(String endpoint) { try { Uri u = Uri.parse(endpoint); return u.getScheme() + "://" + u.getAuthority(); } catch (Exception e) { return endpoint; } }

    // ---------------- 快捷：拍照 / 剪贴板 / 语音记任务 ----------------

    private void takePhoto() {
        try {
            java.io.File dir = new java.io.File(getCacheDir(), "photos"); dir.mkdirs();
            java.io.File f = new java.io.File(dir, "拍照-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US).format(new java.util.Date()) + ".jpg");
            photoUri = androidx.core.content.FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent i = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, photoUri);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(i, TAKE_PHOTO);
        } catch (Exception e) { toast("打不开相机：" + e.getMessage()); }
    }

    private void voiceTask() {
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "说一句，记进电脑的任务清单");
            startActivityForResult(intent, VOICE_TASK);
        } catch (ActivityNotFoundException e) { toast("当前手机没有可用的系统语音识别服务"); }
    }

    private void pushClipboard() {
        android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        CharSequence t = cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0 ? cm.getPrimaryClip().getItemAt(0).coerceToText(this) : null;
        if (t == null || t.toString().trim().isEmpty()) { toast("手机剪贴板是空的"); return; }
        command("clipboard.write", "{\"text\":" + json(t.toString()) + "}", ok -> toast(ok ? "已写进电脑剪贴板" : "没写上，看看是否已连接"));
    }

    private void pullClipboard() {
        commandRaw("clipboard.read", "{}", body -> {
            try {
                String text = new org.json.JSONObject(body).optString("text", "");
                if (text.isEmpty()) { toast("电脑剪贴板是空的"); return; }
                android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                cm.setPrimaryClip(android.content.ClipData.newPlainText("来自电脑", text));
                toast("拿到了：" + (text.length() > 40 ? text.substring(0, 40) + "…" : text));
            } catch (Exception e) { toast("拿不到：" + e.getMessage()); }
        });
    }

    interface OkCallback { void done(boolean ok); }
    interface BodyCallback { void done(String body); }

    /** 调电脑端 /api/command，结果回到主线程 */
    private void command(String type, String payloadJson, OkCallback cb) {
        commandRaw(type, payloadJson, body -> cb.done(body != null && body.contains("\"ok\":true")));
    }

    private void commandRaw(String type, String payloadJson, BodyCallback cb) {
        new Thread(() -> {
            String body = null;
            try {
                Uri remote = Uri.parse(endpoint());
                String token = remote.getQueryParameter("token");
                if (token == null) throw new IllegalStateException("请先连接电脑");
                URL target = new URL(originOf(endpoint()) + "/api/command?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8.name()));
                HttpURLConnection c = (HttpURLConnection) target.openConnection();
                c.setRequestMethod("POST"); c.setDoOutput(true); c.setConnectTimeout(6000); c.setReadTimeout(20000);
                c.setRequestProperty("Content-Type", "application/json");
                String jsonBody = "{\"type\":" + json(type) + ",\"payload\":" + payloadJson + "}";
                try (OutputStream out = c.getOutputStream()) { out.write(jsonBody.getBytes(StandardCharsets.UTF_8)); }
                int code = c.getResponseCode();
                try (java.io.InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream()) {
                    java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream(); byte[] chunk = new byte[8192]; int n;
                    while (in != null && (n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
                    body = buf.toString("UTF-8");
                }
            } catch (Exception e) { body = null; final String msg = e.getMessage(); runOnUiThread(() -> toast("连不上电脑：" + msg)); }
            final String result = body;
            runOnUiThread(() -> cb.done(result));
        }).start();
    }

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
        if (req == PICK_FILE && result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                android.content.ClipData cd = data.getClipData();
                for (int i = 0; i < cd.getItemCount(); i++) { Uri u = cd.getItemAt(i).getUri(); if (u != null) sendFile(u); }
            } else if (data.getData() != null) sendFile(data.getData());
            return;
        }
        if (req == TAKE_PHOTO) { if (result == RESULT_OK && photoUri != null) { shareStatus.setText("照片拍好了，正在递给电脑…"); setupPanel.setVisibility(View.VISIBLE); sendFile(photoUri); } return; }
        if (req == VOICE_TASK) {
            if (result == RESULT_OK && data != null) {
                ArrayList<String> values = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (values != null && !values.isEmpty()) command("tasks.add", "{\"title\":" + json(values.get(0)) + "}", ok -> toast(ok ? "记进任务了：" + values.get(0) : "没记上"));
            }
            return;
        }
        super.onActivityResult(req, result, data);
    }

    // ---------------- 发给电脑 ----------------

    private void pickFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);   // 一次可多选，批量发给电脑
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
                runOnUiThread(() -> {
                    shareStatus.setText(ok ? "电脑收到了：" + name + " ✓（在 下载/Agent工具箱/手机精灵）" : "发送失败：" + name);
                    if (ok) { pushPref("sendlog", "📎 " + name, 6); renderSendLog(); }
                });
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
                runOnUiThread(() -> {
                    boolean ok = code >= 200 && code < 300;
                    shareStatus.setText(ok ? "已发送到电脑收件箱 ✓" : "发送失败：HTTP " + code);
                    if (ok) { manualShareInput.setText(""); pushPref("sendlog", "💬 " + (text.length() > 24 ? text.substring(0, 24) + "…" : text), 6); renderSendLog(); }
                });
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

    @Override protected void onDestroy() {
        if (chipPulse != null) { chipPulse.cancel(); chipPulse = null; }
        super.onDestroy();
    }
}
