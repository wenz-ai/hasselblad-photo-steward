'use strict';
const $=id=>document.getElementById(id);
let data, groups, groupIndex=0, other=1, page=0, view='picks', order='default', month='', locked=false, selection={};
const views={picks:'分享精选',compare:'相似对照',review:'淘汰候选',all:'全部照片',queue:'移除清单'};
const paths={picks:'m12 3 2.5 5.4 5.8.8-4.2 4.1 1 5.8-5.1-2.8-5.1 2.8 1-5.8-4.2-4.1 5.8-.8z',compare:'M3 5h8v14H3z M14 5h7v14h-7z',review:'M3 4h18v16H3z M3 16l5-5 4 3 3-3 6 6',all:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',queue:'M4 7h16 M8 7V4h8v3 M6 7l1 13h10l1-13 M10 10v7 M14 10v7'};
const icon=k=>'<svg aria-hidden="true" class="ico" viewBox="0 0 24 24"><path d="'+paths[k]+'"/></svg>';
const chosen=r=>data.picks[r.id]??Boolean(r.pick);
const isCandidate=r=>['相似备选','画质待核'].includes(r.reason);
const formats=r=>r.files.map(f=>f.rel.split('.').pop()).join(' + ');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(act,label,id='',cls='')=>'<button class="'+cls+'" data-act="'+act+'" data-id="'+esc(id)+'">'+label+'</button>';
const source=r=>'/p/'+encodeURIComponent(r.id);
let timer;
function message(s){clearTimeout(timer);$('toast').textContent=s;timer=setTimeout(()=>$('toast').textContent='',4300)}
function listState(){
  const removed=new Set(data.removed.map(x=>x[0]));
  const all=data.rows.filter(r=>!removed.has(r.id)), map=new Map();
  for(const r of all){if(!map.has(r.group))map.set(r.group,[]);map.get(r.group).push(r)}
  groups=[...map.values()].filter(g=>g.length>1).map(g=>g.sort((a,b)=>a.rank-b.rank));
  groups.sort((a,b)=>b[0].date.localeCompare(a[0].date));
  return {picks:all.filter(chosen),compare:groups,review:all.filter(r=>isCandidate(r)&&!chosen(r)),all,queue:all.filter(r=>data.queue[r.id])};
}
function reviewEvidence(r) {
  const related = r.comparison;
  const peer = related && data.rows.find(x => x.id === related.peer);
  const lines = [];
  if (r.note) lines.push(esc(r.note));
  if (peer) {
    lines.push('同组首选 ' + esc(peer.name) + '（' + peer.score + ' 分），拍摄相隔 ' + related.seconds + ' 秒。');
    const match = related.match;
    if (match?.method === 'features') lines.push('两张预览有 ' + match.inliers + ' 处细节能按同一位移或缩放对齐。');
    else if (match?.method === 'layout') lines.push('两张预览的明暗布局和色彩分布接近。');
    else if (!r.note) lines.push('与首选直接比对时未达到自动相似阈值，建议并排核对取景。');
    if (!r.note && r.reason === '相似备选' && peer.rating > r.rating)
      lines.push('首选的相机星级更高。');
  } else if (!r.note && r.reason === '画质待核') {
    if (r.clip > .54) lines.push('预览中接近纯黑或纯白的像素占 ' + (100*r.clip).toFixed(1) + '%。请核对是否刻意保留剪影或亮背景。');
    else lines.push('预览技术分低于复核线 50 分，可放大检查主体对焦及明暗。');
  }
  const why = lines.length ? '<div class="why">'+lines.map(x=>'<p>'+x+'</p>').join('')+'</div>' : '';
  if (!r.parts) return why;
  const signed = n => (n > 0 ? '+' : '') + n.toFixed(1);
  const values = ['基础 51','局部纹理 '+signed(r.parts[0]),'明暗层次 '+signed(r.parts[1]),'高低光截断 '+signed(r.parts[2])];
  return why + '<details class="breakdown"><summary>技术分怎么算</summary><p>'+values.join('　')+'。合计取整为 '+r.score+' 分（范围 12–98）。</p><p>取 36 个区域的纹理强度，背景边缘也会加分。亮度跨度最多加 8 分，近黑或近白像素合计超过 6% 才扣分。主体表情、构图和焦点位置另看。</p></details>';
}

function card(r,large=false){
  const q=Boolean(data.queue[r.id]),fav=chosen(r),good=r.reason==='组内优选';
  const label=q?'已列入移除':fav?'分享精选':r.reason;
  const compareLink=!large&&view!=='queue'&&groups.some(g=>g[0].group===r.group)?button('compareGroup','看同组',r.id):'';
  const actions=view==='queue'?button('unqueue','撤回移除',r.id,'selected'):
    button('pick',fav?'★ 已入选':'☆ 加入精选',r.id,fav?'':'primary')+
    button(q?'unqueue':'queue',q?'撤回移除':'待移除',r.id,q?'selected':'')+compareLink;
  return '<article class="frame"><button class="'+(large?'picture':'gridpic')+'" data-act="zoom" data-id="'+r.id+'" aria-label="放大 '+esc(r.name)+'"><img loading="lazy" src="'+source(r)+'" alt="'+esc(r.name)+'"><span class="badge '+((fav||good)&&!q?'good':'')+'">'+label+'</span></button><div class="caption"><div class="cardtop"><strong>'+esc(r.name)+'</strong><span class="score" title="基于预览的清晰度、明暗层次与高低光截断估算">'+r.score+'<small> 技术分</small></span></div><p>'+r.date.slice(0,16)+' · '+formats(r)+'</p>'+(large?'<p>'+esc(r.lens)+'　f/'+r.aperture+'　'+r.shutter+' s　ISO '+r.iso+'</p>':'')+reviewEvidence(r)+'<div class="actions">'+actions+'</div></div></article>';
}
function pager(index,len,prev,next,word){
  return '<div class="navcontrol">'+button(prev,'‹','','prev')+'<span>'+(index+1)+' / '+len+' '+word+'</span>'+button(next,'›','','next')+'</div>';
}
function render(){
 const sets=listState();
 $('total').innerHTML=data.rows.length+'<small>张照片</small>';
 $('nav').innerHTML=Object.entries(views).map(([k,label])=>'<button class="navbtn '+(k===view?'on':'')+'" data-act="view" data-id="'+k+'" '+(k===view?'aria-current="page"':'')+'>'+icon(k)+label+'<b>'+sets[k].length+'</b></button>').join('');
 const stage=$('stage');
 if(view==='compare' && groups.length){
   groupIndex=Math.min(groupIndex,groups.length-1);
   const g=groups[groupIndex];other=Math.max(1,Math.min(other,g.length-1));
   stage.innerHTML='<div class="heading"><h1>相似对照</h1>'+pager(groupIndex,groups.length,'gp','gn','组')+'</div><div class="subline"><span>'+g[0].date.slice(0,10)+'　同组 '+g.length+' 张</span><span>点击照片放大</span></div><div class="compare">'+card(g[0],true)+card(g[other],true)+'</div><div class="railtitle"><strong>本组底片</strong><span class="secondary">点缩略图切换右侧照片</span></div><div class="rail">'+g.map((r,i)=>'<button class="thumb '+(i===other?'on':'')+'" data-act="other" data-id="'+i+'"><img src="'+source(r)+'" alt=""><span>'+esc(r.name)+' '+(i===0?'· 首选':'')+'</span></button>').join('')+'</div><div class="toolbar"><label>跳到 <select id="groupSel">'+groups.map((v,i)=>'<option value="'+i+'" '+(i===groupIndex?'selected':'')+'>'+esc(v[0].name)+'　'+v[0].date.slice(0,10)+'　'+v.length+' 张</option>').join('')+'</select></label><span class="secondary">← → 切换组</span></div>';
   return;
 }
 let items=[...sets[view]];
 const months=[...new Set(items.map(r=>r.date.slice(0,7)))].sort().reverse();
 if(month&&!months.includes(month))month='';
 if(month)items=items.filter(r=>r.date.startsWith(month));
 const byDefault=(a,b)=>view==='review'?(Number(b.reason==='画质待核')-Number(a.reason==='画质待核')||a.score-b.score):view==='picks'?((a.pick??0)-(b.pick??0)):b.date.localeCompare(a.date);
 items.sort(order==='high'?(a,b)=>b.score-a.score:order==='low'?(a,b)=>a.score-b.score:order==='date'?(a,b)=>b.date.localeCompare(a.date):byDefault);
 const pages=Math.max(1,Math.ceil(items.length/18));page=Math.min(page,pages-1);
 const slice=items.slice(page*18,page*18+18);
 const batch=view==='review'&&slice.length?button('batch','将本页候选列入清单',slice.map(r=>r.id).join(','),'smallbtn'):'';
 const notes={picks:'在 Phocus Mobile 里按原文件名找图，加水印后导出。',review:'先看画质疑点，再按技术分从低到高复核相似备选。',all:'按拍摄日期或技术分浏览。',queue:'仅列出你标记的照片；请逐项核对同名的全部格式。',compare:'暂无可对照的照片。'};
 const filter='<select aria-label="拍摄月份" id="month"><option value="">全部月份</option>'+months.map(m=>'<option '+(m===month?'selected':'')+'>'+m+'</option>').join('')+'</select> <select aria-label="排序" id="sort">'+[['default','推荐顺序'],['date','最新拍摄'],['high','技术分从高到低'],['low','技术分从低到高']].map(([k,n])=>'<option value="'+k+'" '+(k===order?'selected':'')+'>'+n+'</option>').join('')+'</select>';
 stage.innerHTML='<div class="heading"><h1>'+views[view]+'</h1>'+(view==='queue'&&sets.queue.length?button('confirm','核对并移除 '+sets.queue.length+' 张','','danger smallbtn'):'')+'</div><div class="subline">'+notes[view]+'</div><div class="filterline">'+filter+batch+'<span class="secondary">'+items.length+' 张</span></div>'+(slice.length?'<div class="grid">'+slice.map(r=>card(r)).join('')+'</div>':'<p class="empty">'+(view==='queue'?'移除清单为空。': '当前没有照片。')+'</p>')+(pages>1?'<div class="foot"><span class="secondary">每页 18 张</span>'+pager(page,pages,'pp','pn','页')+'</div>':'');
}
async function post(url,body){
 const resp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':data.token},body:JSON.stringify(body)});
 const state=await resp.json();if(!resp.ok)throw new Error(state.error);Object.assign(data,state);
}
async function action(act,id){
 if(locked)return;
 const r=data.rows.find(v=>v.id===id);
 if(act==='zoom'){$('zoomImage').src=source(r);$('zoomImage').alt=r.name;$('zoomCaption').textContent=r.name+'　'+r.date+'　'+formats(r);$('zoom').showModal();return}
 if(act==='confirm'){
  selection={...data.queue};const rs=data.rows.filter(x=>selection[x.id]);const fs=rs.flatMap(x=>x.files);
  $('confirmText').textContent='将从来源文件夹移走 '+rs.length+' 张照片，共 '+fs.length+' 个原文件（'+(fs.reduce((s,f)=>s+f.size,0)/1e9).toFixed(2)+' GB）。下列同名格式会一起移入来源磁盘的废纸篓。\n\n'+rs.map(x=>x.name+'　'+formats(x)).join('\n');
  $('confirmDialog').showModal();return;
 }
 if(act==='compareGroup'){view='compare';groupIndex=groups.findIndex(g=>g[0].group===r.group);other=Math.max(1,groups[groupIndex].findIndex(x=>x.id===r.id))}
 else if(act==='view'){view=id;page=0;month='';order='default'}
 else if(act==='other'){other=Number(id)||1}
 else if(act==='gp'||act==='gn'){groupIndex=(groupIndex+(act==='gn'?1:-1)+groups.length)%groups.length;other=1}
 else if(act==='pp'||act==='pn'){page=Math.max(0,page+(act==='pn'?1:-1));window.scrollTo(0,0)}
 else{
   locked=true;document.body.classList.add('loading');
   try{
    if(act==='pick'){const on=!chosen(r);await post('/pick',{id,on});message(on?'已加入手机选片单':'已从手机选片单移出')}
    if(act==='batch'){await post('/queue',{ids:id.split(','),kind:'photo'});message('本页候选已列入清单，等待你确认')}
    if(act==='queue'||act==='unqueue'){await post('/queue',{ids:[id],kind:act==='queue'?'photo':null});message(act==='queue'?'已列入清单，等待你确认':'已撤回移除标记')}
    if(act==='finder')await post('/finder',{});
    if(act==='remove'){await post('/remove',{selection,confirm:'移入废纸篓'});message('所选原件已移入来源磁盘的废纸篓')}
   }catch(e){message(e.message)}finally{locked=false;document.body.classList.remove('loading')}
 }
 render();
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)action(b.dataset.act,b.dataset.id)});
document.addEventListener('change',e=>{if(e.target.id==='sort'){order=e.target.value;page=0}else if(e.target.id==='month'){month=e.target.value;page=0}else if(e.target.id==='groupSel'){groupIndex=+e.target.value;other=1}else return;render()});
document.addEventListener('keydown',e=>{if(view!=='compare'||document.querySelector('dialog[open]')||e.target.tagName==='SELECT')return;if(['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();action(e.key==='ArrowRight'?'gn':'gp')}});
$('finder').onclick=()=>action('finder');$('closeZoom').onclick=()=>$('zoom').close();
$('zoom').onclick=e=>{if(e.target===$('zoom'))$('zoom').close()};
$('cancel').onclick=()=>$('confirmDialog').close();
$('confirmRemove').onclick=()=>{$('confirmDialog').close();action('remove')};
fetch('/api').then(r=>r.json()).then(d=>{data=d;
 const id = new URLSearchParams(location.search).get('compare');
 if(id && d.rows.some(r=>r.id===id)){
   listState();
   const index=groups.findIndex(g=>g.some(r=>r.id===id));
   if(index>=0){view='compare';groupIndex=index;other=Math.max(1,groups[index].findIndex(r=>r.id===id))}
 }
 render()}).catch(()=>{$('stage').textContent='无法读取本机片库，请重新打开照片管家。'});
