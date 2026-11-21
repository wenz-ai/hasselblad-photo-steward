'use strict';
const $=id=>document.getElementById(id);
let data, groups, groupIndex=0, other=1, page=0, view='compare', order='default', month='', locked=false, selection={};
const views={compare:'相似选片',ai:'AI 选片',review:'淘汰候选',picks:'分享精选',all:'全部照片',queue:'移除清单'};
const paths={ai:'M4 4h16v16H4z M8 14l2-5 2 5 M9 12h2 M16 9v5',picks:'m12 3 2.5 5.4 5.8.8-4.2 4.1 1 5.8-5.1-2.8-5.1 2.8 1-5.8-4.2-4.1 5.8-.8z',compare:'M3 5h8v14H3z M14 5h7v14h-7z',review:'M3 4h18v16H3z M3 16l5-5 4 3 3-3 6 6',all:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',queue:'M4 7h16 M8 7V4h8v3 M6 7l1 13h10l1-13 M10 10v7 M14 10v7'};
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
  return {ai:all.filter(r=>data.ai?.[r.id]),picks:all.filter(chosen),compare:groups,review:all.filter(r=>isCandidate(r)&&!chosen(r)),all,queue:all.filter(r=>data.queue[r.id])};
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

function card(r, role=''){
 const id=esc(r.id), name=esc(r.name), queued=Boolean(data.queue[r.id]), picked=chosen(r);
 const ai=data.ai?.[r.id];
 const status=queued?'待移除':picked?'已入选':ai?'AI '+ai.decision:r.reason;
 const score=ai?ai.score:r.score, scoreType=ai?'AI 分享分':'技术分';
 const peer=r.comparison&&byId(r.comparison.peer);
 const note=ai?.reason||r.note||(isCandidate(r)?(peer?'同组首选 '+peer.name+'，相隔 '+r.comparison.seconds+' 秒。':'请放大核对画质。'):'');
 const compareLink=!role&&view!=='queue'&&groups.some(g=>g[0].group===r.group)?button('compareGroup','看同组',r.id):'';
 const pick=!role&&view!=='queue'?button('pick',picked?'★ 已入选':'☆ 入选',r.id):'';
 return '<article class="frame">'+(role?'<div class="side-label">'+role+'<span>'+esc(status)+'</span></div>':'')+
 '<button class="'+(role?'picture':'gridpic')+'" data-act="zoom" data-id="'+id+'" aria-label="放大 '+name+'"><img loading="'+(role?'eager':'lazy')+'" src="'+source(r)+'" alt="'+name+'"></button>'+
 '<div class="caption"><div class="cardtop"><strong>'+name+'</strong><span class="score">'+score+' <small>'+scoreType+'</small></span></div>'+
 '<p class="meta">'+(role?r.date.slice(11)+'　'+esc(r.lens)+'　f/'+r.aperture+'　'+r.shutter+' s':r.date.slice(0,10)+'　'+formats(r)+'　'+esc(status))+'</p>'+
 (!role&&note?'<p class="brief">'+esc(note)+'</p>':'')+
 (role?'':'<details class="inline-review" data-photo="'+id+'"><summary>查看评片卡</summary>'+scorecard(r)+(!Number.isFinite(ai?.exposure)?button('aiOne','AI 看这张',r.id,'one-review'):'')+'</details><div class="actions">'+compareLink+pick+button(queued?'unqueue':'queue',queued?'撤回移除':'待移除',r.id,queued?'marked':'quiet')+'</div>')+'</div></article>';
}
function pager(index,len,prev,next,word){
 return '<div class="navcontrol"><button aria-label="上一'+word+'" data-act="'+prev+'">‹</button><span>'+(index+1)+' / '+len+' '+word+'</span><button aria-label="下一'+word+'" data-act="'+next+'">›</button></div>';
}
let anchorId='', detailZoom=false;
function anchorIndex(g){return Math.max(0,g.findIndex(r=>r.id===anchorId))}
function enterGroup(index, target=''){
 groupIndex=index;const g=groups[index];anchorId=(g.find(chosen)||g[0]).id;
 const requested=g.findIndex(r=>r.id===target&&r.id!==anchorId);
 other=requested>=0?requested:g.findIndex(r=>r.id!==anchorId);
 detailZoom=false;view='compare';
}
function captureOrder(g){
 return g.map((r,i)=>i).sort((a,b)=>g[a].date.localeCompare(g[b].date)||g[a].name.localeCompare(g[b].name));
}
function stepFrame(delta){
 const g=groups[groupIndex], candidates=captureOrder(g).filter(i=>g[i].id!==anchorId);
 other=candidates[(candidates.indexOf(other)+delta+candidates.length)%candidates.length];
}
function compareView(g){
 const base=anchorIndex(g);anchorId=g[base].id;
 if(!g[other]||other===base)other=g.findIndex(r=>r.id!==anchorId);
 const selected=g.filter(chosen);
 const toolbar='<div class="compare-tools"><label class="group-menu"><span>'+g[0].date.slice(0,10)+'　/　'+g.length+' 张</span><select aria-label="跳到相似组" id="groupSel">'+groups.map((v,i)=>'<option value="'+i+'" '+(i===groupIndex?'selected':'')+'>'+esc(v[0].name)+'　'+v[0].date.slice(0,10)+'　'+v.length+' 张</option>').join('')+'</select></label><div>'+button('aiPair',aiBusy?'评审进行中':'AI 看这两张')+button('swap','右图设为参照')+button('detail',detailZoom?'回到全图':'同步放大 2×')+'</div></div>';
 const strip=captureOrder(g).map(i=>{const r=g[i];return '<button class="thumb '+(i===other?'on':i===base?'anchor':'')+'" data-act="other" data-id="'+i+'" '+(i===base?'disabled':'')+' aria-label="'+esc(r.name)+(i===base?'，参照':'，切换对照')+'"><img src="'+source(r)+'" alt=""><span>'+esc(r.name)+(i===base?' · 参照':chosen(r)?' ★':'')+'</span></button>'}).join('');
 $('sideStrip').innerHTML='<div class="strip-title">本组底片 <span>'+g.length+'</span></div><div class="side-film">'+strip+'</div>';
 return '<div class="heading"><h1>相似选片</h1>'+pager(groupIndex,groups.length,'gp','gn','组')+'</div>'+toolbar+(aiProgress?'<p class="pair-progress" role="status">'+esc(aiProgress)+'</p>':'')+
 '<div class="compare '+(detailZoom?'magnified':'')+'">'+card(g[base],'参照')+card(g[other],'对照')+'</div>'+
 '<div class="decision"><div><strong>本组分享精选</strong><p>'+ (selected.length?selected.map(r=>esc(r.name)).join('、'):'尚未入选')+'</p></div><div class="decision-buttons">'+button('selectLeft','只选左图','',selected.length===1&&chosen(g[base])?'choice-on':'')+button('selectBoth','两张都选','',selected.length===2&&chosen(g[base])&&chosen(g[other])?'choice-on':'')+button('selectRight','只选右图','',selected.length===1&&chosen(g[other])?'choice-on':'')+'</div></div>'+
 '<div class="scorepair">'+[g[base],g[other]].map(r=>'<div><div class="rating-for"><strong>评片卡</strong><span>'+esc(r.name)+'</span></div>'+scorecard(r)+'</div>').join('')+'</div>'+
 '<div class="railtitle mobile-strip"><b>本组底片</b><span>← → 换片　⇧ ← → 换组</span></div><div class="rail mobile-strip">'+strip+'</div>'+
 '<div class="toolbar">'+button('aiGroup','用 AI 复核本组',g[base].id,'smallbtn')+'</div>';
}
function studioPreview(sets){
 const days=new Set(), covers=[];
 // Use real groups with distinct shooting dates to offer several starting points.
 for(const group of groups){
  const r=group[0], day=r.date.slice(0,10);
  if(days.has(day)||group.every(x=>data.ai?.[x.id]))continue;
  days.add(day);covers.push(group);if(covers.length===3)break;
 }
 if(!covers.length)return '<p class="empty">'+(sets.all.length?'可从本地照片开始评审。':'当前没有照片。')+'</p>';
 return '<section class="contact"><div class="railtitle"><h2>待评相似组</h2><span>打开一组，对照看图</span></div><div class="covers">'+covers.map(g=>{
  const r=g[0];return '<button data-act="compareGroup" data-id="'+esc(r.id)+'"><span class="coverpic"><img src="'+source(r)+'" alt="'+esc(r.name)+'"></span><span class="covercaption"><b>'+r.date.slice(0,10)+'</b><small>'+g.length+' 张　↗</small></span></button>';
 }).join('')+'</div></section>';
}
function render(){
 const sets=listState();
 $('total').innerHTML=sets.all.length+' 张照片';
 $('nav').innerHTML=Object.entries(views).map(([k,label])=>'<button class="navbtn '+(k===view?'on':'')+'" data-act="view" data-id="'+k+'" '+(k===view?'aria-current="page"':'')+'>'+icon(k)+label+'<b>'+sets[k].length+'</b></button>').join('');
 const stage=$('stage');$('sideStrip').replaceChildren();
 if(view==='compare' && groups.length){
   groupIndex=Math.min(groupIndex,groups.length-1);
   stage.innerHTML=compareView(groups[groupIndex]);
   const strip=$('sideStrip'), active=strip.querySelector('.thumb.on');
   if(active && strip.clientHeight){
    const offset=active.getBoundingClientRect().bottom-strip.getBoundingClientRect().bottom;
    if(offset>0)strip.scrollTop+=offset+4;
   }
   return;
 }
 let items=[...sets[view]];
 if(view==='ai' && aiFilter)items=items.filter(r=>data.ai[r.id].decision===aiFilter);
 const months=[...new Set(items.map(r=>r.date.slice(0,7)))].sort().reverse();
 if(month&&!months.includes(month))month='';
 if(month)items=items.filter(r=>r.date.startsWith(month));
 const byDefault=(a,b)=>view==='ai'?data.ai[b.id].score-data.ai[a.id].score:view==='review'?(Number(b.reason==='画质待核')-Number(a.reason==='画质待核')||a.score-b.score):view==='picks'?((a.pick??0)-(b.pick??0)):b.date.localeCompare(a.date);
 items.sort(order==='high'?(a,b)=>b.score-a.score:order==='low'?(a,b)=>a.score-b.score:order==='date'?(a,b)=>b.date.localeCompare(a.date):byDefault);
 const pages=Math.max(1,Math.ceil(items.length/18));page=Math.min(page,pages-1);
 const slice=items.slice(page*18,page*18+18);
 const batch=view==='review'&&slice.length?button('batch','将本页候选列入清单',slice.map(r=>r.id).join(','),'smallbtn'):'';
 const notes={ai:'',picks:'',review:'先复核画质，再比较同组备选。',all:'',queue:'确认后，同名格式会一起移入废纸篓。',compare:'暂无可对照的照片。'};
 if(view==='ai'&&!sets.ai.length){
  stage.innerHTML='<div class="heading"><h1>AI 选片</h1></div>'+aiControls()+studioPreview(sets);return;
 }
 const filter='<select aria-label="拍摄月份" id="month"><option value="">全部月份</option>'+months.map(m=>'<option '+(m===month?'selected':'')+'>'+m+'</option>').join('')+'</select> <select aria-label="排序" id="sort">'+[['default','推荐顺序'],['date','最新拍摄'],['high','技术分从高到低'],['low','技术分从低到高']].map(([k,n])=>'<option value="'+k+'" '+(k===order?'selected':'')+'>'+n+'</option>').join('')+'</select>';
 stage.innerHTML='<div class="heading"><h1>'+views[view]+'</h1>'+(view==='queue'&&sets.queue.length?button('confirm','核对并移除 '+sets.queue.length+' 张','','danger smallbtn'):'')+'</div><div class="subline">'+notes[view]+'</div>'+(view==='ai'?aiControls():'')+'<div class="filterline">'+(view==='ai'?'<select id="aiFilter" aria-label="AI 建议"><option value="">全部建议</option>'+aiLabels.map(k=>'<option '+(k===aiFilter?'selected':'')+'>'+k+'</option>').join('')+'</select>':'')+filter+batch+'<span class="secondary">'+items.length+' 张</span></div>'+(slice.length?'<div class="grid">'+slice.map(r=>card(r)).join('')+'</div>':'<p class="empty">'+(view==='queue'?'移除清单为空。': '当前没有照片。')+'</p>')+(pages>1?'<div class="foot"><span class="secondary">每页 18 张</span>'+pager(page,pages,'pp','pn','页')+'</div>':'');
}
async function post(url,body){
 const resp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':data.token},body:JSON.stringify(body)});
 const state=await resp.json();if(!resp.ok)throw new Error(state.error);Object.assign(data,state);
}
async function action(act,id){
 if(locked)return;
 if(act==='aiOne')return prepareAI('one',id);
 if(act==='aiPair')return prepareAI('pair');
 if(act==='aiTrial'||act==='aiAll'||act==='aiGroup')return prepareAI({aiTrial:'trial',aiAll:'all',aiGroup:'group'}[act],id);
 if(act==='aiStop'){stopAI=true;aiProgress='本批结束后暂停';render();return}
 const r=data.rows.find(v=>v.id===id);

 if(act==='zoom'&&detailZoom&&view==='compare'){return}
 if(act==='zoom'){$('zoomImage').src=source(r);$('zoomImage').alt=r.name;$('zoomCaption').textContent=r.name+'　'+r.date+'　'+formats(r);$('zoom').showModal();return}
 if(act==='confirm'){
  selection={...data.queue};const rs=data.rows.filter(x=>selection[x.id]);const fs=rs.flatMap(x=>x.files);
  $('confirmText').textContent='将从来源文件夹移走 '+rs.length+' 张照片，共 '+fs.length+' 个原文件（'+(fs.reduce((s,f)=>s+f.size,0)/1e9).toFixed(2)+' GB）。下列同名格式会一起移入来源磁盘的废纸篓。\n\n'+rs.map(x=>x.name+'　'+formats(x)).join('\n');
  $('confirmDialog').showModal();return;
 }
 if(act==='compareGroup'){enterGroup(groups.findIndex(g=>g[0].group===r.group),id)}
 else if(act==='view'){setMenu(false);view=id;page=0;month='';order='default'}
 else if(act==='other'){other=Number(id)}
 else if(act==='stepBack'||act==='stepNext'){stepFrame(act==='stepNext'?1:-1)}
 else if(act==='swap'){const g=groups[groupIndex];const old=anchorIndex(g);anchorId=g[other].id;other=old}
 else if(act==='detail'){detailZoom=!detailZoom}
 else if(act==='gp'||act==='gn'){enterGroup((groupIndex+(act==='gn'?1:-1)+groups.length)%groups.length)}
 else if(act==='pp'||act==='pn'){page=Math.max(0,page+(act==='pn'?1:-1));window.scrollTo(0,0)}
 else{
   locked=true;document.body.classList.add('loading');
   try{
    if(['selectLeft','selectRight','selectBoth'].includes(act)){
     const g=groups[groupIndex], left=g[anchorIndex(g)].id, right=g[other].id;
     const ids=act==='selectBoth'?[left,right]:[act==='selectLeft'?left:right];
     await post('/group-picks',{group:g[0].group,selected:ids,expected:g.filter(chosen).map(x=>x.id)});
     message('已更新本组分享精选，共 '+ids.length+' 张');
    }
    if(act==='pick'){const on=!chosen(r);await post('/pick',{id,on});message(on?'已加入手机选片单':'已从手机选片单移出')}
    if(act==='batch'){await post('/queue',{ids:id.split(','),kind:'photo'});message('本页候选已列入清单，等待你确认')}
    if(act==='queue'||act==='unqueue'){await post('/queue',{ids:[id],kind:act==='queue'?'photo':null});message(act==='queue'?'已列入清单，等待你确认':'已撤回移除标记')}
    if(act==='exportAI')await post('/ai/export',{});
    if(act==='finder')await post('/finder',{});
    if(act==='remove'){await post('/remove',{selection,confirm:'移入废纸篓'});message('所选原件已移入来源磁盘的废纸篓')}
   }catch(e){message(e.message)}finally{locked=false;document.body.classList.remove('loading')}
 }
 render();
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)action(b.dataset.act,b.dataset.id)});
document.addEventListener('change',e=>{if(e.target.id==='aiFilter'){aiFilter=e.target.value;page=0}else if(e.target.id==='sort'){order=e.target.value;page=0}else if(e.target.id==='month'){month=e.target.value;page=0}else if(e.target.id==='groupSel'){enterGroup(+e.target.value)}else return;render()});
document.addEventListener('keydown',e=>{if(view!=='compare'||document.querySelector('dialog[open]')||e.target.tagName==='SELECT')return;if(['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();action(e.shiftKey?(e.key==='ArrowRight'?'gn':'gp'):(e.key==='ArrowRight'?'stepNext':'stepBack'))}});
$('finder').onclick=()=>action('finder');$('closeZoom').onclick=()=>$('zoom').close();
$('zoom').onclick=e=>{if(e.target===$('zoom'))$('zoom').close()};
$('cancel').onclick=()=>$('confirmDialog').close();
$('confirmRemove').onclick=()=>{$('confirmDialog').close();action('remove')};
const byId=id=>data.rows.find(x=>x.id===id);
function auditCopy(value){
 return '<pre class="audit-copy">'+esc(value)+'</pre>';
}
function policyDescription(plan){
 const groupNames=plan.jobs.map((ids,i)=>(i+1)+'. '+ids.map(k=>byId(k)?.name||k).join('、')).join('\n');
 return '<p>策略 v'+esc(plan.policy)+'，按拍摄组和时间分批，每批最多 6 张。模型只能比较同批预览。</p>'+auditCopy(plan.prompt)+
 '<details><summary>查看 '+plan.jobs.length+' 批照片的文件名</summary>'+auditCopy(groupNames)+'</details>';
}
const dimensions=[['exposure','曝光'],['focus','对焦'],['composition','构图'],['aesthetics','审美']];
const zones=['左上','上方中央','右上','左侧','中央','右侧','左下','下方中央','右下'];
function localReading(r, key){
 const m=r.meter;
 if(key==='exposure'){
  if(!m)return '预览的明暗跨度为 '+r.spread+' / 255。';
  const tone=m.mid<65?'画面以暗调为主':m.mid>173?'画面以亮调为主':'画面以中间调为主';
  return tone+'。'+(m.bright>.08?'有大片接近纯白，建议检查亮部细节。':m.dark>.18?'暗处较多，建议看主体是否还有轮廓。':r.spread<75?'大部分像素亮度接近，明暗反差较低。':'亮暗之间有层次，需结合主体判断曝光。');
 }
 if(key==='focus')return '预览'+(m?'的'+zones[m.textureZone]+'纹理最明显':'只有全图边缘测量')+'；主体是否合焦需放大看。';
 if(key==='composition')return (m?m.shape+'取景。':'')+'主体位置、遮挡与边缘干扰等待看图判断。';
 return m?(m.saturation<38?'色彩偏淡。':m.saturation>102?'色彩较浓。':'色彩浓淡适中。')+'氛围和瞬间尚未评审。':'氛围与瞬间尚未评审。';
}
function scorecard(r){
 const ai=data.ai?.[r.id], ed=r.editorial, detailed=ai && Number.isFinite(ai.exposure);
 const rel=ai?.peer?byId(ai.peer):r.comparison&&byId(r.comparison.peer);
 const weak=!ai&&r.reason==='相似备选'&&r.comparison&&!r.comparison.match&&!ed&&!r.note;
 const verdict=ai?.decision||(weak?'需并排复核':{'组内优选':'优先保留','相似备选':'可作备选','画质待核':'需复核','独立画面':'暂留'}[r.reason]||'待评');
 const basis=ai?'AI 看图':ed?'看图复核':'本地测量';
 const reason=(ai?.decision_note ? ai.decision_note+' '+ai.reason : ai?.reason)||ed?.reason||r.note||(weak?'同组里有相近取景，但与首选直接比对的证据不足，暂留这张。':rel?'与 '+rel.name+' 拍摄接近，组内已有优先保留的版本。':r.reason==='画质待核'?'本地测量提示可能有画质问题，请先确认主体和拍摄意图。':r.reason==='组内优选'?'按相机星级和预览表现排在本组前列，先作为对照。':'本地尚未发现更接近的替代画面。');
 const rows=dimensions.map(([key,label])=>{
  const legacy=ai && (key==='composition'?ai.composition_reason:key==='aesthetics'?ai.moment_reason:null);
  const description=(detailed&&ai[key+'_reason'])||legacy||ed?.[key]||localReading(r,key);
  return '<div class="rating-row"><dt>'+label+'</dt><dd>'+esc(description)+'</dd>'+(detailed?'<span>'+ai[key]+'<small>/25</small></span>':'')+'</div>';
 }).join('');
 const edit=ai?.edit_priority||ed?.edit_priority||'看原片再定';
 const recovery=ai?.recovery_reason||ed?.recovery_reason||(r.clip>.18?'预览中有大面积高光或暗部接近截断；可先用 RAW 试拉曝光，看主体细节能否回来。':'可从原片检查亮暗余量与主体细节，预览无法确定修复上限。');
 const crop=ai?.crop_reason||ed?.crop_reason||'尚未评估裁切；先看主体边缘是否完整。';
 const priority=ai?.edit_reason||ed?.edit_reason||(rel?'先比较 '+rel.name+'；另一张若已满足用途，可省下修这张的时间。':'先确定这张是否值得分享，再决定投入。');
 const rec=ai?.recovery||ed?.recovery||'需查原片', cropLabel=ai?.crop||ed?.crop||'待核对';
 const source=ai?'AI 分享分':'本地技术分';
 const tone=verdict==='疑似废片'?'risk':['精选','保留','优先保留'].includes(verdict)?'keep':'review';
 return '<section class="rating-card" data-tone="'+tone+'"><div class="rating-heading"><div><small>'+basis+'</small><div class="decision-line"><h3>'+esc(verdict)+'</h3><span>'+esc(edit)+'</span></div></div><div class="rating-number">'+(ai?.score??r.score)+'<small>'+source+'</small></div></div><p class="rationale">'+esc(reason)+'</p>'+
 (rel?'<p class="peerline">同组对照　'+esc(rel.name)+'</p>':'')+
 '<dl class="ratings">'+rows+'</dl><div class="repair"><div><b>后期取舍</b><strong>'+esc(edit)+'</strong></div><p>'+esc(priority)+'</p><dl><dt>修复</dt><dd><b>'+esc(rec)+'</b>　'+esc(recovery)+'</dd><dt>裁切</dt><dd><b>'+esc(cropLabel)+'</b>　'+esc(crop)+'</dd></dl></div>'+
 (ai?.uncertainty?'<p class="limit">判断限制　'+esc(ai.uncertainty)+'</p>':'')+
 (ai?.alternative?'<details class="subrecord"><summary>另一种取舍</summary><p>'+esc(ai.alternative)+'</p></details>':'')+
 (ai&&!detailed?'<details class="subrecord"><summary>原版 AI 评分</summary><p>主体与瞬间 '+ai.moment+'/40，构图 '+ai.composition+'/30，可见技术表现 '+ai.quality+'/30。'+esc(ai.quality_reason||'')+'</p></details>':'')+
 '<details class="subrecord"><summary>技术分与初筛依据</summary>'+reviewEvidence(r)+'</details>'+
 (ai?.signature?'<details class="subrecord audit-record" data-id="'+esc(r.id)+'"><summary>当次 AI 评审记录</summary><div class="audit-body"></div></details>':'')+'</section>';
}
async function loadAudit(details){
 if(!details.open||details.dataset.loaded)return;
 const r=byId(details.dataset.id), ai=data.ai?.[r.id], body=details.querySelector('.audit-body');
 details.dataset.loaded='loading';body.textContent='读取本机记录…';
 try{
  const audit=await aiRequest('audit',{signature:ai.signature});
  const idx=audit.attachments.findIndex(x=>x.id===r.id);
  body.innerHTML='<p>'+esc(audit.model)+' · 策略 v'+esc(audit.policy)+' · '+esc(new Date(audit.time).toLocaleString())+'</p>'+
  '<p>送评顺序　'+audit.attachments.map(x=>esc(byId(x.id)?.name||x.id)).join('、')+'</p>'+
  '<details><summary>当次提示词</summary>'+auditCopy(audit.prompt)+'</details><details><summary>原始评语与预览指纹</summary>'+auditCopy(JSON.stringify({photo:audit.raw.photos.find(x=>x.index===idx+1),attachment:audit.attachments[idx]},null,2))+'</details>';
  details.dataset.loaded='yes';
 }catch(e){body.textContent=e.message;delete details.dataset.loaded}
}
document.addEventListener('toggle',e=>{if(e.target.matches?.('.audit-record'))loadAudit(e.target)},true);

let aiMode='subscription', aiFilter='', aiPlan=null, aiBusy=false, stopAI=false, aiProgress='';
const aiLabels=['精选','保留','相似备选','疑似废片','需复核'];
function aiControls(){
 return '<section class="aitools"><div><p>比较构图、瞬间与清晰度，为每张照片留下取舍理由。</p><small>'+ (aiMode==='subscription'?'ChatGPT 订阅':'API Key · 按量计费')+'</small></div><div class="actions">'+
 (aiBusy?button('aiStop','本批结束后暂停'):button('aiTrial','先试一组','','primary')+button('aiAll','评审整库'))+
 (Object.values(data.ai||{}).some(x=>x.decision==='精选')?button('exportAI','导出 AI 精选单'):'')+'</div>'+
 (aiProgress?'<p class="progress" role="status">'+esc(aiProgress)+'</p>':'')+'</section>';
}
async function aiRequest(route,body){
 const res=await fetch('/ai/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':data.token},body:JSON.stringify(body)});
 const payload=await res.json();if(!res.ok)throw new Error(payload.error);return payload;
}
async function prepareAI(scope,id){
 if(aiBusy)return;
 try{
   const g=groups[groupIndex];
   const pair=scope==='pair'?[g[anchorIndex(g)].id,g[other].id]:undefined;
   const plan=await aiRequest('plan',{mode:aiMode,scope,id,pair});plan.scope=scope;plan.originId=id;
   const total=plan.jobs.flat().length;
   if(!total){message('当前没有可评审的照片');return}
   aiPlan=plan;
   $('aiPolicy').innerHTML=policyDescription(plan);
   $('aiDescription').textContent='本次 '+total+' 张，分 '+plan.jobs.length+' 批，已有 '+plan.cached+' 批可从本机复用。需要新评的照片会以最长边 1200 像素的预览图发送给 OpenAI。\n\n'+(plan.mode==='subscription'?'使用当前 ChatGPT 订阅的 Codex 额度。':'使用当前登录的 API Key，按 API 用量计费。')+' 结果只写入 AI 评审栏；星标和移除由你决定。';
   $('aiConsent').showModal();
 }catch(e){aiProgress=e.message;message(e.message);render()}
}
async function runAI(){
 $('aiConsent').close();if(aiBusy||!aiPlan)return;
 const plan=aiPlan;aiPlan=null;aiBusy=true;stopAI=false;if(!['pair','group','one'].includes(plan.scope)){view='ai';page=0;month='';order='default';}
 let completed=0;
 try{
   for(const ids of plan.jobs){
     if(stopAI)break;
     aiProgress='正在评审第 '+(completed+1)+' / '+plan.jobs.length+' 批';render();
     const response=await aiRequest('batch',{ids,mode:plan.mode});
     Object.assign(data.ai,response.ai);completed++;
   }
   aiProgress='已完成 '+completed+' / '+plan.jobs.length+' 批。'+(stopAI?'再次运行可复用已有结果。':'');
 }catch(e){aiProgress='已完成 '+completed+' 批。'+e.message}
 finally{aiBusy=false;render();if(plan.scope==='one'){
  const panel=[...document.querySelectorAll('.inline-review')].find(x=>x.dataset.photo===plan.originId);
  if(panel)panel.open=true;
 }if(['pair','group','one'].includes(plan.scope))message(aiProgress)}
}
$('aiCancel').onclick=()=>$('aiConsent').close();
$('aiBegin').onclick=runAI;

fetch('/api').then(r=>r.json()).then(d=>{data=d;aiMode=d.aiMode||'subscription';
 const id = new URLSearchParams(location.search).get('compare');
 if(id && d.rows.some(r=>r.id===id)){
   listState();
   const index=groups.findIndex(g=>g.some(r=>r.id===id));
   if(index>=0)enterGroup(index,id)
 }
 if(!id && !listState().compare.length)view='all';
 const requested=new URLSearchParams(location.search).get('view');if(Object.hasOwn(views,requested))view=requested;
 render()}).catch(()=>{$('stage').textContent='无法读取本机片库，请重新打开照片管家。'});

$('settings').onclick=()=>{if(!data)return;$('aiMode').value=aiMode;$('preferences').showModal()};
$('cancelPref').onclick=()=>$('preferences').close();
$('prefForm').onsubmit=async e=>{
 e.preventDefault();
 try{await post('/preferences',{mode:$('aiMode').value});aiMode=data.aiMode;$('preferences').close();render();message('已保存本机设置')}
 catch(error){message(error.message)}
};
function moveLoupe(event){
 const target=event.target.closest('.magnified .picture');
 if(!target)return;
 const rect=target.getBoundingClientRect();
 const x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
 const y=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
 for(const img of document.querySelectorAll('.magnified .picture img'))img.style.transformOrigin=(x*100)+'% '+(y*100)+'%';
}
document.addEventListener('pointermove',moveLoupe);
document.addEventListener('pointerdown',moveLoupe);

function setMenu(open){
 document.querySelector('.studio-side').classList.toggle('expanded',open);
 $('menuToggle').setAttribute('aria-expanded',String(open));
 $('menuToggle').textContent=open?'收起 ▴':'导航 ▾';
}
$('menuToggle').onclick=()=>setMenu($('menuToggle').getAttribute('aria-expanded')!=='true');
