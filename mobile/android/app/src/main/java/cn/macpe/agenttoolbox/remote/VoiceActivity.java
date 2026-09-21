package cn.macpe.agenttoolbox.remote;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.widget.Toast;

import java.util.ArrayList;

/**
 * 听一句话。透明页：底下的应用照常显示，四周流光亮起、精灵竖起耳朵，
 * 说完把文字交给精灵去执行，页面就退掉。
 */
public class VoiceActivity extends Activity {
    private static final int PERM = 7, DIALOG = 8;
    private SpeechRecognizer rec;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        SpriteService svc = SpriteService.get();
        if (svc == null) { toast("先在系统「无障碍」里打开「Agent 工具箱 · 手机精灵」"); finish(); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{ Manifest.permission.RECORD_AUDIO }, PERM);
            return;
        }
        listen();
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] grants) {
        if (req == PERM && grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) listen();
        else { toast("没有麦克风权限，精灵听不见"); finish(); }
    }

    private void listen() {
        SpriteService svc = SpriteService.get();
        if (svc == null) { finish(); return; }
        svc.setState("listening", "");
        svc.say("在听…", true);
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            // 没有免打扰的识别服务，退回系统那个带对话框的
            try {
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
                i.putExtra(RecognizerIntent.EXTRA_PROMPT, "跟精灵说要做什么");
                startActivityForResult(i, DIALOG);
            } catch (Exception e) { svc.say("这台手机没有语音识别服务"); svc.setState("idle", ""); finish(); }
            return;
        }
        rec = SpeechRecognizer.createSpeechRecognizer(this);
        rec.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle p) { }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onRmsChanged(float v) { }
            @Override public void onBufferReceived(byte[] b) { }
            @Override public void onEndOfSpeech() { SpriteService s = SpriteService.get(); if (s != null) s.say("嗯，想想…", true); }
            @Override public void onError(int code) {
                SpriteService s = SpriteService.get();
                if (s != null) { s.say(code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "没听清，再点我一下" : "听不了：错误 " + code); s.setState("idle", ""); }
                finish();
            }
            @Override public void onResults(Bundle b) {
                ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                deliver(r != null && !r.isEmpty() ? r.get(0) : "");
            }
            @Override public void onPartialResults(Bundle b) {
                ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                SpriteService s = SpriteService.get();
                if (s != null && r != null && !r.isEmpty() && !r.get(0).isEmpty()) s.say(r.get(0), true);
            }
            @Override public void onEvent(int t, Bundle b) { }
        });
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        rec.startListening(i);
    }

    @Override protected void onActivityResult(int req, int result, Intent data) {
        if (req == DIALOG) {
            ArrayList<String> r = result == RESULT_OK && data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
            deliver(r != null && !r.isEmpty() ? r.get(0) : "");
            return;
        }
        super.onActivityResult(req, result, data);
    }

    private void deliver(String text) {
        SpriteService s = SpriteService.get();
        if (s != null) {
            if (text.trim().isEmpty()) { s.say("没听到内容"); s.setState("idle", ""); }
            else s.runGoal(text.trim());
        }
        finish();
    }

    @Override protected void onDestroy() {
        if (rec != null) { try { rec.destroy(); } catch (Exception ignored) { } rec = null; }
        super.onDestroy();
    }

    private void toast(String m) { Toast.makeText(this, m, Toast.LENGTH_LONG).show(); }
}
