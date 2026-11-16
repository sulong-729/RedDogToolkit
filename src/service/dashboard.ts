// The dashboard page: plain HTML, CSS and JavaScript, no framework, no external assets (same approach as Forge's
// service control page). All text from the service is put on screen with textContent, never innerHTML.
// The key is injected when the page is served and is sent back only as a request header.

export function dashboardHtml(key: string): string {
    return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RedDogToolkit</title>
<style>
:root{--bg:#0d1117;--card:#151b23;--line:#263140;--text:#e6edf3;--mute:#8b98a9;--ok:#5eead4;--bad:#f87171;--warn:#fbbf24;--btn:#1f2a37;--accent:#e5484d}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:900px;margin:0 auto;padding:28px 16px 40px}
header{display:flex;gap:14px;align-items:center;margin-bottom:22px}
.logo{width:54px;height:54px;border-radius:14px;background:#2a1517;display:grid;place-items:center;flex:none}
h1{font-size:23px;margin:0}.sub{color:var(--mute);font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px 22px;margin-bottom:18px}
.card h2{font-size:17px;margin:0 0 12px}
.title{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:700;margin-bottom:10px}
.dot{width:12px;height:12px;border-radius:50%;background:var(--bad);flex:none}.dot.on{background:var(--ok)}
.meta{color:var(--mute);display:flex;flex-wrap:wrap;gap:6px 22px;margin-bottom:14px}.meta b{color:var(--text)}
.row{display:flex;gap:10px;flex-wrap:wrap}
button,select{font:inherit;color:var(--text);background:var(--btn);border:1px solid var(--line);border-radius:10px;padding:8px 14px;cursor:pointer}
button.primary{background:#3b2326;border-color:#6b2f33}button:disabled{opacity:.45;cursor:default}
.head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.head h2{margin:0}
.line{padding:7px 0;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.line:first-of-type{border-top:0}.good{color:var(--ok)}.bad{color:var(--bad)}.mute{color:var(--mute)}
.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
pre{background:#0b0f14;border:1px solid var(--line);border-radius:12px;padding:14px;margin:0;height:230px;overflow:auto;white-space:pre-wrap;word-break:break-word}
footer{display:flex;justify-content:space-between;gap:10px;color:var(--mute);font-size:13px;flex-wrap:wrap}
.empty{color:var(--mute);padding:6px 0}
</style></head><body><main>
<header>
  <div class="logo"><svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true"><path d="M8 10l9 6M40 10l-9 6" stroke="#e5484d" stroke-width="5" stroke-linecap="round"/><circle cx="24" cy="27" r="14" fill="#e5484d"/><circle cx="18.5" cy="25" r="2.4" fill="#0d1117"/><circle cx="29.5" cy="25" r="2.4" fill="#0d1117"/><ellipse cx="24" cy="32" rx="4.2" ry="3" fill="#0d1117"/></svg></div>
  <div><h1>RedDogToolkit</h1><div class="sub">Bảng điều khiển service</div></div>
</header>

<section class="card" id="service">
  <div class="title"><span class="dot" id="dot"></span><span id="state">Đang kiểm tra…</span></div>
  <div class="meta"><span>Phiên bản: <b id="ver">–</b></span><span>PID: <b id="pid">–</b></span><span>Tự khởi động: <b id="auto">–</b></span></div>
  <div class="row"><button class="primary" id="start">Bật service</button><button id="stop">Tắt service</button><button id="refresh">Làm mới</button></div>
  <div class="mute" id="msg" style="margin-top:10px;min-height:20px"></div>
</section>

<section class="card" id="env"><h2>Môi trường</h2><div id="envBody" class="empty">Đang kiểm tra…</div></section>
<section class="card" id="runs"><h2>Run gần đây</h2><div id="runsBody" class="empty">–</div></section>
<section class="card" id="tokens"><h2>Token</h2><div id="tokensBody" class="empty">–</div></section>
<section class="card" id="plans"><h2>Kế hoạch chờ duyệt</h2><div id="plansBody" class="empty">–</div></section>

<section class="card" id="logs">
  <div class="head"><h2>Nhật ký</h2><select id="source"><option value="service">Hoạt động service</option><option value="daemon">Nhật ký daemon</option><option value="controller">Nhật ký bảng điều khiển</option></select></div>
  <pre id="logText"></pre>
</section>
<footer><span>Service chạy độc lập với cửa sổ điều khiển.</span><span id="updated">–</span></footer>
</main>
<script>
const KEY=${JSON.stringify(key)};
const $=(id)=>document.getElementById(id);
const api=async(path,body)=>{const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-RedDog-Key':KEY,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return r.json();};
const put=(el,children)=>{el.replaceChildren(...children);};
const div=(cls,text)=>{const d=document.createElement('div');if(cls)d.className=cls;if(text!==undefined)d.textContent=text;return d;};
const row=(a,b,cls)=>{const d=div('line');const x=document.createElement('span');x.textContent=a;const y=document.createElement('span');y.textContent=b;if(cls)y.className=cls;d.append(x,y);return d;};
async function status(){
  const s=await api('/api/status');
  $('dot').className='dot'+(s.running?' on':'');
  $('state').textContent=s.running?'Service đang chạy':'Service đã tắt';
  $('ver').textContent=s.version||'–';$('pid').textContent=s.pid??'–';
  $('auto').textContent=s.autostart==='installed'?'Bật':'Tắt (chưa cài)';
  $('start').disabled=s.running;$('stop').disabled=!s.running;
}
async function env(){
  const d=await api('/api/doctor');
  put($('envBody'),d.lines.map(l=>row(l.replace(/^FAIL /,''),l.startsWith('FAIL')?'Lỗi':'Đạt',l.startsWith('FAIL')?'bad':'good')));
}
async function runs(){
  const d=await api('/api/runs');
  if(!d.runs.length){put($('runsBody'),[div('empty','Chưa có run nào.')]);return;}
  put($('runsBody'),d.runs.map(r=>row(r.id+'  ·  '+r.scenario,r.status+'  ·  '+r.records+' bản ghi',r.status==='ok'?'good':r.status==='failed'||r.status==='aborted'?'bad':'mute')));
  const opts=[...$('source').options].filter(o=>!o.value.startsWith('run:'));
  const have=new Set([...$('source').options].map(o=>o.value));
  for(const r of d.runs.slice(0,5)){if(!have.has('run:'+r.id)){const o=document.createElement('option');o.value='run:'+r.id;o.textContent='Run '+r.id;$('source').append(o);}}
}
async function tokens(){
  const d=await api('/api/tokens');
  const rows=[row('Số lần gọi',String(d.calls)),row('Token phản hồi (ước lượng)',String(d.tokens)),row('Vượt ngân sách',String(d.overBudget),d.overBudget?'bad':'good')];
  for(const t of d.top)rows.push(row(t.operation,t.calls+' lần · '+t.tokens+' token','mute'));
  put($('tokensBody'),rows);
}
async function plans(){
  const d=await api('/api/plans');
  if(!d.plans.length){put($('plansBody'),[div('empty','Không có kế hoạch nào đang chờ.')]);return;}
  put($('plansBody'),d.plans.map(p=>{
    const box=div('line');const info=div('');info.append(div('mono',p.hash.slice(0,12)+'…  '+p.operation));info.append(div('mute',p.mutations.join('; ')||'(không có thay đổi staging)'));
    const b=document.createElement('button');b.textContent='Duyệt';b.onclick=async()=>{b.disabled=true;const r=await api('/api/plans/approve',{hash:p.hash});$('msg').textContent=r.ok?'Đã duyệt (dùng một lần, hết hạn sau 10 phút).':('Không duyệt được: '+(r.error||''));plans();};
    box.append(info,b);return box;}));
}
async function logs(){const d=await api('/api/logs?source='+encodeURIComponent($('source').value));$('logText').textContent=d.lines.join('\\n');$('logText').scrollTop=1e9;}
async function all(){try{await status();await Promise.all([env(),runs(),tokens(),plans(),logs()]);$('updated').textContent='Cập nhật '+new Date().toLocaleTimeString('vi-VN');}catch(e){$('msg').textContent='Không đọc được dữ liệu.';}}
$('start').onclick=async()=>{$('msg').textContent='Đang bật…';const r=await api('/api/service/start',{});$('msg').textContent=r.started||r.alreadyRunning?'Đã bật service.':'Không bật được service.';all();};
$('stop').onclick=async()=>{$('msg').textContent='Đang tắt…';const r=await api('/api/service/stop',{});$('msg').textContent=r.stopped?'Đã tắt service.':'Service không chạy.';all();};
$('refresh').onclick=all;$('source').onchange=logs;
all();setInterval(()=>{if(!document.hidden)all();},5000);
</script></body></html>`;
}
