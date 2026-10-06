import { auth, db } from './firebase.js';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  updateDoc,
} from 'firebase/firestore';
import { loadServices, renderCatalogView } from './catalog-manager.js';

const app = document.getElementById('app');

// Mirrors lib/models/job.dart HomeRepairCategories.all -- keep in sync.
const CATEGORIES = {
  electrical: { name: 'ไฟฟ้า', icon: '⚡' },
  plumbing: { name: 'ประปา', icon: '🚰' },
  air_con: { name: 'แอร์', icon: '❄️' },
  roof_structure: { name: 'หลังคา-โครงสร้าง', icon: '🏠' },
  wall_paint: { name: 'ผนัง-สี', icon: '🎨' },
  floor_tile: { name: 'พื้น-กระเบื้อง', icon: '🧱' },
  door_window: { name: 'ประตู-หน้าต่าง', icon: '🚪' },
  appliance_ventilation: { name: 'เครื่องใช้ไฟฟ้า', icon: '🔌' },
  emergency_safety: { name: 'ความปลอดภัยฉุกเฉิน', icon: '🚨' },
};

// Mirrors lib/models/job.dart JobStatusFirestore -- keep in sync. Each step
// only knows how to advance to the next one; staff can't skip steps or go
// back from this UI (matches the mobile app's one-directional stepper).
const STATUS_STEPS = [
  { value: 'pending_review', label: 'รอการยืนยัน', badge: 'pending' },
  { value: 'assigned', label: 'มอบหมายช่างแล้ว', badge: 'active' },
  { value: 'traveling', label: 'กำลังเดินทาง', badge: 'active' },
  { value: 'in_progress', label: 'กำลังซ่อมหน้างาน', badge: 'active' },
  { value: 'completed', label: 'งานเสร็จสิ้น', badge: 'done' },
  { value: 'cancelled', label: 'ยกเลิกงาน', badge: 'inactive' },
];

// Mirrors lib/models/job.dart JobTypeFirestore -- keep in sync. "เล็ก" =
// one-shot repair (existing 5-step flow), "ใหญ่" = milestone-billed project
// (jobs/{jobId}/milestones sub-collection -- see resolveMilestoneProgress).
const JOB_TYPE_LABELS = {
  repair: { label: 'ซ่อมบำรุง (เล็ก)', className: 'small' },
  construction: { label: 'ก่อสร้าง/ต่อเติม (ใหญ่)', className: 'large' },
};

const STAFF_ROLES = ['team', 'admin', 'super_admin'];

const addressCache = new Map();
let unsubscribeJobs = null;
let activeTab = window.location.hash === '#jobs' ? 'jobs' : 'catalog';

onAuthStateChanged(auth, async (user) => {
  if (unsubscribeJobs) {
    unsubscribeJobs();
    unsubscribeJobs = null;
  }
  if (!user) {
    renderLogin();
    return;
  }
  // Force-refresh so a claim granted by scripts/grant-staff-role.js after
  // this session started shows up without requiring a full sign-out first.
  const tokenResult = await user.getIdTokenResult(true);
  const role = tokenResult.claims.role || 'customer';
  if (!STAFF_ROLES.includes(role)) {
    renderNoRole(user, role);
    return;
  }
  renderDashboard(user, role);
});

function renderLogin() {
  app.innerHTML = `
    <div style="max-width: 480px; margin: 40px auto 0;">
      <div class="brand-badge" style="justify-content: center; margin-bottom: 24px;">
        <span style="font-size: 32px;">🏡</span>
        <div>
          <h1 class="brand-title" style="font-size: 22px;">รักบ้าน@CNX — Ops Portal</h1>
          <div class="brand-subtitle">ระบบบริหารจัดการสำหรับทีมงานและผู้ดูแลระบบ</div>
        </div>
      </div>
      <div class="card">
        <h2 style="font-size: 16px; margin-bottom: 14px;">เข้าสู่ระบบ Staff / Admin</h2>
        <input id="email" type="email" placeholder="อีเมล" autocomplete="username" />
        <input id="password" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" />
        <p class="error" id="error"></p>
        <div class="row">
          <button class="primary" id="signin" style="flex: 1;">เข้าสู่ระบบ</button>
          <button class="secondary" id="signup">สร้างบัญชีใหม่</button>
        </div>
      </div>
      <p class="meta" style="text-align: center;">
        บัญชีใหม่ต้องได้รับสิทธิ์ staff ผ่าน <code>node scripts/grant-staff-role.js [email]</code> ก่อนเข้าใช้งาน
      </p>
    </div>
  `;
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const error = document.getElementById('error');

  document.getElementById('signin').onclick = async () => {
    error.textContent = '';
    try {
      await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    } catch (e) {
      error.textContent = describeAuthError(e);
    }
  };
  document.getElementById('signup').onclick = async () => {
    error.textContent = '';
    try {
      await createUserWithEmailAndPassword(auth, email.value.trim(), password.value);
    } catch (e) {
      error.textContent = describeAuthError(e);
    }
  };
}

function describeAuthError(e) {
  if (e.code === 'auth/operation-not-allowed') {
    return 'Email/Password sign-in ยังไม่ได้เปิดใน Firebase Console (Authentication > Sign-in method)';
  }
  return e.message;
}

function renderNoRole(user, role) {
  app.innerHTML = `
    <div style="max-width: 540px; margin: 40px auto 0;">
      <div class="brand-badge" style="justify-content: center; margin-bottom: 24px;">
        <span style="font-size: 32px;">🏡</span>
        <div>
          <h1 class="brand-title" style="font-size: 22px;">รักบ้าน@CNX — Ops Portal</h1>
        </div>
      </div>
      <div class="notice">
        บัญชี <strong>${user.email}</strong> ยังไม่มีสิทธิ์ staff (role ปัจจุบัน: <code>${role}</code>).<br />
        ให้ผู้ดูแลระบบรัน:<br />
        <code>node scripts/grant-staff-role.js ${user.email}</code><br />
        แล้วกด "ออกจากระบบ" ด้านล่าง แล้ว "เข้าสู่ระบบ" ใหม่อีกครั้ง
      </div>
      <button class="secondary" id="signout">ออกจากระบบ</button>
    </div>
  `;
  document.getElementById('signout').onclick = () => signOut(auth);
}

function renderDashboard(user, role) {
  app.innerHTML = `
    <div class="layout-wrapper">
      <aside class="sidebar">
        <div class="brand-badge sidebar-brand">
          <span style="font-size: 26px;">🏡</span>
          <div>
            <h1 class="brand-title">RakBaan Ops Hub</h1>
            <div class="brand-subtitle">RakBaan Operations & Engineering</div>
          </div>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-item ${activeTab === 'jobs' ? 'active' : ''}" id="nav-jobs">
            📋 คิวงานซ่อม
          </button>
          <button class="nav-item ${activeTab === 'catalog' ? 'active' : ''}" id="nav-catalog">
            🏷️ รายการงานบริการ
          </button>
          <button class="nav-item ${activeTab === 'technicians' ? 'active' : ''}" id="nav-technicians">
            👷‍♂️ ทะเบียนช่าง
          </button>
          <button class="nav-item ${activeTab === 'customers' ? 'active' : ''}" id="nav-customers">
            👥 ข้อมูลลูกค้า
          </button>
          <button class="nav-item ${activeTab === 'finance' ? 'active' : ''}" id="nav-finance">
            💰 สรุปการเงิน
          </button>
        </nav>
        <div class="sidebar-footer">
          <div class="user-chip" style="margin-bottom: 12px;">
            <div class="user-info">
              <span class="meta">${user.email}</span>
              <span class="role-badge">${role}</span>
            </div>
            <button class="link text-red" id="signout">ออกจากระบบ</button>
          </div>
          <div style="font-size: 11px; color: var(--gray-400); text-align: center; margin-top: 8px;">
            Powered by Dlab Studios.<br>
            <a href="https://www.Dlabotory.com" target="_blank" style="color: var(--gray-400); text-decoration: none;">www.Dlabotory.com</a>
          </div>
        </div>
      </aside>

      <main class="main-content">
        <div id="view-content"></div>
      </main>
    </div>
  `;

  document.getElementById('signout').onclick = () => signOut(auth);

  const tabs = ['jobs', 'catalog', 'technicians', 'customers', 'finance'];
  const switchTab = (tab) => {
    activeTab = tab;
    window.location.hash = tab;
    tabs.forEach(t => {
      document.getElementById(`nav-${t}`).classList.toggle('active', t === tab);
    });
    renderActiveTab(user, role);
  };

  tabs.forEach(t => {
    document.getElementById(`nav-${t}`).onclick = () => switchTab(t);
  });

  renderActiveTab(user, role);
}

async function renderActiveTab(user, role) {
  const content = document.getElementById('view-content');
  if (!content) return;

  if (activeTab === 'jobs') {
    renderJobsView(content);
  } else if (activeTab === 'catalog') {
    if (unsubscribeJobs) {
      unsubscribeJobs();
      unsubscribeJobs = null;
    }
    content.innerHTML = '<p class="meta" style="padding: 24px; text-align: center;">กำลังโหลดข้อมูลรายการงานบริการ...</p>';
    await loadServices();
    renderCatalogView(content);
  } else if (activeTab === 'technicians') {
    if (unsubscribeJobs) {
      unsubscribeJobs();
      unsubscribeJobs = null;
    }
    renderTechniciansView(content);
  } else if (activeTab === 'customers') {
    if (unsubscribeJobs) {
      unsubscribeJobs();
      unsubscribeJobs = null;
    }
    renderCustomersView(content);
  } else if (activeTab === 'finance') {
    if (unsubscribeJobs) {
      unsubscribeJobs();
      unsubscribeJobs = null;
    }
    renderFinanceView(content);
  }
}


let mockTechnicians = [
  { id: 'PPT-TC01', name: 'สมชาย ใจดี (ชาย)', gender: 'ชาย', age: 35, phone: '081-111-2222', skills: ['❄️ แอร์', '⚡ ไฟฟ้า'], qcScore: 4.8, reviewScore: 4.9, paymentModel: 'ส่วนแบ่ง %', status: 'available' },
  { id: 'PPT-TC02', name: 'วิชัย รักงาน (ชัย)', gender: 'ชาย', age: 42, phone: '082-222-3333', skills: ['🚰 ประปา', '🏠 ซ่อมบ้าน'], qcScore: 4.5, reviewScore: 4.7, paymentModel: 'เงินเดือน', status: 'busy' },
  { id: 'PPT-TC03', name: 'นพดล เก่งมาก (นพ)', gender: 'ชาย', age: 28, phone: '083-333-4444', skills: ['❄️ แอร์'], qcScore: 4.9, reviewScore: 5.0, paymentModel: 'เหมาต่องาน', status: 'available' },
  { id: 'PPT-TC04', name: 'สุดา ช่างแอร์ (ดา)', gender: 'หญิง', age: 31, phone: '084-444-5555', skills: ['❄️ แอร์', '⚡ ไฟฟ้า'], qcScore: 4.6, reviewScore: 4.8, paymentModel: 'ส่วนแบ่ง %', status: 'inactive' },
  { id: 'PPT-TC05', name: 'อำนาจ ทรงพลัง (อ่ำ)', gender: 'ชาย', age: 45, phone: '085-555-6666', skills: ['🏠 ซ่อมบ้าน', '🚰 ประปา', '⚡ ไฟฟ้า'], qcScore: 4.7, reviewScore: 4.6, paymentModel: 'เหมาต่องาน', status: 'busy' },
];

let mockCustomers = [
  { id: 'CUST-01', name: 'คุณนารี สวยเสมอ', phone: '091-111-1111', zone: 'นิมมาน, เชียงใหม่', currentStatus: 'normal', jobCount: 5, totalSpend: 15500, history: [{ date: '2026-09-10', code: 'AC-CLN-001', service: 'ล้างแอร์ติดผนัง', tech: 'สมชาย ใจดี', price: 550, review: 'ดีมาก ช่างตรงต่อเวลา ⭐⭐⭐⭐⭐' }] },
  { id: 'CUST-02', name: 'บจก. คาเฟ่ เชียงใหม่', phone: '092-222-2222', zone: 'แม่เหียะ, เชียงใหม่', currentStatus: 'in_progress', jobCount: 12, totalSpend: 45000, history: [{ date: '2026-09-08', code: 'EL-REP-005', service: 'ซ่อมไฟช็อต', tech: 'อำนาจ ทรงพลัง', price: 1200, review: 'แก้ไขได้รวดเร็ว ⭐⭐⭐⭐' }] },
  { id: 'CUST-03', name: 'ดร. วิชาญ เรียนดี', phone: '093-333-3333', zone: 'สันผีเสื้อ, เชียงใหม่', currentStatus: 'pending', jobCount: 2, totalSpend: 2800, history: [{ date: '2026-09-01', code: 'PL-LEK-002', service: 'ซ่อมท่อประปารั่ว', tech: 'วิชัย รักงาน', price: 800, review: 'งานเรียบร้อยดี ⭐⭐⭐⭐⭐' }] },
  { id: 'CUST-04', name: 'ร้านอาหาร ไทยล้านนา', phone: '094-444-4444', zone: 'ช้างคลาน, เชียงใหม่', currentStatus: 'normal', jobCount: 8, totalSpend: 23400, history: [{ date: '2026-08-25', code: 'AC-REP-009', service: 'ซ่อมแอร์ไม่เย็น', tech: 'นพดล เก่งมาก', price: 3500, review: 'แอร์เย็นฉ่ำเหมือนใหม่ ⭐⭐⭐⭐⭐' }] },
  { id: 'CUST-05', name: 'คุณสมศักดิ์ มั่งมี', phone: '095-555-5555', zone: 'สันทราย, เชียงใหม่', currentStatus: 'normal', jobCount: 1, totalSpend: 550, history: [{ date: '2026-08-20', code: 'AC-CLN-010', service: 'ล้างแอร์ติดผนัง', tech: 'สุดา ช่างแอร์', price: 550, review: 'ช่างอัธยาศัยดี ⭐⭐⭐⭐⭐' }] },
];


function renderTechniciansView(container) {
  const all = mockTechnicians.length;
  const available = mockTechnicians.filter(t => t.status === 'available').length;
  const busy = mockTechnicians.filter(t => t.status === 'busy').length;
  const inactive = mockTechnicians.filter(t => t.status === 'inactive').length;

  container.innerHTML = `
    <div class="catalog-header">
      <div>
        <h2 class="catalog-title">👷‍♂️ ทะเบียนช่าง (Technicians)</h2>
        <p class="catalog-subtitle">ข้อมูลช่างสังกัด PPT, Multi-select Skill Tags, ระบบคะแนน 2 มิติ และโมเดลค่าแรง</p>
      </div>
      <div>
        <button class="btn-mint" id="btn-add-tech">➕ เพิ่มช่างใหม่</button>
      </div>
    </div>
    
    <div class="kpi-row" style="margin-bottom: 20px;">
      <div class="kpi-tile"><div class="kpi-value">${all}</div><div class="kpi-label">ช่างทั้งหมด</div></div>
      <div class="kpi-tile" style="border-color: var(--mint);"><div class="kpi-value text-mint">${available}</div><div class="kpi-label">พร้อมรับงาน</div></div>
      <div class="kpi-tile" style="border-color: var(--amber);"><div class="kpi-value text-amber">${busy}</div><div class="kpi-label">ติดงาน</div></div>
      <div class="kpi-tile" style="border-color: var(--gray-400);"><div class="kpi-value" style="color: var(--gray-500);">${inactive}</div><div class="kpi-label">พักงาน</div></div>
    </div>

    <div class="table-responsive card" style="padding: 0; overflow: hidden; margin-bottom: 20px;">
      <table class="catalog-table">
        <thead>
          <tr>
            <th style="width: 100px;">รหัสช่าง</th>
            <th style="width: 160px;">ชื่อ-สกุล</th>
            <th style="width: 100px; text-align: center;">สถานะ</th>
            <th style="width: 90px;">เพศ/อายุ</th>
            <th style="width: 120px;">เบอร์โทร</th>
            <th>ทักษะความชำนาญ</th>
            <th style="width: 140px;">คะแนน (QC | ลูกค้า)</th>
            <th style="width: 120px;">โมเดลค่าแรง</th>
            <th style="width: 120px; text-align: center;">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          ${mockTechnicians.map(t => `
            <tr class="service-row">
              <td style="font-family: monospace; font-weight: 700; color: var(--navy);">${t.id}</td>
              <td style="font-weight: 600; color: var(--gray-900);">${t.name}</td>
              <td style="text-align: center;">
                <span class="badge ${t.status === 'available' ? '' : (t.status === 'busy' ? 'jobtype-large' : 'pending')}" 
                      style="${t.status === 'available' ? 'background: var(--mint-100); color: var(--mint-600);' : (t.status === 'busy' ? 'background: var(--amber-100); color: var(--amber);' : 'background: var(--gray-200); color: var(--gray-600);')}">
                  ${t.status === 'available' ? 'พร้อมรับงาน' : (t.status === 'busy' ? 'กำลังทำงาน' : 'พักงาน')}
                </span>
              </td>
              <td style="color: var(--gray-600);">${t.gender} ${t.age}</td>
              <td>${t.phone}</td>
              <td>
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  ${t.skills.map(s => `<span class="badge" style="background: var(--gray-100); color: var(--gray-700); font-size: 11px;">${s}</span>`).join('')}
                </div>
              </td>
              <td>
                <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
                  <span>🏅 PPT QC: ${t.qcScore}</span>
                  <span>⭐ รีวิว: ${t.reviewScore}</span>
                </div>
              </td>
              <td style="color: var(--gray-700);">${t.paymentModel}</td>
              <td style="text-align: center;">
                <button class="secondary btn-sm" onclick="alert('ฟังก์ชันแก้ไขช่าง')">✏️</button>
                <button class="secondary btn-sm" onclick="alert('ฟังก์ชันดูประวัติ')">🔍</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <!-- Tech Modal Container -->
    <div id="tech-modal-container"></div>
  `;

  document.getElementById('btn-add-tech').onclick = () => {
    const m = document.getElementById('tech-modal-container');
    m.innerHTML = `
      <div class="modal-backdrop" id="tech-modal-backdrop" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;">
        <div class="modal-dialog card" style="width: 500px; max-width: 90%; position: relative; padding: 24px;">
          <button class="modal-close-btn" id="tech-modal-close" style="position: absolute; right: 16px; top: 16px; background: none; border: none; font-size: 18px; cursor: pointer;">✕</button>
          <h3 style="margin: 0 0 16px 0;">➕ เพิ่ม/แก้ไขข้อมูลช่าง</h3>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <div><label class="form-label">ชื่อ-สกุล (ชื่อเล่น)</label><input class="form-input" style="margin:0;" type="text"></div>
            <div><label class="form-label">เบอร์โทรศัพท์</label><input class="form-input" style="margin:0;" type="text"></div>
            <div>
              <label class="form-label">ทักษะความชำนาญ (Multi-select)</label>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <label><input type="checkbox"> ❄️ แอร์</label>
                <label><input type="checkbox"> ⚡ ไฟฟ้า</label>
                <label><input type="checkbox"> 🚰 ประปา</label>
                <label><input type="checkbox"> 🏠 ซ่อมบ้าน</label>
              </div>
            </div>
            <div>
              <label class="form-label">โมเดลค่าแรง</label>
              <select class="form-input select-input" style="margin:0;">
                <option>ส่วนแบ่ง %</option><option>เหมาต่องาน</option><option>เงินเดือน</option>
              </select>
            </div>
            <div>
              <label class="form-label">สถานะ (ห้ามลบ)</label>
              <select class="form-input select-input" style="margin:0;">
                <option>พร้อมรับงาน</option><option>กำลังทำงาน</option><option>พักงาน</option>
              </select>
            </div>
          </div>
          <div style="margin-top: 24px; text-align: right;">
            <button class="btn-mint" id="btn-save-tech">บันทึกข้อมูล</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('tech-modal-close').onclick = () => m.innerHTML = '';
    document.getElementById('tech-modal-backdrop').onclick = (e) => { if(e.target.id === 'tech-modal-backdrop') m.innerHTML = ''; };
    document.getElementById('btn-save-tech').onclick = () => { m.innerHTML = ''; showToast('บันทึกข้อมูลช่างเรียบร้อย'); };
  };
}


let customerSearchKeyword = '';

function renderCustomersView(container) {
  const filtered = mockCustomers.filter(c => {
    if (!customerSearchKeyword) return true;
    const q = customerSearchKeyword.toLowerCase();
    return c.name.toLowerCase().includes(q) || 
           c.phone.includes(q) || 
           c.zone.toLowerCase().includes(q);
  });

  container.innerHTML = `
    <div class="catalog-header">
      <div>
        <h2 class="catalog-title">👥 ข้อมูลลูกค้า (Customers)</h2>
        <p class="catalog-subtitle">ระบบค้นหาอัจฉริยะ (Universal Smart Search) และประวัติงานซ่อม</p>
      </div>
    </div>
    <div class="card" style="margin-bottom: 20px;">
      <div class="search-input-wrapper" style="margin-bottom: 0;">
        <span class="search-icon">🔍</span>
        <input type="text" id="cust-search" class="catalog-search-input" placeholder="ค้นหา ชื่อ, สกุล, เบอร์โทร, โซนที่อยู่ แบบเรียลไทม์..." value="${customerSearchKeyword}" />
      </div>
    </div>

    <div class="table-responsive card" style="padding: 0; overflow: hidden; margin-bottom: 20px;">
      <table class="catalog-table">
        <thead>
          <tr>
            <th style="width: 100px;">รหัสลูกค้า</th>
            <th style="width: 180px;">ชื่อ-นามสกุล</th>
            <th style="width: 130px;">เบอร์โทรศัพท์</th>
            <th>ที่อยู่ / โซน</th>
            <th style="width: 130px; text-align: center;">สถานะงานซ่อม</th>
            <th style="width: 130px; text-align: center;">จำนวนงานซ่อม</th>
            <th style="width: 130px; text-align: right;">ยอดใช้จ่ายสะสม</th>
            <th style="width: 120px; text-align: center;">ประวัติงาน</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="8" class="meta" style="text-align: center;">ไม่พบข้อมูลลูกค้า</td></tr>` : filtered.map(c => {
            let badge = '<span class="badge" style="background: var(--mint-100); color: var(--mint-600);">🟢 ปกติ</span>';
            if (c.currentStatus === 'in_progress') badge = '<span class="badge" style="background: var(--amber-100); color: var(--amber);">🟡 กำลังซ่อม</span>';
            else if (c.currentStatus === 'pending') badge = '<span class="badge" style="background: var(--navy-100); color: var(--navy);">🔵 รอนัดหมาย</span>';
            return `
            <tr class="service-row">
              <td style="font-family: monospace; font-weight: 700; color: var(--navy);">${c.id}</td>
              <td style="font-weight: 600; color: var(--gray-900);">${c.name}</td>
              <td>${c.phone}</td>
              <td style="color: var(--gray-600);">${c.zone}</td>
              <td style="text-align: center;">${badge}</td>
              <td style="text-align: center;"><span class="badge" style="background: var(--gray-100); color: var(--gray-700);">${c.jobCount} งาน</span></td>
              <td style="text-align: right; font-weight: 700; color: var(--mint-600);">฿${c.totalSpend.toLocaleString()}</td>
              <td style="text-align: center;">
                <button class="secondary btn-sm btn-cust-history" data-id="${c.id}">🔍 ประวัติงาน</button>
              </td>
            </tr>
          `}).join('')}
        </tbody>
      </table>
    </div>

    <div id="cust-modal-container"></div>
  `;

  const searchInput = document.getElementById('cust-search');
  searchInput.oninput = (e) => {
    customerSearchKeyword = e.target.value;
    // Debounce is ideal, but for mock data immediate re-render is fine
    renderCustomersView(container);
    // Keep focus
    const newSearch = document.getElementById('cust-search');
    if (newSearch) {
      newSearch.focus();
      const val = newSearch.value;
      newSearch.value = '';
      newSearch.value = val;
    }
  };

  const historyBtns = container.querySelectorAll('.btn-cust-history');
  historyBtns.forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const cust = mockCustomers.find(c => c.id === id);
      if (cust) openCustomerHistoryModal(cust);
    };
  });
}

function openCustomerHistoryModal(cust) {
  const m = document.getElementById('cust-modal-container');
  if (!m) return;
  
  m.innerHTML = `
    <div class="modal-backdrop" id="cust-modal-backdrop" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;">
      <div class="modal-dialog card" style="width: 800px; max-width: 95%; max-height: 90vh; overflow-y: auto; position: relative; padding: 24px;">
        <button class="modal-close-btn" id="cust-modal-close" style="position: absolute; right: 16px; top: 16px; background: none; border: none; font-size: 18px; cursor: pointer;">✕</button>
        
        <div style="margin-bottom: 20px; border-bottom: 1px solid var(--gray-200); padding-bottom: 16px;">
          <h2 style="margin: 0 0 8px 0; color: var(--navy);">ประวัติงานซ่อม: ${cust.name}</h2>
          <div style="font-size: 13px; color: var(--gray-600);">รหัส: ${cust.id} | โทร: ${cust.phone} | โซน: ${cust.zone}</div>
        </div>

        <div class="table-responsive card" style="padding: 0; overflow: hidden;">
          <table class="catalog-table">
            <thead>
              <tr>
                <th style="width: 100px;">วันที่</th>
                <th style="width: 100px;">รหัสงาน</th>
                <th>รายการซ่อม</th>
                <th style="width: 120px;">ช่างผู้ปฏิบัติงาน</th>
                <th style="width: 90px; text-align: right;">ค่าบริการ</th>
                <th style="width: 180px;">ผลตอบรับ / รีวิว</th>
              </tr>
            </thead>
            <tbody>
              ${cust.history.map(h => `
                <tr class="service-row">
                  <td style="font-size: 12px; color: var(--gray-600);">${h.date}</td>
                  <td style="font-family: monospace; font-weight: 700; color: var(--navy); font-size: 12px;">${h.code}</td>
                  <td style="font-weight: 600; color: var(--gray-900);">${h.service}</td>
                  <td style="font-size: 12px; color: var(--gray-700);">${h.tech}</td>
                  <td style="font-weight: 700; color: var(--navy); text-align: right;">฿${h.price.toLocaleString()}</td>
                  <td style="font-size: 12px; color: var(--gray-600);">${h.review}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top: 16px; text-align: right;">
          <button class="secondary" id="btn-close-hist">ปิดหน้าต่าง</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('cust-modal-close').onclick = () => m.innerHTML = '';
  document.getElementById('btn-close-hist').onclick = () => m.innerHTML = '';
  document.getElementById('cust-modal-backdrop').onclick = (e) => { if(e.target.id === 'cust-modal-backdrop') m.innerHTML = ''; };
}


function renderFinanceView(container) {
  container.innerHTML = `
    <div class="catalog-header">
      <div>
        <h2 class="catalog-title">การเงิน (Finance)</h2>
        <p class="catalog-subtitle">สรุปยอดทางการเงิน</p>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi-tile"><div class="kpi-value text-mint">฿0</div><div class="kpi-label">รายรับรวม</div></div>
      <div class="kpi-tile"><div class="kpi-value text-amber">฿0</div><div class="kpi-label">รายจ่ายช่าง</div></div>
      <div class="kpi-tile"><div class="kpi-value text-amber">฿0</div><div class="kpi-label">ค่าอะไหล่</div></div>
      <div class="kpi-tile"><div class="kpi-value text-mint">฿0</div><div class="kpi-label">กำไรสุทธิ</div></div>
    </div>
    <div class="card"><p class="meta">กำลังสร้างระบบรายงานการเงิน...</p></div>
  `;
}


let currentJobTab = 'all'; // active, pending, special, completed, all
let filterMonth = 'all';
let filterYear = 'all';

function renderJobsView(container) {
  container.innerHTML = `
    <div class="catalog-header">
      <div>
        <h2 class="catalog-title">📋 คิวงานซ่อม</h2>
        <p class="catalog-subtitle">ระบบบริหารจัดการและติดตามสถานะงานซ่อม</p>
      </div>
    </div>
    
    <!-- 5 State Tabs -->
    <div class="nav-tabs" style="margin-bottom: 20px; display: flex; gap: 8px; overflow-x: auto; padding: 4px;">
      <button class="nav-tab ${currentJobTab === 'active' ? 'active' : ''}" data-tab="active">🟡 กำลังดำเนินการ</button>
      <button class="nav-tab ${currentJobTab === 'pending' ? 'active' : ''}" data-tab="pending">🔵 งานรอคิว</button>
      <button class="nav-tab ${currentJobTab === 'special' ? 'active' : ''}" data-tab="special">⭐ งานนอกเมนู</button>
      <button class="nav-tab ${currentJobTab === 'completed' ? 'active' : ''}" data-tab="completed">🟢 งานเสร็จสิ้น</button>
      <button class="nav-tab ${currentJobTab === 'all' ? 'active' : ''}" data-tab="all">⚪ งานทั้งหมด</button>
    </div>

    <!-- Date Filters -->
    <div style="display: flex; gap: 12px; margin-bottom: 20px; align-items: center;">
      <span style="font-size: 14px; font-weight: 600; color: var(--gray-700);">ตัวกรอง:</span>
      <select id="filter-month" class="form-input select-input" style="width: 150px; margin-bottom: 0;">
        <option value="all" ${filterMonth === 'all' ? 'selected' : ''}>ทุกเดือน</option>
        <option value="1" ${filterMonth === '1' ? 'selected' : ''}>ม.ค.</option>
        <option value="2" ${filterMonth === '2' ? 'selected' : ''}>ก.พ.</option>
        <option value="3" ${filterMonth === '3' ? 'selected' : ''}>มี.ค.</option>
        <option value="4" ${filterMonth === '4' ? 'selected' : ''}>เม.ย.</option>
        <option value="5" ${filterMonth === '5' ? 'selected' : ''}>พ.ค.</option>
        <option value="6" ${filterMonth === '6' ? 'selected' : ''}>มิ.ย.</option>
        <option value="7" ${filterMonth === '7' ? 'selected' : ''}>ก.ค.</option>
        <option value="8" ${filterMonth === '8' ? 'selected' : ''}>ส.ค.</option>
        <option value="9" ${filterMonth === '9' ? 'selected' : ''}>ก.ย.</option>
        <option value="10" ${filterMonth === '10' ? 'selected' : ''}>ต.ค.</option>
        <option value="11" ${filterMonth === '11' ? 'selected' : ''}>พ.ย.</option>
        <option value="12" ${filterMonth === '12' ? 'selected' : ''}>ธ.ค.</option>
      </select>
      <select id="filter-year" class="form-input select-input" style="width: 120px; margin-bottom: 0;">
        <option value="all" ${filterYear === 'all' ? 'selected' : ''}>ทุกปี</option>
        <option value="2569" ${filterYear === '2569' ? 'selected' : ''}>2569 (2026)</option>
        <option value="2568" ${filterYear === '2568' ? 'selected' : ''}>2568 (2025)</option>
      </select>
    </div>

    <!-- Table View -->
    <div class="table-responsive card" style="padding: 0; overflow: hidden; margin-bottom: 20px;" id="jobs-table-container">
      กำลังโหลด...
    </div>
    
    <div id="job-modal-container"></div>
  `;

  // Attach tab events
  const tabs = container.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentJobTab = tab.getAttribute('data-tab');
      refreshJobsTable();
    };
  });

  // Attach filter events
  document.getElementById('filter-month').onchange = (e) => {
    filterMonth = e.target.value;
    refreshJobsTable();
  };
  document.getElementById('filter-year').onchange = (e) => {
    filterYear = e.target.value;
    refreshJobsTable();
  };

  if (unsubscribeJobs) {
    unsubscribeJobs();
    unsubscribeJobs = null;
  }

  const jobsQuery = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(100));
  unsubscribeJobs = onSnapshot(jobsQuery, (snapshot) => {
    const allJobsData = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((j) => (j.recordStatus ?? 0) <= 3);
    window._allJobs = allJobsData;
    refreshJobsTable();
  }, (err) => {
    const tcontainer = document.getElementById('jobs-table-container');
    if (tcontainer) tcontainer.innerHTML = `<div class="error" style="padding:20px;">โหลดงานไม่สำเร็จ: ${err.message}</div>`;
  });
}

async function refreshJobsTable() {
  const container = document.getElementById('jobs-table-container');
  if (!container || !window._allJobs) return;
  
  if (currentJobTab === 'special') {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <span class="badge" style="background: #eab308; color: #fff; font-size: 14px;">Exclusive Admin Level 1-2 PPT</span>
        <p class="meta" style="margin-top: 10px;">งานราคาสูง/เสี่ยงสูง เช่น ทาสีโรยตัวตึกสูง รีโนเวทใหญ่</p>
        <p class="meta">กำลังสร้างระบบจัดการงานโครงการพิเศษ...</p>
      </div>
    `;
    return;
  }

  let filtered = window._allJobs.filter(j => {
    if (currentJobTab === 'active') {
      if (!['assigned', 'traveling', 'in_progress'].includes(j.status)) return false;
    } else if (currentJobTab === 'pending') {
      if (j.status !== 'pending_review') return false;
    } else if (currentJobTab === 'completed') {
      if (j.status !== 'completed') return false;
    }
    
    const dateStr = j.scheduledDate || j.createdAt;
    if (dateStr) {
      const d = new Date(dateStr);
      if (filterYear !== 'all') {
        const y = parseInt(filterYear) === 2569 ? 2026 : 2025;
        if (d.getFullYear() !== y) return false;
      }
      if (filterMonth !== 'all') {
        if (d.getMonth() + 1 !== parseInt(filterMonth)) return false;
      }
    }
    return true;
  });

  const showStatusCol = (currentJobTab === 'active' || currentJobTab === 'pending');

  let tableHtml = `
    <table class="catalog-table">
      <thead>
        <tr>
          <th style="width: 100px;"># รหัสงาน</th>
          <th style="width: 140px;">วัน/เวลานัดหมาย</th>
          <th>รายการงานซ่อม</th>
          ${showStatusCol ? '<th style="width: 130px; text-align:center;">สถานะงาน</th>' : ''}
          <th style="width: 160px;">ลูกค้า</th>
          <th style="width: 160px;">สถานที่ / โซน</th>
          <th style="width: 140px;">ช่างผู้รับผิดชอบ</th>
          <th style="width: 110px;">ราคาประเมิน</th>
          <th style="width: 70px; text-align: center;">จัดการ</th>
        </tr>
      </thead>
      <tbody>
  `;

  if (filtered.length === 0) {
    tableHtml += `<tr><td colspan="${showStatusCol ? 9 : 8}" class="meta" style="text-align: center;">ไม่พบข้อมูลคิวงานซ่อม</td></tr>`;
  } else {
    for (const j of filtered) {
      const category = CATEGORIES[j.category] || { name: j.category, icon: '🔧' };
      const dateObj = new Date(j.scheduledDate || j.createdAt);
      const dateStr = dateObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const address = j.addressId ? await resolveAddress(j.addressId) : '(ไม่มีที่อยู่)';
      const step = STATUS_STEPS.find((s) => s.value === j.status) || STATUS_STEPS[0];
      
      tableHtml += `
        <tr class="service-row" id="job-row-${j.id}">
          <td style="font-family: monospace; font-weight: 700; color: var(--navy); font-size: 12px;">${j.id.slice(0, 8).toUpperCase()}</td>
          <td style="font-size: 12px; color: var(--gray-700);">${dateStr}</td>
          <td>
            <div style="font-weight: 600; color: var(--gray-900);">${category.icon} ${category.name}</div>
            <div style="font-size: 11px; color: var(--gray-600);">${escapeHtml(j.title || '-')}</div>
          </td>
          ${showStatusCol ? `<td style="text-align:center;"><span class="badge ${step.badge}" style="font-size: 11px;">${step.label}</span></td>` : ''}
          <td style="font-size: 12px;">${escapeHtml(j.customerId?.slice(0, 15) || '-')}</td>
          <td style="font-size: 12px; color: var(--gray-600); max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(address)}">${escapeHtml(address)}</td>
          <td style="font-size: 12px; font-weight: 600; color: ${j.assignedTeamId ? 'var(--mint-600)' : 'var(--amber)'};">${escapeHtml(j.assignedTeamId || 'รอการยืนยัน')}</td>
          <td style="font-weight: 600; color: var(--navy);">฿${(j.price || 0).toLocaleString()}</td>
          <td style="text-align: center;">
            <button class="secondary btn-sm btn-job-detail" data-id="${j.id}" title="[📋 ใบงาน] ตรวจสอบ/แก้ไข" style="font-size: 14px; padding: 4px 8px;">📋</button>
          </td>
        </tr>
      `;
    }
  }
  
  tableHtml += `</tbody></table>`;
  container.innerHTML = tableHtml;

  // Attach modal events
  const detailBtns = container.querySelectorAll('.btn-job-detail');
  detailBtns.forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const job = filtered.find(j => j.id === id);
      if (job) openJobModal(job);
    };
  });
}

async function openJobModal(job) {
  const modalContainer = document.getElementById('job-modal-container');
  if (!modalContainer) return;
  
  const category = CATEGORIES[job.category] || { name: job.category, icon: '🔧' };
  const step = STATUS_STEPS.find((s) => s.value === job.status) || STATUS_STEPS[0];
  const address = job.addressId ? await resolveAddress(job.addressId) : '(ไม่มีที่อยู่)';
  const dateStr = new Date(job.scheduledDate || job.createdAt).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  modalContainer.innerHTML = `
    <div class="modal-backdrop" id="job-modal-backdrop" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;">
      <div class="modal-dialog card" style="width: 650px; max-width: 90%; max-height: 90vh; overflow-y: auto; padding: 24px; position: relative;">
        <button class="modal-close-btn" id="job-modal-close" style="position: absolute; right: 16px; top: 16px; background: none; border: none; font-size: 18px; cursor: pointer;">✕</button>
        
        <div style="margin-bottom: 20px; border-bottom: 1px solid var(--gray-200); padding-bottom: 16px;">
          <div style="font-size: 12px; color: var(--gray-600); font-family: monospace;">รหัสงาน: ${job.id}</div>
          <h2 style="margin: 4px 0 8px 0;">${category.icon} ${category.name}</h2>
          <span class="badge ${step.badge}" style="font-size: 13px;">สถานะ: ${step.label}</span>
        </div>

        <div style="margin-bottom: 16px;">
          <h4 style="margin: 0 0 8px 0; color: var(--navy);">รายละเอียดอาการเสีย / หมายเหตุ</h4>
          <p style="margin: 0; font-size: 14px; color: var(--gray-700); background: var(--gray-50); padding: 12px; border-radius: var(--radius-sm);">${escapeHtml(job.title || 'ไม่มีรายละเอียด')}</p>
        </div>

        <div style="margin-bottom: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <h4 style="margin: 0 0 8px 0; color: var(--navy);">ข้อมูลการนัดหมาย</h4>
            <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: var(--gray-700);">
              <li><strong>เวลานัดหมาย:</strong> ${dateStr}</li>
              <li><strong>ลูกค้า:</strong> ${escapeHtml(job.customerId || '-')}</li>
            </ul>
          </div>
          <div>
            <h4 style="margin: 0 0 8px 0; color: var(--navy);">สถานที่ & โซน</h4>
            <div style="font-size: 14px; color: var(--gray-700);">${escapeHtml(address)}</div>
          </div>
        </div>

        <div style="margin-bottom: 24px; background: var(--gray-50); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200);">
          <h4 style="margin: 0 0 12px 0; color: var(--navy);">ข้อมูลความประสงค์เรื่องช่าง</h4>
          
          <div style="display: flex; flex-direction: column; gap: 12px; font-size: 14px;">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--gray-300); padding-bottom: 8px;">
              <span style="font-weight: 600; color: var(--gray-700);">🎯 ความประสงค์ของลูกค้า:</span>
              <span style="color: var(--navy);">${job.technicianPreference === 'ai' ? '[🤖 ให้ระบบ AI จัดหาช่างให้อัตโนมัติ]' : '[👤 ลูกค้าประสงค์เลือกช่างเอง]'}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--gray-300); padding-bottom: 8px;">
              <span style="font-weight: 600; color: var(--gray-700);">👤 ช่างที่ลูกค้าเลือก:</span>
              <span style="color: var(--gray-900);">${job.technicianPreference === 'ai' ? '<span style="color: var(--gray-500); font-style: italic;">ลูกค้าให้ระบบจัดให้</span>' : escapeHtml(job.customerSelectedTech || 'ไม่ได้ระบุ')}</span>
            </div>

            <div style="display: flex; justify-content: space-between; padding-bottom: 4px;">
              <span style="font-weight: 600; color: var(--gray-700);">🤖 ช่างที่ AI จับคู่:</span>
              <span style="color: var(--mint-600); font-weight: 600;">${job.aiRecommendedTech ? `${escapeHtml(job.aiRecommendedTech)} (Match: ${job.aiMatchScore || 95}%)` : '<span style="color: var(--gray-500); font-style: italic; font-weight: normal;">กำลังประมวลผล...</span>'}</span>
            </div>
          </div>
          
          <div style="margin-top: 16px;">
            <label class="form-label">ช่างผู้รับผิดชอบงานนี้ (Assigned Technician)</label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="modal-assign-tech" class="form-input" placeholder="พิมพ์ชื่อช่างที่ต้องการมอบหมาย..." value="${escapeHtml(job.assignedTeamId || '')}" style="margin-bottom: 0; flex: 1;">
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--gray-200); padding-top: 16px;">
          <button class="secondary" id="btn-save-assign">💾 บันทึกผู้รับผิดชอบ</button>
          ${step.action ? `<button class="btn-mint" id="btn-advance-status">${step.action} (ขั้นถัดไป)</button>` : ''}
        </div>
      </div>
    </div>
  `;

  document.getElementById('job-modal-close').onclick = () => {
    modalContainer.innerHTML = '';
  };
  document.getElementById('job-modal-backdrop').onclick = (e) => {
    if (e.target.id === 'job-modal-backdrop') modalContainer.innerHTML = '';
  };

  document.getElementById('btn-save-job-modal').onclick = async () => {
    const val = document.getElementById('modal-assign-tech').value.trim();
    const newStatus = document.getElementById('modal-update-status').value;
    try {
      await updateDoc(doc(db, 'jobs', job.id), { assignedTeamId: val, status: newStatus });
      modalContainer.innerHTML = '';
      showToast('บันทึกข้อมูลและอัปเดตสถานะเรียบร้อย', 'success');
    } catch (e) {
      alert(`อัปเดตไม่สำเร็จ: ${e.message}`);
    }
  };
}


async function resolveAddress(addressId) {
  if (addressCache.has(addressId)) return addressCache.get(addressId);
  try {
    const snap = await getDoc(doc(db, 'addresses', addressId));
    const text = snap.exists()
      ? `${snap.data().label || ''} ${snap.data().addressDetail || ''}`.trim() || '(ไม่มีรายละเอียด)'
      : '(ไม่พบที่อยู่)';
    addressCache.set(addressId, text);
    return text;
  } catch {
    return '(อ่านที่อยู่ไม่ได้)';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'success') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : 'ℹ️'}</span><span class="toast-msg">${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
