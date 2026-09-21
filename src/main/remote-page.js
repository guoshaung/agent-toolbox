'use strict';

/**
 * 手机控制台页面。
 *
 * 之前是七张一模一样的卡片从上滚到下，一屏只看得到一张半，找「今天吃什么」得先
 * 滚过办公室。现在按「一屏一件事」分三个 tab：派活 / 吃啥 / 电脑，配色跟桌面端
 * 的紫色系对齐，工位用桌面端同一套像素头像，输入栏固定在底部。
 *
 * 这个页面由工具箱自己的 http 服务直出，没有 CSP，所以 style 属性和内联脚本都能用。
 */

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// 头像和桌面端 office-scene.js 的 LOOKS 保持一致；OpenCode 没有原画，走首字母
const LOOKS = {
  dsh: { sprite: 'sprite-dsh.png', accent: '#4e8cff', who: 'DeepSeek' },
  codex: { sprite: 'sprite-codex.png', accent: '#c9d2e6', who: 'GPT' },
  claude: { sprite: 'sprite-claude.png', accent: '#e89b68', who: 'Claude' },
  gemini: { sprite: 'sprite-gemini.png', accent: '#8d9cf6', who: 'Gemini' },
  kimi: { sprite: 'sprite-kimi.png', accent: '#b9b6e8', who: 'Kimi' },
  glm: { sprite: 'sprite-glm.png', accent: '#7f8797', who: 'GLM' },
  grok: { sprite: 'sprite-grok.png', accent: '#d7b45e', who: 'Grok' },
  opencode: { sprite: '', accent: '#ba86ed', who: 'OpenCode' },
};

const MOODS = ['随便', '想吃点好的', '清淡一点', '重口味', '快一点', '省钱'];

const CSS = `
:root{color-scheme:dark;
  --bg:#12101c;--bg-2:#1a1729;--card:#1e1a30;--card-2:#262040;--line:#2f2947;--line-2:#3d3560;
  --text:#efeaff;--muted:#9d95bd;--faint:#6d6690;
  --accent:#c9a7ff;--accent-2:#9d7bff;--accent-ink:#1a0f33;
  --ok:#5fd3a0;--warn:#f0b93d;--bad:#ef6b8a;
  --sat:env(safe-area-inset-top,0px);--sab:env(safe-area-inset-bottom,0px);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Noto Sans SC",sans-serif;
  background:var(--bg);color:var(--text)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{margin:0;background:
  radial-gradient(90% 40% at 100% -10%,#2a1f4f 0,transparent 60%),
  radial-gradient(70% 30% at 0% 100%,#1c1440 0,transparent 60%),var(--bg);
  display:flex;flex-direction:column;overflow:hidden}
button{font:inherit;color:var(--text);border:1px solid var(--line-2);border-radius:12px;padding:10px 13px;background:var(--card-2);font-weight:600;line-height:1.2}
button:active{transform:scale(.97)}
button:disabled{opacity:.45}
button.primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));border-color:transparent;color:var(--accent-ink);box-shadow:0 6px 18px #9d7bff44}
button.ghost{background:transparent;border-color:var(--line)}
button.danger{background:#3a1f2a;border-color:#7a3a4d;color:#ffb3c4}
button.sm{padding:7px 11px;font-size:12.5px;border-radius:10px}
input,textarea{width:100%;font:inherit;color:var(--text);background:var(--bg-2);border:1px solid var(--line-2);border-radius:12px;padding:11px 12px;outline:none}
input:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px #c9a7ff22}
textarea{resize:none}
.muted{color:var(--muted);font-size:12px;line-height:1.55}
.faint{color:var(--faint)}

/* ---- 顶栏 + tab ---- */
header{padding:calc(10px + var(--sat)) 16px 6px;display:flex;align-items:center;gap:11px}
.mark{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,#2c2350,#171130);border:1px solid var(--line-2);color:var(--accent);font-size:20px;font-weight:900;box-shadow:0 6px 18px #0006}
.title{flex:1;min-width:0}
.title b{display:block;font-size:17px;letter-spacing:-.2px}
.title span{display:block;font:600 10px ui-monospace,monospace;letter-spacing:1.2px;color:var(--accent);opacity:.8}
.status{font-size:11px;color:var(--ok);border:1px solid #2c5a47;background:#12281f;border-radius:999px;padding:5px 9px;white-space:nowrap}
.status.off{color:var(--bad);border-color:#5a2c3a;background:#2a1220}
nav{display:flex;gap:6px;padding:6px 16px 10px}
nav button{flex:1;border-radius:14px;padding:11px 0;font-size:14px;background:var(--card);border-color:var(--line);color:var(--muted);display:flex;align-items:center;justify-content:center;gap:6px}
nav button.on{background:linear-gradient(160deg,var(--card-2),var(--card));border-color:var(--accent);color:var(--text);box-shadow:0 0 0 3px #c9a7ff1a,0 8px 20px #0005}
nav button i{font-style:normal;font-size:16px}

/* ---- 面板 ---- */
main{flex:1;min-height:0;overflow:auto;padding:0 16px;-webkit-overflow-scrolling:touch}
.panel{display:none;padding-bottom:calc(20px + var(--sab))}
.panel.on{display:block}
.card{margin-top:12px;padding:15px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(160deg,var(--card),var(--bg-2));box-shadow:0 10px 30px #0004}
.card h2{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:8px}
.card h2 small{font-weight:400;color:var(--faint);font-size:11px;margin-left:auto}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chips{display:flex;gap:7px;flex-wrap:wrap}
.chip{padding:7px 12px;border-radius:999px;font-size:12.5px;background:var(--bg-2);border:1px solid var(--line-2);color:var(--muted)}
.chip.on{background:#2f2554;border-color:var(--accent);color:var(--text)}

/* ---- 工位 ---- */
.desks{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}
.desk{position:relative;padding:10px 4px 8px;border-radius:14px;background:var(--bg-2);border:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:5px;transition:transform .15s,border-color .15s}
.desk.on{border-color:var(--accent);background:#261f45;transform:translateY(-2px);box-shadow:0 8px 20px #0006,0 0 0 3px #c9a7ff1c}
.desk.off{opacity:.42;filter:saturate(.3)}
.desk .av{width:46px;height:46px;border-radius:12px;overflow:hidden;background:#0d0b16;display:grid;place-items:center;font-weight:900;font-size:18px;color:#fff;image-rendering:pixelated}
.desk .av img{width:200%;max-width:none;image-rendering:pixelated;margin-top:8px}
.desk .nm{font-size:11px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.desk .st{font-size:9.5px;color:var(--faint);display:flex;align-items:center;gap:4px}
.desk .st::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--faint)}
.desk.busy .st{color:var(--warn)}.desk.busy .st::before{background:var(--warn);box-shadow:0 0 6px var(--warn)}
.desk.idle .st{color:var(--ok)}.desk.idle .st::before{background:var(--ok)}
.desk.busy .av{animation:bob 1.6s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-2px)}}
.empty{padding:16px 8px;text-align:center;color:var(--faint);font-size:12.5px}

/* ---- 会话气泡 ---- */
.chat{display:flex;flex-direction:column;gap:9px;margin-top:12px}
.chat:empty{display:none}
.msg{display:flex;gap:8px;align-items:flex-end;max-width:92%}
.msg.me{align-self:flex-end;flex-direction:row-reverse}
.msg .b{padding:9px 12px;border-radius:15px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;background:var(--card-2);border:1px solid var(--line-2);border-bottom-left-radius:5px}
.msg.me .b{background:linear-gradient(135deg,#3f2f7a,#33256a);border-color:#5b47a8;border-bottom-left-radius:15px;border-bottom-right-radius:5px}
.msg.sys .b{background:transparent;border-style:dashed;color:var(--muted);font-size:12px}
.msg.bad .b{border-color:#7a3a4d;color:#ffb3c4}
.msg .who{width:26px;height:26px;border-radius:8px;flex:none;overflow:hidden;background:#0d0b16;display:grid;place-items:center;font-size:11px;font-weight:800}
.msg .who img{width:200%;max-width:none;margin-top:4px;image-rendering:pixelated}
.chat-head{margin-top:12px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
.chat-head b{color:var(--text)}
.chat-head .cwd{margin-left:auto;font:11px ui-monospace,monospace;color:var(--faint);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.typing .b::after{content:"…";animation:dots 1s steps(3,end) infinite}
@keyframes dots{0%{content:"·"}33%{content:"··"}66%{content:"···"}}

/* ---- 底部输入栏 ---- */
.composer{flex:none;padding:8px 12px calc(10px + var(--sab));background:linear-gradient(180deg,transparent,var(--bg) 30%);border-top:1px solid var(--line)}
.composer .to{display:flex;gap:6px;align-items:center;padding:0 2px 6px;font-size:11.5px;color:var(--muted)}
.composer .to b{color:var(--accent)}
.composer .to button{margin-left:auto}
.composer .bar{display:flex;gap:7px;align-items:flex-end}
.composer textarea{flex:1;min-height:42px;max-height:120px;border-radius:14px;padding:10px 12px}
.composer .ic{width:42px;height:42px;padding:0;border-radius:13px;flex:none;font-size:18px;display:grid;place-items:center}

/* ---- 吃啥 ---- */
.hero{margin-top:12px;padding:18px 16px 16px;border-radius:20px;background:linear-gradient(150deg,#3a2a1f,#26192f 55%,#1e1a30);border:1px solid #4a3a35;box-shadow:0 12px 30px #0005;position:relative;overflow:hidden}
.hero::after{content:"🍜";position:absolute;right:-6px;top:-10px;font-size:78px;opacity:.14;transform:rotate(12deg)}
.hero h2{margin:0;font-size:19px}
.hero p{margin:4px 0 12px;color:var(--muted);font-size:12.5px}
.hero .go{width:100%;padding:13px;font-size:15px;border-radius:14px;background:linear-gradient(135deg,#ffb37a,#ff8a4c);color:#2a1206;box-shadow:0 8px 22px #ff8a4c44}
.picks{display:flex;flex-direction:column;gap:9px;margin-top:10px}
.pick{display:flex;gap:11px;padding:12px;border-radius:15px;background:var(--bg-2);border:1px solid var(--line)}
.pick .n{width:30px;height:30px;border-radius:10px;flex:none;display:grid;place-items:center;font-weight:800;background:linear-gradient(135deg,#ffb37a,#ff8a4c);color:#2a1206}
.pick b{display:block;font-size:14px}
.pick .shop{color:var(--muted);font-size:11.5px;margin-top:1px}
.pick .why{color:var(--text);opacity:.85;font-size:12.5px;line-height:1.5;margin-top:5px}
.avoid{margin-top:10px;padding:9px 12px;border-radius:12px;border:1px dashed #6b3a4a;color:#ffb3c4;font-size:12.5px}
.headline{font-size:14px;line-height:1.6;margin-top:10px}

/* ---- 电脑 ---- */
.tools{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.tool{padding:11px 8px;border-radius:13px;background:var(--bg-2);border:1px solid var(--line);display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;text-align:left;min-height:44px}
.tool i{width:9px;height:9px;border-radius:50%;flex:none;background:var(--c);box-shadow:0 0 8px var(--c)}
.tool span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.inbox{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.inbox .it{padding:10px 12px;border-radius:13px;background:var(--bg-2);border:1px solid var(--line)}
.inbox .it b{display:block;font-size:13px;margin-bottom:3px}
.inbox .it .t{color:var(--muted);font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:80px;overflow:hidden}
.inbox .it button{margin-top:7px}
.log{margin-top:8px;padding:10px 12px;border-radius:12px;background:var(--bg-2);border:1px solid var(--line);font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-all;color:var(--muted);max-height:180px;overflow:auto}
.log:empty{display:none}

/* ---- 电脑画面 ---- */
.screen{position:relative;border-radius:12px;overflow:hidden;background:#0a0814;border:1px solid var(--line);min-height:120px;touch-action:none;user-select:none}
.screen img{display:block;width:100%;height:auto}
.screen img[src=""]{display:none}
.screen-empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--faint);font-size:12px;text-align:center;padding:12px}
.screen-empty[hidden]{display:none}
.screen .tapdot{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid var(--accent);pointer-events:none;animation:tap .45s ease-out forwards}
@keyframes tap{to{transform:scale(1.8);opacity:0}}

/* ---- 全屏操作电脑 ---- */
.fs{position:fixed;inset:0;z-index:50;background:#000;touch-action:none;user-select:none}
.fs[hidden]{display:none}
.fs canvas{position:absolute;inset:0;width:100%;height:100%}
.fs-bar{position:absolute;left:0;right:0;bottom:0;padding:8px 10px calc(8px + var(--sab));display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:linear-gradient(0deg,#000d,transparent);font-size:12px}
.fs-bar #fsZoom{min-width:44px;text-align:center;color:var(--accent)}
.fs-bar #fsHint{flex-basis:100%;font-size:10.5px}
.fs .tapdot{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2px solid var(--accent);pointer-events:none;animation:tap .45s ease-out forwards}

/* ---- 飘字 ---- */
.tip{position:fixed;left:50%;top:calc(12px + var(--sat));transform:translateX(-50%) translateY(-8px);z-index:99;padding:9px 15px;border-radius:12px;background:#2f2554;border:1px solid var(--accent);color:var(--text);font-size:13px;box-shadow:0 8px 24px #0008;opacity:0;transition:.18s;pointer-events:none;max-width:88vw;text-align:center}
.tip.on{opacity:1;transform:translateX(-50%) translateY(0)}
.tip.bad{background:#3a1f2a;border-color:#7a3a4d;color:#ffb3c4}
@media(min-width:560px){body{max-width:560px;margin:auto}.desks{grid-template-columns:repeat(4,1fr)}}
`;

function pageHtml(token, deviceName, tools) {
  const safeName = escapeHtml(deviceName);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#12101c"><link rel="manifest" href="/manifest.webmanifest?token=${encodeURIComponent(token)}"><title>Agent 手机控制</title>
<style>${CSS}</style></head><body>
<header><div class="mark">✦</div><div class="title"><span>AGENT TOOLBOX / REMOTE</span><b>手机控制台</b></div><div class="status" id="status">已配对</div></header>
<nav><button class="on" data-tab="work"><i>🤖</i>派活</button><button data-tab="eat"><i>🍜</i>吃啥</button><button data-tab="pc"><i>💻</i>电脑</button></nav>
<main>

<section class="panel on" id="tab-work">
  <div class="card">
    <h2>AI 办公室 <small id="officeHint">点头像选人</small></h2>
    <div class="desks" id="desks"><div class="empty" style="grid-column:1/-1">正在扫描电脑上的 Agent…</div></div>
    <div class="chat-head" id="chatHead" hidden></div>
    <div class="chat" id="chat"></div>
  </div>
  <div class="card">
    <h2>发给网页版 AI <small>先复制到电脑，再打开</small></h2>
    <div class="chips" id="webAis"><button class="chip" data-url="https://chat.deepseek.com/">DeepSeek</button><button class="chip" data-url="https://claude.ai/">Claude</button><button class="chip" data-url="https://chatgpt.com/">ChatGPT</button><button class="chip" data-url="https://gemini.google.com/">Gemini</button><button class="chip" id="copyOnly">只复制</button></div>
    <p class="muted" style="margin:8px 0 0">把下面输入栏的文字复制到电脑剪贴板，并在电脑上打开对应网站，粘贴即可。</p>
  </div>
</section>

<section class="panel" id="tab-eat">
  <div class="hero">
    <h2>今天吃什么</h2>
    <p>结合电脑上读到的最近订单、附近店铺和你的口味，AI 给三个选择。</p>
    <div class="chips" id="moods" style="margin-bottom:12px">${MOODS.map((m, i) => `<button class="chip${i === 0 ? ' on' : ''}" data-mood="${m}">${m}</button>`).join('')}</div>
    <button class="go" id="eatGo">🍽 帮我定</button>
  </div>
  <div id="eatOut"></div>
  <div class="card">
    <h2>吃完记一条 <small>下次推荐会避开刚吃过的</small></h2>
    <div class="row"><input id="eatDish" placeholder="菜名 @店名" style="flex:1;min-width:0"><button id="eatRecord">记下</button></div>
  </div>
</section>

<section class="panel" id="tab-pc">
  <div class="card" id="spriteCard" hidden>
    <h2>手机精灵 <small id="spriteHint">对它说话，它替你操作手机</small></h2>
    <div class="row"><button class="sm primary" id="spriteListen">🎤 说句话</button><button class="sm" id="spriteToggle">显示精灵</button><button class="sm ghost" id="spriteSetup">开启无障碍</button></div>
    <div class="log" id="spriteLog"></div>
  </div>
  <div class="card">
    <h2>电脑画面 <small id="screenHint">点一下就是点电脑，上下滑就是滚动</small></h2>
    <div class="screen" id="screenBox"><img id="screenImg" alt="" draggable="false"><div class="screen-empty" id="screenEmpty">正在取画面…</div></div>
    <div class="row" style="margin-top:8px"><button class="sm primary" id="screenFull">⛶ 全屏操作</button><button class="sm" id="screenLive">⏸ 暂停刷新</button><button class="sm ghost" id="screenOnce">刷新一次</button><span class="faint" id="screenAt" style="font-size:11px;margin-left:auto"></span></div>
  </div>
  <div class="card">
    <h2>切换工具 <small>电脑端跟着切，上面画面里能看到</small></h2>
    <div class="tools" id="tools"></div>
  </div>
  <div class="card">
    <h2>电脑动作</h2>
    <div class="row"><input id="openUrl" placeholder="网址，在电脑上打开" style="flex:1;min-width:0" inputmode="url"><button id="goUrl">打开</button></div>
    <div class="row" style="margin-top:8px"><button class="sm" id="readClipboard">📋 读电脑剪贴板</button><button class="sm" id="showApp">🖥 把工具箱叫到前台</button></div>
    <div class="log" id="clipboard"></div>
  </div>
  <div class="card">
    <h2>手机分享收件箱 <small><button class="sm ghost" id="refreshInbox">刷新</button></small></h2>
    <div class="inbox" id="inbox"><div class="empty">正在加载…</div></div>
    <p class="muted" style="margin:8px 0 0">Android 安装到主屏幕后，可从浏览器、视频、公众号等应用直接分享文字或链接到这里。</p>
  </div>
  <div class="card">
    <h2>配对</h2>
    <p class="muted" style="margin:0 0 10px">设备：${safeName} · 局域网或已连接的 VPN 可访问。手机不能让电脑自动执行任意命令；需要登录、付款、验证码或系统权限时请在电脑端确认。</p>
    <button class="danger sm" id="stop">停止手机控制</button>
  </div>
</section>

</main>

<div class="composer" id="composer">
  <div class="to"><span>发给</span><b id="toName">当前 AI（电脑端设置）</b><button class="sm ghost" id="toReset" hidden>改回当前 AI</button></div>
  <div class="bar"><button class="ic ghost" id="voice" aria-label="语音输入" title="语音输入">🎙</button><textarea id="prompt" rows="1" placeholder="输入任务，或点麦克风说话"></textarea><button class="ic primary" id="send" aria-label="发送">➤</button></div>
</div>
<div class="fs" id="fs" hidden>
  <canvas id="fsCanvas"></canvas>
  <div class="fs-bar"><button class="sm" id="fsExit">✕ 退出</button><button class="sm ghost" id="fsRotate">⟳ 转向</button><button class="sm ghost" id="fsZoomOut">－</button><span id="fsZoom">100%</span><button class="sm ghost" id="fsZoomIn">＋</button><button class="sm ghost" id="fsFit">适应屏幕</button><span class="faint" id="fsHint">点=点电脑 · 一指拖=平移 · 两指=缩放 · 双击=放大/还原</span></div>
</div>
<div class="tip" id="tip"></div>

<script>
const token=${JSON.stringify(token)};const tools=${JSON.stringify(tools)};const LOOKS=${JSON.stringify(LOOKS)};
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
const sprite=name=>'/assets/office/'+name+'?token='+encodeURIComponent(token);

// 飘字。手机上 alert 会打断操作还得多点一次
let tipTimer=null;
function say(text,bad){const t=$('tip');t.textContent=text;t.classList.toggle('bad',!!bad);t.classList.add('on');clearTimeout(tipTimer);tipTimer=setTimeout(()=>t.classList.remove('on'),2000)}
async function command(type,payload={}){let response;try{response=await fetch('/api/command?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload})})}catch(e){$('status').textContent='连不上电脑';$('status').classList.add('off');throw new Error('连不上电脑，检查是否同一 Wi-Fi')}$('status').textContent='已配对';$('status').classList.remove('off');const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'请求失败');return data}

// ---- tab ----
for(const b of document.querySelectorAll('nav button'))b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('on',p.id==='tab-'+b.dataset.tab));$('composer').style.display=b.dataset.tab==='work'?'':'none';try{localStorage.setItem('remote.tab',b.dataset.tab)}catch{}};
try{const t=localStorage.getItem('remote.tab');if(t){document.querySelector('nav button[data-tab="'+t+'"]')?.click()}}catch{}

// ---- 头像 ----
function avatar(source,cls){const look=LOOKS[source]||{};const a=el('div',cls);a.style.background=look.sprite?'#0d0b16':(look.accent||'#5b4f86');if(look.sprite){const img=new Image();img.src=sprite(look.sprite);img.alt='';img.draggable=false;a.append(img)}else a.textContent=(look.who||source||'?').slice(0,1);return a}

// ---- 办公室 ----
let agents=[];let selected=null;
function setTarget(agent){selected=agent;$('toName').textContent=agent?agent.label:'当前 AI（电脑端设置）';$('toReset').hidden=!agent;document.querySelectorAll('.desk').forEach(d=>d.classList.toggle('on',!!agent&&d.dataset.source===agent.source));$('prompt').placeholder=agent?'给 '+agent.label+' 派个活…':'输入任务，或点麦克风说话'}
$('toReset').onclick=()=>{setTarget(null);$('chatHead').hidden=true;$('chat').textContent=''};
function relTime(iso){if(!iso)return'';const d=(Date.now()-new Date(iso).getTime())/60000;if(d<1)return'刚刚';if(d<60)return Math.round(d)+' 分钟前';if(d<1440)return Math.round(d/60)+' 小时前';return Math.round(d/1440)+' 天前'}
async function loadOffice(){const box=$('desks');try{const r=await command('agent.office');agents=(r.agents||[]).filter(a=>a.installed||a.available);box.textContent='';if(!agents.length){box.append(el('div','empty','电脑上暂未发现支持的 Agent。'));return}for(const a of agents){const busy=a.session&&(Date.now()-new Date(a.session.updatedAt||0).getTime())<10*60000;const d=el('button','desk '+(busy?'busy':a.installed?'idle':'off'));d.dataset.source=a.source;d.append(avatar(a.source,'av'),el('div','nm',(LOOKS[a.source]||{}).who||a.label),el('div','st',busy?'在忙':a.installed?'空闲':'只读'));d.onclick=()=>openAgent(a);box.append(d)}if(selected)setTarget(agents.find(a=>a.source===selected.source)||null)}catch(e){box.textContent='';box.append(el('div','empty','扫描失败：'+e.message))}}
function bubble(role,text,source,extra){const m=el('div','msg '+(role==='user'?'me':'')+(extra||''));const b=el('div','b',text);if(role!=='user'){const w=avatar(source,'who');m.append(w)}m.append(b);$('chat').append(m);m.scrollIntoView({block:'end'});return m}
async function openAgent(a){setTarget(a);const head=$('chatHead');head.hidden=false;head.textContent='';$('chat').textContent='';if(!a.session){head.append(el('b',null,a.label),el('span',null,a.installed?'已安装，还没有本地会话':'没有会话'));return}head.append(el('b',null,a.session.title||'未命名会话'),el('span',null,relTime(a.session.updatedAt)),el('span','cwd',(a.session.cwd||'').split('/').slice(-2).join('/')));const wait=bubble('assistant','',a.source,' typing');try{const r=await command('agent.session',{source:a.source,id:a.session.id});wait.remove();const msgs=(r.session.messages||[]).slice(-6);if(!msgs.length)bubble('assistant','（这个会话还没有内容）',a.source,' sys');for(const m of msgs)bubble(m.role==='user'?'user':'assistant',String(m.content||'').slice(0,600),a.source)}catch(e){wait.remove();bubble('assistant','读取失败：'+e.message,a.source,' bad')}}

// ---- 发送 ----
const prompt=$('prompt');prompt.addEventListener('input',()=>{prompt.style.height='auto';prompt.style.height=Math.min(120,prompt.scrollHeight)+'px'});
$('send').onclick=async()=>{const text=prompt.value.trim();if(!text)return;if(selected&&!selected.installed)return say(selected.label+' 未安装，只能看历史',1);$('send').disabled=true;prompt.value='';prompt.style.height='auto';const src=selected?selected.source:'';bubble('user',text,src);const wait=bubble('assistant',selected?'等电脑端确认':'AI 在想',src,' typing');try{const r=selected?await command('agent.run',{source:src,prompt:text}):await command('ai.ask',{prompt:text});wait.remove();bubble('assistant',r.text||'任务已完成',src)}catch(e){wait.remove();bubble('assistant','失败：'+e.message,src,' bad')}finally{$('send').disabled=false}};
prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))$('send').click()});
if(window.AgentToolboxSprite){const sc=$('spriteCard');sc.hidden=false;const refreshSprite=()=>{let st={};try{st=JSON.parse(window.AgentToolboxSprite.status()||'{}')}catch{}$('spriteHint').textContent=st.enabled?(st.visible?'精灵在屏幕下方 · 点它或按这里说话':'无障碍已开 · 精灵隐藏中'):'先开无障碍服务，它才能看见和操作屏幕';$('spriteToggle').textContent=st.visible?'隐藏精灵':'显示精灵';$('spriteSetup').hidden=!!st.enabled;$('spriteLog').textContent=st.enabled?'':'若系统提示「受限设置」：应用信息 → 右上角 ⋮ → 允许受限设置，再回来开。'};$('spriteListen').onclick=()=>{window.AgentToolboxSprite.listen()};$('spriteToggle').onclick=()=>{window.AgentToolboxSprite.toggle();setTimeout(refreshSprite,300)};$('spriteSetup').onclick=()=>{window.AgentToolboxSprite.openSettings()};document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSprite()});refreshSprite()}
window.agentVoiceResult=text=>{prompt.value=String(text||'');prompt.dispatchEvent(new Event('input'));say('已转成文字，确认后发送')};
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(window.AgentToolboxVoice){$('voice').onclick=()=>{say('正在听…');window.AgentToolboxVoice.start()}}else if(!SR){$('voice').disabled=true;$('voice').title='当前浏览器不支持语音识别'}else{$('voice').onclick=()=>{const rec=new SR();rec.lang='zh-CN';rec.interimResults=false;rec.onstart=()=>say('正在听…');rec.onresult=e=>window.agentVoiceResult(e.results[0][0].transcript);rec.onerror=e=>say('语音识别失败：'+e.error,1);rec.start()}}
for(const b of document.querySelectorAll('#webAis [data-url]'))b.onclick=()=>{const text=prompt.value.trim();if(!text)return say('先在底部输入栏写点内容',1);command('ai.send',{text,url:b.dataset.url}).then(()=>say('已复制并在电脑上打开 '+b.textContent)).catch(e=>say(e.message,1))};
$('copyOnly').onclick=()=>{const text=prompt.value.trim();if(!text)return say('先在底部输入栏写点内容',1);command('clipboard.write',{text}).then(()=>say('已复制到电脑剪贴板')).catch(e=>say(e.message,1))};

// ---- 吃啥 ----
let mood=${JSON.stringify(MOODS[0])};
for(const b of document.querySelectorAll('#moods .chip'))b.onclick=()=>{mood=b.dataset.mood;document.querySelectorAll('#moods .chip').forEach(x=>x.classList.toggle('on',x===b))};
function renderAdvice(r){const out=$('eatOut');out.textContent='';const a=r.advice;if(!a||!Array.isArray(a.picks)){const c=el('div','card');c.append(el('div','headline',r.text||JSON.stringify(r)));out.append(c);return}const c=el('div','card');c.append(el('div','headline',a.headline||''));const list=el('div','picks');a.picks.forEach((p,i)=>{const it=el('div','pick');it.append(el('div','n',String(i+1)));const body=el('div');body.append(el('b',null,p.name||''));if(p.shop)body.append(el('div','shop',p.shop));if(p.why)body.append(el('div','why',p.why));it.append(body);it.onclick=()=>{$('eatDish').value=(p.name||'')+(p.shop?' @'+p.shop:'')};list.append(it)});c.append(list);if(a.avoid)c.append(el('div','avoid','今天先别：'+a.avoid));out.append(c)}
$('eatGo').onclick=async()=>{const b=$('eatGo');b.disabled=true;b.textContent='AI 在想…';const out=$('eatOut');out.textContent='';const c=el('div','card');c.append(el('div','muted','正在看最近吃过的、附近的店和你的口味…'));out.append(c);try{renderAdvice(await command('eat.recommend',{mood}))}catch(e){out.textContent='';const err=el('div','card');err.append(el('div','avoid','失败：'+e.message));out.append(err)}finally{b.disabled=false;b.textContent='🍽 帮我定'}};
$('eatRecord').onclick=()=>{const raw=$('eatDish').value.trim();if(!raw)return say('先写菜名',1);const [dish,shop='']=raw.split('@').map(x=>x.trim());command('eat.record',{dish,shop}).then(()=>{$('eatDish').value='';say('记下了：'+dish)}).catch(e=>say(e.message,1))};

// ---- 电脑 ----
for(const t of tools){const b=el('button','tool');b.style.setProperty('--c',t.color||'#9aa4b5');b.append(el('i'),el('span',null,t.label));b.onclick=()=>command('tool.open',{id:t.id}).then(()=>say('电脑已切到「'+t.label+'」')).catch(e=>say(e.message,1));$('tools').append(b)}
// ---- 电脑画面 ----
let screenLive=true,screenTimer=null,screenBusy=false;
async function grabScreen(){if(screenBusy)return;screenBusy=true;try{const r=await fetch('/api/screen?token='+encodeURIComponent(token)+'&t='+Date.now());if(r.status!==200){$('screenEmpty').hidden=false;$('screenEmpty').textContent='电脑窗口没打开 —— 点下面「把工具箱叫到前台」';return}const blob=await r.blob();const img=$('screenImg');const old=img.src;img.src=URL.createObjectURL(blob);if(old)URL.revokeObjectURL(old);$('screenEmpty').hidden=true;$('screenAt').textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false})}catch(e){$('screenEmpty').hidden=false;$('screenEmpty').textContent='取不到画面：'+e.message}finally{screenBusy=false}}
function screenTick(){clearTimeout(screenTimer);const pcOn=$('tab-pc').classList.contains('on');if(pcOn&&screenLive&&!document.hidden)grabScreen();screenTimer=setTimeout(screenTick,1400)}
$('screenLive').onclick=()=>{screenLive=!screenLive;$('screenLive').textContent=screenLive?'⏸ 暂停刷新':'▶ 继续刷新';if(screenLive)grabScreen()};
$('screenOnce').onclick=grabScreen;
// 点=点电脑；竖着划=滚动。手指离开时按位移判断是哪种
(()=>{const box=$('screenBox');let start=null;const rel=e=>{const r=box.getBoundingClientRect();const p=e.changedTouches?e.changedTouches[0]:e;return {x:(p.clientX-r.left)/r.width,y:(p.clientY-r.top)/r.height,px:p.clientX-r.left,py:p.clientY-r.top}};
const down=e=>{start=rel(e);start.t=Date.now()};
const up=async e=>{if(!start)return;const end=rel(e);const dy=(end.py-start.py);const s=start;start=null;if(Math.abs(dy)>18){command('screen.scroll',{x:s.x,y:s.y,dy:Math.round(dy*2.2)}).then(()=>setTimeout(grabScreen,250)).catch(x=>say(x.message,1));return}
const dot=document.createElement('span');dot.className='tapdot';dot.style.left=s.px+'px';dot.style.top=s.py+'px';box.append(dot);setTimeout(()=>dot.remove(),500);
command('screen.tap',{x:s.x,y:s.y}).then(()=>setTimeout(grabScreen,350)).catch(x=>say(x.message,1))};
box.addEventListener('touchstart',down,{passive:true});box.addEventListener('touchend',up);box.addEventListener('mousedown',down);box.addEventListener('mouseup',up)})();
for(const b of document.querySelectorAll('nav button'))b.addEventListener('click',()=>{if(b.dataset.tab==='pc')grabScreen()});
screenTick();

// ---- 全屏操作：电脑是横的、手机是竖的，把画面转 90° 铺满；能捏合缩放、拖着看；点和滑都按我们自己的变换算回电脑坐标 ----
(()=>{
const fs=$('fs'),cv=$('fsCanvas'),ctx=cv.getContext('2d');
let on=false,frame=null,rot=90,zoom=1,fit=1,ox=0,oy=0,timer=null,busy=false,gest=null,lastTap=0;
const W=()=>cv.width,H=()=>cv.height;
function autoRot(){rot=(innerWidth<innerHeight)?90:0}
function size(){const d=devicePixelRatio||1;cv.width=Math.round(innerWidth*d);cv.height=Math.round(innerHeight*d);computeFit();draw()}
function computeFit(){if(!frame)return;const fw=rot?frame.height:frame.width,fh=rot?frame.width:frame.height;fit=Math.min(W()/fw,H()/fh)}
// 画面坐标 -> 屏幕坐标：先按 rot 转，再乘 zoom*fit，再平移到中心 + 偏移
function toScreen(px,py){const s=fit*zoom;let x,y;if(rot){x=frame.height-py;y=px}else{x=px;y=py}const fw=rot?frame.height:frame.width,fh=rot?frame.width:frame.height;return {x:(x-fw/2)*s+W()/2+ox,y:(y-fh/2)*s+H()/2+oy}}
function toFrame(sx,sy){const s=fit*zoom;const fw=rot?frame.height:frame.width,fh=rot?frame.width:frame.height;const x=(sx-W()/2-ox)/s+fw/2,y=(sy-H()/2-oy)/s+fh/2;return rot?{x:y,y:frame.height-x}:{x,y}}
function draw(){ctx.fillStyle='#000';ctx.fillRect(0,0,W(),H());if(!frame)return;const s=fit*zoom;ctx.save();ctx.translate(W()/2+ox,H()/2+oy);ctx.scale(s,s);if(rot)ctx.rotate(Math.PI/2);ctx.drawImage(frame,-frame.width/2,-frame.height/2);ctx.restore();$('fsZoom').textContent=Math.round(zoom*100)+'%'}
async function pull(){if(busy||!on)return;busy=true;try{const r=await fetch('/api/screen?token='+encodeURIComponent(token)+'&w=1400&t='+Date.now());if(r.status===200){const b=await r.blob();const img=await createImageBitmap(b);frame=img;computeFit();draw()}}catch{}finally{busy=false}}
function loop(){clearTimeout(timer);if(!on)return;pull();timer=setTimeout(loop,900)}
function open(){on=true;fs.hidden=false;autoRot();zoom=1;ox=oy=0;size();try{window.AgentToolboxNative?.lockLandscape(true)}catch{}try{document.documentElement.requestFullscreen?.()}catch{}try{screen.orientation?.lock?.('landscape').catch(()=>{})}catch{}loop()}
function close(){on=false;fs.hidden=true;clearTimeout(timer);try{window.AgentToolboxNative?.lockLandscape(false)}catch{}try{screen.orientation?.unlock?.()}catch{}try{if(document.fullscreenElement)document.exitFullscreen()}catch{}grabScreen()}
$('screenFull').onclick=open;$('fsExit').onclick=close;
$('fsRotate').onclick=()=>{rot=rot?0:90;computeFit();ox=oy=0;draw()};
$('fsZoomIn').onclick=()=>{zoom=Math.min(5,zoom*1.3);draw()};$('fsZoomOut').onclick=()=>{zoom=Math.max(.5,zoom/1.3);draw()};$('fsFit').onclick=()=>{zoom=1;ox=oy=0;draw()};
addEventListener('resize',()=>{if(!on)return;autoRot();size()});
const pt=e=>{const d=devicePixelRatio||1;const r=cv.getBoundingClientRect();return [...(e.touches?.length?e.touches:e.changedTouches||[e])].map(t=>({x:(t.clientX-r.left)*d,y:(t.clientY-r.top)*d}))};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
cv.addEventListener('touchstart',e=>{e.preventDefault();const p=pt(e);if(p.length>=2){gest={kind:'pinch',d0:dist(p[0],p[1]),z0:zoom,cx:(p[0].x+p[1].x)/2,cy:(p[0].y+p[1].y)/2,ox0:ox,oy0:oy}}else{gest={kind:'one',x0:p[0].x,y0:p[0].y,ox0:ox,oy0:oy,moved:false,t0:Date.now()}}},{passive:false});
cv.addEventListener('touchmove',e=>{e.preventDefault();if(!gest)return;const p=pt(e);if(gest.kind==='pinch'&&p.length>=2){const k=dist(p[0],p[1])/gest.d0;const nz=Math.max(.5,Math.min(5,gest.z0*k));// 围绕两指中心缩放
const cx=gest.cx-W()/2,cy=gest.cy-H()/2;ox=cx-(cx-gest.ox0)*(nz/gest.z0);oy=cy-(cy-gest.oy0)*(nz/gest.z0);zoom=nz;draw()}else if(gest.kind==='one'){const dx=p[0].x-gest.x0,dy=p[0].y-gest.y0;if(Math.hypot(dx,dy)>8*(devicePixelRatio||1))gest.moved=true;if(gest.moved){ox=gest.ox0+dx;oy=gest.oy0+dy;draw()}}},{passive:false});
cv.addEventListener('touchend',e=>{e.preventDefault();if(!gest)return;const g=gest;gest=null;if(g.kind!=='one'||g.moved||!frame)return;const now=Date.now();const f=toFrame(g.x0,g.y0);const rx=f.x/frame.width,ry=f.y/frame.height;if(rx<0||ry<0||rx>1||ry>1)return;if(now-lastTap<320){lastTap=0;if(zoom>1.05){zoom=1;ox=oy=0}else{zoom=2.2;const cx=g.x0-W()/2,cy=g.y0-H()/2;ox=-cx*1.2;oy=-cy*1.2}draw();return}lastTap=now;const d=devicePixelRatio||1;const dot=document.createElement('span');dot.className='tapdot';dot.style.left=(g.x0/d)+'px';dot.style.top=(g.y0/d)+'px';fs.append(dot);setTimeout(()=>dot.remove(),500);command('screen.tap',{x:rx,y:ry}).then(()=>setTimeout(pull,300)).catch(x=>say(x.message,1))},{passive:false});
// 滚动电脑：在全屏里用底栏之外的双指竖滑不好区分，改成长按后拖 —— 简单起见：单指按住 350ms 不动再拖 = 滚动
let holdTimer=null;cv.addEventListener('touchstart',e=>{clearTimeout(holdTimer);if(e.touches.length!==1)return;holdTimer=setTimeout(()=>{if(gest&&gest.kind==='one'&&!gest.moved){gest.kind='scroll';gest.sy=gest.y0;navigator.vibrate?.(15)}},350)},{passive:true});
cv.addEventListener('touchmove',e=>{if(!gest||gest.kind!=='scroll')return;const p=pt(e)[0];const dy=p.y-gest.sy;if(Math.abs(dy)<24)return;gest.sy=p.y;const f=toFrame(gest.x0,gest.y0);command('screen.scroll',{x:f.x/frame.width,y:f.y/frame.height,dy:Math.round((rot?-dy:dy)*1.5)}).catch(()=>{})},{passive:true});
cv.addEventListener('touchend',()=>clearTimeout(holdTimer),{passive:true});
})();

$('goUrl').onclick=()=>{let u=$('openUrl').value.trim();if(!u)return;if(!/^https?:\\/\\//i.test(u))u='https://'+u;command('url.open',{url:u}).then(()=>say('已在电脑上打开')).catch(e=>say(e.message,1))};
$('openUrl').addEventListener('keydown',e=>{if(e.key==='Enter')$('goUrl').click()});
$('readClipboard').onclick=async()=>{try{const r=await command('clipboard.read');$('clipboard').textContent=r.text||'（剪贴板为空）'}catch(e){$('clipboard').textContent='失败：'+e.message}};
$('showApp').onclick=()=>command('app.show').then(()=>say('工具箱已到前台')).catch(e=>say(e.message,1));
async function loadInbox(){const box=$('inbox');try{const response=await fetch('/api/inbox?token='+encodeURIComponent(token));const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'读取失败');const items=data.items||[];box.textContent='';if(!items.length){box.append(el('div','empty','还没有分享内容。'));return}for(const item of items){const it=el('div','it');it.append(el('b',null,item.title||item.url||'手机分享'),el('div','t',[item.text,item.url].filter(Boolean).join('\\n')));const copy=el('button','sm','复制到电脑');copy.onclick=()=>command('clipboard.write',{text:[item.title,item.text,item.url].filter(Boolean).join('\\n')}).then(()=>say('已复制到电脑剪贴板')).catch(e=>say(e.message,1));it.append(copy);box.append(it)}}catch(e){box.textContent='';box.append(el('div','empty','读取失败：'+e.message))}}
$('refreshInbox').onclick=loadInbox;
$('stop').onclick=async()=>{if(confirm('停止后手机将不能再控制工具箱，确定吗？')){await command('remote.stop');location.reload()}};

loadOffice();loadInbox();setInterval(loadInbox,15000);setInterval(loadOffice,60000);
navigator.serviceWorker?.register('/sw.js?token='+encodeURIComponent(token)).catch(()=>{});
</script></body></html>`;
}

module.exports = { pageHtml, LOOKS, MOODS };
