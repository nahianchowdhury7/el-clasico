// ============================================================
// MANAGER.JS — Manager panel এর সব functions
// Depends on: app.js (sb, today, fmtTime, toMin, fromMin, calcAmt,
//             slotLbl, allSlots, getTimeRate, mgrDur, setMDur,
//             updateMTotal, isSlotFree, blockedSlots, basePrices,
//             buildSlots, goPage)
// ============================================================

// ============================================================
// MANAGER LOGIN
// ============================================================
async function mgrLogin() {
  const email = document.getElementById('mgr-email').value.trim();
  const pw    = document.getElementById('mgr-pw').value;
  if (!email || !pw) { showMgrErr('Email ও password দিন'); return; }

  const btn = document.getElementById('mgr-login-btn');
  btn.innerHTML = '<span class="spin"></span>Checking...';
  btn.disabled = true;

  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  btn.innerHTML = 'Login';
  btn.disabled = false;

  if (error) { showMgrErr('Login failed: ' + error.message); return; }

  const { data: { user } } = await sb.auth.getUser();
  const { data: adm } = await sb.from('admins').select('role').eq('id', user.id).single();

  if (!adm || !['manager', 'superadmin'].includes(adm.role)) {
    showMgrErr('আপনার manager access নেই');
    await sb.auth.signOut();
    return;
  }

  adminRole = adm.role;
  document.getElementById('mgr-auth-check').style.display = 'none';
  document.getElementById('mgr-panel').classList.add('show');
  loadAdminPanel();
}

function showMgrErr(msg) {
  const e = document.getElementById('mgr-err');
  e.textContent = msg;
  e.style.display = 'block';
}

// ============================================================
// MANAGER PANEL — load & render
// ============================================================
async function loadAdminPanel() {
  const { data } = await sb.from('bookings')
    .select('*')
    .order('booking_date', { ascending: false });

  renderAdminTable('mgr-bookings', data || []);
  renderStats('mgr-stats', data || []);

  document.getElementById('m-date').value = today;
  document.getElementById('blk-date').value = today;
  renderBlockGrid('blk-grid', 'blk-date');
  updateMTotal();
}

// ============================================================
// SLOT GRID — state & styles
// ============================================================
let mgrGridDate = null;
let mgrGridBookings = [];
let saGridDate = null;
let saGridBookings = [];

function ensureSlotGridStyles() {
  if (document.getElementById('slot-grid-styles')) return;
  const css = document.createElement('style');
  css.id = 'slot-grid-styles';
  css.textContent = `
    .sg-wrap{padding:4px 0}
    .sg-datebar{display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap}
    .sg-datebar input[type=date]{padding:9px 12px;border-radius:10px;border:1px solid var(--bdr,#444);background:transparent;color:inherit;font-size:14px;font-family:inherit}
    .sg-refresh{padding:8px 14px;border-radius:10px;border:1px solid var(--bdr,#444);background:transparent;color:inherit;cursor:pointer;font-size:13px;font-weight:500}
    .sg-refresh:hover{filter:brightness(1.1)}
    .sg-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    @media(min-width:720px){.sg-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(min-width:1100px){.sg-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    .sg-card{border-radius:16px;padding:16px;cursor:pointer;transition:transform .15s,box-shadow .15s;line-height:1.4;user-select:none;display:flex;flex-direction:column;gap:4px;min-height:118px}
    .sg-card:hover{transform:translateY(-2px);box-shadow:0 8px 18px rgba(0,0,0,.18)}
    .sg-card .sg-lbl{font-weight:700;font-size:18px;letter-spacing:.2px}
    .sg-card .sg-time{font-size:15px;font-weight:600}
    .sg-card .sg-meta{font-size:14px;font-weight:500;margin-top:auto}
    .sg-card.sg-unbooked{background:#D7DBE0;color:#1a1a1a}
    .sg-card.sg-booked{background:#D6F5DC;color:#0E7A3B}
    .sg-card.sg-advanced{background:#C99416;color:#fff}
    .sg-card.sg-unpaid{background:#F2722B;color:#fff}
    .sg-card.sg-paid{background:#0E7A3B;color:#fff}
    .sg-card.sg-cancelled{background:#FADBD8;color:#922B21}
    .sg-zone-h{grid-column:1/-1;font-size:11px;color:var(--muted,#888);text-transform:uppercase;letter-spacing:1.4px;padding:12px 0 4px;border-top:1px solid var(--bdr,#3334);margin-top:6px;font-weight:600}
    .sg-empty{grid-column:1/-1;padding:18px;color:var(--muted,#888);font-size:13px;text-align:center}

    .sd-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:flex-start;justify-content:center;z-index:9999;padding:20px;overflow-y:auto}
    .sd-modal.open{display:flex}
    .sd-card{background:var(--card,#1c1f24);color:inherit;width:min(720px,100%);border-radius:18px;padding:20px;border:1px solid var(--bdr,#3334);box-shadow:0 20px 60px rgba(0,0,0,.4)}
    .sd-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
    .sd-title{font-size:16px;font-weight:700}
    .sd-close{background:transparent;border:0;color:inherit;font-size:26px;cursor:pointer;line-height:1;padding:0 4px}
    .sd-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px}
    @media(max-width:520px){.sd-row{grid-template-columns:1fr}}
    .sd-fld{display:flex;flex-direction:column;gap:5px}
    .sd-lbl{font-size:12px;color:var(--muted,#aaa);font-weight:500}
    .sd-inp,.sd-sel{padding:10px 12px;border-radius:10px;border:1px solid var(--bdr,#3334);background:var(--bg,#15171b);color:inherit;font-size:14px;width:100%;box-sizing:border-box;font-family:inherit}
    .sd-ro{border:2px solid #d9534f !important;background:rgba(217,83,79,.06) !important;cursor:not-allowed;color:inherit}
    .sd-ro:focus{outline:none}
    .sd-bdg-row{display:flex;gap:6px;align-items:center;padding:8px 0;flex-wrap:wrap}
    .sd-bdg{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600}
    .sd-bdg.played{background:#D6F5DC;color:#0E7A3B}
    .sd-bdg.cancelled{background:#FADBD8;color:#922B21}
    .sd-due{background:#FADBD8 !important;color:#922B21 !important;font-weight:700;border:1px solid #f5b7b1 !important}
    .sd-total{background:#E8F0FE !important;color:#1a4eb8 !important;font-weight:700;border:1px solid #b8d0f5 !important}
    .sd-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
    .sd-btn{padding:11px 12px;border-radius:10px;border:1px solid var(--bdr,#3334);background:var(--card,#1c1f24);color:inherit;cursor:pointer;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:7px;transition:filter .15s;font-family:inherit}
    .sd-btn:hover{filter:brightness(1.1)}
    .sd-btn.book{background:#fff;color:#000;border-color:#000}
    .sd-btn.clear{background:#FFCC80;color:#5a3c00;border-color:#FFCC80}
    .sd-btn.cancel{background:#fff;color:#922B21;border-color:#000}
    .sd-btn.print{background:#fff;color:#222;border-color:#000}
    .sd-btn.sms-sim{background:#E3F2FD;color:#1565C0;border-color:#90CAF9}
    .sd-btn.sms-wa{background:#E8F5E9;color:#1B5E20;border-color:#A5D6A7}
    .sd-btn.call-sim{background:#E3F2FD;color:#1565C0;border-color:#90CAF9}
    .sd-btn.call-wa{background:#E8F5E9;color:#1B5E20;border-color:#A5D6A7}
    .sd-textarea{width:100%;min-height:90px;padding:10px 12px;border-radius:10px;border:1px solid var(--bdr,#3334);background:var(--bg,#15171b);color:inherit;font-size:13px;box-sizing:border-box;margin-top:12px;font-family:inherit;resize:vertical}
    .sd-pmt{font-weight:700;text-align:center}
    .sd-pmt.advanced{background:#FFE9B5 !important;color:#7a5300 !important;border-color:#C99416 !important}
    .sd-pmt.paid{background:#CFEFD8 !important;color:#0E7A3B !important;border-color:#0E7A3B !important}
    .sd-pmt.unpaid{background:#FFD3BD !important;color:#7a2300 !important;border-color:#F2722B !important}
    .sd-pmt.cancelled{background:#FADBD8 !important;color:#922B21 !important;border-color:#d9534f !important}
    .sd-tplbl{color:#1a4eb8;font-weight:700}
  `;
  document.head.appendChild(css);
}

// ============================================================
// Zone helpers
// ============================================================
function zoneRanges() {
  return [
    { key:'morning',   name:'Morning',   price:basePrices.early, start:360,  end:540  },
    { key:'day',       name:'Day',       price:basePrices.day,   start:540,  end:900  },
    { key:'afternoon', name:'Afternoon', price:basePrices.eve,   start:900,  end:1080 },
    { key:'night',     name:'Night',     price:basePrices.night, start:1080, end:1800 },
  ];
}

function zoneOfMin(m) {
  if (m >= 360 && m < 540)  return 'morning';
  if (m >= 540 && m < 900)  return 'day';
  if (m >= 900 && m < 1080) return 'afternoon';
  return 'night';
}

function zoneNameOf(key) {
  return { morning:'Morning', day:'Day', afternoon:'Afternoon', night:'Night' }[key] || '';
}

function fmtMin(m) {
  const norm = ((m % 1440) + 1440) % 1440;
  return fmtTime(fromMin(norm));
}

// ============================================================
// Fetch bookings for one date
// ============================================================
async function fetchDayBookings(dateStr) {
  const { data } = await sb.from('bookings').select('*').eq('booking_date', dateStr);
  return (data || []).filter(b => b.time).map(b => {
    const raw = toMin(b.time.slice(0,5));
    const dur = b.duration_minutes || 60;
    const start = raw < 360 ? raw + 1440 : raw;
    return Object.assign({}, b, { _start: start, _end: start + dur });
  });
}

// ============================================================
// Payment status detection
// ============================================================
function paymentStateOf(b) {
  if (!b) return 'unbooked';
  if (b.status === 'cancelled') return 'cancelled';
  const fee  = +b.amount || 0;
  const advC = +b.advance_cash  || 0;
  const advB = +b.advance_bkash || 0;
  const cashP  = +b.cash_paid   || 0;
  const bkashP = +b.bkash_paid  || 0;
  const disc   = +b.discount    || 0;
  const paid = advC + advB + cashP + bkashP;
  const eff  = paid + disc;
  if (b.status === 'confirmed' && (paid + disc) >= fee && fee > 0) return 'paid';
  if (b.status === 'confirmed' && paid === 0 && advC === 0 && advB === 0) return 'paid';
  if (eff >= fee && fee > 0) return 'paid';
  if (paid > 0 || (b.bkash_trxid && String(b.bkash_trxid).trim())) return 'advanced';
  if (b.status === 'pending') return 'unpaid';
  return 'advanced';
}

function statusToCardClass(s) {
  return ({ unbooked:'sg-unbooked', booked:'sg-booked', advanced:'sg-advanced', unpaid:'sg-unpaid', paid:'sg-paid', cancelled:'sg-cancelled' })[s] || 'sg-unbooked';
}

function statusLabelOf(s) {
  return ({ unbooked:'Unbooked', booked:'Booked', advanced:'Advanced', unpaid:'Unpaid', paid:'Paid', cancelled:'Cancelled' })[s] || 'Unbooked';
}

// ============================================================
// Build slot cards from zones + bookings
// ============================================================
function buildSlotGridCards(zones, bookings) {
  const sorted   = [...bookings].sort((a, b) => a._start - b._start);
  const rendered = new Set();
  const cards    = [];

  zones.forEach(zone => {
    let pointer = zone.start;
    while (pointer < zone.end) {
      const covering = sorted.find(b => b._start <= pointer && b._end > pointer);
      if (covering && !rendered.has(covering.id)) {
        rendered.add(covering.id);
        cards.push({ zone: zone.key, startMin: covering._start, endMin: covering._end, displayTimeRange: fmtMin(covering._start) + ' - ' + fmtMin(covering._end), booking: covering });
        pointer = Math.min(covering._end, zone.end);
        continue;
      }
      if (covering) { pointer = Math.min(covering._end, zone.end); continue; }
      const slotEnd0 = Math.min(pointer + 60, zone.end);
      const next     = sorted.find(b => b._start > pointer && b._start < slotEnd0);
      const slotEnd  = next ? next._start : slotEnd0;
      cards.push({ zone: zone.key, startMin: pointer, endMin: slotEnd, displayTimeRange: fmtMin(pointer) + ' - ' + fmtMin(slotEnd), booking: null });
      pointer = slotEnd;
    }
  });
  return cards;
}

// ============================================================
// Render slot grid UI
// ============================================================
function renderSlotGridUI(containerId, dateStr, cards, zonePrices) {
  ensureSlotGridStyles();
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const inputId = 'sg-date-' + containerId;

  let html = '<div class="sg-wrap">' +
    '<div class="sg-datebar">' +
    '<label style="font-size:13px;color:var(--muted,#888)">তারিখ:</label>' +
    '<input type="date" id="' + inputId + '" value="' + dateStr + '">' +
    '<button class="sg-refresh" onclick="refreshSlotGrid(\'' + containerId + '\')">🔄 Refresh</button>' +
    '</div>';

  if (!cards.length) {
    html += '<div class="sg-empty">কোনো slot পাওয়া যায়নি।</div></div>';
    wrap.innerHTML = html;
    const di = document.getElementById(inputId);
    if (di) di.addEventListener('change', () => refreshSlotGrid(containerId));
    return;
  }

  const grouped = {};
  cards.forEach(c => { (grouped[c.zone] = grouped[c.zone] || []).push(c); });
  const order = ['morning','day','afternoon','night'];

  html += '<div class="sg-grid">';
  order.forEach(zk => {
    if (!grouped[zk]) return;
    const zname  = zoneNameOf(zk);
    const zprice = zonePrices[zk];
    html += '<div class="sg-zone-h">' + zname + ' — ৳' + zprice.toLocaleString() + '/hr</div>';
    grouped[zk].forEach((c, i) => {
      const lbl       = zname + ' ' + (i + 1);
      const state     = c.booking ? paymentStateOf(c.booking) : 'unbooked';
      const cls       = statusToCardClass(state);
      const statusTxt = statusLabelOf(state);
      const price     = c.booking
        ? (+c.booking.amount || 0)
        : Math.round(zprice * ((c.endMin - c.startMin) / 60));
      const onclick = c.booking
        ? "openSlotDetailModal('" + containerId + "','" + c.booking.id + "')"
        : "openUnbookedSlot('" + containerId + "','" + dateStr + "','" + fromMin(((c.startMin % 1440) + 1440) % 1440) + "'," + (c.endMin - c.startMin) + ")";
      html += '<div class="sg-card ' + cls + '" onclick="' + onclick + '">' +
              '<div class="sg-lbl">' + lbl + '</div>' +
              '<div class="sg-time">' + c.displayTimeRange + '</div>' +
              '<div class="sg-meta">' + price.toLocaleString() + ' - ' + statusTxt + '</div>' +
              '</div>';
    });
  });
  html += '</div></div>';
  wrap.innerHTML = html;
  const di = document.getElementById(inputId);
  if (di) di.addEventListener('change', () => refreshSlotGrid(containerId));
}

async function refreshSlotGrid(containerId) {
  const inputId = 'sg-date-' + containerId;
  const di      = document.getElementById(inputId);
  const dateStr = (di && di.value) ? di.value : today;
  const bookings = await fetchDayBookings(dateStr);
  if (containerId.startsWith('mgr')) { mgrGridDate = dateStr; mgrGridBookings = bookings; }
  else                                { saGridDate  = dateStr; saGridBookings  = bookings; }
  const zones      = zoneRanges();
  const zonePrices = { morning: basePrices.early, day: basePrices.day, afternoon: basePrices.eve, night: basePrices.night };
  const cards      = buildSlotGridCards(zones, bookings);
  renderSlotGridUI(containerId, dateStr, cards, zonePrices);
}

// ============================================================
// RENDER BOOKINGS GRID (replaces old table)
// ============================================================
function renderAdminTable(containerId, _bookingsIgnored) {
  ensureSlotGridStyles();
  const wrap    = document.getElementById(containerId);
  if (!wrap) return;
  const inputId = 'sg-date-' + containerId;
  const dateStr = (containerId.startsWith('mgr') ? mgrGridDate : saGridDate) || today;
  wrap.innerHTML =
    '<div class="sg-wrap">' +
      '<div class="sg-datebar">' +
        '<label style="font-size:13px;color:var(--muted,#888)">তারিখ:</label>' +
        '<input type="date" id="' + inputId + '" value="' + dateStr + '">' +
        '<button class="sg-refresh" onclick="refreshSlotGrid(\'' + containerId + '\')">🔄 Refresh</button>' +
      '</div>' +
      '<div class="sg-empty"><span class="spin"></span> Loading slots...</div>' +
    '</div>';
  const di = document.getElementById(inputId);
  if (di) di.addEventListener('change', () => refreshSlotGrid(containerId));
  refreshSlotGrid(containerId);
}

// ============================================================
// RENDER STATS CARDS
// ============================================================
function renderStats(cid, bookings) {
  const c = document.getElementById(cid);
  if (!c) return;
  const tdy  = bookings.filter(b => b.booking_date === today).length;
  const rev  = bookings.filter(b => b.status === 'confirmed').reduce((a, b) => a + (b.amount || 0), 0);
  const rate = Math.round(bookings.filter(b => b.status === 'confirmed').length / Math.max(bookings.length, 1) * 100);
  c.innerHTML = `
    <div class="sc"><div class="sc-n">${bookings.length}</div><div class="sc-l">Total</div></div>
    <div class="sc"><div class="sc-n">${tdy}</div><div class="sc-l">Today</div></div>
    <div class="sc"><div class="sc-n">৳${rev.toLocaleString()}</div><div class="sc-l">Revenue</div></div>
    <div class="sc"><div class="sc-n">${rate}%</div><div class="sc-l">Confirmed</div></div>`;
}

// ============================================================
// TOGGLE / DELETE BOOKING
// ============================================================
async function toggleStatus(id, currentStatus, tableId) {
  const newStatus = currentStatus === 'cancelled' ? 'pending' : 'cancelled';
  await sb.from('bookings').update({ status: newStatus }).eq('id', id);
  if (tableId.startsWith('mgr')) loadAdminPanel();
  else loadSaPanel();
}

async function delBooking(id, tableId) {
  if (!confirm('Delete this booking?')) return;
  await sb.from('bookings').delete().eq('id', id);
  if (tableId.startsWith('mgr')) loadAdminPanel();
  else loadSaPanel();
}

// ============================================================
// WHATSAPP CONFIRM
// ============================================================
async function waConfirmBooking(id, name, date, time, phone, duration) {
  if (!phone) { alert('Phone number missing!'); return; }
  await sb.from('bookings').update({ status: 'confirmed' }).eq('id', id);
  if (phone.startsWith('0')) phone = '88' + phone;
  const friendlyTime = fmtTime(time);
  const dur = duration ? (duration >= 60 ? Math.floor(duration / 60) + 'h' + (duration % 60 ? (' ' + duration % 60 + 'min') : '') : duration + 'min') : '';
  const msg = `Dear ${name},\n\nআপনার booking Confirmed! ✅\nDate: ${date}\nTime: ${friendlyTime}\nDuration: ${dur}\n\n১০ মিনিট আগে চলে আসবেন।\n\nSee you at El Clasico Football Arena! ⚽`;
  window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank');
  setTimeout(() => loadAdminPanel(), 500);
}

// ============================================================
// MANAGER — ADD BOOKING
// ============================================================
async function mgrAddBook() {
  const name  = document.getElementById('m-name').value.trim();
  const phone = document.getElementById('m-phone').value.trim();
  const date  = document.getElementById('m-date').value;
  const time  = document.getElementById('m-time').value;
  if (!name || !phone || !date || !time) { alert('Fill all fields!'); return; }
  const isFree = await isSlotFree(date, toMin(time), mgrDur);
  if (!isFree) { alert('Conflict! এই slot টি already booked।'); return; }
  const amt = calcAmt(time, mgrDur);
  const { error } = await sb.from('bookings').insert({ name, phone, booking_date: date, time: time + ':00', duration_minutes: mgrDur, amount: amt, status: 'confirmed' });
  if (error) { alert('Error: ' + error.message); return; }
  document.getElementById('m-smsg').textContent = `${name} — ${date} ${time} for ${mgrDur}min. ৳${amt.toLocaleString()}`;
  document.getElementById('m-sbox').style.display = 'block';
  loadAdminPanel();
}

// ============================================================
// BLOCK SLOTS GRID
// ============================================================
function renderBlockGrid(gid, did) {
  const date = document.getElementById(did).value;
  const g    = document.getElementById(gid);
  if (!g || !date) return;
  g.innerHTML = '';
  const blk = blockedSlots[date] || [];
  allSlots.forEach(t => {
    const h   = parseInt(t);
    const lbl = slotLbl(h);
    const isBlocked = blk.includes(t);
    const el  = document.createElement('div');
    el.className = 'blk-sl' + (isBlocked ? ' blocked' : '');
    el.innerHTML = lbl + `<span class="blkp">৳${getTimeRate(t).toLocaleString()}</span>`;
    el.onclick = function () {
      if (!blockedSlots[date]) blockedSlots[date] = [];
      const idx = blockedSlots[date].indexOf(t);
      if (idx > -1) blockedSlots[date].splice(idx, 1);
      else blockedSlots[date].push(t);
      renderBlockGrid(gid, did);
    };
    g.appendChild(el);
  });
}

// ============================================================
// MANAGER TABS
// ============================================================
function mgrTab(tab, el) {
  document.querySelectorAll('#mgr-panel .at').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  ['bookings', 'newbook', 'block'].forEach(t => {
    document.getElementById('mgr-' + t).style.display = t === tab ? 'block' : 'none';
  });
}

// ============================================================
// SLOT DETAIL MODAL
// ============================================================
function findBookingById(containerId, id) {
  const list = containerId.startsWith('mgr') ? mgrGridBookings : saGridBookings;
  return list.find(b => String(b.id) === String(id));
}

async function openSlotDetailModal(containerId, bookingId) {
  ensureSlotGridStyles();
  const b = findBookingById(containerId, bookingId);
  if (!b) { alert('Booking not found.'); return; }

  let played = 0, cancelled = 0;
  if (b.phone) {
    const { data } = await sb.from('bookings').select('status').eq('phone', b.phone);
    (data || []).forEach(x => {
      if (x.status === 'cancelled') cancelled++;
      else if (x.status === 'confirmed') played++;
    });
  }

  let phoneRaw = (b.phone || '').replace(/\D/g, '');
  if (phoneRaw.startsWith('880')) phoneRaw = phoneRaw.slice(3);
  if (phoneRaw.startsWith('0'))   phoneRaw = phoneRaw.slice(1);
  const phoneDisplay = phoneRaw ? '+88 0' + phoneRaw : '—';

  const zk    = zoneOfMin(b._start);
  const zname = zoneNameOf(zk);
  const list  = containerId.startsWith('mgr') ? mgrGridBookings : saGridBookings;
  const sameZone = list.filter(x => zoneOfMin(x._start) === zk).sort((a, c) => a._start - c._start);
  const zoneIdx  = sameZone.findIndex(x => String(x.id) === String(b.id)) + 1;

  const slotLabel    = `${zname} ${zoneIdx} — ${fmtMin(b._start)} - ${fmtMin(b._end)}`;
  const fee          = +b.amount || 0;
  const state        = paymentStateOf(b);
  const paymentValue = state === 'paid' ? 'Paid' : state === 'cancelled' ? 'Cancelled' : state === 'unpaid' ? 'Unpaid' : 'Advanced';

  const advC   = +b.advance_cash  || 0;
  const advB   = +b.advance_bkash || 0;
  const cashP  = +b.cash_paid     || 0;
  const bkashP = +b.bkash_paid    || 0;
  const disc   = +b.discount      || 0;

  const modalId = 'sd-modal-root';
  let m = document.getElementById(modalId);
  if (!m) { m = document.createElement('div'); m.id = modalId; m.className = 'sd-modal'; document.body.appendChild(m); }
  m.dataset.containerId = containerId;
  m.dataset.bookingId   = String(b.id);
  m.dataset.phone       = phoneRaw;

  const safeAttr = v => String(v == null ? '' : v).replace(/"/g, '&quot;').replace(/</g, '&lt;');

  m.innerHTML = `
    <div class="sd-card" onclick="event.stopPropagation()">
      <div class="sd-head">
        <div class="sd-title">${safeAttr(slotLabel)}</div>
        <button class="sd-close" onclick="closeSlotDetailModal()">×</button>
      </div>
      <div class="sd-row">
        <div class="sd-fld"><label class="sd-lbl">তারিখ</label><input class="sd-inp sd-ro" readonly value="${safeAttr(b.booking_date || '')}"></div>
        <div class="sd-fld"><label class="sd-lbl">সময়</label><input class="sd-inp sd-ro" readonly value="${safeAttr(zname + ' ' + zoneIdx + ' — ' + fmtMin(b._start) + ' - ' + fmtMin(b._end))}"></div>
      </div>
      <div class="sd-row">
        <div class="sd-fld"><label class="sd-lbl">মোবাইল</label><input class="sd-inp sd-ro" readonly value="${safeAttr(phoneDisplay)}"></div>
        <div class="sd-fld"><label class="sd-lbl">Customer History</label><div class="sd-bdg-row"><span class="sd-bdg played">Played: ${played}</span><span class="sd-bdg cancelled">Cancelled: ${cancelled}</span></div></div>
      </div>
      <div class="sd-row">
        <div class="sd-fld"><label class="sd-lbl">নাম <span style="color:#d9534f">*</span></label><input class="sd-inp sd-ro" readonly value="${safeAttr(b.name || '')}"></div>
        <div class="sd-fld"><label class="sd-lbl">ঠিকানা <span style="color:#d9534f">*</span></label><input class="sd-inp sd-ro" readonly value="${safeAttr(b.address || b.note || '')}"></div>
      </div>
      <div class="sd-row">
        <div class="sd-fld"><label class="sd-lbl">bKash Transaction ID</label><input class="sd-inp sd-ro" readonly value="${safeAttr(b.bkash_trxid || '—')}"></div>
        <div class="sd-fld"><label class="sd-lbl">ফি</label><input class="sd-inp sd-ro" readonly value="${fee.toLocaleString()} BDT"></div>
      </div>
      <div class="sd-row">
        <div class="sd-fld" style="grid-column:1/-1"><label class="sd-lbl">পেমেন্ট</label>
          <select class="sd-sel sd-pmt ${paymentValue.toLowerCase()}" id="sd-payment" onchange="onPaymentStatusChange(this)">
            <option value="Advanced"  ${paymentValue==='Advanced' ?'selected':''}>⏳ Advanced</option>
            <option value="Paid"      ${paymentValue==='Paid'     ?'selected':''}>✅ Paid</option>
            <option value="Unpaid"    ${paymentValue==='Unpaid'   ?'selected':''}>⚠ Unpaid</option>
            <option value="Cancelled" ${paymentValue==='Cancelled'?'selected':''}>✖ Cancelled</option>
          </select>
        </div>
      </div>
      <div class="sd-row">
        <div class="sd-fld"><label class="sd-lbl">অগ্রিম ক্যাশ</label><input class="sd-inp" id="sd-advcash"  type="number" min="0" placeholder="Adv Cash"  value="${advC  || ''}" oninput="recalcSlotPay()"></div>
        <div class="sd-fld"><label class="sd-lbl">অগ্রিম বিকাশ</label><input class="sd-inp" id="sd-advbkash" type="number" min="0" placeholder="Adv bKash" value="${advB  || ''}" oninput="recalcSlotPay()"></div>
      </div>
      <div class="sd-row">
        <div class="sd-fld"><label class="sd-lbl">ক্যাশ জমা</label><input class="sd-inp" id="sd-cashpaid"  type="number" min="0" placeholder="Amount" value="${cashP  || ''}" oninput="recalcSlotPay()"></div>
        <div class="sd-fld"><label class="sd-lbl">বিকাশ জমা</label><input class="sd-inp" id="sd-bkashpaid" type="number" min="0" placeholder="Amount" value="${bkashP || ''}" oninput="recalcSlotPay()"></div>
      </div>
      <div class="sd-row">
        <div class="sd-fld"><label class="sd-lbl">ডিসকাউন্ট</label><input class="sd-inp" id="sd-discount" type="number" min="0" placeholder="0" value="${disc || ''}" oninput="recalcSlotPay()"></div>
        <div class="sd-fld"><label class="sd-lbl">বকেয়া</label><input class="sd-inp sd-due" id="sd-due" readonly value="0 BDT"></div>
      </div>
      <div class="sd-row">
        <div class="sd-fld" style="grid-column:1/-1"><label class="sd-lbl sd-tplbl">Total Pay</label><input class="sd-inp sd-total" id="sd-totalpay" readonly value="0"></div>
      </div>
      <div class="sd-actions">
        <button class="sd-btn book" id="sd-book-btn" onclick="slotActionSave()">${paymentValue === 'Paid' ? '✅ Confirm' : '📅 Book'}</button>
        <button class="sd-btn clear"    onclick="slotActionClear()">🧹 Clear</button>
        <button class="sd-btn cancel"   onclick="slotActionCancel()">❌ Cancel</button>
        <button class="sd-btn print"    onclick="slotActionPrint()">🖨 Print</button>
        <button class="sd-btn sms-sim"  onclick="slotActionSmsSim()">📱 SMS (SIM)</button>
        <button class="sd-btn sms-wa"   onclick="slotActionSmsWA()">💬 SMS (WhatsApp)</button>
        <button class="sd-btn call-sim" onclick="slotActionCallSim()">📞 Call (SIM)</button>
        <button class="sd-btn call-wa"  onclick="slotActionCallWA()">➡ Call (WhatsApp)</button>
      </div>
      <textarea class="sd-textarea" id="sd-smsbody" placeholder="SMS Message"></textarea>
    </div>`;

 m.classList.add('open');
  m.onclick = function (e) { if (e.target === m) closeSlotDetailModal(); };
  recalcSlotPay();

  if (b.payment_locked) {
    _lockModalFields();
  } else if (b.advance_locked) {
    _lockAdvanceFields();
  }

  const defaultMsg = `Dear ${b.name || ''},\nআপনার booking — ${b.booking_date} at ${fmtMin(b._start)} - ${fmtMin(b._end)}.\nফি: ৳${fee.toLocaleString()}\nEl Clasico Football Arena ⚽`;
  document.getElementById('sd-smsbody').value = defaultMsg;
}

function closeSlotDetailModal() {
  const m = document.getElementById('sd-modal-root');
  if (m) m.classList.remove('open');
}

function onPaymentStatusChange(sel) {
  sel.classList.remove('advanced', 'paid', 'unpaid', 'cancelled');
  sel.classList.add(sel.value.toLowerCase());
  const bookBtn = document.getElementById('sd-book-btn');
  if (bookBtn) {
    bookBtn.textContent = sel.value === 'Paid' ? '✅ Confirm' : '📅 Book';
  }
}

function recalcSlotPay() {
  const m = document.getElementById('sd-modal-root');
  if (!m) return;
  const b = findBookingById(m.dataset.containerId, m.dataset.bookingId);
  if (!b) return;
  const fee    = +b.amount || 0;
  const advC   = +document.getElementById('sd-advcash').value   || 0;
  const advB   = +document.getElementById('sd-advbkash').value  || 0;
  const cashP  = +document.getElementById('sd-cashpaid').value  || 0;
  const bkashP = +document.getElementById('sd-bkashpaid').value || 0;
  const disc   = +document.getElementById('sd-discount').value  || 0;
  const totalPay = advC + advB + cashP + bkashP;
  const due = Math.max(0, fee - totalPay - disc);
  document.getElementById('sd-due').value      = due.toLocaleString() + ' BDT';
  document.getElementById('sd-totalpay').value = totalPay.toLocaleString();
}

async function slotActionSave() {
  const m = document.getElementById('sd-modal-root');
  if (!m) return;
  const id          = m.dataset.bookingId;
  const containerId = m.dataset.containerId;
  const pmt    = document.getElementById('sd-payment').value;
  const advC   = +document.getElementById('sd-advcash').value   || 0;
  const advB   = +document.getElementById('sd-advbkash').value  || 0;
  const cashP  = +document.getElementById('sd-cashpaid').value  || 0;
  const bkashP = +document.getElementById('sd-bkashpaid').value || 0;
  const disc   = +document.getElementById('sd-discount').value  || 0;

  let status;
  if      (pmt === 'Cancelled') status = 'cancelled';
  else if (pmt === 'Paid')      status = 'confirmed';
  else                          status = 'pending';

  const advanceLocked = pmt === 'Advanced' || pmt === 'Paid';
  const paymentLocked = pmt === 'Paid';

  const update = { status, advance_cash: advC, advance_bkash: advB, cash_paid: cashP, bkash_paid: bkashP, discount: disc, advance_locked: advanceLocked, payment_locked: paymentLocked };
  let { error } = await sb.from('bookings').update(update).eq('id', id);
  if (error) {
    const r2 = await sb.from('bookings').update({ status }).eq('id', id);
    if (r2.error) { alert('Save failed: ' + r2.error.message); return; }
    console.warn('Payment columns not stored:', error.message);
  }

  // Payment = Paid হলে Confirm করা হয়েছে — সব fields read-only করো
  if (pmt === 'Paid') {
    _lockModalFields();
    return; // modal বন্ধ করব না, locked অবস্থায় দেখাবে
  }

  closeSlotDetailModal();
  if (containerId.startsWith('mgr')) loadAdminPanel();
  else loadSaPanel();
}

// Confirm করার পর modal এর সব editable field lock করে দেওয়া
function _lockModalFields() {
  // সব input/select এ readonly/disabled করো
  ['sd-payment','sd-advcash','sd-advbkash','sd-cashpaid','sd-bkashpaid','sd-discount'].forEach(function(fid) {
    const el = document.getElementById(fid);
    if (!el) return;
    el.disabled = true;
    el.classList.add('sd-ro');
  });
  // Book/Confirm button disable
  const bookBtn = document.getElementById('sd-book-btn');
  if (bookBtn) { bookBtn.disabled = true; bookBtn.style.opacity = '0.5'; bookBtn.style.cursor = 'not-allowed'; }
  // Clear button disable
  const clearBtn = document.querySelector('.sd-btn.clear');
  if (clearBtn) { clearBtn.disabled = true; clearBtn.style.opacity = '0.5'; clearBtn.style.cursor = 'not-allowed'; }
  // SMS textarea readonly
  const ta = document.getElementById('sd-smsbody');
  if (ta) { ta.readOnly = true; ta.classList.add('sd-ro'); }
  // Confirmed badge দেখানো
  const head = document.querySelector('.sd-head .sd-title');
  if (head && !head.querySelector('.confirmed-badge')) {
    const badge = document.createElement('span');
    badge.className = 'confirmed-badge';
    badge.style.cssText = 'margin-left:8px;background:#0E7A3B;color:#fff;font-size:11px;padding:3px 8px;border-radius:999px;font-weight:600';
    badge.textContent = '✅ Confirmed';
    head.appendChild(badge);
  }
}
function _lockAdvanceFields() {
  ['sd-advcash','sd-advbkash'].forEach(function(fid) {
    const el = document.getElementById(fid);
    if (!el) return;
    el.disabled = true;
    el.classList.add('sd-ro');
  });
}
function slotActionClear() {
  const m = document.getElementById('sd-modal-root');
  const b = m ? findBookingById(m.dataset.containerId, m.dataset.bookingId) : null;
  if (b && b.payment_locked) return;
  const fields = (b && b.advance_locked)
    ? ['sd-cashpaid','sd-bkashpaid','sd-discount']
    : ['sd-advcash','sd-advbkash','sd-cashpaid','sd-bkashpaid','sd-discount'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const sel = document.getElementById('sd-payment');
  if (sel) { sel.value = 'Advanced'; onPaymentStatusChange(sel); }
  recalcSlotPay();
  const ta = document.getElementById('sd-smsbody');
  if (ta) ta.value = '';
}

async function slotActionCancel() {
  const m = document.getElementById('sd-modal-root');
  if (!m) return;
  if (!confirm('এই booking টি cancel করবেন?')) return;
  const id = m.dataset.bookingId;
  const containerId = m.dataset.containerId;
  await sb.from('bookings').update({ status: 'cancelled' }).eq('id', id);
  closeSlotDetailModal();
  if (containerId.startsWith('mgr')) loadAdminPanel();
  else loadSaPanel();
}

function slotActionPrint() {
  const m = document.getElementById('sd-modal-root');
  if (!m) return;
  const b = findBookingById(m.dataset.containerId, m.dataset.bookingId);
  if (!b) return;
  const fee    = +b.amount || 0;
  const advC   = +document.getElementById('sd-advcash').value   || 0;
  const advB   = +document.getElementById('sd-advbkash').value  || 0;
  const cashP  = +document.getElementById('sd-cashpaid').value  || 0;
  const bkashP = +document.getElementById('sd-bkashpaid').value || 0;
  const disc   = +document.getElementById('sd-discount').value  || 0;
  const totalPay = advC + advB + cashP + bkashP;
  const due = Math.max(0, fee - totalPay - disc);
  const html =
    '<html><head><title>Booking Receipt</title>' +
    '<style>body{font-family:sans-serif;padding:20px;max-width:420px;margin:auto}h2{text-align:center;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:14px}td{padding:7px 6px;border-bottom:1px solid #ddd;font-size:14px}td:first-child{color:#666;width:42%}</style>' +
    '</head><body>' +
    '<h2>El Clasico Football Arena</h2>' +
    '<div style="text-align:center;color:#666;font-size:12px">Booking Receipt</div>' +
    '<table>' +
    '<tr><td>নাম</td><td>'          + (b.name||'')              + '</td></tr>' +
    '<tr><td>মোবাইল</td><td>'       + (b.phone||'')             + '</td></tr>' +
    '<tr><td>ঠিকানা</td><td>'       + (b.address||b.note||'')   + '</td></tr>' +
    '<tr><td>তারিখ</td><td>'        + (b.booking_date||'')      + '</td></tr>' +
    '<tr><td>সময়</td><td>'          + fmtMin(b._start) + ' - ' + fmtMin(b._end) + '</td></tr>' +
    '<tr><td>ফি</td><td>'           + fee.toLocaleString()       + ' BDT</td></tr>' +
    '<tr><td>অগ্রিম ক্যাশ</td><td>' + advC.toLocaleString()     + '</td></tr>' +
    '<tr><td>অগ্রিম বিকাশ</td><td>' + advB.toLocaleString()     + '</td></tr>' +
    '<tr><td>ক্যাশ জমা</td><td>'    + cashP.toLocaleString()    + '</td></tr>' +
    '<tr><td>বিকাশ জমা</td><td>'    + bkashP.toLocaleString()   + '</td></tr>' +
    '<tr><td>ডিসকাউন্ট</td><td>'    + disc.toLocaleString()     + '</td></tr>' +
    '<tr><td>মোট জমা</td><td>'      + totalPay.toLocaleString() + '</td></tr>' +
    '<tr><td>বকেয়া</td><td><b>'     + due.toLocaleString()      + ' BDT</b></td></tr>' +
    '</table>' +
    '<div style="text-align:center;margin-top:16px;font-size:12px;color:#666">Thank you ⚽</div>' +
    '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},300);};</scr' + 'ipt>' +
    '</body></html>';
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

function slotActionSmsSim() {
  const m = document.getElementById('sd-modal-root');
  if (!m) return;
  const phone = m.dataset.phone || '';
  if (!phone) { alert('Phone number missing!'); return; }
  const body = (document.getElementById('sd-smsbody').value || '').trim();
  window.location.href = 'sms:0' + phone + '?body=' + encodeURIComponent(body);
}

function slotActionSmsWA() {
  const m = document.getElementById('sd-modal-root');
  if (!m) return;
  const b = findBookingById(m.dataset.containerId, m.dataset.bookingId);
  if (!b) return;
  waConfirmBooking(b.id, b.name || '', b.booking_date, b.time ? b.time.slice(0,5) : '', b.phone || '', String(b.duration_minutes || 60));
}

function slotActionCallSim() {
  const m = document.getElementById('sd-modal-root');
  if (!m) return;
  const phone = m.dataset.phone || '';
  if (!phone) { alert('Phone number missing!'); return; }
  window.location.href = 'tel:0' + phone;
}

function slotActionCallWA() {
  const m = document.getElementById('sd-modal-root');
  if (!m) return;
  const b = findBookingById(m.dataset.containerId, m.dataset.bookingId);
  if (!b) return;
  waConfirmBooking(b.id, b.name || '', b.booking_date, b.time ? b.time.slice(0,5) : '', b.phone || '', String(b.duration_minutes || 60));
}

// ============================================================
// Unbooked slot click
// ============================================================
function openUnbookedSlot(containerId, dateStr, timeStr, durMin) {
  if (containerId.startsWith('mgr')) {
    const dt = document.getElementById('m-date'); if (dt) dt.value = dateStr;
    const tm = document.getElementById('m-time'); if (tm) tm.value = timeStr;
    if (typeof setMDur === 'function') {
      const btn = document.querySelector('#m-dbtns .db[data-dur="' + durMin + '"]') || document.querySelector('#m-dbtns .db');
      if (btn) setMDur(durMin, btn);
      else { mgrDur = durMin; if (typeof updateMTotal === 'function') updateMTotal(); }
    }
    const tabs = document.querySelectorAll('#mgr-panel .at');
    if (tabs.length >= 2) mgrTab('newbook', tabs[1]);
    setTimeout(() => { const el = document.getElementById('mgr-newbook'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
  } else {
    if (typeof goPage === 'function') {
      const dInp = document.getElementById('b-date'); if (dInp) dInp.value = dateStr;
      const tInp = document.getElementById('b-time'); if (tInp) tInp.value = timeStr;
      goPage('book');
      if (typeof buildSlots === 'function') buildSlots();
    }
  }
}
