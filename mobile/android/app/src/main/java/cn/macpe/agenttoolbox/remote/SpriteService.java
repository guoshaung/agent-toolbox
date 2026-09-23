package cn.macpe.agenttoolbox.remote;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 手机精灵 = 无障碍服务。三件事：
 *
 *  1. 眼和手：读当前屏幕的控件树（文字、坐标、能不能点），按电脑端大脑回的动作去点、滑、输入。
 *     不截图、不上传画面 —— 发给电脑的只是控件上的文字。
 *  2. 脸：底部那个像素精灵和唤醒时的四周流光，都是无障碍覆盖窗（不用再申请悬浮窗权限）。
 *  3. 传文件：每几秒问电脑出件箱一次，有文件就取回来放进「下载/Agent工具箱」。
 *
 * 大脑在电脑端（/api/phone/step），这里只做执行 —— 模型配置和 key 都不落在手机上。
 */
public class SpriteService extends AccessibilityService {
    private static final String PREFS = "agent_remote", ENDPOINT = "endpoint", VISIBLE = "sprite.visible";
    private static final int MAX_STEPS = 25, MAX_NODES = 160;
    private static SpriteService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private GlowView glow;
    private boolean glowAttached = false;
    private LinearLayout box;
    private TextView bubble;
    private SpriteView sprite;
    private WindowManager.LayoutParams boxParams;
    private boolean spriteShown = false;
    private final Runnable hideBubble = () -> { if (bubble != null) bubble.setVisibility(View.GONE); };

    private final List<AccessibilityNodeInfo> refs = new ArrayList<>();
    private volatile boolean running = false, cancelled = false;
    private String currentPackage = "";
    private Thread poller;
    private final Set<String> fetched = new HashSet<>();
    private Uri lastFile;

    public static SpriteService get() { return instance; }

    /** 系统设置里有没有把这个服务打开 */
    public static boolean isEnabled(Context ctx) {
        String list = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (list == null) return false;
        String me = ctx.getPackageName() + "/" + SpriteService.class.getName();
        String meShort = ctx.getPackageName() + "/.SpriteService";
        for (String item : list.split(":")) if (item.equalsIgnoreCase(me) || item.equalsIgnoreCase(meShort)) return true;
        return false;
    }

    public static boolean wantsVisible(Context ctx) { return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(VISIBLE, true); }
    public static String endpoint(Context ctx) { return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getString(ENDPOINT, ""); }

    // ---------------- 生命周期 ----------------

    @Override protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        buildOverlays();
        if (wantsVisible(this)) showSprite();
        startPoller();
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && event.getPackageName() != null) {
            String pkg = event.getPackageName().toString();
            if (!pkg.equals(getPackageName())) currentPackage = pkg;
        }
    }

    @Override public void onInterrupt() { }

    @Override public boolean onUnbind(Intent intent) {
        cancelled = true;
        if (poller != null) poller.interrupt();
        main.post(() -> { hideSprite(); detachGlow(); });
        instance = null;
        return super.onUnbind(intent);
    }

    // ---------------- 覆盖层：精灵 + 流光 ----------------

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private void buildOverlays() {
        glow = new GlowView(this);

        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        bubble = new TextView(this);
        bubble.setTextColor(Color.WHITE);
        bubble.setTextSize(13);
        bubble.setMaxWidth(dp(260));
        bubble.setPadding(dp(12), dp(8), dp(12), dp(8));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xF2171A23);                       // 和网页 / 壳统一的深蓝卡片色
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(1), 0xFF7C5CFF);
        bubble.setBackground(bg);
        bubble.setVisibility(View.GONE);
        bubble.setOnClickListener(v -> openLastFile());
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, -2);
        bp.bottomMargin = dp(6);
        box.addView(bubble, bp);
        sprite = new SpriteView(this);
        box.addView(sprite, new LinearLayout.LayoutParams(dp(92), dp(100)));

        boxParams = new WindowManager.LayoutParams(-2, -2,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT);
        boxParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        boxParams.y = dp(84);

        // 拖着走；轻点 = 说话 / 停下；长按 = 隐藏
        box.setOnTouchListener(new View.OnTouchListener() {
            float downX, downY; int startX, startY; boolean moved; final Runnable longPress = () -> { moved = true; hideSprite(); toast("精灵藏起来了，在工具箱页面可以再叫出来"); };
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX(); downY = e.getRawY(); startX = boxParams.x; startY = boxParams.y; moved = false;
                        main.postDelayed(longPress, 650);
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                        if (!moved && Math.hypot(dx, dy) > dp(8)) { moved = true; main.removeCallbacks(longPress); }
                        if (moved) { boxParams.x = startX + Math.round(dx); boxParams.y = Math.max(0, startY - Math.round(dy)); try { wm.updateViewLayout(box, boxParams); } catch (Exception ignored) { } }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        main.removeCallbacks(longPress);
                        if (!moved && e.getActionMasked() == MotionEvent.ACTION_UP) onSpriteTap();
                        return true;
                }
                return false;
            }
        });
    }

    private void attachGlow() {
        if (glowAttached) return;
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(-1, -1,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        try { wm.addView(glow, p); glowAttached = true; } catch (Exception ignored) { }
    }

    /** 流光不亮的时候把整层窗口撤掉：全屏覆盖窗挂着，有些应用的按钮会拒绝点击（防点击劫持） */
    private void detachGlow() {
        if (!glowAttached) return;
        try { wm.removeView(glow); } catch (Exception ignored) { }
        glowAttached = false;
    }

    public void showSprite() {
        main.post(() -> {
            if (spriteShown || box == null) return;
            try { wm.addView(box, boxParams); spriteShown = true; } catch (Exception e) { toast("精灵出不来：" + e.getMessage()); }
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(VISIBLE, true).apply();
        });
    }

    public void hideSprite() {
        main.post(() -> {
            if (!spriteShown) return;
            try { wm.removeView(box); } catch (Exception ignored) { }
            spriteShown = false;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(VISIBLE, false).apply();
        });
    }

    public boolean isSpriteShown() { return spriteShown; }
    public void toggleSprite() { if (spriteShown) hideSprite(); else showSprite(); }

    private void onSpriteTap() {
        if (running) { cancelled = true; say("好，停下了"); return; }
        Intent i = new Intent(this, VoiceActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
    }

    /** 精灵头上冒一句话。busy 的话不自动消失 */
    public void say(String text) { say(text, false); }
    public void say(String text, boolean sticky) {
        main.post(() -> {
            if (bubble == null) return;
            main.removeCallbacks(hideBubble);
            if (text == null || text.isEmpty()) { bubble.setVisibility(View.GONE); return; }
            bubble.setText(text);
            bubble.setVisibility(View.VISIBLE);
            if (!sticky) main.postDelayed(hideBubble, 6000);
        });
    }

    /** 状态 = 精灵表情 + 流光 + 告诉电脑一声（桌面精灵跟着演） */
    public void setState(String state, String text) {
        main.post(() -> {
            int s = "listening".equals(state) ? SpriteView.LISTENING : "thinking".equals(state) ? SpriteView.THINKING : "acting".equals(state) ? SpriteView.ACTING : SpriteView.IDLE;
            if (sprite != null) sprite.setMode(s);
            int g = "listening".equals(state) ? GlowView.LISTENING : "thinking".equals(state) ? GlowView.THINKING : "acting".equals(state) ? GlowView.ACTING : GlowView.OFF;
            if (g != GlowView.OFF) attachGlow();
            glow.setMode(g);
            if (g == GlowView.OFF) main.postDelayed(this::detachGlow, 900);
        });
        new Thread(() -> { try { JSONObject b = new JSONObject(); b.put("state", state); b.put("text", text == null ? "" : text); post("/api/phone/state", b); } catch (Exception ignored) { } }).start();
    }

    private void toast(String msg) { main.post(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()); }

    // ---------------- 眼：读屏幕 ----------------

    private static String shortClass(CharSequence cls) {
        if (cls == null) return "";
        String s = cls.toString();
        return s.substring(s.lastIndexOf('.') + 1);
    }

    private static String shortId(String id) {
        if (id == null) return "";
        int k = id.indexOf('/');
        return k >= 0 ? id.substring(k + 1) : id;
    }

    /** 深度优先把有意义的控件拉平成一个列表，编号就是列表下标；同时留着引用，动作按编号找回来 */
    private synchronized JSONArray dumpTree() {
        refs.clear();
        JSONArray out = new JSONArray();
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return out;
        walk(root, out, 0);
        return out;
    }

    private void walk(AccessibilityNodeInfo node, JSONArray out, int depth) {
        if (node == null || out.length() >= MAX_NODES || depth > 40) return;
        try {
            if (!node.isVisibleToUser()) return;
            String text = node.getText() == null ? "" : node.getText().toString().trim();
            String desc = node.getContentDescription() == null ? "" : node.getContentDescription().toString().trim();
            boolean meaningful = !text.isEmpty() || !desc.isEmpty() || node.isClickable() || node.isEditable() || node.isScrollable() || node.isCheckable();
            if (meaningful) {
                Rect b = new Rect();
                node.getBoundsInScreen(b);
                if (b.width() > 0 && b.height() > 0) {
                    JSONObject o = new JSONObject();
                    o.put("i", out.length());
                    o.put("cls", shortClass(node.getClassName()));
                    if (!text.isEmpty()) o.put("t", text.length() > 80 ? text.substring(0, 80) : text);
                    if (!desc.isEmpty()) o.put("d", desc.length() > 60 ? desc.substring(0, 60) : desc);
                    String id = shortId(node.getViewIdResourceName());
                    if (!id.isEmpty()) o.put("id", id);
                    o.put("c", node.isClickable()); o.put("e", node.isEditable()); o.put("s", node.isScrollable());
                    if (node.isCheckable()) o.put("chk", node.isChecked());
                    o.put("b", new JSONArray().put(b.left).put(b.top).put(b.right).put(b.bottom));
                    out.put(o);
                    refs.add(node);
                }
            }
            int n = node.getChildCount();
            for (int k = 0; k < n; k++) walk(node.getChild(k), out, depth + 1);
        } catch (Exception ignored) { }
    }

    private AccessibilityNodeInfo ref(int i) { synchronized (this) { return i >= 0 && i < refs.size() ? refs.get(i) : null; } }

    // ---------------- 手：动作 ----------------

    private boolean gestureTap(float x, float y) {
        Path p = new Path(); p.moveTo(x, y);
        GestureDescription g = new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, 60)).build();
        return dispatchGesture(g, null, null);
    }

    private boolean gestureSwipe(float x1, float y1, float x2, float y2, long ms) {
        Path p = new Path(); p.moveTo(x1, y1); p.lineTo(x2, y2);
        GestureDescription g = new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, ms)).build();
        return dispatchGesture(g, null, null);
    }

    private boolean tapIndex(int i) {
        AccessibilityNodeInfo node = ref(i);
        if (node == null) return false;
        // 先试无障碍点击（最准）：自己不能点就往上找能点的父级
        AccessibilityNodeInfo target = node;
        for (int k = 0; target != null && k < 5 && !target.isClickable(); k++) target = target.getParent();
        if (target != null && target.isClickable() && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
        Rect b = new Rect(); node.getBoundsInScreen(b);
        return gestureTap(b.centerX(), b.centerY());
    }

    private boolean typeIndex(int i, String text) {
        AccessibilityNodeInfo node = ref(i);
        if (node == null) return false;
        node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return true;
        // 有些输入框不吃 SET_TEXT（微信的就是），退一步：剪贴板 + 粘贴
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        cm.setPrimaryClip(ClipData.newPlainText("sprite", text));
        return node.performAction(AccessibilityNodeInfo.ACTION_PASTE);
    }

    private boolean swipe(String dir) {
        DisplayMetrics m = getResources().getDisplayMetrics();
        float w = m.widthPixels, h = m.heightPixels, cx = w / 2f, cy = h / 2f;
        switch (dir) {
            case "up": return gestureSwipe(cx, h * 0.72f, cx, h * 0.28f, 320);
            case "down": return gestureSwipe(cx, h * 0.28f, cx, h * 0.72f, 320);
            case "left": return gestureSwipe(w * 0.8f, cy, w * 0.2f, cy, 300);
            default: return gestureSwipe(w * 0.2f, cy, w * 0.8f, cy, 300);
        }
    }

    private boolean scrollIndex(int i, String dir) {
        AccessibilityNodeInfo node = ref(i);
        if (node == null) return false;
        int action = "down".equals(dir) ? AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD : AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
        if (node.performAction(action)) return true;
        Rect b = new Rect(); node.getBoundsInScreen(b);
        float x = b.centerX();
        return "down".equals(dir) ? gestureSwipe(x, b.top + b.height() * 0.25f, x, b.bottom - b.height() * 0.25f, 300)
                                  : gestureSwipe(x, b.bottom - b.height() * 0.25f, x, b.top + b.height() * 0.25f, 300);
    }

    /** 按名字开应用：先全等，再包含，最后拿包名兜底 */
    private boolean openApp(String name) {
        PackageManager pm = getPackageManager();
        Intent probe = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(probe, 0);
        String want = name.trim().toLowerCase();
        String pkg = null;
        for (ResolveInfo r : apps) { String label = String.valueOf(r.loadLabel(pm)).toLowerCase(); if (label.equals(want)) { pkg = r.activityInfo.packageName; break; } }
        if (pkg == null) for (ResolveInfo r : apps) { String label = String.valueOf(r.loadLabel(pm)).toLowerCase(); if (label.contains(want) || want.contains(label) && label.length() >= 2) { pkg = r.activityInfo.packageName; break; } }
        if (pkg == null) for (ResolveInfo r : apps) { if (r.activityInfo.packageName.toLowerCase().contains(want)) { pkg = r.activityInfo.packageName; break; } }
        if (pkg == null) return false;
        Intent launch = pm.getLaunchIntentForPackage(pkg);
        if (launch == null) return false;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        startActivity(launch);
        return true;
    }

    private String currentAppLabel() {
        if (currentPackage.isEmpty()) return "";
        try { PackageManager pm = getPackageManager(); return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(currentPackage, 0))); } catch (Exception e) { return currentPackage; }
    }

    // ---------------- 大脑在电脑那边：循环 ----------------

    public boolean isRunning() { return running; }

    /** 一句话目标 → 看屏幕、问电脑、动手，直到 done / ask / 走满步数 */
    public void runGoal(String goal) {
        if (goal == null || goal.trim().isEmpty()) return;
        if (running) { cancelled = true; return; }
        if (endpoint(this).isEmpty()) { say("还没连电脑 —— 先在工具箱里扫码配对"); return; }
        running = true; cancelled = false;
        new Thread(() -> {
            JSONArray history = new JSONArray();
            try {
                say("好，我来：" + goal, true);
                setState("thinking", goal);
                Thread.sleep(700);                                   // 等透明的听音页退场
                for (int step = 0; step < MAX_STEPS && !cancelled; step++) {
                    JSONArray nodes = dumpTree();
                    JSONObject body = new JSONObject();
                    body.put("goal", goal); body.put("nodes", nodes); body.put("history", history); body.put("app", currentAppLabel());
                    setState("thinking", "");
                    JSONObject reply = post("/api/phone/step", body);
                    if (!reply.optBoolean("ok")) { say("电脑说：" + reply.optString("error", "没回应")); break; }
                    JSONObject a = reply.getJSONObject("action");
                    String kind = a.getString("action");
                    String target = reply.optString("target", "");
                    if (kind.equals("done")) { say(a.optString("say", "搞定了")); setState("done", a.optString("say", "")); running = false; return; }
                    if (kind.equals("ask")) { say(a.optString("say", "你来看一下？"), true); setState("ask", a.optString("say", "")); running = false; return; }
                    String label = describe(a, target);
                    say(label, true);
                    setState("acting", label);
                    boolean ok;
                    switch (kind) {
                        case "tap": ok = tapIndex(a.getInt("index")); break;
                        case "type": ok = typeIndex(a.getInt("index"), a.optString("text", "")); break;
                        case "swipe": ok = swipe(a.optString("dir", "up")); break;
                        case "scroll": ok = scrollIndex(a.getInt("index"), a.optString("dir", "up")); break;
                        case "back": ok = performGlobalAction(GLOBAL_ACTION_BACK); break;
                        case "home": ok = performGlobalAction(GLOBAL_ACTION_HOME); break;
                        case "open": ok = openApp(a.optString("app", "")); break;
                        case "wait": ok = true; Thread.sleep(1200); break;
                        default: ok = false;
                    }
                    JSONObject h = new JSONObject(); h.put("action", a); h.put("text", label + (ok ? "" : "（没成功）"));
                    history.put(h);
                    Thread.sleep(kind.equals("open") ? 1800 : 900);
                }
                if (cancelled) say("停下了"); else say("做了 " + MAX_STEPS + " 步还没完成，先停下，你看看？");
            } catch (Exception e) {
                say("出错了：" + e.getMessage());
            } finally {
                running = false;
                setState("idle", "");
            }
        }).start();
    }

    private static String describe(JSONObject a, String target) {
        String k = a.optString("action");
        String t = target.isEmpty() ? "" : "「" + target + "」";
        switch (k) {
            case "tap": return "点" + (t.isEmpty() ? "一下" : t);
            case "type": return "输入「" + a.optString("text") + "」";
            case "swipe": return "上".equals(a.optString("dir")) || "up".equals(a.optString("dir")) ? "往下翻" : "down".equals(a.optString("dir")) ? "往上翻" : "滑一下";
            case "scroll": return "滚" + t;
            case "back": return "返回";
            case "home": return "回桌面";
            case "open": return "打开 " + a.optString("app");
            case "wait": return "等一下…";
            default: return k;
        }
    }

    // ---------------- 和电脑说话 ----------------

    private static String origin(String endpoint) { Uri u = Uri.parse(endpoint); return u.getScheme() + "://" + u.getAuthority(); }
    private static String token(String endpoint) { String t = Uri.parse(endpoint).getQueryParameter("token"); return t == null ? "" : t; }

    private JSONObject post(String path, JSONObject body) throws Exception {
        String ep = endpoint(this);
        URL url = new URL(origin(ep) + path + "?token=" + URLEncoder.encode(token(ep), "UTF-8"));
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setRequestMethod("POST"); c.setDoOutput(true); c.setConnectTimeout(6000); c.setReadTimeout(70000);
        c.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = c.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        return new JSONObject(readAll(c));
    }

    private static String readAll(HttpURLConnection c) throws Exception {
        int code = c.getResponseCode();
        try (InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream()) {
            if (in == null) return "{}";
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192]; int n;
            while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
            return buf.toString("UTF-8");
        }
    }

    // ---------------- 传文件：取电脑放的、推自己的 ----------------

    private void startPoller() {
        if (poller != null) return;
        poller = new Thread(() -> {
            while (instance == this && !Thread.currentThread().isInterrupted()) {
                try {
                    Thread.sleep(3000);
                    String ep = endpoint(this);
                    if (ep.isEmpty()) continue;
                    URL url = new URL(origin(ep) + "/api/phone/outbox?token=" + URLEncoder.encode(token(ep), "UTF-8"));
                    HttpURLConnection c = (HttpURLConnection) url.openConnection();
                    c.setConnectTimeout(4000); c.setReadTimeout(6000);
                    JSONObject reply = new JSONObject(readAll(c));
                    JSONArray items = reply.optJSONArray("items");
                    if (items == null) continue;
                    for (int k = 0; k < items.length(); k++) {
                        JSONObject it = items.getJSONObject(k);
                        String id = it.getString("id");
                        if (fetched.contains(id)) continue;
                        fetched.add(id);
                        fetchOne(ep, id, it.getString("name"), it.optString("mime", "application/octet-stream"));
                    }
                } catch (InterruptedException e) { return; } catch (Exception ignored) { }
            }
        }, "sprite-outbox");
        poller.setDaemon(true);
        poller.start();
    }

    private void fetchOne(String ep, String id, String name, String mime) {
        try {
            say("收到电脑递来的 " + name + " …", true);
            URL url = new URL(origin(ep) + "/api/phone/outbox/" + id + "?token=" + URLEncoder.encode(token(ep), "UTF-8"));
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(6000); c.setReadTimeout(120000);
            if (c.getResponseCode() != 200) { say("取 " + name + " 失败：HTTP " + c.getResponseCode()); return; }
            Uri saved;
            try (InputStream in = c.getInputStream()) { saved = saveToDownloads(name, mime, in); }
            lastFile = saved;
            HttpURLConnection done = (HttpURLConnection) new URL(origin(ep) + "/api/phone/outbox/" + id + "/done?token=" + URLEncoder.encode(token(ep), "UTF-8") + "&name=" + URLEncoder.encode(name, "UTF-8")).openConnection();
            done.setRequestMethod("POST"); done.setDoOutput(true); done.setConnectTimeout(4000);
            try (OutputStream out = done.getOutputStream()) { out.write("{}".getBytes(StandardCharsets.UTF_8)); }
            done.getResponseCode();
            say("收好了：" + name + "（在 下载/Agent工具箱）· 点这里打开", true);
            main.postDelayed(hideBubble, 15000);
            notifyFile(name, saved);
        } catch (Exception e) {
            say("取 " + name + " 出错：" + e.getMessage());
        }
    }

    /** 收到文件的系统通知：精灵藏着、或者你在别的应用里，也知道东西到了 */
    private void notifyFile(String name, Uri uri) {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new android.app.NotificationChannel("files", "电脑递来的文件", android.app.NotificationManager.IMPORTANCE_DEFAULT));
            Intent open = new Intent(Intent.ACTION_VIEW, uri); open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(this, (int) (System.currentTimeMillis() & 0xffff), open, android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
            android.app.Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new android.app.Notification.Builder(this, "files") : new android.app.Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("电脑递来：" + name).setContentText("在 下载/Agent工具箱，点一下打开").setContentIntent(pi).setAutoCancel(true);
            nm.notify((int) (System.currentTimeMillis() & 0x7fffffff), b.build());
        } catch (Exception ignored) { }
    }

    /** 落到系统「下载/Agent工具箱」：任何文件管理器都看得到，不需要存储权限 */
    private Uri saveToDownloads(String name, String mime, InputStream in) throws Exception {
        ContentResolver cr = getContentResolver();
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, "Download/Agent工具箱");
            v.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IllegalStateException("系统不让写下载目录");
            try (OutputStream out = cr.openOutputStream(uri)) { copy(in, out); }
            v.clear(); v.put(MediaStore.Downloads.IS_PENDING, 0); cr.update(uri, v, null, null);
            return uri;
        }
        File dir = new File(getExternalFilesDir(null), "精灵收件");
        dir.mkdirs();
        File f = new File(dir, name);
        try (OutputStream out = new FileOutputStream(f)) { copy(in, out); }
        return Uri.fromFile(f);
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] chunk = new byte[65536]; int n;
        while ((n = in.read(chunk)) != -1) out.write(chunk, 0, n);
    }

    private void openLastFile() {
        if (lastFile == null) return;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, lastFile);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(i);
        } catch (Exception e) { toast("没有能打开它的应用；文件在 下载/Agent工具箱"); }
    }

    /** 手机往电脑推文件：原始字节流，不转 base64，大文件也行。MainActivity 用，不需要服务在跑 */
    public static JSONObject upload(Context ctx, Uri uri, String name) throws Exception {
        String ep = endpoint(ctx);
        if (ep.isEmpty()) throw new IllegalStateException("还没连电脑");
        ContentResolver cr = ctx.getContentResolver();
        long size = -1;
        try (android.database.Cursor cur = cr.query(uri, new String[]{ android.provider.OpenableColumns.SIZE, android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cur != null && cur.moveToFirst()) { size = cur.getLong(0); if (name == null || name.isEmpty()) name = cur.getString(1); }
        }
        if (name == null || name.isEmpty()) name = "手机文件-" + System.currentTimeMillis();
        URL url = new URL(origin(ep) + "/api/phone/upload?token=" + URLEncoder.encode(token(ep), "UTF-8") + "&name=" + URLEncoder.encode(name, "UTF-8"));
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setRequestMethod("POST"); c.setDoOutput(true); c.setConnectTimeout(6000); c.setReadTimeout(180000);
        c.setRequestProperty("Content-Type", "application/octet-stream");
        if (size > 0) c.setFixedLengthStreamingMode(size); else c.setChunkedStreamingMode(65536);
        try (InputStream in = cr.openInputStream(uri); OutputStream out = c.getOutputStream()) {
            if (in == null) throw new IllegalStateException("打不开这个文件");
            copy(in, out);
        }
        return new JSONObject(readAll(c));
    }
}
