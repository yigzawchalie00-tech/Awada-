// ── STATE ─────────────────────────────────────────────────────────
let token = localStorage.getItem('gubae_token');
let currentUser = null;
let currentLang = localStorage.getItem('gubae_lang') || 'am';
let currentPage = 1;
let searchTimeout = null;

const GUBAE_DEPTS = [
  'ሰብሳቢ','ምክትል ሰብሳቢ','ፀሀፊ',
  'ሙያ እና በጎ አድራጎት','ትምህርት እና ሐዋርያዊ አገልግሎት',
  'መዝሙር እና ኪነ ጥበብ','አባላትና እንክብካቤ','ቋንቋ እና ልዩ ድጋፍ',
  'ኦዲት እና ኢንስፔክሽን','ባች እና መርሃግብር አስተባባሪ','ሒሳብ ክፍል','ገንዘብ ያዥ'
];

// ── API HELPERS ───────────────────────────────────────────────────
async function api(method, path, data, isFormData = false) {
  const opts = {
    method,
    headers: { Authorization: token ? `Bearer ${token}` : '' },
  };
  if (data) {
    if (isFormData) {
      opts.body = data;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(data);
    }
  }
  const res = await fetch(path, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

// ── LANGUAGE ──────────────────────────────────────────────────────
function applyLang() {
  document.querySelectorAll('[data-am][data-en]').forEach(el => {
    el.textContent = currentLang === 'am' ? el.dataset.am : el.dataset.en;
  });
  document.getElementById('lang-toggle').textContent = currentLang === 'am' ? 'English' : 'አማርኛ';
}

// ── TOAST ─────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ── NAVIGATION ────────────────────────────────────────────────────
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('page-' + pageId).style.display = 'block';
  const link = document.querySelector(`.nav-link[data-page="${pageId}"]`);
  if (link) link.classList.add('active');
}

// ── AUTH ──────────────────────────────────────────────────────────
async function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const data = await api('POST', '/api/auth/login', { username, password });
    token = data.token;
    localStorage.setItem('gubae_token', token);
    currentUser = data;
    initApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function checkAuth() {
  if (!token) return false;
  try {
    currentUser = await api('GET', '/api/auth/me');
    return true;
  } catch {
    token = null;
    localStorage.removeItem('gubae_token');
    return false;
  }
}

function logout() {
  token = null;
  localStorage.removeItem('gubae_token');
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

// ── APP INIT ──────────────────────────────────────────────────────
function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  document.getElementById('sidebar-user').textContent =
    `${currentUser.fullName || currentUser.username} (${currentUser.role})`;

  // Show/hide role-specific nav
  const isAdmin = ['super_admin', 'admin'].includes(currentUser.role);
  const isSuperAdmin = currentUser.role === 'super_admin';
  document.getElementById('nav-add').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('nav-admins').style.display = isSuperAdmin ? 'flex' : 'none';

  // Populate filter dropdowns
  const deptSelect = document.getElementById('filter-dept');
  GUBAE_DEPTS.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    deptSelect.appendChild(opt);
  });

  loadDashboard();
  showPage('dashboard');
  applyLang();
}

// ── DASHBOARD ─────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const stats = await api('GET', '/api/stats');
    const grid = document.getElementById('stats-grid');
    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label" data-am="ጠቅላላ አባላት" data-en="Total Members">ጠቅላላ አባላት</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--accent-2)">${stats.active}</div>
        <div class="stat-label" data-am="ንቁ አባላት" data-en="Active Members">ንቁ አባላት</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.graduated}</div>
        <div class="stat-label" data-am="ተመርቀዋል" data-en="Graduated">ተመርቀዋል</div>
      </div>
    `;

    const maxDept = Math.max(...stats.byDepartment.map(d => d.count), 1);
    document.getElementById('dept-chart').innerHTML = stats.byDepartment.map(d => `
      <div class="bar-row">
        <div class="bar-label">${d.gubae_department}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(d.count/maxDept*100).toFixed(0)}%"></div></div>
        <div class="bar-count">${d.count}</div>
      </div>
    `).join('') || '<div style="color:var(--text-dim);font-size:13px;">ምንም ክፍሎች የሉም</div>';

    const maxBatch = Math.max(...stats.byBatch.map(b => b.count), 1);
    document.getElementById('batch-chart').innerHTML = stats.byBatch.map(b => `
      <div class="bar-row">
        <div class="bar-label">${b.batch}</div>
        <div class="bar-track"><div class="bar-fill green" style="width:${(b.count/maxBatch*100).toFixed(0)}%"></div></div>
        <div class="bar-count">${b.count}</div>
      </div>
    `).join('') || '<div style="color:var(--text-dim);font-size:13px;">ምንም ባቾች የሉም</div>';

    applyLang();
  } catch (err) {
    showToast('Could not load dashboard', 'error');
  }
}

// ── MEMBERS ───────────────────────────────────────────────────────
async function loadMembers(page = 1) {
  currentPage = page;
  const search = document.getElementById('search-input').value;
  const status = document.getElementById('filter-status').value;
  const dept = document.getElementById('filter-dept').value;
  const batch = document.getElementById('filter-batch').value;

  const params = new URLSearchParams({ page, limit: 24 });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (dept) params.set('gubae_department', dept);
  if (batch) params.set('batch', batch);

  try {
    const data = await api('GET', `/api/members?${params}`);
    const grid = document.getElementById('members-grid');

    if (data.members.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-dim);padding:40px;font-family:var(--serif-am);">
        ${currentLang === 'am' ? 'ምንም አባላት አልተገኙም' : 'No members found'}
      </div>`;
    } else {
      grid.innerHTML = data.members.map(m => `
        <div class="member-card" onclick="viewMember(${m.id})">
          <div class="member-avatar">
            ${m.photo_url ? `<img src="${m.photo_url}" alt="">` : '✞'}
          </div>
          <div class="member-name">${m.first_name} ${m.father_name}</div>
          ${m.baptism_name ? `<div class="member-sub">${m.baptism_name}</div>` : ''}
          <div class="member-sub">${m.university_department || ''} ${m.batch ? '· ባች ' + m.batch : ''}</div>
          ${m.gubae_department ? `<div class="member-sub" style="color:var(--accent);font-size:11px;">${m.gubae_department}</div>` : ''}
          <span class="member-badge ${m.status === 'active' ? 'badge-active' : 'badge-graduated'}">
            ${m.status === 'active' ? (currentLang === 'am' ? 'ንቁ' : 'Active') : (currentLang === 'am' ? 'ተመርቀዋል' : 'Graduated')}
          </span>
        </div>
      `).join('');
    }

    // Pagination
    const totalPages = Math.ceil(data.total / 24);
    const pag = document.getElementById('pagination');
    pag.innerHTML = '';
    for (let i = 1; i <= totalPages; i++) {
      const btn = document.createElement('button');
      btn.className = `page-btn ${i === page ? 'active' : ''}`;
      btn.textContent = i;
      btn.onclick = () => loadMembers(i);
      pag.appendChild(btn);
    }
  } catch (err) {
    showToast('Could not load members', 'error');
  }
}

// ── MEMBER DETAIL ─────────────────────────────────────────────────
async function viewMember(id) {
  try {
    const m = await api('GET', `/api/members/${id}`);
    showPage('member-detail');

    const isAdmin = ['super_admin', 'admin'].includes(currentUser.role);
    const isSuperAdmin = currentUser.role === 'super_admin';

    document.getElementById('detail-actions').innerHTML = `
      ${isAdmin ? `<button class="btn-ghost" onclick="editMember(${id})">✏️ ${currentLang === 'am' ? 'አርትዕ' : 'Edit'}</button>` : ''}
      ${isSuperAdmin ? `<button class="btn-danger" onclick="deleteMember(${id})">🗑 ${currentLang === 'am' ? 'ሰርዝ' : 'Delete'}</button>` : ''}
    `;

    const f = (val) => val || `<span style="color:var(--text-dim);">—</span>`;
    document.getElementById('member-detail-content').innerHTML = `
      <div class="detail-card">
        <div class="detail-header">
          <div class="detail-photo">
            ${m.photo_url ? `<img src="${m.photo_url}" alt="">` : '✞'}
          </div>
          <div>
            <div class="detail-name">${m.title ? m.title + ' ' : ''}${m.first_name} ${m.father_name} ${m.grandfather_name || ''}</div>
            ${m.baptism_name ? `<div style="color:var(--accent);font-size:14px;">✞ ${m.baptism_name}</div>` : ''}
            <span class="member-badge ${m.status === 'active' ? 'badge-active' : 'badge-graduated'}" style="margin-top:8px;display:inline-block;">
              ${m.status === 'active' ? 'ንቁ / Active' : 'ተመርቀዋል / Graduated'}
            </span>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-label">የግል መረጃ / Personal</div>
          <div class="detail-grid">
            <div class="detail-field"><label>ጾታ / Gender</label><span>${f(m.gender)}</span></div>
            <div class="detail-field"><label>የትዉልድ ቀን / DOB</label><span>${f(m.date_of_birth ? new Date(m.date_of_birth).toLocaleDateString('am-ET') : null)}</span></div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-label">የትዉልድ ቦታ / Origin</div>
          <div class="detail-grid">
            <div class="detail-field"><label>ክልል / Region</label><span>${f(m.region)}</span></div>
            <div class="detail-field"><label>ዞን / Zone</label><span>${f(m.zone)}</span></div>
            <div class="detail-field"><label>ወረዳ / Woreda</label><span>${f(m.woreda)}</span></div>
            <div class="detail-field"><label>ማእከል / Center</label><span>${f(m.center)}</span></div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-label">መንፈሳዊ / Spiritual</div>
          <div class="detail-grid">
            <div class="detail-field"><label>የክርስትና ስም / Baptism Name</label><span>${f(m.baptism_name)}</span></div>
            <div class="detail-field"><label>የንስሐ አባት / Confession Father</label><span>${f(m.confession_father)}</span></div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-label">ዩኒቨርሲቲ / University</div>
          <div class="detail-grid">
            <div class="detail-field"><label>ዲፓርትመንት</label><span>${f(m.university_department)}</span></div>
            <div class="detail-field"><label>ባች / Batch</label><span>${f(m.batch)}</span></div>
            <div class="detail-field"><label>ሴክሽን / Section</label><span>${f(m.section)}</span></div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-label">ግንኙነት / Contact</div>
          <div class="detail-grid">
            <div class="detail-field"><label>ስልክ / Phone</label><span>${f(m.phone)}</span></div>
            <div class="detail-field"><label>ኢሜይል / Email</label><span>${f(m.email)}</span></div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-label">የጉባኤ አገልግሎት / Ministry</div>
          <div class="detail-grid">
            <div class="detail-field"><label>ክፍል / Department</label><span>${f(m.gubae_department)}</span></div>
            <div class="detail-field"><label>የተቀበሉበት ቀን / Joined</label><span>${f(m.joining_date ? new Date(m.joining_date).toLocaleDateString('am-ET') : null)}</span></div>
            ${m.graduation_year ? `<div class="detail-field"><label>ተመረቁ / Graduated</label><span>${m.graduation_year}</span></div>` : ''}
          </div>
        </div>

        ${m.notes ? `
        <div class="detail-section">
          <div class="detail-section-label">ማሳሰቢያ / Notes</div>
          <p style="font-size:14px;color:var(--text);line-height:1.6;">${m.notes}</p>
        </div>` : ''}
      </div>
    `;
  } catch (err) {
    showToast('Could not load member', 'error');
  }
}

// ── MEMBER FORM (add/edit) ────────────────────────────────────────
function showAddForm() {
  document.getElementById('edit-member-id').value = '';
  document.getElementById('member-form').reset();
  document.getElementById('photo-preview').style.display = 'none';
  document.getElementById('photo-placeholder').style.display = 'block';
  document.getElementById('form-title').dataset.am = 'አባል ጨምር';
  document.getElementById('form-title').dataset.en = 'Add Member';
  document.getElementById('form-title').textContent = currentLang === 'am' ? 'አባል ጨምር' : 'Add Member';
  document.getElementById('graduation-year-row').style.display = 'none';
  document.getElementById('form-error').textContent = '';
  showPage('add-member');
}

async function editMember(id) {
  try {
    const m = await api('GET', `/api/members/${id}`);
    document.getElementById('edit-member-id').value = id;
    document.getElementById('form-title').dataset.am = 'አባል አርትዕ';
    document.getElementById('form-title').dataset.en = 'Edit Member';
    document.getElementById('form-title').textContent = currentLang === 'am' ? 'አባል አርትዕ' : 'Edit Member';

    const fields = ['title','first_name','father_name','grandfather_name','gender',
      'date_of_birth','region','zone','woreda','center','baptism_name','confession_father',
      'university_department','batch','section','email','phone','gubae_department',
      'joining_date','status','graduation_year','notes'];

    fields.forEach(f => {
      const el = document.getElementById('f-' + f);
      if (!el) return;
      let val = m[f] || '';
      if ((f === 'date_of_birth' || f === 'joining_date') && val) {
        val = val.split('T')[0];
      }
      el.value = val;
    });

    if (m.photo_url) {
      const prev = document.getElementById('photo-preview');
      prev.src = m.photo_url;
      prev.style.display = 'block';
      document.getElementById('photo-placeholder').style.display = 'none';
    }

    document.getElementById('graduation-year-row').style.display =
      m.status === 'graduated' ? 'grid' : 'none';

    document.getElementById('form-error').textContent = '';
    showPage('add-member');
    applyLang();
  } catch (err) {
    showToast('Could not load member for editing', 'error');
  }
}

async function submitMemberForm(e) {
  e.preventDefault();
  const errEl = document.getElementById('form-error');
  errEl.textContent = '';
  const memberId = document.getElementById('edit-member-id').value;
  const formData = new FormData(document.getElementById('member-form'));

  if (memberId) {
    const existing = document.getElementById('photo-preview');
    if (existing.src && existing.style.display !== 'none') {
      formData.append('existing_photo_url', existing.src);
    }
  }

  try {
    const method = memberId ? 'PUT' : 'POST';
    const path = memberId ? `/api/members/${memberId}` : '/api/members';
    await api(method, path, formData, true);
    showToast(memberId ? 'Member updated!' : 'Member added!', 'success');
    showPage('members');
    loadMembers(1);
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteMember(id) {
  if (!confirm(currentLang === 'am' ? 'እርግጠኛ ነህ? አባሉ ሙሉ በሙሉ ይሰረዛል።' : 'Are you sure? This will permanently delete the member.')) return;
  try {
    await api('DELETE', `/api/members/${id}`);
    showToast('Member deleted.', 'success');
    showPage('members');
    loadMembers(1);
  } catch (err) {
    showToast('Could not delete member', 'error');
  }
}

// ── IMPORT FROM EXCEL ─────────────────────────────────────────────
async function importFromExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (rows.length === 0) {
          showToast('ፋይሉ ባዶ ነው / File is empty', 'error');
          return;
        }

        // Map column headers — supports both Amharic and English header names
        const members = rows.map(row => ({
          title:                  row['ማእረግ']          || row['title']                  || '',
          first_name:             row['ስም']             || row['first_name']             || '',
          father_name:            row['የአባት ስም']        || row['father_name']            || '',
          grandfather_name:       row['የአያት ስም']        || row['grandfather_name']        || '',
          baptism_name:           row['የክርስትና ስም']      || row['baptism_name']           || '',
          gender:                 row['ጾታ']             || row['gender']                 || '',
          date_of_birth:          row['የትዉልድ ቀን']       || row['date_of_birth']          || '',
          region:                 row['ክልል']            || row['region']                 || '',
          zone:                   row['ዞን']             || row['zone']                   || '',
          woreda:                 row['ወረዳ']            || row['woreda']                 || '',
          center:                 row['ማእከል']           || row['center']                 || '',
          university_department:  row['ዲፓርትመንት']       || row['university_department']  || '',
          batch:                  row['ባች']             || row['batch']                  || '',
          section:                row['ሴክሽን']           || row['section']                || '',
          phone:           String(row['ስልክ']            || row['phone']                  || ''),
          email:                  row['ኢሜይል']           || row['email']                  || '',
          gubae_department:       row['የጉባኤ ክፍል']       || row['gubae_department']       || '',
          joining_date:           row['የተቀበሉበት ቀን']     || row['joining_date']           || '',
          status:                 row['ሁኔታ'] === 'ተመርቀዋል' ? 'graduated' : (row['status'] || 'active'),
          graduation_year: String(row['የተመረቁበት ዓ.ም']   || row['graduation_year']        || ''),
          confession_father:      row['የንስሐ አባት']       || row['confession_father']      || '',
          notes:                  row['ማሳሰቢያ']          || row['notes']                  || '',
        })).filter(m => m.first_name && m.father_name);

        if (members.length === 0) {
          showToast('ትክክለኛ ስም ያላቸው ረድፎች አልተገኙም / No valid rows found (ስም and የአባት ስም are required)', 'error');
          return;
        }

        const confirmed = confirm(
          `${members.length} ${currentLang === 'am' ? 'አባላት ተገኝተዋል። ማስገባት ይፈለጋል?' : 'members found. Import them?'}`
        );
        if (!confirmed) return;

        const result = await api('POST', '/api/members/import', { members });
        const msg = currentLang === 'am'
          ? `✓ ${result.imported} ተጨምረዋል${result.failed > 0 ? ` — ${result.failed} አልተሳካም` : ''}`
          : `✓ ${result.imported} imported${result.failed > 0 ? ` — ${result.failed} failed` : ''}`;
        showToast(msg, result.failed > 0 ? 'error' : 'success');
        loadMembers(1);
        loadDashboard();
        resolve(result);
      } catch (err) {
        showToast('Import failed: ' + err.message, 'error');
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}
async function exportToExcel() {
  try {
    const status = document.getElementById('filter-status').value;
    const dept = document.getElementById('filter-dept').value;
    const batch = document.getElementById('filter-batch').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (dept) params.set('gubae_department', dept);
    if (batch) params.set('batch', batch);

    const rows = await api('GET', `/api/export?${params}`);

    const exportData = rows.map(m => ({
      'ማእረግ': m.title || '',
      'ስም': m.first_name,
      'የአባት ስም': m.father_name,
      'የአያት ስም': m.grandfather_name || '',
      'የክርስትና ስም': m.baptism_name || '',
      'ጾታ': m.gender || '',
      'የትዉልድ ቀን': m.date_of_birth ? new Date(m.date_of_birth).toLocaleDateString() : '',
      'ክልል': m.region || '',
      'ዞን': m.zone || '',
      'ወረዳ': m.woreda || '',
      'ማእከል': m.center || '',
      'ዲፓርትመንት': m.university_department || '',
      'ባች': m.batch || '',
      'ሴክሽን': m.section || '',
      'ስልክ': m.phone || '',
      'ኢሜይል': m.email || '',
      'የጉባኤ ክፍል': m.gubae_department || '',
      'የተቀበሉበት ቀን': m.joining_date ? new Date(m.joining_date).toLocaleDateString() : '',
      'ሁኔታ': m.status === 'active' ? 'ንቁ' : 'ተመርቀዋል',
      'የተመረቁበት ዓ.ም': m.graduation_year || '',
      'የንስሐ አባት': m.confession_father || '',
      'ማሳሰቢያ': m.notes || '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'አባላት');
    XLSX.writeFile(wb, `አዋዳ-ጉባኤ-አባላት-${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('Excel ተላከ!', 'success');
  } catch (err) {
    showToast('Export failed', 'error');
  }
}

// ── ADMINS ────────────────────────────────────────────────────────
async function loadAdmins() {
  try {
    const admins = await api('GET', '/api/admins');
    document.getElementById('admins-list').innerHTML = `
      <div class="card">
        ${admins.map(a => `
          <div class="admin-row">
            <div>
              <div style="font-weight:600;">${a.full_name || a.username}</div>
              <div style="font-size:12px;color:var(--text-dim);">@${a.username}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="role-badge ${a.role === 'viewer' ? 'viewer' : ''}">${a.role}</span>
              ${a.role !== 'super_admin' ? `<button class="btn-danger" onclick="deleteAdmin(${a.id})" style="padding:5px 10px;font-size:12px;">✕</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    showToast('Could not load admins', 'error');
  }
}

async function saveAdmin() {
  const errEl = document.getElementById('admin-error');
  errEl.textContent = '';
  try {
    await api('POST', '/api/admins', {
      username: document.getElementById('admin-username').value.trim(),
      password: document.getElementById('admin-password').value,
      role: document.getElementById('admin-role').value,
      full_name: document.getElementById('admin-fullname').value.trim(),
    });
    document.getElementById('add-admin-form').style.display = 'none';
    showToast('Admin added!', 'success');
    loadAdmins();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteAdmin(id) {
  if (!confirm('Remove this admin?')) return;
  try {
    await api('DELETE', `/api/admins/${id}`);
    showToast('Admin removed.', 'success');
    loadAdmins();
  } catch (err) {
    showToast('Could not remove admin', 'error');
  }
}

// ── EVENT WIRING ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Login
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

  // Nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const page = link.dataset.page;
      if (page === 'members') { showPage('members'); loadMembers(1); }
      else if (page === 'dashboard') { showPage('dashboard'); loadDashboard(); }
      else if (page === 'add-member') showAddForm();
      else if (page === 'admins') { showPage('admins'); loadAdmins(); }
    });
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Language
  document.getElementById('lang-toggle').addEventListener('click', () => {
    currentLang = currentLang === 'am' ? 'en' : 'am';
    localStorage.setItem('gubae_lang', currentLang);
    applyLang();
  });

  // Member form submit
  document.getElementById('member-form').addEventListener('submit', submitMemberForm);

  // Show graduation year when status = graduated
  document.getElementById('f-status').addEventListener('change', e => {
    document.getElementById('graduation-year-row').style.display =
      e.target.value === 'graduated' ? 'grid' : 'none';
  });

  // Search (debounced)
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadMembers(1), 400);
  });

  // Filters
  ['filter-status', 'filter-dept', 'filter-batch'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => loadMembers(1));
  });

  // Import
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await importFromExcel(file);
    e.target.value = ''; // reset so same file can be re-imported if needed
  });

  // Export
  document.getElementById('export-btn').addEventListener('click', exportToExcel);

  // Cancel form
  document.getElementById('cancel-form-btn').addEventListener('click', () => {
    showPage('members');
    loadMembers(currentPage);
  });

  // Back to members from detail
  document.getElementById('back-to-members').addEventListener('click', () => {
    showPage('members');
  });

  // Photo upload
  const photoArea = document.getElementById('photo-upload-area');
  const photoInput = document.getElementById('photo-input');
  photoArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const prev = document.getElementById('photo-preview');
      prev.src = e.target.result;
      prev.style.display = 'block';
      document.getElementById('photo-placeholder').style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  // Admin management
  document.getElementById('show-add-admin').addEventListener('click', () => {
    const f = document.getElementById('add-admin-form');
    f.style.display = f.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('save-admin-btn').addEventListener('click', saveAdmin);

  // Check existing session
  const authed = await checkAuth();
  if (authed) {
    initApp();
  } else {
    document.getElementById('login-screen').style.display = 'flex';
  }
});
