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
 * 一张 12×14 的字符图当底稿，按最近邻放大画出来（保留像素感），
 * 眼睛、天线、手臂这些会动的部分在底稿之上按状态另外画。
 */
public class SpriteView extends View {
    public static final int IDLE = 0, LISTENING = 1, THINKING = 2, ACTING = 3;

    private static final String[] BASE = {
        "....GG......",
        ".....D......",
        "...DDDDDD...",
        "..DBBBBBBD..",
        ".DBWWBBWWBD.",
        ".DBWWBBWWBD.",
        ".DBBBBBBBBD.",
        ".DBBDDDDBBD.",
        "..DBBBBBBD..",
        "...DDDDDD...",
        "..DB....BD..",
        ".DBBD..DBBD.",
        "..DD....DD..",
        "............",
    };
    private static final int COLS = 12, ROWS = 14;

    private final Paint px = new Paint();
    private final Paint wave = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF arc = new RectF();
    private int mode = IDLE;
    private float t = 0f;                 // 秒
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
            if (t > nextBlink) { blinkUntil = t + 0.12f; nextBlink = t + 2.2f + (float) Math.random() * 2.5f; }
            invalidate();
        });
        ticker.start();
    }

    @Override protected void onDetachedFromWindow() {
        if (ticker != null) { ticker.cancel(); ticker = null; }
        super.onDetachedFromWindow();
    }

    private int color(char c) {
        switch (c) {
            case 'D': return 0xFF1B2A44;
            case 'B': return 0xFF3B7BFF;
            case 'W': return 0xFFF4FAFF;
            case 'G': return 0xFF21E6A5;
            case 'Y': return 0xFFF0B93D;
            case 'E': return 0xFF0B1F3A;
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
        float s = Math.min(w / (float) (COLS + 4), h / (float) (ROWS + 1));   // 两侧留位置画声波
        float ox = (w - COLS * s) / 2f;
        // 待机上下浮动；干活时抖得快一点
        float bob = mode == ACTING ? (float) Math.sin(t * 14) * s * 0.25f : (float) Math.sin(t * 2.2f) * s * 0.35f;
        float oy = h - (ROWS + 0.5f) * s + bob;

        boolean blink = t < blinkUntil;
        for (int r = 0; r < ROWS; r++) {
            String line = BASE[r];
            for (int k = 0; k < COLS; k++) {
                char ch = line.charAt(k);
                // 眨眼：眼白那两行换成机身色
                if (blink && (r == 4 || r == 5) && ch == 'W') ch = 'B';
                // 挥手：干活时右臂那两格抬起来
                if (mode == ACTING && r == 11 && k >= 7 && k <= 9) ch = '.';
                cell(c, ox, oy, s, k, r, ch);
            }
        }
        // 抬起来的右臂
        if (mode == ACTING) {
            boolean up = ((int) (t * 6)) % 2 == 0;
            int armRow = up ? 8 : 9;
            cell(c, ox, oy, s, 10, armRow, 'D'); cell(c, ox, oy, s, 11, armRow, 'B'); cell(c, ox, oy, s, 11, armRow - 1, 'D');
        }
        // 瞳孔：想事情时左右瞟；听的时候睁大
        if (!blink) {
            int look = mode == THINKING ? (int) Math.signum(Math.sin(t * 1.6f)) : 0;
            int pupilRow = mode == LISTENING ? 4 : 5;
            cell(c, ox, oy, s, 3 + look, pupilRow, 'E');
            cell(c, ox, oy, s, 8 + look, pupilRow, 'E');
        }
        // 天线：听/做的时候闪
        if (mode != IDLE) {
            boolean on = ((int) (t * (mode == LISTENING ? 5 : 2))) % 2 == 0;
            cell(c, ox, oy, s, 4, 0, on ? 'Y' : 'G'); cell(c, ox, oy, s, 5, 0, on ? 'Y' : 'G');
        }
        // 声波：听的时候两侧一圈圈往外
        if (mode == LISTENING) {
            float cx = ox + COLS * s / 2f, cy = oy + 5.5f * s;
            wave.setStrokeWidth(s * 0.35f);
            for (int k = 0; k < 3; k++) {
                float p = ((t * 0.9f) + k / 3f) % 1f;
                float r = s * (5.5f + p * 4f);
                wave.setColor(0xFF21E6A5);
                wave.setAlpha(Math.round(200 * (1f - p)));
                arc.set(cx - r, cy - r, cx + r, cy + r);
                c.drawArc(arc, 150, 60, false, wave);
                c.drawArc(arc, -30, 60, false, wave);
            }
        }
        // 想：头顶三个点轮流亮
        if (mode == THINKING) {
            int lit = ((int) (t * 3)) % 3;
            for (int k = 0; k < 3; k++) {
                px.setColor(k == lit ? 0xFF21E6A5 : 0x5521E6A5);
                float dx = ox + (COLS + 1.2f + k * 1.1f) * s, dy = oy + (2.5f - k * 0.7f) * s;
                c.drawCircle(dx, dy, s * 0.42f, px);
            }
        }
    }
}
