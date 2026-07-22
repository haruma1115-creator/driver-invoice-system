const WD = ['日','月','火','水','木','金','土'];

function isoDate(d){ return d.toISOString().slice(0,10); }
function addDays(dateStr, n){ const d=new Date(dateStr+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return isoDate(d); }
function dow(dateStr){ return new Date(dateStr+'T00:00:00Z').getUTCDay(); }
function fmt(dateStr){ const [y,m,d]=dateStr.split('-'); return `${parseInt(m)}/${parseInt(d)}`; }
function todayISO(){ return isoDate(new Date()); }

function statusSymbol(status){
  switch(status){
    case 'full': return '◯';
    case 'half_am': return 'C1';
    case 'half_pm': return 'C2';
    case 'off': return '×';
    default: return '-';
  }
}
function statusClass(status){
  return status || 'off';
}

async function apiGet(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error('GET failed: '+url);
  return res.json();
}
async function apiSend(url, method, body){
  const res = await fetch(url, {
    method, headers:{'Content-Type':'application/json'},
    body: body!==undefined ? JSON.stringify(body) : undefined
  });
  if(!res.ok) throw new Error(method+' failed: '+url);
  return res.json();
}
