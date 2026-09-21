package cn.macpe.agenttoolbox.remote;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import android.view.animation.LinearInterpolator;

/**
 * 底部常驻的像素精灵。
 *
 * 一张 16×18 的字符图当底稿（圆身子、大眼睛、腮红、天线球、两只小脚），按最近邻放大画出来保留像素感。
 * 会动的部分（眨眼、瞳孔、天线、嘴、脚）按状态在底稿之上另外画。身下有一片软阴影，
 * 干活/听的时候身后有一圈呼吸光。
 */
public class SpriteView extends View {
    public static final int IDLE = 0, LISTENING = 1, THINKING = 2, ACTING = 3;

    // D 描边 B 主体 L 高光 S 阴影 W 眼白 E 瞳孔 H 眼高光 G 天线/脚 Y 天线亮 P 腮红 M 嘴
    private static final String[] BASE = {
        "......YGG.......",
        "......GGG.......",
        ".......D........",
        ".....DDDDDD.....",
        "...DDLLLBBBBDD..",
        "..DLLLBBBBBBBBD.",
        ".DLLBBBBBBBBBBBD",
        ".DLBWWWBBBWWWBBD",
        ".DBBWHEBBBWHEBBD",
        ".DBBWEEBBBWEEBBD",
        ".DPPBBBBBBBBBPPD",
        ".DSBBBMBBBMBBBSD",
        "..DSBBBMMMBBBSD.",
        "..DSSBBBBBBBSSD.",
        "...DDSSSSSSSDD..",
        "....DGGD.DGGD...",
        ".....DD...DD....",
        "................",
    };
    private static final int COLS = 16, ROWS = 18;

    private final Paint px = new Paint();
    private final Paint soft = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint wave = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF oval = new RectF();
    private int mode = IDLE;
    private float t = 0f;
    private long lastFrame = 0;
    private float blinkUntil = 0f, nextBlink = 2.5f;
    private ValueAnimator ticker;

    public SpriteView(Context context) {
        super(context);
        wave.setStyle(Paint.Style.STROKE);
        wave.setStrokeCap(Paint.Cap.ROUND);
    }

    public void setMode(int m) { mode = m; invalidate(); }
    public int getMode() { return mode; }

    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        ticker = ValueAnimator.ofFloat(0f, 1f);
        ticker.setDuration(1000);
        ticker.setRepeatCount(ValueAnimator.INFINITE);
        ticker.setInterpolator(new LinearInterpolator());
        ticker.addUpdateListener(a -> {
            long now = System.currentTimeMillis();
            float dt = lastFrame == 0 ? 0.016f : Math.min(0.1f, (now - lastFrame) / 1000f);
            lastFrame = now;
            t += dt;
            if (t > nextBlink) { blinkUntil = t + 0.13f; nextBlink = t + 2.4f + (float) Math.random() * 2.6f; }
            invalidate();
        });
        ticker.start();
    }

    @Override protected void onDetachedFromWindow() {
        if (ticker != null) { ticker.cancel(); ticker = null; }
        super.onDetachedFromWindow();
    }

    private static int color(char c) {
        switch (c) {
            case 'D': return 0xFF1B2A44;
            case 'B': return 0xFF3B7BFF;
            case 'L': return 0xFF7FB0FF;
            case 'S': return 0xFF2A5FD6;
            case 'W': return 0xFFF4FAFF;
            case 'E': return 0xFF0B1F3A;
            case 'H': return 0xFFFFFFFF;
            case 'G': return 0xFF21E6A5;
            case 'Y': return 0xFFF0B93D;
            case 'P': return 0xFFFF8FB1;
            case 'M': return 0xFF1B2A44;
            default: return 0;
        }
    }

    private void cell(Canvas c, float ox, float oy, float s, int col, int row, char ch) {
        int color = color(ch);
        if (color == 0) return;
        px.setColor(color);
        c.drawRect(ox + col * s, oy + row * s, ox + (col + 1) * s, oy + (row + 1) * s, px);
    }

    @Override protected void onDraw(Canvas c) {
        int w = getWidth(), h = getHeight();
        float s = Math.min(w / (float) (COLS + 4), h / (float) (ROWS + 1));
        float ox = (w - COLS * s) / 2f;
        float bob = mode == ACTING ? (float) Math.abs(Math.sin(t * 9)) * -s * 0.6f : (float) Math.sin(t * 2.0f) * s * 0.3f;
        float oy = h - (ROWS + 0.5f) * s + bob;
        float cx = ox + COLS * s / 2f;

        // 身后的呼吸光（只在忙的时候）
        if (mode != IDLE) {
            float pulse = 0.55f + 0.45f * (float) Math.sin(t * (mode == LISTENING ? 4f : 2.2f));
            int tint = mode == LISTENING ? 0x21E6A5 : mode == THINKING ? 0x9D7BFF : 0x3B7BFF;
            soft.setStyle(Paint.Style.FILL);
            for (int k = 3; k >= 1; k--) {
                soft.setColor((Math.round(26 * pulse * k) << 24) | tint);
                float r = s * (7f + k * 1.3f);
                c.drawCircle(cx, oy + 9.5f * s, r, soft);
            }
        }
        // 脚下的软阴影：跳起来的时候变小变淡
        float lift = -bob / (s * 0.6f);
        soft.setStyle(Paint.Style.FILL);
        soft.setColor((Math.round(70 * (1f - 0.5f * Math.max(0, lift))) << 24));
        float sw = s * (5.5f - 1.2f * Math.max(0, lift));
        oval.set(cx - sw, h - s * 1.1f, cx + sw, h - s * 0.2f);
        c.drawOval(oval, soft);

        boolean blink = t < blinkUntil;
        boolean stepA = ((int) (t * 8)) % 2 == 0;
        for (int r = 0; r < ROWS; r++) {
            String line = BASE[r];
            for (int k = 0; k < COLS; k++) {
                char ch = line.charAt(k);
                // 眨眼：眼睛三行全换成机身色，再画一条细线
                if (blink && r >= 7 && r <= 9 && (ch == 'W' || ch == 'E' || ch == 'H')) ch = r == 8 ? 'D' : 'B';
                // 瞳孔：动态另画
                if (!blink && (ch == 'E' || ch == 'H')) ch = 'W';
                // 走路：干活时两只脚交替抬起
                if (mode == ACTING && r >= 15 && r <= 16) {
                    boolean leftFoot = k < 8;
                    if (leftFoot == stepA && ch != '.') { if (r == 16) ch = '.'; }
                }
                // 说话：嘴一开一合
                if (ch == 'M' && (mode == ACTING || mode == THINKING) && ((int) (t * 5)) % 2 == 0 && r == 12) ch = 'B';
                cell(c, ox, oy, s, k, r, ch);
            }
        }
        // 瞳孔 + 高光：想事情时左右瞟，听的时候放大一格
        if (!blink) {
            int look = mode == THINKING ? (int) Math.round(Math.sin(t * 1.5f)) : 0;
            int[] eyes = { 4, 10 };                 // 两只眼睛眼白的左列
            for (int e : eyes) {
                int px0 = e + 1 + look;              // 瞳孔左上
                cell(c, ox, oy, s, Math.max(e, Math.min(e + 1, px0)), 8, 'E');
                cell(c, ox, oy, s, Math.max(e, Math.min(e + 1, px0)), 9, 'E');
                cell(c, ox, oy, s, Math.max(e, Math.min(e + 2, px0 + 1)), 8, 'E');
                cell(c, ox, oy, s, Math.max(e, Math.min(e + 2, px0 + 1)), 9, 'E');
                cell(c, ox, oy, s, Math.max(e, Math.min(e + 1, px0)), 8, 'H');   // 高光盖在左上
                if (mode == LISTENING) cell(c, ox, oy, s, Math.max(e, Math.min(e + 2, px0 + 1)), 7, 'E');
            }
        }
        // 天线球：忙的时候一闪一闪
        if (mode != IDLE) {
            boolean on = ((int) (t * (mode == LISTENING ? 6 : 2.5f))) % 2 == 0;
            cell(c, ox, oy, s, 6, 0, on ? 'Y' : 'G'); cell(c, ox, oy, s, 7, 0, on ? 'Y' : 'G'); cell(c, ox, oy, s, 8, 0, on ? 'Y' : 'G');
            cell(c, ox, oy, s, 6, 1, on ? 'Y' : 'G'); cell(c, ox, oy, s, 7, 1, on ? 'Y' : 'G'); cell(c, ox, oy, s, 8, 1, on ? 'Y' : 'G');
        }
        // 听：两侧一圈圈往外的声波
        if (mode == LISTENING) {
            float cy = oy + 8.5f * s;
            wave.setStrokeWidth(s * 0.4f);
            for (int k = 0; k < 3; k++) {
                float p = ((t * 0.9f) + k / 3f) % 1f;
                float r = s * (8f + p * 4.5f);
                wave.setColor(0xFF21E6A5);
                wave.setAlpha(Math.round(210 * (1f - p)));
                oval.set(cx - r, cy - r, cx + r, cy + r);
                c.drawArc(oval, 150, 60, false, wave);
                c.drawArc(oval, -30, 60, false, wave);
            }
        }
        // 想：头顶三个点轮流亮
        if (mode == THINKING) {
            int lit = ((int) (t * 3)) % 3;
            for (int k = 0; k < 3; k++) {
                px.setColor(k == lit ? 0xFF9D7BFF : 0x559D7BFF);
                c.drawCircle(ox + (COLS + 1.2f + k * 1.1f) * s, oy + (3.2f - k * 0.8f) * s, s * 0.45f, px);
            }
        }
    }
}
