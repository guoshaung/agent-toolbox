package cn.macpe.agenttoolbox.remote;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.SweepGradient;
import android.view.View;
import android.view.animation.LinearInterpolator;

/**
 * 唤醒时屏幕四周的流光边框。
 *
 * 一条环绕屏幕的角向渐变，转起来；同一条路径叠画四遍（越外圈越宽越淡），
 * 就是发光的感觉，不用模糊滤镜（软件层太费电）。整层不接收触摸。
 */
public class GlowView extends View {
    public static final int OFF = 0, LISTENING = 1, THINKING = 2, ACTING = 3;

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();
    private final Matrix matrix = new Matrix();
    private SweepGradient gradient;
    private final int[] colors = { 0xFF21E6A5, 0xFF4FB3D9, 0xFF9D7BFF, 0xFFF0B93D, 0xFF21E6A5 };
    private float phase = 0f;        // 0..1，转了几圈的小数部分
    private float alpha = 0f;        // 0..1，整体淡入淡出
    private int mode = OFF;
    private long lastFrame = 0;
    private ValueAnimator ticker;

    public GlowView(Context context) {
        super(context);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
    }

    public void setMode(int m) {
        if (m == mode) return;
        mode = m;
        ensureTicker();
    }

    private void ensureTicker() {
        if (ticker != null) return;
        ticker = ValueAnimator.ofFloat(0f, 1f);
        ticker.setDuration(1000);
        ticker.setRepeatCount(ValueAnimator.INFINITE);
        ticker.setInterpolator(new LinearInterpolator());
        ticker.addUpdateListener(a -> tick());
        ticker.start();
    }

    private void tick() {
        long now = System.currentTimeMillis();
        float dt = lastFrame == 0 ? 0.016f : Math.min(0.1f, (now - lastFrame) / 1000f);
        lastFrame = now;
        // 转速：听 2.4s 一圈，想 5s，做 1s
        float speed = mode == LISTENING ? 1f / 2.4f : mode == THINKING ? 1f / 5f : mode == ACTING ? 1f : 0f;
        phase = (phase + dt * speed) % 1f;
        float target = mode == OFF ? 0f : 1f;
        alpha += (target - alpha) * Math.min(1f, dt * (target > alpha ? 6f : 3f));
        if (mode == OFF && alpha < 0.01f) {
            alpha = 0f;
            if (ticker != null) { ticker.cancel(); ticker = null; }
            lastFrame = 0;
        }
        invalidate();
    }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        gradient = new SweepGradient(w / 2f, h / 2f, colors, null);
    }

    @Override protected void onDraw(Canvas canvas) {
        if (alpha <= 0f || gradient == null) return;
        int w = getWidth(), h = getHeight();
        float radius = Math.min(w, h) * 0.11f;                    // 跟着现在手机的圆角走
        // 听的时候轻轻呼吸一下
        float breathe = mode == LISTENING ? 0.82f + 0.18f * (float) Math.sin(phase * Math.PI * 2 * 2.4f) : 1f;
        matrix.setRotate(phase * 360f, w / 2f, h / 2f);
        gradient.setLocalMatrix(matrix);
        paint.setShader(gradient);
        float[] widths = { 0.06f, 0.032f, 0.014f, 0.005f };
        float[] alphas = { 0.10f, 0.22f, 0.55f, 1.0f };
        for (int k = 0; k < widths.length; k++) {
            float sw = Math.min(w, h) * widths[k];
            paint.setStrokeWidth(sw);
            paint.setAlpha(Math.round(255 * alphas[k] * alpha * breathe));
            rect.set(sw / 2f, sw / 2f, w - sw / 2f, h - sw / 2f);
            canvas.drawRoundRect(rect, radius, radius, paint);
        }
    }
}
