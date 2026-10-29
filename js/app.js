(function(){
"use strict";
/* Confere se o index.html é o que combina com este app.js (evita erros por arquivos de versões misturadas). */
var need=["auth","authform","app","modal","toast","view","scroll","fab","setup","who","ttl","acts","greet","back-slot","btn-out-d","pw","em","pwbox","auth-go","auth-sw","auth-forgot","auth-msg","namebox","nm"],
    miss=need.filter(function(i){return !document.getElementById(i)});
if(miss.length){var bb=document.getElementById("boot");
 if(bb){bb.hidden=false;bb.innerHTML="<b>O index.html não combina com o app.js</b><br><small>Faltam no index.html: "+miss.join(", ")+". Use todos os arquivos do <b>minha-agenda.zip</b> mais recente (index.html, css e js juntos).</small>"}
 return}
var $=function(i){return document.getElementById(i)};
var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};
var pad=function(n){return(n<10?"0":"")+n};
var isoOf=function(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())};
var parse=function(s){var a=s.split("-");return new Date(+a[0],+a[1]-1,+a[2])};
var todayISO=function(){return isoOf(new Date())};
var hm=function(t){return String(t).slice(0,5)};
var mins=function(t){var a=String(t).split(":");return +a[0]*60+ +a[1]};
var fmtMin=function(x){x=(x+1440)%1440;return pad(Math.floor(x/60))+":"+pad(x%60)};
var MN=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
var WDL=["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
var WD=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
var cap=function(s){return s.charAt(0).toUpperCase()+s.slice(1)};
var dmy=function(s){var d=parse(s);return pad(d.getDate())+"/"+pad(d.getMonth()+1)};
var dfull=function(s){var d=parse(s);return cap(WDL[d.getDay()])+", "+d.getDate()+" de "+MN[d.getMonth()]};
var ic=function(n){return '<svg class="i"><use href="#'+n+'"/></svg>'};
var money=function(v){return "R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:2})};
var initials=function(n){var w=n.trim().split(/\s+/);return(w[0].charAt(0)+(w.length>1?w[w.length-1].charAt(0):"")).toUpperCase()};
var LAB={realizado:"Realizada",cancelado:"Cancelada",remarcado:"Remarcada",agendado:"Agendada"};

var S={user:null,name:"",pts:[],ap:[],view:"agenda",pid:null,day:todayISO(),cm:null,filt:"all",q:"",notified:{}};
S.cm=new Date(parse(S.day).getFullYear(),parse(S.day).getMonth(),1);
var sb=null,started=false,recovering=false,resetOpen=false,modalLocked=false;
var RECOVERY_KEY="agendapro:recovery-request",RECOVERY_FLOW_KEY="agendapro:recovery-flow";

var getP=function(id){return S.pts.filter(function(p){return p.id===id})[0]};
var getA=function(id){return S.ap.filter(function(a){return a.id===id})[0]};
var cmpA=function(a,b){return a.date.localeCompare(b.date)||a.time.localeCompare(b.time)};
var doneOf=function(pid){return S.ap.filter(function(a){return a.patient_id===pid&&a.status==="realizado"}).sort(cmpA)};
var okc=function(pid){return doneOf(pid).length};
var nextOf=function(pid){return S.ap.filter(function(a){return a.patient_id===pid&&a.status==="agendado"}).sort(cmpA)[0]};
var sessNo=function(a){return doneOf(a.patient_id).map(function(x){return x.id}).indexOf(a.id)+1};
var whenTxt=function(a){if(!a)return"Sem agendamento";var t=todayISO(),tm=isoOf(new Date(Date.now()+864e5));
 return(a.date===t?"Hoje":a.date===tm?"Amanhã":WD[parse(a.date).getDay()])+" ("+dmy(a.date)+") · "+hm(a.time)};

var tt=null;
function toast(m,ms){var e=$("toast");e.textContent=m;e.classList.add("show");clearTimeout(tt);tt=setTimeout(function(){e.classList.remove("show")},ms||2600)}
function errMsg(e){return(e&&e.message)?e.message:"Erro inesperado."}

/* ---------------- modal helpers ---------------- */
function modal(html){$("modal").innerHTML='<div class="box"><div class="grip"></div>'+html+'</div>';$("modal").classList.add("on")}
function closeModal(){$("modal").classList.remove("on");$("modal").innerHTML="";modalLocked=false}
$("modal").addEventListener("click",function(e){if(e.target===$("modal")&&!modalLocked)closeModal()});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!modalLocked)closeModal()});
function confirmBox(title,text,label,fn){
 modal('<div class="row"><b>'+esc(title)+'</b><button class="ibtn" data-close aria-label="Fechar">'+ic("xx")+'</button></div><div class="mute">'+esc(text)+'</div><button class="btn danger" id="cf-yes">'+esc(label)+'</button><button class="btn sec" data-close>Voltar</button>');
 $("cf-yes").onclick=function(){this.disabled=true;Promise.resolve(fn()).then(closeModal).catch(function(e){toast(errMsg(e));closeModal()})}}

/* ---------------- data ---------------- */
async function load(){
 var r=await Promise.all([sb.from("patients").select("*").order("name"),sb.from("appointments").select("*").order("date").order("time")]);
 if(r[0].error)throw r[0].error;if(r[1].error)throw r[1].error;
 S.pts=r[0].data;S.ap=r[1].data.map(function(a){a.time=hm(a.time);return a});
}
async function run(p,okMsg){try{var r=await p;if(r&&r.error)throw r.error;await load();render();if(okMsg)toast(okMsg);return r}catch(e){toast("Erro: "+errMsg(e),4000);return null}}

/* ---------------- URL do app e links de autenticação ---------------- */
/* URL pública usada como redirectTo no e-mail de recuperação de senha.
   Prioriza APP_URL (js/config.js). Sem ela, usa o endereço atual quando o app
   está em http/https. Em file:// não existe origem válida, então retorna "". */
function appUrlConfigured(){return typeof APP_URL==="string"&&/^https?:\/\//i.test(APP_URL.trim())}
function appBaseUrl(){
 var raw="",u;
 if(appUrlConfigured())raw=APP_URL.trim();
 else{if(!/^https?:$/i.test(location.protocol))return "";raw=location.origin+location.pathname}
 try{u=new URL(raw)}catch(e){return ""}
 if(!/^https?:$/i.test(u.protocol))return "";
 var p=u.pathname.replace(/\/index\.html?$/i,"/");
 if(p.charAt(p.length-1)!=="/"){
  if(p.split("/").pop().indexOf(".")>=0)p=p.replace(/[^/]*$/,"");
  if(p.charAt(p.length-1)!=="/")p+="/";
 }
 return u.origin+p;
}
function isLocalUrl(u){try{var h=new URL(u).hostname;return h==="localhost"||h==="127.0.0.1"||h==="0.0.0.0"||h==="[::1]"||/\.local$/i.test(h)}catch(e){return false}}
/* Lê os parâmetros que o Supabase devolve na URL (tokens e erros do link). */
function parseAuthLink(){
 var q=new URLSearchParams(location.search.replace(/^\?/,"")),
     h=new URLSearchParams(location.hash.replace(/^#/,"")),
     pick=function(k){return q.get(k)||h.get(k)||""};
 return {err:pick("error"),code:pick("error_code"),desc:pick("error_description"),type:pick("type"),
         authCode:pick("code"),tokenHash:pick("token_hash"),accessToken:pick("access_token")};
}
/* Guarda o pedido de recuperação para reconhecer também retornos com ?code=...,
   que não trazem o parâmetro type=recovery. */
function saveRecoveryRequest(email){
 try{localStorage.setItem(RECOVERY_KEY,JSON.stringify({email:String(email||""),at:Date.now()}))}catch(e){}
}
function recentRecoveryRequest(){
 try{
  var raw=localStorage.getItem(RECOVERY_KEY);if(!raw)return null;
  var d=JSON.parse(raw);
  if(!d||typeof d.at!=="number"||Date.now()-d.at>7200000){localStorage.removeItem(RECOVERY_KEY);return null}
  return d;
 }catch(e){return null}
}
function clearRecoveryRequest(){try{localStorage.removeItem(RECOVERY_KEY)}catch(e){}}
function markRecoveryFlow(on){try{if(on)sessionStorage.setItem(RECOVERY_FLOW_KEY,"1");else sessionStorage.removeItem(RECOVERY_FLOW_KEY)}catch(e){}}
function recoveryFlowActive(){try{return sessionStorage.getItem(RECOVERY_FLOW_KEY)==="1"}catch(e){return false}}
/* Remove os parâmetros de autenticação da barra de endereço (tokens/erros). */
function cleanAuthUrl(){
 try{
  var q=new URLSearchParams(location.search);
  ["error","error_code","error_description","code","token_hash","type"].forEach(function(k){q.delete(k)});
  var qs=q.toString(),hs=/access_token=|error=|error_description=|type=recovery/.test(location.hash)?"":location.hash;
  history.replaceState(null,"",location.pathname+(qs?"?"+qs:"")+hs);
 }catch(e){}
}
function authLinkMessage(l){
 var d=(l.code+" "+l.desc).toLowerCase();
 if(/expired|expirad/.test(d))return "O link de recuperação expirou ou já foi usado. Peça um novo link em \"Esqueci minha senha\".";
 if(l.err==="access_denied")return "O link do e-mail não pôde ser validado. Peça um novo link em \"Esqueci minha senha\".";
 if(l.err)return "Não foi possível abrir o link do e-mail. Peça um novo link em \"Esqueci minha senha\".";
 return "";
}

/* ---------------- auth ---------------- */
var mode="login";
function authMode(m){mode=m;var l=m==="login",c=m==="signup",f=m==="forgot";
 $("pwbox").hidden=f;$("namebox").hidden=!c;$("pw").autocomplete=c?"new-password":"current-password";
 $("auth-go").textContent=l?"Entrar":c?"Criar conta":"Enviar link de recuperação";
 $("auth-sw").textContent=l?"Criar conta":"Já tenho conta";$("auth-forgot").hidden=!l;$("auth-msg").hidden=true}
function amsg(t,k){var m=$("auth-msg");m.className="hint "+(k||"err");m.textContent=t;m.hidden=false}
$("auth-sw").onclick=function(){authMode(mode==="login"?"signup":"login")};
$("auth-forgot").onclick=function(){authMode("forgot")};
$("authform").addEventListener("submit",async function(e){
 e.preventDefault();var em=$("em").value.trim(),pw=$("pw").value,b=$("auth-go");
 /* Login/cadastro manual encerra qualquer recuperação pendente. */
 if(mode!=="forgot"&&(recovering||resetOpen)){recovering=false;resetOpen=false;modalLocked=false;markRecoveryFlow(false);clearRecoveryRequest();closeModal()}
 if(!em){amsg("Informe o e-mail.");return}
 if(mode==="signup"&&!$("nm").value.trim()){amsg("Informe como você gostaria de ser chamado.");$("nm").focus();return}
 if(mode!=="forgot"&&pw.length<6){amsg("A senha precisa ter pelo menos 6 caracteres.");return}
 b.disabled=true;
 try{
  if(mode==="login"){var r=await sb.auth.signInWithPassword({email:em,password:pw});if(r.error)throw r.error}
  else if(mode==="signup"){var nm=$("nm").value.trim().slice(0,60),opts={data:{display_name:nm}},baseS=appBaseUrl();
   if(baseS)opts.emailRedirectTo=baseS;
   var r2=await sb.auth.signUp({email:em,password:pw,options:opts});if(r2.error)throw r2.error;
   var u2=r2.data&&r2.data.user;if(u2&&u2.identities&&u2.identities.length===0)throw new Error("User already registered");
   if(!(r2.data&&r2.data.session)){var r5=await sb.auth.signInWithPassword({email:em,password:pw});
    if(r5.error){if(/not confirmed/i.test(r5.error.message))throw new Error("CONFIRM_ON");throw r5.error}}}
  else{var baseR=appBaseUrl();
   if(!baseR){amsg("Não foi possível montar o link de recuperação: o app está aberto como arquivo local (file://). Publique o site ou preencha APP_URL em js/config.js.");b.disabled=false;return}
   if(!appUrlConfigured()&&isLocalUrl(baseR))console.warn("[recuperação de senha] O link do e-mail apontará para "+baseR+". Em produção, preencha APP_URL em js/config.js e cadastre o endereço em Supabase → Authentication → URL Configuration.");
   var r3=await sb.auth.resetPasswordForEmail(em,{redirectTo:baseR});if(r3.error)throw r3.error;
   saveRecoveryRequest(em);
   amsg("Link enviado para "+em+". Abra o e-mail e toque no link para definir a nova senha.","ok")}
 }catch(err){var m=errMsg(err);
  if(m==="CONFIRM_ON")m="Conta criada, mas o servidor ainda exige confirmação por e-mail. O administrador precisa desativar \"Confirm email\" no painel do Supabase (Authentication → Sign In / Providers → Email).";
  else if(/Invalid login/i.test(m))m="E-mail ou senha incorretos.";
  else if(/not confirmed/i.test(m))m="Este e-mail ainda não foi confirmado. Peça ao administrador para liberar o acesso.";
  else if(/already registered|already been registered/i.test(m))m="Este e-mail já tem conta. Toque em \"Já tenho conta\" e entre.";
  else if(/at least \d+ characters|weak password|Password should/i.test(m))m="A senha precisa ter pelo menos 6 caracteres.";
  else if(/rate limit|too many|security purposes/i.test(m))m="Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  else if(/valid email|invalid.*email|Unable to validate email/i.test(m))m="Informe um e-mail válido.";
  else if(/Failed to fetch|NetworkError|Load failed/i.test(m))m="Sem conexão com a internet. Verifique e tente de novo.";
  amsg(m)}
 b.disabled=false});
function logout(){confirmBox("Sair da conta?","Você precisará entrar de novo neste aparelho.","Sair",async function(){await sb.auth.signOut()})}
$("btn-out-d").onclick=logout;

function showAuth(keepModal){started=false;if(!keepModal)S.user=null;$("app").hidden=true;$("auth").hidden=false;if(!keepModal){modalLocked=false;closeModal()}}
async function startApp(){
 /* Enquanto a recuperação de senha estiver em curso, o app nunca abre a Home.
    Se algum evento do Supabase tentar entrar na agenda, voltamos ao formulário. */
 if(recovering||resetOpen){openResetPassword();return}
 $("auth").hidden=true;$("app").hidden=false;setWho();
 try{await load()}catch(e){$("view").innerHTML='<div class="hint err">Não foi possível carregar os dados: '+esc(errMsg(e))+'. Confira se você executou o arquivo supabase.sql.</div>';return}
 await loadProfile();setWho();started=true;route();if(!S.name)askName(true)}

/* ---------------- perfil (nome de exibição) ---------------- */
var metaName=function(){return((S.user&&S.user.user_metadata&&S.user.user_metadata.display_name)||"").trim()};
async function loadProfile(){
 S.name="";
 try{var r=await sb.from("profiles").select("display_name").eq("user_id",S.user.id).maybeSingle();if(r.error)throw r.error;
  S.name=((r.data&&r.data.display_name)||"").trim();
  if(!S.name&&metaName()){S.name=metaName();var u=await sb.from("profiles").upsert({user_id:S.user.id,display_name:S.name});if(u.error)throw u.error}
 }catch(e){S.name=S.name||metaName()}}
function setWho(){var w=$("who");w.innerHTML=(S.name?'<b style="color:var(--ink)">'+esc(S.name)+"</b><br>":"")+esc(S.user.email);w.style.cursor="pointer";w.title="Alterar nome";w.onclick=function(){askName(false)}}
function askName(first){
 modal('<div class="row"><b style="font-size:1.1rem">'+(first?"Como você gostaria de ser chamado?":"Alterar nome")+'</b><button class="ibtn" data-close aria-label="Fechar">'+ic("xx")+"</button></div>"+
 '<div class="mute">'+(first?"Vamos usar esse nome para te receber no app.":"Esse nome aparece na saudação do app.")+"</div>"+
 '<div id="nm-err" class="hint err" hidden></div><div><label for="nm-i">Seu nome ou apelido</label><input id="nm-i" maxlength="60" autocomplete="nickname" value="'+esc(S.name)+'"></div>'+
 '<button class="btn" id="nm-ok">'+ic("chk")+"Salvar</button>"+(first?'<button class="btn sec" data-close>Agora não</button>':""));
 setTimeout(function(){var i=$("nm-i");if(i)i.focus()},50);
 $("nm-ok").onclick=async function(){var v=$("nm-i").value.trim().slice(0,60),er=$("nm-err");
  if(!v){er.textContent="Informe seu nome ou apelido.";er.hidden=false;return}
  this.disabled=true;
  try{var r=await sb.from("profiles").upsert({user_id:S.user.id,display_name:v,updated_at:new Date().toISOString()});if(r.error)throw r.error;
   try{await sb.auth.updateUser({data:{display_name:v}})}catch(e2){}
   S.name=v;setWho();closeModal();render();toast("Pronto, "+v+"!")}
  catch(e){er.textContent="Não foi possível salvar: "+errMsg(e);er.hidden=false;this.disabled=false}}}

/* ---------------- routing ---------------- */
function go(v,id){location.hash="#/"+v+(id?"/"+id:"")}
function route(){
 if(!started)return;
 var h=location.hash.replace(/^#\/?/,"").split("/");S.view=h[0]||"agenda";S.pid=h[1]||null;
 if(["agenda","pacientes","paciente","historico"].indexOf(S.view)<0)S.view="agenda";
 if((S.view==="paciente"||S.view==="historico")&&!getP(S.pid))S.view="pacientes";
 render();$("scroll").scrollTop=0}
window.addEventListener("hashchange",route);

function render(){
 if(!started)return;
 var v=S.view,top=(v==="agenda"||v==="pacientes");
 document.querySelectorAll("[data-nav]").forEach(function(b){b.classList.toggle("on",b.dataset.nav===(top?v:"pacientes"))});
 $("fab").hidden=v!=="agenda";
 var bell='<button class="ibtn" id="btn-bell" aria-label="Ativar avisos de lembrete">'+ic("bel")+'</button>',
     out='<button class="ibtn mob" id="btn-out" aria-label="Sair">'+ic("out")+'</button>';
 $("back-slot").innerHTML="";$("greet").textContent="";$("greet").onclick=null;$("greet").title="";
 if(v==="agenda"){var hr=new Date().getHours();$("greet").textContent=S.name?"Olá, "+S.name+"! Seja bem-vindo":(hr<12?"Bom dia":hr<18?"Boa tarde":"Boa noite");$("greet").onclick=function(){askName(false)};$("greet").title="Alterar nome";$("ttl").textContent=dfull(S.day);
  $("acts").innerHTML='<button class="btn sm desk" id="btn-new">'+ic("plus")+'Novo atendimento</button>'+bell+out;renderAgenda()}
 else if(v==="pacientes"){$("ttl").textContent="Pacientes";$("acts").innerHTML='<button class="btn sm" id="btn-newp">'+ic("plus")+'Cadastrar</button>'+bell+out;renderList()}
 else if(v==="paciente"){$("ttl").textContent=getP(S.pid).name;$("back-slot").innerHTML='<button class="ibtn" data-nav="pacientes" aria-label="Voltar">'+ic("chl")+'</button>';
  $("acts").innerHTML='<button class="btn sec sm" id="btn-editp">'+ic("pen")+'Editar</button>'+out;renderPac()}
 else{$("ttl").textContent="Histórico";$("greet").textContent=getP(S.pid).name;$("back-slot").innerHTML='<button class="ibtn" id="back-p" aria-label="Voltar">'+ic("chl")+'</button>';$("acts").innerHTML=out;renderHist()}
 var e;
 if(e=$("btn-new"))e.onclick=function(){apptForm(null,null)};
 if(e=$("btn-newp"))e.onclick=function(){patForm(null)};
 if(e=$("btn-editp"))e.onclick=function(){patForm(getP(S.pid))};
 if(e=$("btn-out"))e.onclick=logout;
 if(e=$("back-p"))e.onclick=function(){go("paciente",S.pid)};
 if(e=$("btn-bell"))e.onclick=askNotif;
}
$("fab").onclick=function(){apptForm(null,null)};

/* ---------------- agenda ---------------- */
function renderAgenda(){
 var f=S.cm,y=f.getFullYear(),m=f.getMonth(),ld=(f.getDay()+6)%7,dim=new Date(y,m+1,0).getDate(),tot=Math.ceil((ld+dim)/7)*7,t=todayISO(),cells="";
 var has={};S.ap.forEach(function(a){if(a.status==="agendado"||a.status==="realizado")has[a.date]=1});
 for(var x=0;x<tot;x++){var d=new Date(y,m,1-ld+x),i=isoOf(d);
  cells+='<button class="cd'+(d.getMonth()!==m?" o":"")+(i===S.day?" on":"")+(i===t?" td":"")+'" data-day="'+i+'" aria-label="'+d.getDate()+" de "+MN[d.getMonth()]+'"><b>'+d.getDate()+'</b><i class="pt'+(has[i]?"":" z")+'"></i></button>'}
 var CAL='<div class="cal"><div class="ch"><button data-cm="-1" aria-label="Mês anterior">'+ic("chl")+'</button><b>'+MN[m]+" "+y+'</b><button data-day="'+t+'" style="padding:0 10px;font-size:.75rem;font-weight:700">Hoje</button><button data-cm="1" aria-label="Próximo mês">'+ic("chr")+'</button></div><div class="cg">'+["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map(function(s){return"<span>"+s+"</span>"}).join("")+cells+"</div></div>";
 var l=S.ap.filter(function(a){return a.date===S.day&&(a.status==="agendado"||a.status==="realizado")}).sort(cmpA);
 var now=new Date(),nm=now.getHours()*60+now.getMinutes();
 var nx=S.day===t?l.filter(function(a){return a.status==="agendado"&&mins(a.time)>=nm})[0]:null;
 var late=S.ap.filter(function(a){return a.status==="agendado"&&a.date<t}).sort(cmpA);
 var warn=late.length?'<button class="hint" style="border:0;width:100%;text-align:left" data-day="'+late[0].date+'">'+ic("clk")+late.length+" atendimento"+(late.length>1?"s":"")+" de dias anteriores sem baixa. Toque para revisar.</button>":"";
 var cnt='<div class="sub"><b style="color:var(--ink)">'+(S.day===t?"Hoje, ":"")+dmy(S.day)+"</b> · "+l.length+" atendimento"+(l.length===1?"":"s")+(nx?" · próximo "+relTxt(nx.time,nm):"")+"</div>";
 var body=l.length?l.map(function(a){
  var p=getP(a.patient_id),isn=a===nx,dn=a.status==="realizado",od=!dn&&(a.date<t||(a.date===t&&mins(a.time)+(a.duration||50)<nm));
  return '<div class="appt'+(isn?" next":"")+(dn?" done":"")+'"><div class="tm">'+a.time+"<span>"+a.duration+' min</span></div><button class="card" data-appt="'+a.id+'"><div class="row"><b>'+esc(p?p.name:"—")+"</b>"+(dn?'<span class="pill ok">'+ic("chk")+"Concluído</span>":isn?'<span class="pill" style="background:#fff;color:#0f766e">Próximo</span>':od?'<span class="pill amb">Pendente</span>':"")+'</div><div class="mute" style="margin:2px 0 8px">'+esc(a.kind)+(a.note?" · "+esc(a.note):"")+"</div>"+(dn?"":'<span class="bell">'+ic("bel")+"Lembrete às "+fmtMin(mins(a.time)-(a.reminder_min||30))+"</span>")+"</button>"+(dn?"":'<button class="chk" data-done="'+a.id+'" aria-label="Marcar como realizada">'+ic("chk")+"Realizada</button>")+"</div>"}).join("")
  :'<div class="empty">'+ic("cal")+'<div style="font-weight:700;margin-top:6px">Dia livre</div>Nenhum atendimento neste dia.</div>';
 $("view").innerHTML='<div class="agenda-grid"><div style="display:flex;flex-direction:column;gap:14px">'+CAL+'<button class="btn sec desk" id="ag-new">'+ic("plus")+"Novo atendimento neste dia</button></div><div class=\"list\">"+warn+cnt+body+"</div></div>";
 var b=$("ag-new");if(b)b.onclick=function(){apptForm(null,null)};
}
function relTxt(t,nm){var d=mins(t)-nm;return d<=0?"agora":d<60?"em "+d+" min":"em "+Math.floor(d/60)+"h"+(d%60?pad(d%60):"")}

/* ---------------- pacientes ---------------- */
function renderList(){
 var q=S.q.toLowerCase(),l=S.pts.filter(function(p){return !q||p.name.toLowerCase().indexOf(q)>=0});
 $("view").innerHTML='<input id="pq" type="search" placeholder="Buscar paciente" value="'+esc(S.q)+'" aria-label="Buscar paciente">'+
  (l.length?'<div class="pgrid">'+l.map(function(p){var d=okc(p.id),pc=Math.min(100,d/p.total_sessions*100),n=nextOf(p.id);
   return '<button class="card" data-pat="'+p.id+'" style="display:flex;gap:12px;align-items:center"><div class="av">'+esc(initials(p.name))+'</div><div style="flex:1;min-width:0"><b>'+esc(p.name)+'</b><div class="mute">'+d+" de "+p.total_sessions+" sessões · "+money(p.fee)+'</div><div class="mute">'+(n?"Próximo: "+whenTxt(n):"Sem agendamento")+'</div><div class="bar" style="margin-top:8px"><i style="width:'+pc+'%"></i></div></div>'+ic("chr")+"</button>"}).join("")+"</div>"
  :'<div class="empty">'+ic("usr")+'<div style="font-weight:700;margin-top:6px">'+(S.pts.length?"Nenhum resultado":"Nenhum paciente ainda")+"</div>"+(S.pts.length?"":"Toque em Cadastrar para começar.")+"</div>");
 var q2=$("pq");q2.oninput=function(){S.q=q2.value;var pos=q2.selectionStart;renderList();var n=$("pq");n.focus();n.setSelectionRange(pos,pos)}}

function histCard(a,p){var dn=a.status==="realizado";
 return '<button class="card" data-appt="'+a.id+'"><div class="row"><div><b>'+(dn?"Sessão "+sessNo(a)+" de "+p.total_sessions:esc(a.kind))+'</b><div class="mute">'+dmy(a.date)+" · "+a.time+'</div></div><span class="pill '+a.status+'">'+LAB[a.status]+"</span></div>"+(a.note?'<div style="margin-top:6px;font-size:.88rem">'+esc(a.note)+"</div>":"")+"</button>"}

function renderPac(){
 var p=getP(S.pid),d=okc(p.id),L=Math.max(0,p.total_sessions-d),pct=Math.min(100,Math.round(d/p.total_sessions*100)),n=nextOf(p.id),paid=Math.round(p.fee*Math.min(d,p.total_sessions)/p.total_sessions),C=2*Math.PI*37;
 var hist=S.ap.filter(function(a){return a.patient_id===p.id&&a.status!=="agendado"}).sort(function(a,b){return cmpA(b,a)});
 $("view").innerHTML='<div class="pdet">'+
 '<div class="hero"><div class="ring"><svg viewBox="0 0 92 92"><circle cx="46" cy="46" r="37" stroke="rgba(255,255,255,.2)"/><circle cx="46" cy="46" r="37" stroke="#5eead4" stroke-linecap="round" stroke-dasharray="'+(C*pct/100)+" "+C+'"/></svg><div class="c"><div>'+pct+"%<small>concluído</small></div></div></div><div style=\"flex:1;min-width:0\"><div style=\"font-size:1.3rem;font-weight:800;letter-spacing:-.02em\">"+esc(p.name)+'</div>'+(p.phone?'<div class="mute"><a href="tel:'+esc(p.phone.replace(/[^\d+]/g,""))+'" style="color:inherit">'+esc(p.phone)+"</a></div>":"")+'<div class="mute">Valor combinado</div><b style="font-size:1.15rem">'+money(p.fee)+"</b></div></div>"+
 '<div class="stats"><div class="card"><b>'+p.total_sessions+'</b><span class="mute">Contratadas</span></div><div class="card"><b>'+d+'</b><span class="mute">Realizadas</span></div><div class="card"><b>'+L+'</b><span class="mute">Restantes</span></div></div>'+
 '<div class="card"><div class="row"><b style="font-size:1.05rem">Sessões: '+d+"/"+p.total_sessions+"</b>"+(L?"":'<span class="pill ok">'+ic("chk")+"Sessões finalizadas</span>")+'</div><div class="bar" style="margin:8px 0"><i style="width:'+pct+'%"></i></div><div class="mute"><b>'+(L?L+(L===1?" sessão restante.":" sessões restantes."):"Nenhuma sessão restante.")+'</b></div><div class="row" style="margin-top:8px"><span class="mute">Valor das sessões realizadas</span><b>'+money(paid)+" de "+money(p.fee)+"</b></div></div>"+
 '<div class="card"><div class="row"><div style="display:flex;gap:10px;align-items:center"><div class="av" style="width:40px;height:40px">'+ic("clk")+'</div><div><div class="mute">Próximo atendimento</div><b>'+(n?whenTxt(n):L?"Sem agendamento":"Sessões finalizadas")+"</b></div></div></div>"+
 '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">'+(n?'<button class="btn sec sm" style="flex:1" data-appt="'+n.id+'">Ações / alterar</button>':"")+(L?'<button class="btn sm" style="flex:1" id="pc-new">'+ic("plus")+"Agendar</button>":"")+"</div></div>"+
 '<div class="full" style="display:flex;flex-direction:column;gap:12px"><div class="row"><b>Últimas sessões</b><button class="back" data-hist="'+p.id+'">Ver histórico'+ic("chr")+"</button></div>"+
 (hist.length?hist.slice(0,5).map(function(a){return histCard(a,p)}).join(""):'<div class="card mute">Nenhuma sessão registrada ainda.</div>')+
 (p.notes?'<div class="card"><div class="mute">Observação</div><div style="white-space:pre-wrap">'+esc(p.notes)+"</div></div>":"")+
 '<button class="btn danger" id="pc-del" style="margin-top:6px">'+ic("trs")+"Excluir paciente</button></div></div>";
 var b=$("pc-new");if(b)b.onclick=function(){apptForm(null,p.id)};
 $("pc-del").onclick=function(){confirmBox("Excluir "+p.name+"?","Todo o histórico e os atendimentos deste paciente serão apagados. Esta ação não pode ser desfeita.","Excluir paciente",async function(){var r=await sb.from("patients").delete().eq("id",p.id);if(r.error)throw r.error;await load();go("pacientes");toast("Paciente excluído.")})}}

function renderHist(){
 var p=getP(S.pid);
 var l=S.ap.filter(function(a){return a.patient_id===p.id&&a.status!=="agendado"&&(S.filt==="all"||a.status===S.filt)}).sort(function(a,b){return cmpA(b,a)});
 $("view").innerHTML='<div class="sub">'+okc(p.id)+" de "+p.total_sessions+' realizadas</div><div class="seg" id="seg">'+[["all","Todas"],["realizado","Realizadas"],["cancelado","Canceladas"],["remarcado","Remarcadas"]].map(function(x){return'<button data-f="'+x[0]+'" class="'+(S.filt===x[0]?"on":"")+'">'+x[1]+"</button>"}).join("")+"</div>"+
 (l.length?'<div class="list">'+l.map(function(a){return'<div class="tl '+a.status+'"><div class="dt"></div><div style="flex:1;min-width:0">'+histCard(a,p)+"</div></div>"}).join("")+"</div>":'<div class="empty">Nenhuma sessão neste filtro.</div>')}

/* ---------------- formulários ---------------- */
function patForm(p){
 var isNew=!p,d=p?okc(p.id):0;
 modal('<div class="row"><b style="font-size:1.1rem">'+(isNew?"Cadastrar paciente":"Editar paciente")+'</b><button class="ibtn" data-close aria-label="Fechar">'+ic("xx")+"</button></div>"+
 '<div id="pf-err" class="hint err" hidden></div>'+
 '<div><label for="pf-n">Nome completo</label><input id="pf-n" autocomplete="off" placeholder="Ex.: Ana Pereira" value="'+esc(p?p.name:"")+'"></div>'+
 '<div><label for="pf-tel">Telefone</label><input id="pf-tel" type="tel" inputmode="tel" placeholder="(32) 99999-0000" value="'+esc(p?p.phone:"")+'"></div>'+
 (isNew?'<div class="two"><div><label for="pf-d">Data do 1º atendimento</label><input id="pf-d" type="date" value="'+isoOf(new Date(Date.now()+864e5))+'"></div><div><label for="pf-h">Horário</label><input id="pf-h" type="time" value="15:00"></div></div>'
  :'<div><label for="pf-h">Horário padrão das sessões</label><input id="pf-h" type="time" value="'+esc(p.default_time?hm(p.default_time):"15:00")+'"><div class="mute" style="margin-top:4px">Alterar este horário atualiza os atendimentos futuros já agendados.</div></div>')+
 '<div class="two"><div><label for="pf-v">Valor combinado (R$)</label><input id="pf-v" type="number" inputmode="decimal" min="0" step="0.01" value="'+(p?p.fee:600)+'"></div><div><label for="pf-t">Total de sessões</label><input id="pf-t" type="number" inputmode="numeric" min="1" value="'+(p?p.total_sessions:10)+'"></div></div>'+
 (isNew?"":'<div class="mute">Sessões já realizadas: <b>'+d+"</b>. O total não pode ser menor que isso.</div>")+
 '<div><label for="pf-o">Observação</label><textarea id="pf-o" rows="3" placeholder="Opcional">'+esc(p?p.notes:"")+"</textarea></div>"+
 '<button class="btn" id="pf-save">'+ic("chk")+(isNew?"Salvar paciente":"Salvar alterações")+"</button>");
 $("pf-save").onclick=async function(){
  var er=$("pf-err"),nm=$("pf-n").value.trim(),tot=parseInt($("pf-t").value,10),fee=parseFloat($("pf-v").value)||0,hr=$("pf-h").value||"15:00";
  function bad(t){er.textContent=t;er.hidden=false}
  if(!nm)return bad("Informe o nome do paciente.");
  if(!(tot>=1))return bad("Informe o total de sessões (mínimo 1).");
  if(tot<d)return bad("O total de sessões não pode ser menor que as já realizadas ("+d+").");
  var btn=this;btn.disabled=true;
  try{
   var row={name:nm,phone:$("pf-tel").value.trim(),fee:fee,total_sessions:tot,default_time:hr,notes:$("pf-o").value.trim()};
   if(isNew){var r=await sb.from("patients").insert(row).select().single();if(r.error)throw r.error;
    var dt=$("pf-d").value;if(dt){var r2=await sb.from("appointments").insert({patient_id:r.data.id,date:dt,time:hr,duration:50,kind:"Sessão",reminder_min:30});if(r2.error)throw r2.error;S.day=dt;S.cm=new Date(parse(dt).getFullYear(),parse(dt).getMonth(),1)}
    await load();closeModal();go("paciente",r.data.id);toast("Paciente cadastrado.")}
   else{var r3=await sb.from("patients").update(row).eq("id",p.id);if(r3.error)throw r3.error;
    if(hr!==hm(p.default_time||"")){var r4=await sb.from("appointments").update({time:hr}).eq("patient_id",p.id).eq("status","agendado");if(r4.error)throw r4.error}
    await load();closeModal();render();toast("Paciente atualizado.")}
  }catch(e){bad("Erro ao salvar: "+errMsg(e));btn.disabled=false}}}

function apptForm(a,pid){
 var isNew=!a;if(!S.pts.length){modal('<div class="row"><b>Novo atendimento</b><button class="ibtn" data-close aria-label="Fechar">'+ic("xx")+'</button></div><div class="mute">Cadastre um paciente antes de criar atendimentos.</div><button class="btn" id="ap-cp">'+ic("plus")+"Cadastrar paciente</button>");$("ap-cp").onclick=function(){patForm(null)};return}
 var sel=a?a.patient_id:(pid||(S.view==="paciente"?S.pid:S.pts[0].id)),pp=getP(sel),lead=a?(a.reminder_min||30):30;
 var dflt=a?a.date:S.day,tm=a?a.time:(pp&&pp.default_time?hm(pp.default_time):"15:00");
 modal('<div class="row"><b style="font-size:1.1rem">'+(isNew?"Novo atendimento":"Editar atendimento")+'</b><button class="ibtn" data-close aria-label="Fechar">'+ic("xx")+"</button></div>"+
 '<div id="ap-err" class="hint err" hidden></div>'+
 '<div><label for="ap-p">Paciente</label><select id="ap-p">'+S.pts.map(function(x){return'<option value="'+x.id+'"'+(x.id===sel?" selected":"")+">"+esc(x.name)+"</option>"}).join("")+"</select></div>"+
 '<div class="two"><div><label for="ap-d">Data</label><input id="ap-d" type="date" value="'+dflt+'"></div><div><label for="ap-t">Horário</label><input id="ap-t" type="time" value="'+tm+'"></div></div>'+
 '<div class="two"><div><label for="ap-du">Duração</label><select id="ap-du">'+[30,45,50,60,90].map(function(n){return"<option"+((a?a.duration:50)===n?" selected":"")+' value="'+n+'">'+n+" min</option>"}).join("")+'</select></div><div><label for="ap-k">Tipo</label><select id="ap-k">'+["Sessão","Avaliação","Retorno"].map(function(k){return"<option"+((a?a.kind:"Sessão")===k?" selected":"")+">"+k+"</option>"}).join("")+"</select></div></div>"+
 '<div><label>Avisar com antecedência de</label><div class="chips" id="ap-chips">'+[10,30,60].map(function(m){return'<button type="button" class="chip'+(m===lead?" on":"")+'" data-m="'+m+'">'+m+" min</button>"}).join("")+"</div></div>"+
 '<div class="hint" id="ap-hint"></div>'+
 '<div><label for="ap-o">Observação</label><textarea id="ap-o" rows="2" placeholder="Opcional">'+esc(a?a.note:"")+"</textarea></div>"+
 '<button class="btn" id="ap-save">'+ic("chk")+"Salvar atendimento</button>"+(isNew?"":'<button class="btn danger" id="ap-del">'+ic("trs")+"Excluir atendimento</button>"));
 function hint(){$("ap-hint").innerHTML=ic("bel")+"Você receberá o lembrete às "+fmtMin(mins($("ap-t").value||"00:00")-lead)+" (com o site aberto)."}
 hint();$("ap-t").oninput=hint;
 $("ap-chips").onclick=function(e){var c=e.target.closest(".chip");if(!c)return;lead=+c.dataset.m;document.querySelectorAll("#ap-chips .chip").forEach(function(x){x.classList.toggle("on",x===c)});hint()};
 $("ap-p").onchange=function(){var q=getP($("ap-p").value);if(isNew&&q&&q.default_time)$("ap-t").value=hm(q.default_time);hint()};
 $("ap-save").onclick=async function(){
  var er=$("ap-err"),d=$("ap-d").value,t=$("ap-t").value;
  if(!d||!t){er.textContent="Informe data e horário.";er.hidden=false;return}
  var row={patient_id:$("ap-p").value,date:d,time:t,duration:+$("ap-du").value,kind:$("ap-k").value,reminder_min:lead,note:$("ap-o").value.trim()};
  this.disabled=true;
  try{var r=isNew?await sb.from("appointments").insert(row):await sb.from("appointments").update(row).eq("id",a.id);if(r.error)throw r.error;
   await load();S.day=d;S.cm=new Date(parse(d).getFullYear(),parse(d).getMonth(),1);delete S.notified[a&&a.id];closeModal();render();toast(isNew?"Atendimento salvo. Lembrete programado.":"Atendimento atualizado.")}
  catch(e){er.textContent="Erro ao salvar: "+errMsg(e);er.hidden=false;this.disabled=false}};
 var dl=$("ap-del");if(dl)dl.onclick=function(){delAppt(a)}}

function delAppt(a){confirmBox("Excluir atendimento?","O registro será removido definitivamente, inclusive do histórico.","Excluir",async function(){var r=await sb.from("appointments").delete().eq("id",a.id);if(r.error)throw r.error;await load();render();toast("Atendimento excluído.")})}

/* ---------------- ações sobre atendimento ---------------- */
function openAppt(id){
 var a=getA(id);if(!a)return;var p=getP(a.patient_id),ag=a.status==="agendado";
 modal('<div class="row"><div><b style="font-size:1.1rem">'+esc(p.name)+'</b><div class="mute">'+dfull(a.date)+" · "+a.time+" · "+LAB[a.status]+'</div></div><button class="ibtn" data-close aria-label="Fechar">'+ic("xx")+"</button></div>"+
 (a.note?'<div class="mute">'+esc(a.note)+"</div>":"")+
 (ag?'<button class="act" data-a="ok"><span class="ic" style="background:var(--okbg);color:var(--ok)">'+ic("chk")+"</span>Marcar como realizada</button>"+
  '<button class="act" data-a="rem"><span class="ic" style="background:var(--rembg);color:var(--rem)">'+ic("rep")+"</span>Remarcar atendimento</button>"+
  '<button class="act" data-a="no"><span class="ic" style="background:var(--nobg);color:var(--no)">'+ic("xx")+"</span>Cancelar atendimento</button>"
  :'<button class="act" data-a="undo"><span class="ic" style="background:var(--soft);color:var(--acc2)">'+ic("und")+"</span>Voltar para agendada</button>")+
 '<button class="act" data-a="edit"><span class="ic" style="background:var(--soft);color:var(--acc2)">'+ic("pen")+"</span>Editar</button>"+
 '<button class="act" data-a="del"><span class="ic" style="background:var(--nobg);color:var(--no)">'+ic("trs")+"</span>Excluir</button>");
 $("modal").querySelector(".box").onclick=function(e){var b=e.target.closest("[data-a]");if(!b)return;var k=b.dataset.a;
  if(k==="ok"){closeModal();markDone(id)}
  else if(k==="edit")apptForm(a,null);
  else if(k==="del")delAppt(a);
  else if(k==="undo"){closeModal();run(sb.from("appointments").update({status:"agendado"}).eq("id",id),"Atendimento reaberto.")}
  else reasonForm(a,k)}}

async function markDone(id){
 var a=getA(id),p=getP(a.patient_id);
 if(okc(p.id)>=p.total_sessions){toast("Todas as sessões contratadas já foram realizadas. Aumente o total em Editar paciente.",4500);return}
 var n=okc(p.id)+1;
 var r=await run(sb.from("appointments").update({status:"realizado"}).eq("id",id));
 if(r)toast(p.name+": sessão "+n+" de "+p.total_sessions+" registrada."+(n===p.total_sessions?" Sessões finalizadas!":""),3500)}

function reasonForm(a,k){
 var rem=k==="rem",nd=isoOf(new Date(parse(a.date).getTime()+864e5*7)),box=$("modal").querySelector(".box");
 box.innerHTML='<div class="grip"></div><div class="row"><b style="font-size:1.1rem">'+(rem?"Remarcar atendimento":"Cancelar atendimento")+'</b><button class="ibtn" data-close aria-label="Fechar">'+ic("xx")+"</button></div><div class=\"mute\">Descreva o motivo para ficar registrado no histórico.</div>"+
 '<div id="rs-err" class="hint err" hidden></div>'+
 (rem?'<div class="two"><div><label for="rs-d">Nova data</label><input id="rs-d" type="date" value="'+nd+'"></div><div><label for="rs-h">Novo horário</label><input id="rs-h" type="time" value="'+a.time+'"></div></div>':"")+
 '<div><label for="rs-m">Motivo</label><textarea id="rs-m" rows="3" placeholder="Ex.: paciente viajou, imprevisto, doença..."></textarea></div>'+
 '<div class="chips" id="rs-q"><button type="button" class="chip" data-q="Pedido do paciente.">Pedido do paciente</button><button type="button" class="chip" data-q="Imprevisto do profissional.">Imprevisto meu</button><button type="button" class="chip" data-q="Paciente doente.">Paciente doente</button></div>'+
 '<button class="btn" id="rs-ok">'+(rem?"Confirmar remarcação":"Confirmar cancelamento")+'</button><button class="btn sec" id="rs-back">Voltar</button>';
 $("rs-q").onclick=function(e){var q=e.target.closest("[data-q]");if(q)$("rs-m").value=q.dataset.q};
 $("rs-back").onclick=function(){openAppt(a.id)};
 $("rs-ok").onclick=async function(){
  var m=$("rs-m").value.trim(),er=$("rs-err");this.disabled=true;
  try{
   if(rem){var d=$("rs-d").value,t=$("rs-h").value;if(!d||!t){er.textContent="Informe nova data e horário.";er.hidden=false;this.disabled=false;return}
    var note="Remarcada para "+dmy(d)+" às "+t+"."+(m?" Motivo: "+m:"");
    var r1=await sb.from("appointments").insert({patient_id:a.patient_id,date:d,time:t,duration:a.duration,kind:a.kind,reminder_min:a.reminder_min,note:a.note});if(r1.error)throw r1.error;
    var r2=await sb.from("appointments").update({status:"remarcado",note:note}).eq("id",a.id);if(r2.error)throw r2.error;
    S.day=d;S.cm=new Date(parse(d).getFullYear(),parse(d).getMonth(),1)}
   else{var r3=await sb.from("appointments").update({status:"cancelado",note:"Cancelada."+(m?" Motivo: "+m:"")}).eq("id",a.id);if(r3.error)throw r3.error}
   await load();closeModal();render();toast(rem?"Atendimento remarcado.":"Atendimento cancelado.")
  }catch(e){er.textContent="Erro: "+errMsg(e);er.hidden=false;this.disabled=false}}}

/* ---------------- lembretes ---------------- */
function askNotif(){
 if(!("Notification" in window)){toast("Este navegador não oferece notificações. Os lembretes aparecem na tela com o site aberto.",4500);return}
 if(Notification.permission==="granted"){toast("Avisos ativados. Eles funcionam com o site aberto.",3500);return}
 if(Notification.permission==="denied"){toast("Notificações bloqueadas nas configurações do navegador.",4000);return}
 Notification.requestPermission().then(function(p){toast(p==="granted"?"Avisos ativados.":"Permissão não concedida.")})}
function checkRem(){
 if(!started)return;var n=new Date(),t=isoOf(n),nm=n.getHours()*60+n.getMinutes();
 S.ap.forEach(function(a){if(a.status!=="agendado"||a.date!==t)return;var st=mins(a.time),ld=a.reminder_min||30;
  if(nm>=st-ld&&nm<st&&!S.notified[a.id]){S.notified[a.id]=1;var p=getP(a.patient_id),msg="Atendimento com "+(p?p.name:"paciente")+" às "+a.time+". Faltam "+(st-nm)+" min.";
   toast("🔔 "+msg,8000);try{if("Notification" in window&&Notification.permission==="granted")new Notification("Minha Agenda",{body:msg})}catch(e){}}})}
setInterval(checkRem,30000);
setInterval(function(){if(started&&S.view==="agenda"&&!$("modal").classList.contains("on"))renderAgenda()},60000);
document.addEventListener("visibilitychange",function(){if(!document.hidden&&started){load().then(function(){if(!$("modal").classList.contains("on"))render();checkRem()}).catch(function(){})}});

/* ---------------- delegação de cliques ---------------- */
document.addEventListener("click",function(e){
 var t;
 if(t=e.target.closest("[data-close]")){closeModal();return}
 if(t=e.target.closest("[data-done]")){markDone(t.dataset.done);return}
 if(t=e.target.closest("[data-appt]")){openAppt(t.dataset.appt);return}
 if(t=e.target.closest("[data-cm]")){S.cm=new Date(S.cm.getFullYear(),S.cm.getMonth()+ +t.dataset.cm,1);renderAgenda();return}
 if(t=e.target.closest("[data-day]")){S.day=t.dataset.day;var d=parse(S.day);S.cm=new Date(d.getFullYear(),d.getMonth(),1);if(S.view!=="agenda")go("agenda");else render();return}
 if(t=e.target.closest("[data-pat]")){go("paciente",t.dataset.pat);return}
 if(t=e.target.closest("[data-hist]")){S.filt="all";go("historico",t.dataset.hist);return}
 if(t=e.target.closest("[data-f]")){S.filt=t.dataset.f;renderHist();return}
 if(t=e.target.closest("[data-nav]")){go(t.dataset.nav)}
});

/* ---------------- inicialização ---------------- */
function init(){
 var bt=$("boot");if(bt)bt.hidden=true;
 if(typeof supabase==="undefined"){document.body.innerHTML='<div style="padding:28px;font:16px system-ui">Não foi possível carregar a biblioteca do Supabase. Verifique sua conexão com a internet e recarregue a página.</div>';return}
 if(SUPABASE_URL.indexOf("COLE_AQUI")>=0||SUPABASE_KEY.indexOf("COLE_AQUI")>=0){$("setup").hidden=false;return}
 /* Lê o link antes de criar o cliente (o Supabase consome e limpa a URL). */
 var link=parseAuthLink(),linkMsg=authLinkMessage(link),pending=recentRecoveryRequest(),
     linkRecovery=/recovery/i.test(link.type),
     codeRecovery=!link.type&&!!link.authCode&&!!pending;
 recovering=!linkMsg&&(linkRecovery||codeRecovery||recoveryFlowActive());
 if(recovering)markRecoveryFlow(true);
 else if(linkMsg){markRecoveryFlow(false);clearRecoveryRequest()}
 if(linkMsg)cleanAuthUrl();
 sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{detectSessionInUrl:true,flowType:"implicit",persistSession:true}});authMode("login");
 if(linkMsg)amsg(linkMsg);
 sb.auth.onAuthStateChange(function(ev,session){
  setTimeout(function(){
   /* O link pode disparar PASSWORD_RECOVERY ou apenas SIGNED_IN (por exemplo
      em retornos com ?code=...). Os dois casos precisam abrir o formulário. */
   if(ev==="PASSWORD_RECOVERY"){
    recovering=true;markRecoveryFlow(true);
    if(session&&session.user)S.user=session.user;
    showAuth(true);cleanAuthUrl();openResetPassword(session&&session.user&&session.user.email);
    var w=$("np-warn");if(w){w.hidden=true;w.textContent=""}
    return;
   }
   if(ev==="SIGNED_IN"){
    if(recovering&&session&&session.user){
     S.user=session.user;showAuth(true);cleanAuthUrl();openResetPassword(session.user.email);return;
    }
    if(session&&session.user&&(!S.user||S.user.id!==session.user.id)){S.user=session.user;startApp()}
    return;
   }
   if(session&&session.user){
    if(recovering){S.user=session.user;showAuth(true);openResetPassword(session.user.email);return}
    if(!S.user||S.user.id!==session.user.id){S.user=session.user;startApp()}
    return;
   }
   if(ev==="SIGNED_OUT"){
    /* A recuperação não pode ser cancelada por um SIGNED_OUT do próprio link:
       a sessão temporária pode ser encerrada pelo Supabase durante a troca. */
    if(recovering||resetOpen){showAuth(true);openResetPassword(session&&session.user&&session.user.email);return}
    showAuth();return;
   }
   if(ev==="INITIAL_SESSION"){
    /* Enquanto a recuperação estiver ativa, o evento inicial não fecha o
       formulário nem descarta a sessão do link. */
    if(recovering||resetOpen){
     showAuth(true);openResetPassword(session&&session.user&&session.user.email);
     /* INITIAL_SESSION chega depois de o Supabase processar a URL. Sem sessão
        aqui, o link não foi validado (expirado, já usado ou aberto noutro
        navegador/aparelho). O formulário continua aberto para o usuário ver o
        aviso e poder cancelar. */
     var w=$("np-warn");
     if(w&&!(session&&session.user)){
      w.textContent="Não foi possível validar o link neste navegador. Se ele já foi usado ou expirou, cancele e peça um novo em \"Esqueci minha senha\".";
      w.hidden=false;
     }
     return;
    }
    showAuth();
   }
  },0)});
}
function resetPasswordError(m){
 if(/Auth session missing|session.*missing|JWT|not authenticated|invalid.*session/i.test(m))return "A sessão do link expirou. Peça um novo link em \"Esqueci minha senha\".";
 if(/different from the old|same password|should be different/i.test(m))return "A nova senha precisa ser diferente da senha atual.";
 if(/at least \d+ characters|weak password|Password should/i.test(m))return "A senha precisa ter no mínimo 8 caracteres, com 1 letra maiúscula, 1 número e 1 caractere especial.";
 if(/rate limit|too many|security purposes/i.test(m))return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
 if(/Failed to fetch|NetworkError|Load failed/i.test(m))return "Sem conexão com a internet. Verifique e tente de novo.";
 return m;
}
function openResetPassword(email){
 email=email||(S.user&&S.user.email)||"";
 if(resetOpen){
  /* O formulário já está aberto: só completa o e-mail da conta se ele chegou depois. */
  var acc=$("np-acc"),mail=$("np-mail"),warn=$("np-warn");
  if(email&&acc&&mail&&acc.textContent.indexOf("@")<0){mail.textContent=email;acc.hidden=false}
  if(email&&warn){warn.hidden=true;warn.textContent=""}
  return;
 }
 resetOpen=true;modalLocked=true;
 showAuth(true);authMode("login");
 var eye='<svg class="eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'+
  '<svg class="eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 4.1-5.1M9.9 5.2A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/></svg>';
 var reqsHtml="";
 var REQ_TXT=[["len","Mínimo de 8 caracteres"],["num","Pelo menos 1 número"],["upper","1 letra maiúscula"],["esp","1 caractere especial"]];
 REQ_TXT.forEach(function(r){reqsHtml+='<li data-req="'+r[0]+'"><span class="dot"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#chk"/></svg></span>'+r[1]+'</li>'});
 modal('<div class="rp">'+
  '<div class="rp-head"><span class="rp-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2.5"/></svg></span>'+
   '<div><h2>Definir nova senha</h2><p>Crie uma senha nova e segura para voltar a acessar sua agenda.</p></div></div>'+
  '<div class="rp-acc" id="np-acc"'+(email?"":" hidden")+'><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg><span>Conta: <b id="np-mail">'+esc(email)+'</b></span></div>'+
  '<div id="np-warn" class="hint" hidden></div>'+
  '<div id="np-err" class="hint err" role="alert" hidden></div>'+
  '<form class="rp-form" id="np-form" novalidate>'+
   '<div class="rp-field"><label for="np">Nova senha</label><div class="rp-input"><input id="np" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Digite a nova senha"><button type="button" class="rp-eye" id="np-eye" aria-label="Mostrar senha" aria-pressed="false">'+eye+'</button></div></div>'+
   '<div class="rp-strength" id="np-strength" data-level="0">'+
    '<div class="rp-bars" aria-hidden="true"><i></i><i></i><i></i></div>'+
    '<div class="rp-strength-row"><span>Força da senha</span><b id="np-level" aria-live="polite">—</b></div>'+
    '<ul class="rp-reqs" id="np-reqs">'+reqsHtml+'</ul>'+
   '</div>'+
   '<div class="rp-field"><label for="np2">Confirmar nova senha</label><div class="rp-input" id="np2-box"><input id="np2" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Repita a nova senha"><button type="button" class="rp-eye" id="np2-eye" aria-label="Mostrar senha" aria-pressed="false">'+eye+'</button></div>'+
    '<div class="rp-match" id="np-match" aria-live="polite"><svg class="ic-ok" viewBox="0 0 24 24" aria-hidden="true"><use href="#chk"/></svg><svg class="ic-no" viewBox="0 0 24 24" aria-hidden="true"><use href="#xx"/></svg><span>As senhas precisam ser iguais.</span></div></div>'+
   '<button type="submit" class="rp-submit" id="np-ok" disabled><span class="rp-spin" aria-hidden="true"></span><span class="rp-submit-t">Salvar Nova Senha</span></button>'+
   '<p class="rp-foot"><button type="button" class="rp-back" id="np-cancel">Voltar para o Login</button></p>'+
  '</form>'+
 '</div>');
 var form=$("np-form"),btn=$("np-ok"),cancel=$("np-cancel"),er=$("np-err"),
  np=$("np"),np2=$("np2"),box2=$("np2-box"),match=$("np-match"),
  matchTxt=match.querySelector("span"),strength=$("np-strength"),level=$("np-level"),
  reqsEl=$("np-reqs"),warn=$("np-warn"),label=btn.querySelector(".rp-submit-t");
 function fail(t){er.textContent=t;er.hidden=false;if(er.scrollIntoView)try{er.scrollIntoView({block:"nearest"})}catch(e){}}
 var TESTS=[
  ["len",function(v){return v.length>=8}],
  ["num",function(v){return /\d/.test(v)}],
  ["upper",function(v){return /[A-ZÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ]/.test(v)}],
  ["esp",function(v){return /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/.test(v)}]
 ];
 function matches(v){var ok=true;TESTS.forEach(function(t){
  var pass=t[1](v),li=reqsEl.querySelector('[data-req="'+t[0]+'"]');
  if(li)li.classList.toggle("ok",pass);
  if(!pass)ok=false;
 });return ok}
 function paint(){
  var v=np.value,v2=np2.value,all=matches(v),n=0;
  TESTS.forEach(function(t){if(t[1](v))n++});
  var lvl=!v.length?0:all?3:n>=2?2:1;
  strength.setAttribute("data-level",String(lvl));
  level.textContent=!v.length?"—":lvl===3?"Forte":lvl===2?"Média":"Fraca";
  var same=v2.length>0&&v===v2;
  box2.classList.toggle("bad",v2.length>0&&!same);
  match.className="rp-match"+(v2.length?(same?" ok":" bad"):"");
  matchTxt.textContent=!v2.length?"As senhas precisam ser iguais.":same?"As senhas conferem.":"As senhas não conferem.";
  if(!er.hidden&&all&&same){er.hidden=true;er.textContent=""}
  btn.disabled=!(all&&same);
 }
 function setEye(id,input){
  var b=$(id);if(!b)return;
  b.onclick=function(){
   var show=b.getAttribute("aria-pressed")!=="true";
   b.setAttribute("aria-pressed",show?"true":"false");
   b.setAttribute("aria-label",show?"Ocultar senha":"Mostrar senha");
   input.type=show?"text":"password";
   try{input.focus({preventScroll:true})}catch(e){input.focus()}
  };
 }
 setEye("np-eye",np);setEye("np2-eye",np2);
 async function save(){
  var v=np.value,v2=np2.value;
  if(!matches(v)){fail("A senha ainda não atende a todos os requisitos abaixo.");np.focus();return}
  if(v!==v2){fail("As senhas não conferem. Digite a mesma senha nos dois campos.");box2.classList.add("bad");np2.focus();return}
  er.hidden=true;er.textContent="";
  btn.classList.add("loading");btn.disabled=true;cancel.disabled=true;btn.setAttribute("aria-busy","true");
  label.textContent="Salvando...";
  try{
   var r=await sb.auth.updateUser({password:v});
   if(r.error)throw r.error;
   var em=(r.data&&r.data.user&&r.data.user.email)||email;
   resetOpen=false;recovering=false;markRecoveryFlow(false);clearRecoveryRequest();cleanAuthUrl();closeModal();
   try{await sb.auth.signOut()}catch(e2){}
   showAuth();authMode("login");
   if(em)$("em").value=em;
   $("pw").value="";
   amsg("Senha alterada com sucesso! Entre com a nova senha.","ok");
   toast("Senha alterada com sucesso!");
   setTimeout(function(){var p=$("pw");if(p)p.focus()},80);
  }catch(e){
   btn.classList.remove("loading");btn.removeAttribute("aria-busy");
   label.textContent="Salvar Nova Senha";
   btn.disabled=false;cancel.disabled=false;
   fail(resetPasswordError(errMsg(e)));
  }
 }
 form.addEventListener("submit",function(e){e.preventDefault();if(btn.disabled&&!er.textContent)fail("A senha ainda não atende a todos os requisitos abaixo.");save()});
 [np,np2].forEach(function(el){el.addEventListener("input",paint);el.addEventListener("keydown",function(e){
  if(e.key==="Enter"){e.preventDefault();save()}
 })});
 cancel.onclick=async function(){
  if(!resetOpen)return;
  resetOpen=false;recovering=false;markRecoveryFlow(false);clearRecoveryRequest();cleanAuthUrl();closeModal();
  try{await sb.auth.signOut()}catch(e2){}
  showAuth();authMode("login");
  toast("Recuperação cancelada. Peça um novo link quando quiser.");
 };
 paint();
 setTimeout(function(){if(np)np.focus()},50);
}
try{init()}catch(e){var bx=$("boot");if(bx){bx.hidden=false;bx.innerHTML="<b>Erro ao iniciar</b><br><small>"+esc(errMsg(e))+"</small>"}}
})();

/* ===== Tela de login: abas, olho da senha e efeito de erro ===== */
(function(){
  var $=function(i){return document.getElementById(i)};
  var form=$("authform"),tabs=$("auth-tabs");
  if(!form||!tabs||!$("namebox")||!$("pwbox")||!$("auth-sw"))return;

  var TXT={
    login:["Bem-vindo de volta","👋","Entre na sua agenda"],
    signup:["Crie sua conta","✨","Comece a organizar seus atendimentos"],
    forgot:["Recuperar senha","🔑","Enviaremos um link para o seu e-mail"]
  };
  var last="";

  /* descobre em que modo o app.js deixou o formulário */
  function current(){return !$("namebox").hidden?"signup":$("pwbox").hidden?"forgot":"login"}

  function sync(){
    var m=current();if(m===last)return;
    var first=!last;last=m;
    tabs.setAttribute("data-mode",m==="signup"?"signup":"login");
    $("tab-login").setAttribute("aria-selected",String(m!=="signup"));
    $("tab-signup").setAttribute("aria-selected",String(m==="signup"));
    var t=TXT[m],h=$("auth-head");
    $("auth-title").innerHTML=t[0]+' <span class="ap-wave">'+t[1]+'</span>';
    $("auth-sub").textContent=t[2];
    if(!first){h.classList.remove("swap");void h.offsetWidth;h.classList.add("swap")}
  }

  /* as abas apenas "clicam" no botão que o app.js já usa para trocar de modo */
  $("tab-login").onclick=function(){if(current()!=="login")$("auth-sw").click()};
  $("tab-signup").onclick=function(){
    var c=current();if(c==="signup")return;
    $("auth-sw").click();            /* login -> cadastro (ou recuperar -> login) */
    if(c==="forgot")$("auth-sw").click(); /* recuperar -> login -> cadastro */
  };

  new MutationObserver(sync).observe(form,{subtree:true,attributes:true,attributeFilter:["hidden"]});
  sync();

  /* olho para mostrar/ocultar a senha */
  var eye=$("pw-eye");
  if(eye)eye.onclick=function(){
    var i=$("pw"),show=i.type==="password";
    i.type=show?"text":"password";
    eye.setAttribute("aria-pressed",String(show));
    eye.setAttribute("aria-label",show?"Ocultar senha":"Mostrar senha");
  };

  /* o formulário balança quando aparece uma mensagem de erro */
  var msg=$("auth-msg");
  new MutationObserver(function(){
    if(!msg.hidden&&/\berr\b/.test(msg.className)){
      form.classList.remove("shake");void form.offsetWidth;form.classList.add("shake");
    }
  }).observe(msg,{attributes:true,childList:true,characterData:true,subtree:true});
})();
