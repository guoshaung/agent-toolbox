package cn.macpe.agenttoolbox.remote;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final String PREFS = "agent_remote";
    private static final String ENDPOINT = "endpoint";
    private EditText endpointInput;
    private TextView shareStatus;
    private WebView webView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        buildUi();
        handleIncomingShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingShare(intent);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(28, 28, 28, 18);
        root.setBackgroundColor(Color.rgb(16, 21, 27));

        TextView title = new TextView(this);
        title.setText("Agent 工具箱手机端");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setPadding(0, 0, 0, 14);
        root.addView(title, new LinearLayout.LayoutParams(-1, -2));

        TextView hint = new TextView(this);
        hint.setText("先粘贴电脑端配对地址；之后从论文、视频、公众号点击系统分享即可同步到电脑。\n当前版本接收文字和链接，PDF 文件接收将在下一版加入。\n配对地址示例：http://电脑地址:43127/?token=...");
        hint.setTextColor(Color.rgb(168, 183, 193));
        hint.setTextSize(13);
        root.addView(hint, new LinearLayout.LayoutParams(-1, -2));

        endpointInput = new EditText(this);
        endpointInput.setSingleLine(true);
        endpointInput.setHint("http://192.168.x.x:43127/?token=...");
        endpointInput.setTextColor(Color.WHITE);
        endpointInput.setHintTextColor(Color.rgb(120, 137, 148));
        endpointInput.setText(getSharedPreferences(PREFS, MODE_PRIVATE).getString(ENDPOINT, ""));
        root.addView(endpointInput, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        Button connect = button("连接电脑");
        connect.setOnClickListener(view -> connect());
        Button clear = button("清除");
        clear.setOnClickListener(view -> { endpointInput.setText(""); getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(ENDPOINT).apply(); });
        actions.addView(connect, new LinearLayout.LayoutParams(0, -2, 1));
        actions.addView(clear, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(actions, new LinearLayout.LayoutParams(-1, -2));

        shareStatus = new TextView(this);
        shareStatus.setTextColor(Color.rgb(110, 224, 204));
        shareStatus.setTextSize(12);
        shareStatus.setPadding(0, 14, 0, 8);
        root.addView(shareStatus, new LinearLayout.LayoutParams(-1, -2));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportZoom(true);
        webView.setBackgroundColor(Color.rgb(16, 21, 27));
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        if (!endpointInput.getText().toString().trim().isEmpty()) connect();
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        return button;
    }

    private void connect() {
        String endpoint = endpointInput.getText().toString().trim();
        if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) { toast("请输入电脑端配对地址"); return; }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(ENDPOINT, endpoint).apply();
        webView.loadUrl(endpoint);
        shareStatus.setText("已保存配对地址，正在连接电脑…");
    }

    private void handleIncomingShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (text == null && uri != null) text = uri.toString();
        if (text == null) text = "";
        final String shared = text.trim();
        if (shared.isEmpty()) return;
        String endpoint = getSharedPreferences(PREFS, MODE_PRIVATE).getString(ENDPOINT, "");
        if (endpoint.isEmpty()) { shareStatus.setText("已收到分享内容，请先填写电脑端配对地址"); return; }
        shareStatus.setText("正在把分享内容同步到电脑…");
        new Thread(() -> {
            try {
                Uri remote = Uri.parse(endpoint);
                String token = remote.getQueryParameter("token");
                if (token == null || remote.getHost() == null) throw new IllegalStateException("配对地址缺少 token");
                String origin = remote.getScheme() + "://" + remote.getAuthority();
                URL url = new URL(origin + "/share?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8.name()));
                String body = "title=" + URLEncoder.encode("手机分享", StandardCharsets.UTF_8.name()) + "&text=" + URLEncoder.encode(shared, StandardCharsets.UTF_8.name());
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setConnectTimeout(8000); connection.setReadTimeout(12000); connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                try (OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
                int code = connection.getResponseCode();
                runOnUiThread(() -> shareStatus.setText(code >= 200 && code < 400 ? "已同步到电脑手机收件箱" : "同步失败：HTTP " + code));
            } catch (Exception error) { runOnUiThread(() -> shareStatus.setText("同步失败：" + error.getMessage())); }
        }).start();
    }

    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show(); }
}
