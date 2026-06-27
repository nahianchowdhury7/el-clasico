// ============================================================
// SADMIN.JS — Super Admin panel এর সব functions
// Depends on: app.js (sb, today, fmtTime, calcAmt, basePrices,
//             blockedSlots, allSlots, slotLbl, getTimeRate,
//             calYear, calMonth, buildSlots, updateTotal, updateMTotal,
//             loadGallery, loadReviews)
//             manager.js (renderAdminTable, renderStats,
//             toggleStatus, delBooking, waConfirmBooking, renderBlockGrid,
//             openSlotDetailModal, openUnbookedSlot, refreshSlotGrid)
// ============================================================

// ============================================================
// SUPER ADMIN LOGIN
// ============================================================
async function saLogin() {
  const email = document.getElementById('sa-email').value.trim();
  const pw    = document.getElementById('sa-pw').value;
  if (!email || !pw) { showSaErr('Email ও password দিন'); return; }

  const btn = document.getElementById('sa-login-btn');
  btn.innerHTML = '<span class="spin"></span>Checking...';
  btn.disabled = true;

  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  btn.innerHTML = 'Login';
  btn.disabled = false;

  if (error) { showSaErr('Login failed: ' + error.message); return; }

  const { data: { user } } = await sb.auth.getUser();
  const { data: adm } = await sb.from('admins').select('role').eq('id', user.id).single();

  if (!adm || adm.role !== 'superadmin') {
    showSaErr('SuperAdmin access নেই');
    await sb.auth.signOut();
    return;
  }

  adminRole = 'superadmin';
  document.getElementById('sa-auth-check').style.display = 'none';
  document.getElementById('sa-panel').classList.add('show');
  loadSaPanel();
  startSaAutoRefresh();
}

function showSaErr(msg) {
  const e = document.getElementById('sa-err');
  e.textContent = msg;
  e.style.display = 'block';
}

let saRefreshTimer = null;
function startSaAutoRefresh() {
  if (saRefreshTimer) clearInterval(saRefreshTimer);
  saRefreshTimer = setInterval(() => {
    const panel = document.getElementById('sa-panel');
    if (panel && panel.classList.contains('show')) {
      const activeTab = document.querySelector('#sa-panel .at.on');
      if (activeTab) {
        const tabText = activeTab.textContent.trim().toLowerCase();
        if (tabText === 'bookings') loadSaPanel();
      }
    }
  }, 10000);
}

// ============================================================
// SA PANEL — main load
// ============================================================
async function loadSaPanel() {
  const { data } = await sb.from('bookings')
    .select('*')
    .order('booking_date', { ascending: false });

  const bookings = data || [];
  renderAdminTable('sa-bookings', bookings);
  renderStats('sa-stats', bookings);
  document.getElementById('sa-blk-date').value = today;
  renderBlockGrid('sa-blk-grid', 'sa-blk-date');
  buildRevChart(bookings);
  buildCalendar(bookings);
}

// ============================================================
// SA TABS
// ============================================================
function saTab(tab, el) {
  document.querySelectorAll('#sa-panel .at').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  ['bookings', 'revenue', 'calendar', 'block', 'pricing', 'reviews', 'gallery', 'customers'].forEach(t => {
    document.getElementById('sa-' + t).style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'revenue')  loadSaPanel();
  if (tab === 'calendar') loadSaPanel();
  if (tab === 'reviews')  loadAdminReviews();
  if (tab === 'gallery')  loadAdminGallery();
  if (tab === 'customers') loadSaCustomers();
}

// ============================================================
// REVENUE CHART
// ============================================================
let revFilter_ = 'week';

function setRevFilter(f, el) {
  revFilter_ = f;
  document.querySelectorAll('.rf').forEach(r => r.classList.remove('on'));
  el.classList.add('on');
  loadSaPanel();
}

function buildRevChart(bookings) {
  const g = document.getElementById('rev-bars');
  if (!g) return;
  const confirmed = bookings.filter(b => b.status === 'confirmed');
  let labels, data;

  if (revFilter_ === 'week') {
    labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    data = [0, 0, 0, 0, 0, 0, 0];
    confirmed.forEach(b => {
      const d = new Date(b.booking_date);
      const dow = (d.getDay() + 6) % 7;
      data[dow] += (b.amount || 0);
    });
  } else {
    labels = ['W1', 'W2', 'W3', 'W4'];
    data = [0, 0, 0, 0];
    confirmed.forEach(b => {
      const d = new Date(b.booking_date);
      const w = Math.floor((d.getDate() - 1) / 7);
      if (w < 4) data[w] += (b.amount || 0);
    });
  }

  const mx    = Math.max(...data, 1);
  const total = data.reduce((a, b) => a + b, 0);

  g.innerHTML = data.map((v, i) =>
    `<div class="bar-col">
      <div class="bar-val">৳${Math.round(v / 1000)}k</div>
      <div class="bar" style="height:${Math.round(v / mx * 110)}px"></div>
      <div class="bar-lbl">${labels[i]}</div>
    </div>`
  ).join('');

  document.getElementById('rev-total').textContent    = '৳' + total.toLocaleString();
  document.getElementById('rev-avg').textContent      = '৳' + Math.round(total / Math.max(data.length, 1)).toLocaleString();
  document.getElementById('rev-bookings').textContent = confirmed.length;
}

// ============================================================
// CALENDAR
// ============================================================
function buildCalendar(bookings = []) {
  const g = document.getElementById('cal-grid');
  if (!g) return;

  const mn = ['January','February','March','April','May','June',
              'July','August','September','October','November','December'];
  document.getElementById('cal-title').textContent = mn[calMonth] + ' ' + calYear;
  g.innerHTML = '';

  ['S','M','T','W','T','F','S'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'cal-dh';
    h.textContent = d;
    g.appendChild(h);
  });

  const first     = new Date(calYear, calMonth, 1).getDay();
  const days      = new Date(calYear, calMonth + 1, 0).getDate();
  const todayDate = new Date();

  for (let i = 0; i < first; i++) {
    const e = document.createElement('div');
    e.className = 'cal-d empty';
    g.appendChild(e);
  }

  for (let d = 1; d <= days; d++) {
    const el      = document.createElement('div');
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const bkCount = bookings.filter(b => b.booking_date === dateStr && b.status === 'confirmed').length;
    const cls     = bkCount === 0 ? 'avail' : bkCount < 3 ? 'busy' : 'full';
    el.className  = `cal-d ${cls}`;
    if (d === todayDate.getDate() && calMonth === todayDate.getMonth() && calYear === todayDate.getFullYear())
      el.classList.add('today');
    el.textContent = d;
    el.title = `${bkCount} booking(s)`;
    g.appendChild(el);
  }
}

function calNav(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  loadSaPanel();
}

// ============================================================
// PRICING
// ============================================================
function savePricing() {
  basePrices.night = parseInt(document.getElementById('sp-night').value) || 2500;
  basePrices.early = parseInt(document.getElementById('sp-early').value) || 1500;
  basePrices.day   = parseInt(document.getElementById('sp-day').value)   || 1200;
  basePrices.eve   = parseInt(document.getElementById('sp-eve').value)   || 1800;
  buildSlots();
  updateTotal();
  updateMTotal();
  if (typeof refreshSlotGrid === 'function') {
    if (document.getElementById('sa-bookings'))  refreshSlotGrid('sa-bookings');
    if (document.getElementById('mgr-bookings')) refreshSlotGrid('mgr-bookings');
  }
  const s = document.getElementById('price-saved');
  s.style.display = 'block';
  setTimeout(() => s.style.display = 'none', 2000);
}

// ============================================================
// REVIEWS ADMIN
// ============================================================
async function loadAdminReviews() {
  const c = document.getElementById('sa-reviews-list');
  if (!c) return;
  const { data } = await sb.from('reviews').select('*').order('created_at', { ascending: false });
  if (!data || !data.length) {
    c.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">No reviews yet.</div>';
    return;
  }
  c.innerHTML = data.map(r => `
    <div class="hist-item">
      <div class="hist-top">
        <span class="hist-name">${r.name}</span>
        <span class="bdg ${r.approved ? 'cf' : 'pd'}">${r.approved ? 'Approved' : 'Pending'}</span>
      </div>
      <div style="color:var(--gold);font-size:12px;margin-bottom:3px">${'★'.repeat(r.rating)}</div>
      <div class="rev-text" style="margin-bottom:6px">${r.review}</div>
      <div style="display:flex;gap:6px">
        <button class="abtn" onclick="approveReview('${r.id}',${r.approved})">${r.approved ? 'Unapprove' : 'Approve'}</button>
        <button class="abtn del" onclick="deleteReview('${r.id}')">Delete</button>
      </div>
    </div>`).join('');
}

async function approveReview(id, current) {
  await sb.from('reviews').update({ approved: !current }).eq('id', id);
  loadAdminReviews();
}

async function deleteReview(id) {
  if (!confirm('Delete this review?')) return;
  await sb.from('reviews').delete().eq('id', id);
  loadAdminReviews();
  loadReviews();
}

// ============================================================
// GALLERY ADMIN
// ============================================================
async function loadAdminGallery() {
  const c = document.getElementById('sa-gallery-list');
  if (!c) return;
  const { data } = await sb.from('gallery').select('*').order('created_at', { ascending: false });
  if (!data || !data.length) {
    c.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">No photos yet.</div>';
    return;
  }
  c.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-top:.8rem">
      ${data.map(p => `
        <div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--bdr)">
          <img src="${p.image_url}" style="width:100%;aspect-ratio:4/3;object-fit:cover" loading="lazy"
               onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 75%22><rect width=%22100%22 height=%2275%22 fill=%22%23111%22/><text x=%2250%22 y=%2237%22 text-anchor=%22middle%22 fill=%22%23555%22 font-size=%2212%22>Error</text></svg>'">
          <div style="padding:4px 6px;font-size:10px;color:var(--muted)">${p.category}</div>
          <button class="abtn del" style="position:absolute;top:4px;right:4px;padding:2px 6px" onclick="deleteGalleryPhoto('${p.id}')">✕</button>
        </div>`).join('')}
    </div>`;
}

async function addGalleryPhoto() {
  const fileInput = document.getElementById('gal-file');
  const cat       = document.getElementById('gal-cat').value.trim();
  const caption   = document.getElementById('gal-caption').value.trim();
  const file      = fileInput.files[0];

  if (!file)  { alert('ছবি select করুন!'); return; }
  if (!cat)   { alert('Category দিন!'); return; }
  if (file.size > 5 * 1024 * 1024) { alert('ছবি ৫MB-এর বেশি হতে পারবে না!'); return; }

  const btn = document.querySelector('#sa-gallery .cbtn');
  btn.innerHTML = '<span class="spin"></span>Uploading...';
  btn.disabled = true;

  const ext      = file.name.split('.').pop();
  const fileName = Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;

  const { error: uploadError } = await sb.storage
    .from('gallery')
    .upload(fileName, file, { cacheControl: '3600', upsert: false, contentType: file.type });

  btn.innerHTML = 'Upload Photo';
  btn.disabled = false;

  if (uploadError) { alert('Upload error: ' + uploadError.message); return; }

  const { data: urlData } = sb.storage.from('gallery').getPublicUrl(fileName);
  const publicUrl = urlData.publicUrl;

  const { error } = await sb.from('gallery').insert({ image_url: publicUrl, category: cat, caption: caption || null });
  if (error) { alert('DB Error: ' + error.message); return; }

  fileInput.value = '';
  document.getElementById('gal-preview').innerHTML = '';
  document.getElementById('gal-caption').value = '';
  loadAdminGallery();
  loadGallery();
  alert('Photo uploaded! ✅');
}

async function deleteGalleryPhoto(id) {
  if (!confirm('Delete this photo?')) return;
  await sb.from('gallery').delete().eq('id', id);
  loadAdminGallery();
  loadGallery();
}

// ============================================================
// GALLERY FILE PREVIEW
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
  const fi = document.getElementById('gal-file');
  if (fi) {
    fi.addEventListener('change', function () {
      const prev = document.getElementById('gal-preview');
      if (this.files && this.files[0]) {
        const r = new FileReader();
        r.onload = function (e) {
          prev.innerHTML = `<img src="${e.target.result}" style="width:100%;max-height:140px;object-fit:cover;border-radius:8px;margin-top:4px">`;
        };
        r.readAsDataURL(this.files[0]);
      } else {
        prev.innerHTML = '';
      }
    });
  }
});
// ============================================================
// CUSTOMERS
// ============================================================
async function loadSaCustomers() {
  const c = document.getElementById('sa-customers-list');
  if (!c) return;
  c.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px"><span class="spin"></span>Loading...</div>';

  const { data, error } = await sb.from('bookings').select('*');
  if (error) { c.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">Error loading customers.</div>'; return; }

  const esc = v => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const map = {};

  (data || []).forEach(b => {
    const key = (b.phone || '').trim();
    if (!key) return;
    if (!map[key]) map[key] = { name: '', phone: key, address: '', email: '', count: 0, totalPaid: 0 };
    const cust = map[key];
    if (b.name) cust.name = b.name;
    if (b.address) cust.address = b.address;
    if (b.email) cust.email = b.email;
    if (b.status !== 'cancelled') cust.count += 1;
    cust.totalPaid += (b.advance_cash || 0) + (b.advance_bkash || 0) + (b.cash_paid || 0) + (b.bkash_paid || 0);
  });

  const customers = Object.values(map).sort((a, b) => b.totalPaid - a.totalPaid);

  if (!customers.length) {
    c.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">No customers yet.</div>';
    return;
  }

  c.innerHTML = `
    <div style="overflow-x:auto">
    <table class="btable" style="min-width:760px">
      <thead><tr>
        <th>Name</th><th>Phone</th><th>Address</th><th>Email</th><th>Slots booked</th><th>Total paid</th>
      </tr></thead>
      <tbody>
        ${customers.map(cu => `
          <tr>
            <td>${esc(cu.name) || '—'}</td>
            <td>${esc(cu.phone)}</td>
            <td>${esc(cu.address) || '—'}</td>
            <td>${esc(cu.email) || '—'}</td>
            <td>${cu.count}</td>
            <td>৳${cu.totalPaid.toLocaleString()}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}
