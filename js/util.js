function fmtData(d) { if(!d) return '—'; const p=d.split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d }
function dataHoje() { return new Date().toISOString().split('T')[0] }
function getTema()  { return localStorage.getItem('@ZAPDISPARO:tema')||'dark' }
function aplicarTema(t) { document.documentElement.setAttribute('data-tema',t); localStorage.setItem('@ZAPDISPARO:tema',t) }
function aplicarTemaAtual() { aplicarTema(getTema()) }

function aviso(tipo, msg) {
  const ok  = document.getElementById('avisoOk')
  const err = document.getElementById('avisoErro')
  if (tipo==='ok') {
    if(err) err.style.display='none'
    if(ok)  { ok.textContent=msg; ok.style.display='block'; setTimeout(()=>ok.style.display='none',3500) }
  } else {
    if(ok)  ok.style.display='none'
    if(err) { err.textContent=msg; err.style.display='block'; setTimeout(()=>err.style.display='none',4500) }
  }
}

function confirmar(mensagem, callback, btnTexto) {
  const ex = document.getElementById('_cm'); if(ex) ex.remove()
  const ov = document.createElement('div')
  ov.id = '_cm'
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:99999;display:flex;align-items:center;justify-content:center'
  ov.innerHTML=`<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
    <div style="font-size:22px;margin-bottom:10px">⚠️</div>
    <div style="font-size:14px;font-weight:600;color:var(--fg);margin-bottom:22px;line-height:1.6">${mensagem}</div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="_cn" style="padding:9px 20px;border-radius:8px;border:1px solid var(--border);background:var(--card2);color:var(--muted);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Cancelar</button>
      <button id="_cs" style="padding:9px 20px;border-radius:8px;border:none;background:var(--red);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">${btnTexto||'Confirmar'}</button>
    </div></div>`
  document.body.appendChild(ov)
  document.getElementById('_cs').onclick=()=>{ov.remove();callback(true)}
  document.getElementById('_cn').onclick=()=>{ov.remove();callback(false)}
  ov.onclick=e=>{if(e.target===ov){ov.remove();callback(false)}}
}

function avisoModal(msg) {
  const ex=document.getElementById('_am');if(ex)ex.remove()
  const ov=document.createElement('div')
  ov.id='_am'
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center'
  ov.innerHTML=`<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
    <div style="font-size:14px;color:var(--fg);margin-bottom:18px;line-height:1.6">${msg}</div>
    <button id="_amok" style="width:100%;padding:10px;border-radius:8px;border:none;background:var(--primary);color:#000;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">OK</button>
  </div>`
  document.body.appendChild(ov)
  document.getElementById('_amok').onclick=()=>ov.remove()
}
