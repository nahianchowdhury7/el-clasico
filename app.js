// ============================================================
// SUPABASE CONFIG
// ============================================================
const SUPABASE_URL = 'https://ndzhkclijmnjqslkupdj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kemhrY2xpam1uanFzbGt1cGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1ODMzMzYsImV4cCI6MjA5MzE1OTMzNn0.q8y2X7IIuGa0vAzGdJg_Mp8JiYGRcCycR8ot8jNQYak';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// STATE
// ============================================================
let currentUser = null;
let currentProfile = null;
let adminRole = null; // 'manager' | 'superadmin' | null
let basePrices = {night:2500, early:1500, day:1200, eve:1800};
let priceOverrides = [];
let blockedSlots = {}; // {date: [time, ...]}
let selDur = 60, mgrDur = 60;
let isDark = true;
let calYear, calMonth;
let revFilter = 'week';
let selStars = 5;
const today = new Date().toISOString().slice(0,10);
const now2 = new Date();
calYear = now2.getFullYear();
calMonth = now2.getMonth();

// ============================================================
// AUTH
// ============================================================
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await handleSession(session);
  sb.auth.onAuthStateChange(async (_ev, session) => {
    if (session) await handleSession(session);
    else { currentUser = null; currentProfile = null; adminRole = null; updateNavAuth(); }
  });
}

async function handleSession(session) {
  currentUser = session.user;
  const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = data;
  const { data: adm } = await sb.from('admins').select('role').eq('id', currentUser.id).single();
  adminRole = adm ? adm.role : null;
  updateNavAuth();
}

function updateNavAuth() {
  const area = document.getElementById('nav-auth-area');
  if (currentUser) {
    const name = currentProfile?.name || currentUser.email.split('@')[0];
    area.innerHTML = `<div class="user-chip" onclick="handleLogout()"><span>👤 ${name}</span></div>`;
    document.getElementById('book-login-notice').style.display = 'none';
  } else {
    area.innerHTML = `<button class="nb" onclick="openAuthModal()">Login</button>`;
    document.getElementById('book-login-notice').style.display = 'block';
  }
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-pw').value;
  if (!email || !pw) { showAuthErr('Email ও password দিন'); return; }
  const btn = document.getElementById('login-btn');
  btn.innerHTML = '<span class="spin"></span>Logging in...'; btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  btn.innerHTML = 'Login'; btn.disabled = false;
  if (error) showAuthErr(error.message);
  else { closeAuthModal(); }
}

async function doSignup() {
  const name = document.getElementById('signup-name').value.trim();
  const phone = document.getElementById('signup-phone').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pw = document.getElementById('signup-pw').value;
  if (!name || !email || !pw) { showAuthErr('সব field পূরণ করুন'); return; }
  const btn = document.getElementById('signup-btn');
  btn.innerHTML = '<span class="spin"></span>Creating...'; btn.disabled = true;
  const { data, error } = await sb.auth.signUp({ email, password: pw });
  if (error) { btn.innerHTML = 'Create Account'; btn.disabled = false; showAuthErr(error.message); return; }
  if (data.user) {
    await sb.from('profiles').upsert({ id: data.user.id, name, phone });
  }
  btn.innerHTML = 'Create Account'; btn.disabled = false;
  showAuthSuccess('Account তৈরি হয়েছে! Email confirm করুন যদি লাগে।');
}

async function handleLogout() {
  await sb.auth.signOut();
  adminRole = null;
}

function openAuthModal() { document.getElementById('auth-modal').classList.add('open'); }
function closeAuthModal() { document.getElementById('auth-modal').classList.remove('open'); }
function switchAuthTab(tab) {
  document.getElementById('auth-login-form').style.display = tab==='login' ? 'block' : 'none';
  document.getElementById('auth-signup-form').style.display = tab==='signup' ? 'block' : 'none';
  document.getElementById('tab-login').classList.toggle('on', tab==='login');
  document.getElementById('tab-signup').classList.toggle('on', tab==='signup');
  hideAuthMessages();
}
function showAuthErr(msg) { const e=document.getElementById('auth-err'); e.textContent=msg; e.style.display='block'; document.getElementById('auth-success').style.display='none'; }
function showAuthSuccess(msg) { const e=document.getElementById('auth-success'); e.textContent=msg; e.style.display='block'; document.getElementById('auth-err').style.display='none'; }
function hideAuthMessages() { document.getElementById('auth-err').style.display='none'; document.getElementById('auth-success').style.display='none'; }

// ============================================================
// BOOKING ENGINE
// ============================================================
const allSlots = ['00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'];

function toMin(t){const p=String(t).split(':');return(parseInt(p[0])||0)*60+(parseInt(p[1])||0);}
function fromMin(m){m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
function fmtTime(t){const m=toMin(t),h=Math.floor(m/60),mm=m%60,ap=h>=12&&h<24?'PM':'AM',h12=h%12===0?12:h%12;return(mm===0?h12:h12+':'+String(mm).padStart(2,'0'))+' '+ap;}
function rangesOverlap(aS,aE,bS,bE){return aS<bE&&aE>bS;}
function getTimeRate(t){const h=parseInt(t);if(h>=18||h<6)return basePrices.night;if(h>=6&&h<9)return basePrices.early;if(h>=9&&h<15)return basePrices.day;return basePrices.eve;}
function calcAmt(t,dur){const ov=priceOverrides.find(o=>o.time===t&&o.dur===dur);return ov?ov.price:Math.round(getTimeRate(t)*(dur/60));}
function slotLbl(h){return h===0?'12 AM':h<12?h+' AM':h===12?'12 PM':(h-12)+' PM';}

async function getBookedRanges(date) {
  const { data: d1 } = await sb.from('bookings')
    .select('time, duration_minutes')
    .eq('booking_date', date)
    .neq('status', 'cancelled');
  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().split('T')[0];
  const { data: d2 } = await sb.from('bookings')
    .select('time, duration_minutes')
    .eq('booking_date', prevDateStr)
    .neq('status', 'cancelled');
  const ranges = [];
  (d1||[]).forEach(b => {
    const s = toMin(b.time.slice(0,5));
    ranges.push({start:s, end:s+(b.duration_minutes||60)});
  });
  (d2||[]).forEach(b => {
    const s = toMin(b.time.slice(0,5));
    const e = s + (b.duration_minutes||60);
    if(e > 1440) ranges.push({start:0, end: e-1440});
  });
  return ranges;
}

function getBlockedRanges(date) {
  return (blockedSlots[date]||[]).map(t => { const s=toMin(t); return {start:s, end:s+60}; });
}

async function isSlotFree(date, startMin, durMin) {
  const endMin = startMin + durMin;
  if (endMin > 1440) return false;
  const taken = (await getBookedRanges(date)).concat(getBlockedRanges(date));
  return !taken.some(t => rangesOverlap(startMin, endMin, t.start, t.end));
}

async function buildSlots() {
  const g = document.getElementById('sgrid'); if(!g) return;
  const dv = document.getElementById('b-date').value; if(!dv){ updateTotal(); return; }
  g.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px"><span class="spin"></span>Checking availability...</div>';
  const now = new Date(), isToday = dv===today, nowMin = now.getHours()*60+now.getMinutes();
  const currentTime = document.getElementById('b-time').value;
  const taken1 = (await getBookedRanges(dv)).concat(getBlockedRanges(dv)).sort((a,b)=>a.start-b.start);
  const zones = [
    { name:'Morning', price:basePrices.early, segments:[{start:360, end:540, taken:taken1, isToday:isToday, date:dv}] },
    { name:'Daytime', price:basePrices.day, segments:[{start:540, end:900, taken:taken1, isToday:isToday, date:dv}] },
    { name:'Afternoon', price:basePrices.eve, segments:[{start:900, end:1080, taken:taken1, isToday:isToday, date:dv}] },
    { name:'Night', price:basePrices.night, segments:[{start:1080, end:1800, taken:taken1, isToday:isToday, date:dv}] },
  ];
  g.innerHTML = '';
  let hasAny = false;
  zones.forEach(zone => {
    const zoneSlots = [];
    let carryPointer = null;
    zone.segments.forEach(seg => {
      let pointer = (carryPointer !== null && carryPointer >= seg.start && carryPointer <= seg.end) ? carryPointer : seg.start;
      carryPointer = null;
      while(pointer + selDur <= seg.end) {
        const sMin = pointer, eMin = pointer + selDur;
        const tStr = fromMin(sMin);
        const isPast = seg.isToday && sMin < nowMin;
        const blocking = seg.taken.find(t => rangesOverlap(sMin, eMin, t.start, t.end));
        if(blocking){ pointer = blocking.end; continue; }
        zoneSlots.push({sMin, eMin, tStr, isPast, date:seg.date, price:zone.price});
        pointer += selDur;
      }
      carryPointer = pointer;
    });
    if(zoneSlots.length === 0) return;
    hasAny = true;
    const zh = document.createElement('div');
    zh.style.cssText = 'font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;padding:6px 0 4px;grid-column:1/-1;border-top:1px solid var(--bdr);margin-top:4px';
    zh.textContent = `${zone.name} — ৳${zone.price.toLocaleString()}/hr`;
    g.appendChild(zh);
    zoneSlots.forEach(({sMin, eMin, tStr, isPast, date, price}) => {
      const lbl = fmtTime(tStr+':00');
      const el = document.createElement('div');
      if(isPast) {
        el.className='sl no'; el.innerHTML=lbl+'<span class="slp">Past</span>';
      } else {
        const bEndLbl = fmtTime(fromMin(eMin >= 1440 ? eMin - 1440 : eMin));
        const ov = priceOverrides.find(o=>o.time===tStr&&o.dur===selDur);
        const amt = ov ? ov.price : Math.round(price*(selDur/60));
        el.className='sl ok';
        el.innerHTML=lbl+`<span class="slp">→ ${bEndLbl} · ৳${amt.toLocaleString()}</span>`;
        if(tStr===currentTime) el.classList.add('sel');
        el.onclick=function(){
          document.querySelectorAll('#sgrid .sl.ok').forEach(x=>x.classList.remove('sel'));
          el.classList.add('sel');
          document.getElementById('b-date').value = date;
          document.getElementById('b-time').value = tStr;
          updateTotal();
        };
      }
      g.appendChild(el);
    });
  });
  if(!hasAny){
    g.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px;grid-column:1/-1">এই দিনে কোনো slot পাওয়া যাচ্ছে না।</div>';
  }
  updateTotal();
}

function updateTotal() {
  const t=document.getElementById('b-time').value;
  const a=calcAmt(t,selDur);
  document.getElementById('total-amt').textContent='৳'+a.toLocaleString();
  const dl={60:'1 hour',90:'1.5 hours',120:'2 hours'};
  document.getElementById('dur-label').textContent=dl[selDur]||selDur+' min';
}
function updateMTotal(){const t=document.getElementById('m-time').value;document.getElementById('m-total').textContent='৳'+calcAmt(t,mgrDur).toLocaleString();}
function setDur(m,el){selDur=m;document.querySelectorAll('#page-book .db').forEach(b=>b.classList.remove('on'));el.classList.add('on');buildSlots();}
function setMDur(m,el){mgrDur=m;document.querySelectorAll('#m-dbtns .db').forEach(b=>b.classList.remove('on'));el.classList.add('on');updateMTotal();}

async function confirmBook() {
  const name=document.getElementById('b-name').value.trim();
  const phone=document.getElementById('b-phone').value.trim();
  const date=document.getElementById('b-date').value;
  const time=document.getElementById('b-time').value;
  if(!name||!phone||!date||!time){alert('Name, phone, date ও time দিন!');return;}
  const btn=document.getElementById('confirm-btn');
  btn.innerHTML='<span class="spin"></span>Saving...';btn.disabled=true;
  const startMin=toMin(time);
  const isFree=await isSlotFree(date,startMin,selDur);
  if(!isFree){alert('এই slot টি booked। অন্য time বেছে নিন।');await buildSlots();btn.innerHTML='Confirm booking';btn.disabled=false;return;}
  const amt=calcAmt(time,selDur);
  const bkash=document.getElementById('b-bkash').value.trim();
  const note=document.getElementById('b-note').value.trim();
  const bookingData={name,phone,booking_date:date,time:time+':00',duration_minutes:selDur,amount:amt,status:'pending',note:note||null};
  if(currentUser) bookingData.user_id=currentUser.id;
  const {error}=await sb.from('bookings').insert(bookingData);
  btn.innerHTML='Confirm booking';btn.disabled=false;
  if(error){alert('Error: '+error.message);return;}
  await buildSlots();
  document.getElementById('smsg').textContent=`${name} — ${date} at ${fmtTime(time)} for ${selDur} min. Total: ৳${amt.toLocaleString()}`;
  document.getElementById('sbox').style.display='block';
  document.getElementById('sbox').scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function searchHistory() {
  const ph=document.getElementById('hist-phone').value.trim();
  const res=document.getElementById('hist-results');
  if(!ph){res.innerHTML='<div class="hist-empty">Phone number দিন</div>';return;}
  res.innerHTML='<div class="hist-empty"><span class="spin"></span>Searching...</div>';
  const {data}=await sb.from('bookings').select('*').ilike('phone','%'+ph.replace(/[-\s]/g,'')+'%').order('booking_date',{ascending:false});
  if(!data||!data.length){res.innerHTML='<div class="hist-empty">কোনো booking পাওয়া যায়নি</div>';return;}
  res.innerHTML=data.map(b=>`<div class="hist-item"><div class="hist-top"><span class="hist-name">${b.name}</span><span class="bdg ${b.status==='confirmed'?'cf':b.status==='pending'?'pd':'cx'}">${b.status}</span></div><div class="hist-date">${b.booking_date} at ${b.time?fmtTime(b.time.slice(0,5)):''} — ${b.duration_minutes} min</div><div class="hist-detail">Amount: ৳${(b.amount||0).toLocaleString()}</div></div>`).join('');
}

// ============================================================
// REVIEWS
// ============================================================
async function loadReviews(){
  const g=document.getElementById('review-grid');if(!g)return;
  const {data}=await sb.from('reviews').select('*').eq('approved',true).order('created_at',{ascending:false});
  if(!data||!data.length){g.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px">এখনো কোনো review নেই।</div>';document.getElementById('review-count').textContent='0 reviews';document.getElementById('avg-rating').textContent='—';return;}
  const avg=(data.reduce((a,r)=>a+r.rating,0)/data.length).toFixed(1);
  document.getElementById('avg-rating').textContent=avg;
  document.getElementById('review-count').textContent=data.length+' reviews';
  g.innerHTML=data.map(r=>`<div class="review-card"><div class="rev-top"><div class="rev-av">${r.name.charAt(0).toUpperCase()}</div><div><div class="rev-name">${r.name}</div><div style="display:flex;align-items:center;gap:6px"><span style="color:var(--gold);font-size:12px">${'★'.repeat(r.rating)}</span><span class="rev-time">${new Date(r.created_at).toLocaleDateString('bn-BD')}</span></div></div></div><div class="rev-text">${r.review}</div></div>`).join('');
}

function toggleReviewForm(){const f=document.getElementById('review-form');f.style.display=f.style.display==='block'?'none':'block';}
function setStar(n){selStars=n;document.querySelectorAll('.sp').forEach((s,i)=>s.classList.toggle('on',i<n));}

async function submitReview(){
  const name=document.getElementById('rev-name').value.trim();
  const text=document.getElementById('rev-text').value.trim();
  if(!name||!text){alert('Name ও review দিন!');return;}
  const btn=document.querySelector('#review-form .cbtn');
  btn.innerHTML='<span class="spin"></span>Submitting...';btn.disabled=true;
  const {error}=await sb.from('reviews').insert({name,rating:selStars,review:text,approved:false});
  btn.innerHTML='Submit review';btn.disabled=false;
  if(error){alert('Error: '+error.message);return;}
  document.getElementById('review-form').style.display='none';
  document.getElementById('rev-name').value='';
  document.getElementById('rev-text').value='';
  alert('Review জমা হয়েছে! Admin approval এর পর দেখাবে। ধন্যবাদ ⭐');
}

// ============================================================
// GALLERY
// ============================================================
async function loadGallery(){
  const c=document.getElementById('gallery-container');if(!c)return;
  const {data}=await sb.from('gallery').select('*').order('created_at',{ascending:false});
  if(!data||!data.length){c.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px">Gallery empty — Admin panel থেকে photo add করুন।</div>';return;}
  const cats={};
  data.forEach(p=>{if(!cats[p.category])cats[p.category]=[];cats[p.category].push(p);});
  let html='';
  Object.entries(cats).forEach(([cat,photos])=>{
    html+=`<div style="margin-bottom:1rem"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${cat}</div><div class="gallery">`;
    photos.forEach(p=>{
      html+=`<div class="gal-item" onclick="openLightboxImg('${p.image_url}','${p.caption||cat}')"><img src="${p.image_url}" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'gal-img g1\\' style=\\'width:100%;height:100%\\'>📷</div>'"><div class="gal-label">${p.caption||cat}</div></div>`;
    });
    html+='</div></div>';
  });
  c.innerHTML=html;
}

function openLightbox(emoji,caption){document.getElementById('lb-img').innerHTML=`<div style="font-size:4rem">${emoji}</div>`;document.getElementById('lb-caption').textContent=caption;document.getElementById('lightbox').classList.add('open');}
function openLightboxImg(url,caption){document.getElementById('lb-img').innerHTML=`<img src="${url}" style="max-width:90vw;max-height:70vh;border-radius:12px;object-fit:contain">`;document.getElementById('lb-caption').textContent=caption;document.getElementById('lightbox').classList.add('open');}
function closeLightbox(){document.getElementById('lightbox').classList.remove('open');}

// ============================================================
// FAQ
// ============================================================
const faqs=[
  {q:'Parking কি আছে?',a:'হ্যাঁ, বিনামূল্যে গাড়ি পার্কিং আছে। Motorcycle ও bike parking ও আছে।'},
  {q:'বাথরুম ও changing room আছে?',a:'হ্যাঁ, পরিষ্কার changing room ও washroom সুবিধা আছে।'},
  {q:'কি কি equipment পাওয়া যায়?',a:'Football ও Goalkeeper gloves পাওয়া যায়।'},
  {q:'কিভাবে payment করবো?',a:'Booking এর সময় bKash এ advance ৳৫০০ দিতে হবে।'},
];
function buildFAQ(){
  const w=document.getElementById('faq-wrap');if(!w)return;
  w.innerHTML=faqs.map((f,i)=>`<div class="faq-item"><div class="faq-q" onclick="toggleFAQ(${i})"><span>${f.q}</span><span class="faq-icon" id="fi-${i}">+</span></div><div class="faq-a" id="fa-${i}">${f.a}</div></div>`).join('');
}
function toggleFAQ(i){
  const a=document.getElementById('fa-'+i),ic=document.getElementById('fi-'+i),isOpen=a.classList.contains('open');
  document.querySelectorAll('.faq-a').forEach(x=>x.classList.remove('open'));
  document.querySelectorAll('.faq-icon').forEach(x=>{x.classList.remove('open');x.textContent='+';});
  if(!isOpen){a.classList.add('open');ic.classList.add('open');}
}

// ============================================================
// NAV / THEME
// ============================================================
function goPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('show'));
  document.querySelectorAll('.nl').forEach(n=>n.classList.remove('active'));
  setTimeout(()=>{const pg=document.getElementById('page-'+id);if(pg)pg.classList.add('show');},20);
  const nl=document.getElementById('nl-'+id);if(nl)nl.classList.add('active');
  closeNav();window.scrollTo(0,0);
}
function toggleNav(){
  const links=document.getElementById('nav-links');
  const back=document.getElementById('nav-backdrop');
  const open=links.classList.toggle('open');
  if(back)back.classList.toggle('open',open);
  document.body.style.overflow=open?'hidden':'';
}
function closeNav(){
  const links=document.getElementById('nav-links');
  const back=document.getElementById('nav-backdrop');
  if(links)links.classList.remove('open');
  if(back)back.classList.remove('open');
  document.body.style.overflow='';
}
function toggleTheme(){
  isDark=!isDark;
  document.documentElement.setAttribute('data-theme',isDark?'':'light');
  document.getElementById('theme-icon').textContent=isDark?'🌙':'☀️';
}

// ============================================================
// AI CHAT
// ============================================================
let chatHistory = [];

function askq(t){document.getElementById('cinp').value=t;sendMsg();}

async function sendMsg(){
  const inp=document.getElementById('cinp');
  const t=inp.value.trim();
  if(!t)return;
  const mc=document.getElementById('msgs');
  const um=document.createElement('div');
  um.className='msg u';um.textContent=t;mc.appendChild(um);
  inp.value='';mc.scrollTop=mc.scrollHeight;
  const ld=document.createElement('div');
  ld.className='msg b';
  ld.innerHTML='<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  mc.appendChild(ld);mc.scrollTop=mc.scrollHeight;
  const reply = await getReply(t);
  setTimeout(()=>{ld.textContent=reply;mc.scrollTop=mc.scrollHeight;},600);
}

async function getReply(m){
  const ml=m.toLowerCase();
  const bn=/[অ-ৱ]/.test(m)?1:0;
  const dateMatch = ml.match(/(\d{1,2})\s*(ta|তা|tarik|তারিখ|\/|-)/);
  const timeMatch = ml.match(/(\d{1,2})\s*(ta|টা|pm|am|:)/);
  const availKeyword = /khali|available|avail|ache|আছে|খালি|বুক|book/.test(ml);
  if(availKeyword && dateMatch && timeMatch){
    const day = parseInt(dateMatch[1]);
    const hour = parseInt(timeMatch[1]);
    const now = new Date();
    const checkDate = new Date(now.getFullYear(), now.getMonth(), day);
    const dateStr = checkDate.toISOString().split('T')[0];
    const timeStr = String(hour).padStart(2,'0')+':00:00';
    const {data} = await sb.from('bookings').select('id').eq('booking_date', dateStr).eq('time', timeStr).neq('status','cancelled');
    const friendly = fmtTime(String(hour).padStart(2,'0')+':00');
    if(data && data.length>0){
      return bn ? `${day} তারিখ ${friendly} এ slot টি বুক হয়ে গেছে। অন্য সময় দেখতে Book page এ যান।` : `${day}th at ${friendly} is already booked. Please check Book page for other slots.`;
    } else {
      return bn ? `হ্যাঁ, ${day} তারিখ ${friendly} এ slot খালি আছে! Book page থেকে এখনই বুক করুন।` : `Yes, ${day}th at ${friendly} is available! Go to Book page to confirm.`;
    }
  }
  if(/parking|পার্কিং|গাড়ি/.test(ml))
    return bn?'হ্যাঁ, গাড়ি ও মোটরসাইকেলের জন্য বিনামূল্যে পার্কিং আছে!':'Yes, free parking available for cars and motorcycles!';
  if(/avail|khali|free|open|slot|আছে|খালি|available now|right now|ekhon|এখন/.test(ml)){
    const nowDate = new Date().toISOString().split('T')[0];
    const nowHour = new Date().getHours();
    const nowTime = String(nowHour).padStart(2,'0')+':00:00';
    const {data} = await sb.from('bookings').select('id').eq('booking_date',nowDate).eq('time',nowTime).neq('status','cancelled');
    const currentLabel = fmtTime(String(nowHour).padStart(2,'0')+':00');
    if(data && data.length>0)
      return bn?`এখন (${currentLabel}) slot টি বুক হয়ে আছে। অন্য সময় দেখতে Book page এ যান।`:`Right now (${currentLabel}) is booked. Check the Book page for other slots.`;
    else
      return bn?`হ্যাঁ! এখন (${currentLabel}) slot খালি আছে। এখনই বুক করুন!`:`Yes! The current slot (${currentLabel}) is available. Book it now!`;
  }
  if(/price|cost|koto|taka|৳|daam|rate|দাম|কত|মূল্য/.test(ml))
    return bn?'রেট: ভোর ৬-৯টা ৳১৫০০, সকাল ৯টা-বিকাল ৩টা ৳১২০০, বিকাল ৩-৬টা ৳১৮০০, সন্ধ্যা ৬টা-ভোর ৬টা ৳২৫০০/ঘণ্টা।':'Rates: 6–9AM ৳1500, 9AM–3PM ৳1200, 3–6PM ৳1800, 6PM–6AM ৳2500 per hour.';
  if(/cheap|সস্তা|কম|lowest/.test(ml))
    return bn?'সবচেয়ে কম: সকাল ৯টা-বিকাল ৩টা, মাত্র ৳১২০০/ঘণ্টা!':'Cheapest: 9AM–3PM at ৳1200/hr!';
  if(/cancel|refund|বাতিল/.test(ml))
    return bn?'২৪ ঘণ্টা আগে cancel করলে advance ফেরত পাবেন। ২৪ ঘণ্টার মধ্যে cancel সম্ভব নয়।':'Cancel 24+ hrs before = full refund. Within 24 hrs = no refund.';
  if(/bathroom|changing|locker|washroom|বাথরুম/.test(ml))
    return bn?'হ্যাঁ, পরিষ্কার changing room ও washroom আছে।':'Yes, clean changing room and washroom available.';
  if(/equipment|ball|glove|গ্লাভস/.test(ml))
    return bn?'Football ও Goalkeeper gloves পাওয়া যায়।':'Football and Goalkeeper gloves are available.';
  if(/payment|bkash|বিকাশ|pay/.test(ml))
    return bn?'Booking এর সময় bKash এ advance ৳৫০০ দিতে হবে।':'Advance ৳500 via bKash at the time of booking.';
  if(/location|কোথায়|address|ঠিকানা/.test(ml))
    return bn?'আমরা Noakhali, Bangladesh এ অবস্থিত। যোগাযোগ: 01633-305811':'Located in Noakhali, Bangladesh. Contact: 01633-305811';
  if(/contact|phone|number|whatsapp|ফোন/.test(ml))
    return bn?'WhatsApp/Call: 01633-305811':'WhatsApp/Call: 01633-305811';
  if(/time|hours|open|khenke|খোলা|সময়/.test(ml))
    return bn?'আমরা ২৪ ঘণ্টা, সপ্তাহে ৭ দিন খোলা!':'We are open 24/7, 7 days a week!';
  return bn ? 'আরো তথ্যের জন্য WhatsApp করুন: 01633-305811' : 'For more info, WhatsApp us: 01633-305811';
}

// ============================================================
// LIVE SLOTS BLOCK
// ============================================================
let liveTabOffset = 0;
let liveBookedTimes = [];
let nextGameInterval = null;

async function loadLiveSlots(dayOffset){
  const grid = document.getElementById('live-slots-grid');
  if(!grid) return;
  grid.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px;grid-column:1/-1"><span class="spin"></span> Loading...</div>';
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const dateStr = d.toISOString().split('T')[0];
  const {data} = await sb.from('bookings').select('time,duration_minutes').eq('booking_date', dateStr).neq('status','cancelled');
  liveBookedTimes = (data||[]).map(b=>b.time?b.time.slice(0,5):'');
  let html = '';
  const now = new Date();
  let nextBookedMs = null;
  for(let h=0;h<24;h++){
    const timeKey = String(h).padStart(2,'0')+':00';
    const isBooked = liveBookedTimes.includes(timeKey);
    const label = fmtTime(timeKey+':00');
    const slotDate = new Date(d);
    slotDate.setHours(h,0,0,0);
    const isPast = dayOffset===0 && slotDate < now;
    if(isPast){
      html+=`<div class="ls booked"><div class="ls-time">${label}</div><div class="ls-status">Past</div></div>`;
    } else if(isBooked){
      if(!nextBookedMs || slotDate.getTime() < nextBookedMs) nextBookedMs = slotDate.getTime();
      html+=`<div class="ls booked"><div class="ls-time">${label}</div><div class="ls-status">Booked</div></div>`;
    } else {
      html+=`<div class="ls avail" onclick="goBookSlot('${dateStr}','${timeKey}')"><div class="ls-time">${label}</div><div class="ls-status">Available</div></div>`;
    }
  }
  grid.innerHTML = html;
  if(nextGameInterval) clearInterval(nextGameInterval);
  if(nextBookedMs){
    updateNextGameTimer(nextBookedMs);
    nextGameInterval = setInterval(()=>updateNextGameTimer(nextBookedMs), 1000);
  } else {
    document.getElementById('next-game-timer').textContent = 'No upcoming bookings';
  }
}

function updateNextGameTimer(targetMs){
  const el = document.getElementById('next-game-timer');
  if(!el) return;
  const diff = targetMs - Date.now();
  if(diff <= 0){el.textContent='Next game starting now!';return;}
  const h = Math.floor(diff/3600000);
  const m = Math.floor((diff%3600000)/60000);
  const s = Math.floor((diff%60000)/1000);
  el.textContent=`⏱ Next game in: ${h>0?h+'h ':''} ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
}

function switchLiveTab(offset, el){
  liveTabOffset = offset;
  document.querySelectorAll('.live-date-tab').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
  loadLiveSlots(offset);
}

function goBookSlot(date, time){
  goPage('book');
  setTimeout(()=>{
    const dateInput = document.getElementById('b-date');
    const timeInput = document.getElementById('b-time');
    if(dateInput){ dateInput.value = date; }
    if(timeInput && time){ timeInput.value = time; }
    buildSlots();
    document.getElementById('page-book').scrollTop = 0;
  }, 150);
}

// ============================================================
// INIT
// ============================================================
buildSlots();
loadReviews();
loadGallery();
loadLiveSlots(0);
buildFAQ();
setStar(5);
initAuth();

const bDateEl = document.getElementById('b-date');
if(bDateEl && !bDateEl.value){ bDateEl.value = today; buildSlots(); }

function checkSecretHash() {
  const hash = window.location.hash;
  if (hash === '#manager-login') { goPage('manager'); }
  else if (hash === '#elclasico-admin') { goPage('sadmin'); }
}
checkSecretHash();
window.addEventListener('hashchange', checkSecretHash);
