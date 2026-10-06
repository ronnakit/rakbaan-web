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
import {
  TECHNICIANS,
  getTechnicians,
  getTechnicianById,
  getTechniciansForCategory,
  TRADE_LABELS,
} from './technicians-data.js';

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
          <a href="/tech.html" target="_blank" class="nav-item" style="text-decoration: none; color: #d97706; margin-top: 12px; background: #fffbeb; border: 1px dashed #f59e0b; border-radius: var(--radius-md); font-size: 13px;">
            🔧 จอมือถือช่าง Pro ↗
          </a>
          <a href="/customer.html" target="_blank" class="nav-item" style="text-decoration: none; color: var(--mint-600); margin-top: 6px; background: var(--mint-100); border: 1px dashed var(--mint); border-radius: var(--radius-md); font-size: 13px;">
            👤 จอลูกค้าแจ้งซ่อม (Senior-First) ↗
          </a>
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
  const allTechs = getTechnicians();
  const all = allTechs.length;
  const available = allTechs.filter(t => t.status === 'active').length;
  const busy = allTechs.filter(t => t.status === 'busy').length;
  const leave = all - available - busy;

  container.innerHTML = `
    <div class="catalog-header">
      <div>
        <h2 class="catalog-title">👷‍♂️ ทำเนียบกำลังพลช่างฝีมือเชียงใหม่ (15 Pro Technicians)</h2>
        <p class="catalog-subtitle">ทะเบียนช่างมืออาชีพผ่านการคัดกรอง RakBaan Pro Academy — ตรวจประวัติอาชญากรรม 100%</p>
      </div>
      <div>
        <a href="/tech.html" target="_blank" class="btn-mint" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
          <span>📱</span> เปิดหน้าจอมือถือช่าง (Tech Portal) ↗
        </a>
      </div>
    </div>
    
    <div class="kpi-row" style="margin-bottom: 20px;">
      <div class="kpi-tile"><div class="kpi-value">${all}</div><div class="kpi-label">ช่างในระบบทั้งหมด</div></div>
      <div class="kpi-tile" style="border-color: var(--mint);"><div class="kpi-value text-mint">${available}</div><div class="kpi-label">พร้อมรับงาน (Active)</div></div>
      <div class="kpi-tile" style="border-color: var(--amber);"><div class="kpi-value text-amber">${busy}</div><div class="kpi-label">ติดงานหน้างาน (Busy)</div></div>
      <div class="kpi-tile" style="border-color: var(--gray-400);"><div class="kpi-value" style="color: var(--gray-500);">${leave}</div><div class="kpi-label">ลาพัก / สแตนด์บาย</div></div>
    </div>

    <div class="table-responsive card" style="padding: 0; overflow: hidden; margin-bottom: 20px;">
      <table class="catalog-table">
        <thead>
          <tr>
            <th style="width: 90px;">รหัสช่าง</th>
            <th style="width: 170px;">ชื่อ-นามสกุล (ชื่อเล่น)</th>
            <th style="width: 120px; text-align: center;">สถานะปฏิบัติงาน</th>
            <th style="width: 170px;">หมวดงานความเชี่ยวชาญ</th>
            <th style="width: 110px;">เบอร์ติดต่อ</th>
            <th style="width: 150px;">พื้นที่ให้บริการ</th>
            <th style="width: 90px; text-align: center;">งานที่จบ</th>
            <th style="width: 150px;">คะแนน (Audit | CSAT)</th>
            <th style="width: 100px; text-align: center;">หน้าช่าง</th>
          </tr>
        </thead>
        <tbody>
          ${allTechs.map(t => `
            <tr class="service-row">
              <td style="font-family: monospace; font-weight: 700; color: var(--navy); font-size: 13px;">${t.id}</td>
              <td>
                <div style="font-weight: 600; color: var(--gray-900);">${t.name}</div>
                <div style="font-size: 11px; color: var(--gray-500);">${t.nickname ? `(${t.nickname})` : ''} ประสบการณ์ ${t.yearsExp} ปี</div>
              </td>
              <td style="text-align: center;">
                <span class="badge" style="${t.status === 'active' ? 'background: var(--mint-100); color: var(--mint-600);' : 'background: var(--amber-100); color: var(--amber);'} font-size: 11px;">
                  ${t.status === 'active' ? '🟢 พร้อมรับงาน' : '🟡 กำลังทำงาน'}
                </span>
              </td>
              <td>
                <span class="badge" style="background: var(--gray-100); color: var(--gray-800); font-size: 11px;">${t.tradeName}</span>
              </td>
              <td style="font-family: monospace; font-size: 12px;">${t.phone}</td>
              <td style="font-size: 12px; color: var(--gray-600);">${t.coverageArea}</td>
              <td style="text-align: center; font-weight: 600; color: var(--navy);">${t.completedJobs} งาน</td>
              <td>
                <div style="display: flex; flex-direction: column; gap: 2px; font-size: 11px;">
                  <span style="color: #0284c7;">🛡️ บริษัท: <strong>${t.companyScore}%</strong></span>
                  <span style="color: #d97706;">⭐ ลูกค้า: <strong>${t.customerRating}</strong> (${t.reviewCount})</span>
                </div>
              </td>
              <td style="text-align: center;">
                <a href="/tech.html?techId=${t.id}" target="_blank" class="secondary btn-sm" style="text-decoration: none; font-size: 11px; padding: 3px 8px;" title="เข้าสู่ระบบในนามช่างคนนี้">
                  📱 สวมบท
                </a>
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
    
    <!-- 6 Workflow Tabs -->
    <div class="nav-tabs" style="margin-bottom: 20px; display: flex; gap: 8px; overflow-x: auto; padding: 4px;">
      <button class="nav-tab ${currentJobTab === 'all' ? 'active' : ''}" data-tab="all">⚪ งานทั้งหมด</button>
      <button class="nav-tab ${currentJobTab === 'pending' ? 'active' : ''}" data-tab="pending">🔵 1-3 รอจัดช่าง</button>
      <button class="nav-tab ${currentJobTab === 'active' ? 'active' : ''}" data-tab="active">🟡 4-7 ดำเนินการ/ซ่อม</button>
      <button class="nav-tab ${currentJobTab === 'qc' ? 'active' : ''}" data-tab="qc">📸 8-9 รอตรวจ QC</button>
      <button class="nav-tab ${currentJobTab === 'rework' ? 'active' : ''}" data-tab="rework">⚠️ 10 ลูกค้าสั่งแก้ (Accountability)</button>
      <button class="nav-tab ${currentJobTab === 'completed' ? 'active' : ''}" data-tab="completed">🟢 10 เสร็จสิ้น/มีประกัน</button>
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
      if (j.workflowStatus === 'tech_submitted' || j.workflowStatus === 'rework_needed') return false;
    } else if (currentJobTab === 'pending') {
      if (j.status !== 'pending_review') return false;
    } else if (currentJobTab === 'qc') {
      if (j.workflowStatus !== 'tech_submitted' && j.workflowStatus !== 'customer_review') return false;
    } else if (currentJobTab === 'rework') {
      if (j.workflowStatus !== 'rework_needed') return false;
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

  const showStatusCol = true;

  let tableHtml = `
    <table class="catalog-table">
      <thead>
        <tr>
          <th style="width: 100px;"># รหัสงาน</th>
          <th style="width: 140px;">วัน/เวลานัดหมาย</th>
          <th>รายการงานซ่อม</th>
          <th style="width: 150px; text-align:center;">สถานะงาน (10 Steps)</th>
          <th style="width: 150px;">ลูกค้า</th>
          <th style="width: 160px;">สถานที่ / โซน</th>
          <th style="width: 160px;">ช่างผู้รับผิดชอบ</th>
          <th style="width: 110px;">ราคารวมสุทธิ</th>
          <th style="width: 70px; text-align: center;">จัดการ</th>
        </tr>
      </thead>
      <tbody>
  `;

  if (filtered.length === 0) {
    tableHtml += `<tr><td colspan="9" class="meta" style="text-align: center;">ไม่พบข้อมูลคิวงานซ่อมในหมวดนี้</td></tr>`;
  } else {
    for (const j of filtered) {
      const category = CATEGORIES[j.category] || { name: j.category, icon: '🔧' };
      const dateObj = new Date(j.scheduledDate || j.createdAt);
      const dateStr = dateObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const address = j.addressId ? await resolveAddress(j.addressId) : '(ไม่มีที่อยู่)';
      const step = STATUS_STEPS.find((s) => s.value === j.status) || STATUS_STEPS[0];
      
      const assignedTech = j.assignedTeamId ? getTechnicianById(j.assignedTeamId) : null;
      const techDisplay = assignedTech
        ? `[${assignedTech.id}] ${assignedTech.nickname || assignedTech.name}`
        : (j.assignedTechName ? `[${j.assignedTeamId}] ${j.assignedTechName}` : (j.assignedTeamId || 'รอการยืนยัน'));

      let statusBadgeHtml = `<span class="badge ${step.badge}" style="font-size: 11px;">${step.label}</span>`;
      if (j.workflowStatus === 'rework_needed') {
        statusBadgeHtml = `<span class="badge" style="background: #fee2e2; color: #991b1b; font-size: 11px; border: 1px solid #fca5a5;">⚠️ สั่งแก้ไข (Accountability)</span>`;
      } else if (j.workflowStatus === 'tech_submitted') {
        statusBadgeHtml = `<span class="badge" style="background: #fef3c7; color: #b45309; font-size: 11px; border: 1px solid #fde68a;">📥 ช่างส่งงาน (รอตรวจ)</span>`;
      } else if (j.workflowStatus === 'customer_review') {
        statusBadgeHtml = `<span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 11px; border: 1px solid #bae6fd;">👤 ส่งต่อลูกค้าตรวจ</span>`;
      } else if (j.status === 'completed') {
        statusBadgeHtml = `<span class="badge" style="background: #dcfce7; color: #166534; font-size: 11px; border: 1px solid #86efac;">✅ เสร็จสิ้น/มีประกัน</span>`;
      }
      
      tableHtml += `
        <tr class="service-row" id="job-row-${j.id}">
          <td style="font-family: monospace; font-weight: 700; color: var(--navy); font-size: 12px;">${j.id.slice(0, 8).toUpperCase()}</td>
          <td style="font-size: 12px; color: var(--gray-700);">${dateStr}</td>
          <td>
            <div style="font-weight: 600; color: var(--gray-900);">${category.icon} ${category.name}</div>
            <div style="font-size: 11px; color: var(--gray-600);">${escapeHtml(j.title || '-')}</div>
          </td>
          <td style="text-align:center;">${statusBadgeHtml}</td>
          <td style="font-size: 12px;">${escapeHtml(j.customerId?.slice(0, 15) || '-')}</td>
          <td style="font-size: 12px; color: var(--gray-600); max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(address)}">${escapeHtml(address)}</td>
          <td style="font-size: 12px; font-weight: 600; color: ${j.assignedTeamId ? 'var(--mint-600)' : 'var(--amber)'};">${escapeHtml(techDisplay)}</td>
          <td style="font-weight: 600; color: var(--navy);">฿${(j.price || 0).toLocaleString()}</td>
          <td style="text-align: center;">
            <button class="secondary btn-sm btn-job-detail" data-id="${j.id}" title="[📋 ใบงาน] ตรวจสอบ/จัดการ 10 สเต็ป" style="font-size: 14px; padding: 4px 8px;">📋</button>
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

  // Calculate 10-step workflow position
  let currentStepNum = 2; // Default: Step 2 เราเห็น
  if (job.status === 'completed') {
    currentStepNum = 10;
  } else if (job.workflowStatus === 'rework_needed') {
    currentStepNum = 6; // Looped back to step 6 (เราประสานงาน) per Cherd's Law
  } else if (job.workflowStatus === 'customer_review') {
    currentStepNum = 10;
  } else if (job.workflowStatus === 'tech_submitted') {
    currentStepNum = 9;
  } else if (job.status === 'in_progress') {
    currentStepNum = 7;
  } else if (job.status === 'traveling') {
    currentStepNum = 5;
  } else if (job.status === 'assigned') {
    currentStepNum = 6;
  } else if (job.assignedTeamId) {
    currentStepNum = 3;
  }

  // Warranty standard calculation by category
  let defaultWarrantyDays = 30;
  if (['air_con', 'appliance_ventilation', 'electrical', 'plumbing'].includes(job.category)) {
    defaultWarrantyDays = 90;
  } else if (job.category === 'roof_structure') {
    defaultWarrantyDays = 180;
  }

  // Get technician candidates
  const matchedTechs = getTechniciansForCategory(job.category);
  const allTechs = getTechnicians();
  const otherTechs = allTechs.filter(t => !matchedTechs.some(m => m.id === t.id));

  let currentSelectedTechId = job.assignedTechId || job.assignedTeamId || '';
  if (!currentSelectedTechId && job.customerSelectedTech) {
    const found = allTechs.find(t => t.name.includes(job.customerSelectedTech) || t.id === job.customerSelectedTech);
    if (found) currentSelectedTechId = found.id;
  }
  if (!currentSelectedTechId && job.aiRecommendedTech) {
    const found = allTechs.find(t => t.name.includes(job.aiRecommendedTech) || t.id === job.aiRecommendedTech);
    if (found) currentSelectedTechId = found.id;
  }

  const isPendingReview = job.status === 'pending_review';
  const isSubmittedForReview = job.workflowStatus === 'tech_submitted';
  const isCustomerReview = job.workflowStatus === 'customer_review';
  const isRework = job.workflowStatus === 'rework_needed';
  const isCompleted = job.status === 'completed';

  modalContainer.innerHTML = `
    <div class="modal-backdrop" id="job-modal-backdrop" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;">
      <div class="modal-dialog card" style="width: 820px; max-width: 95%; max-height: 92vh; overflow-y: auto; padding: 24px; position: relative;">
        <button class="modal-close-btn" id="job-modal-close" style="position: absolute; right: 16px; top: 16px; background: none; border: none; font-size: 20px; cursor: pointer; color: var(--gray-600);">✕</button>
        
        <!-- Header -->
        <div style="margin-bottom: 16px; border-bottom: 1px solid var(--gray-200); padding-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 13px; color: var(--gray-600); font-family: monospace;">รหัสงาน: ${job.id}</span>
            <div style="display: flex; gap: 6px; align-items: center;">
              <span class="badge ${step.badge}" style="font-size: 12px;">สถานะหลัก: ${step.label}</span>
              ${isRework ? '<span class="badge" style="background: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 700;">⚠️ วนกลับสเต็ป 6 (ลูกค้าขอแก้ไข)</span>' : ''}
              ${isSubmittedForReview ? '<span class="badge" style="background: #fef3c7; color: #b45309; font-size: 12px; font-weight: 700;">📸 สเต็ป 9: รอ Ops ตรวจ QC</span>' : ''}
              ${isCustomerReview ? '<span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 12px; font-weight: 700;">👤 สเต็ป 10: ส่งต่อลูกค้าตรวจรับ</span>' : ''}
              ${isCompleted ? '<span class="badge" style="background: #dcfce7; color: #166534; font-size: 12px; font-weight: 700;">🛡️ รับประกันดิจิทัลเปิดใช้งาน</span>' : ''}
            </div>
          </div>
          <h2 style="margin: 0; color: var(--navy); display: flex; align-items: center; gap: 8px;">
            <span>${category.icon}</span> ${category.name}
            <span style="font-size: 14px; font-weight: normal; color: var(--gray-600);">— ศูนย์บัญชาการงานซ่อมส่วนกลาง (Ops Command Center)</span>
          </h2>
        </div>

        <!-- 10-Step Interactive Workflow Pipeline Stepper -->
        <div class="workflow-pipeline" title="ขั้นตอนปฏิบัติงาน 10 สเต็ปตามกฎคุณเชิด">
          <div class="pipeline-step ${currentStepNum >= 1 ? 'done' : ''} ${currentStepNum === 1 ? 'active' : ''}">1. ลูกค้าจ้าง</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 2 ? 'done' : ''} ${currentStepNum === 2 ? 'active' : ''}">2. เราเห็น</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 3 ? 'done' : ''} ${currentStepNum === 3 ? 'active' : ''}">3. ส่งช่างรับ</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 4 ? 'done' : ''} ${currentStepNum === 4 ? 'active' : ''}">4. พักเงิน PPT</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 5 ? 'done' : ''} ${currentStepNum === 5 ? 'active' : ''}">5. ช่างรับงาน</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 6 ? 'done' : ''} ${currentStepNum === 6 ? 'active' : ''}">6. เราประสานงาน</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 7 ? 'done' : ''} ${currentStepNum === 7 ? 'active' : ''}">7. เราสั่งเริ่มงาน</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 8 ? 'done' : ''} ${currentStepNum === 8 ? 'active' : ''}">8. ช่างส่งงาน</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 9 ? 'done' : ''} ${currentStepNum === 9 ? 'active' : ''}">9. เราตรวจ QC</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 10 ? 'done' : ''} ${currentStepNum === 10 ? 'active' : ''}">10. ลูกค้ารับงาน/ประกัน</div>
        </div>

        <!-- Accountability Banner (Cherd's Law: เกิดข้อบกพร่องร่วม เมื่อลูกค้าไม่รับงานหลัง Ops ผ่าน QC) -->
        ${(isRework || job.accountability) ? `
          <div class="accountability-banner">
            <div class="accountability-title">⚠️ บันทึกความรับผิดชอบร่วม (Internal Accountability Penalty Flag)</div>
            <div class="accountability-desc">
              ลูกค้าไม่รับงานและขอให้แก้ไขตามเหตุผล: <em>"${escapeHtml(job.accountability?.rejectionReason || 'พบจุดบกพร่องที่ต้องแก้ไขเพิ่มเติมหน้างาน')}"</em><br>
              📌 <strong>บันทึกความบกพร่องร่วมตามกฎคุณเชิด:</strong> ผู้ตรวจ Ops ที่ตรวจผ่านในสเต็ป 9 (<code>${escapeHtml(job.accountability?.penalizedInspector || 'ทีมตรวจ PPT')}</code>) และช่างผู้ปฏิบัติงาน (<code>${escapeHtml(job.assignedTeamId || '-')}</code>)<br>
              🔄 <strong>ระบบวนลูปกลับมาที่:</strong> <strong>ขั้นตอนที่ 6 (เราประสานงาน)</strong> เพื่อตรวจสอบอะไหล่และนัดหมายแก้ไขให้ลูกค้าโดยด่วน
            </div>
          </div>
        ` : ''}

        <!-- Digital Warranty Banner (ถ้าจบงานแล้ว) -->
        ${isCompleted ? `
          <div class="warranty-card">
            <div class="warranty-header">
              <span class="warranty-title">🛡️ ความคุ้มครองการรับประกันดิจิทัลเปิดใช้งานแล้ว</span>
              <span class="badge" style="background: #10b981; color: #fff; font-size: 11px;">Active Warranty</span>
            </div>
            <div style="font-size: 13px; color: #065f46; line-height: 1.6;">
              <div>• <strong>ระยะเวลารับประกัน:</strong> ${job.warranty?.days || defaultWarrantyDays} วัน (ครอบคลุมงานฝีมือและชิ้นส่วนที่เปลี่ยน)</div>
              <div>• <strong>วันเริ่มต้น - สิ้นสุด:</strong> ${job.warranty?.startDate ? new Date(job.warranty.startDate).toLocaleDateString('th-TH') : '-'} ถึง <strong>${job.warranty?.endDate ? new Date(job.warranty.endDate).toLocaleDateString('th-TH') : '-'}</strong></div>
              <div>• <strong>สถานะการเงิน:</strong> ปลดล็อกยอดโอนเงินให้ช่าง (Payout Unlocked) สมบูรณ์</div>
            </div>
          </div>
        ` : ''}

        <!-- Dual-Sided Panel: Customer Side vs Technician & Ops Side -->
        <div class="dual-container">
          <!-- ฝั่งซ้าย: ข้อมูลลูกค้า (Customer Side 👤) -->
          <div class="dual-panel">
            <div class="dual-panel-header">
              <h4 class="dual-panel-title">👤 ฝั่งลูกค้า (Customer Details)</h4>
              <span style="font-size: 11px; color: var(--gray-500);">ฝั่งที่ 1</span>
            </div>

            <div style="font-size: 13px; color: var(--gray-700); line-height: 1.6;">
              <div><strong>รหัสลูกค้า:</strong> ${escapeHtml(job.customerId || '-')}</div>
              <div><strong>วันเวลานัดหมาย:</strong> ${dateStr}</div>
              <div>
                <strong>สถานที่:</strong> ${escapeHtml(address)}
                <div style="margin-top: 4px;">
                  <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" style="color: #0284c7; text-decoration: none; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                    📍 เปิดพิกัด Google Maps ↗
                  </a>
                </div>
              </div>
            </div>

            <div style="background: #fff; padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200); font-size: 13px;">
              <strong style="color: var(--navy);">📋 รายการแจ้งซ่อม & อาการเสีย:</strong>
              <div style="color: var(--gray-800); margin-top: 4px; line-height: 1.4;">${escapeHtml(job.title || 'ไม่มีรายละเอียด')}</div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200);">
              <span style="font-size: 13px; color: var(--gray-600);">ราคารวมสุทธิ (ไร้สูตรคำนวณ):</span>
              <span style="font-size: 16px; font-weight: 700; color: var(--navy);">฿${(job.price || 0).toLocaleString()}</span>
            </div>

            <!-- Escrow Held Badge (Step 4) -->
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: var(--radius-sm); padding: 10px; font-size: 12px; color: #065f46;">
              <div style="font-weight: 700; display: flex; align-items: center; gap: 4px;">
                <span>🛡️ ขั้นตอนที่ 4: พักเงินในบัญชี PPT เรียบร้อย</span>
              </div>
              <div style="margin-top: 2px; color: #047857;">
                ยอด ฿${(job.price || 0).toLocaleString()} ผ่าน Thai QR PromptPay บัญชี บจก. เพียบพร้อมทำ (พักเงินรอไว้ — รอปลดล็อกเมื่อตรวจรับงาน)
              </div>
            </div>

            <div style="font-size: 12px; color: var(--gray-600); border-top: 1px dashed var(--gray-200); padding-top: 6px;">
              <span>ความประสงค์เรื่องช่าง: <strong>${job.technicianPreference === 'ai' ? '🤖 ให้ระบบจัดหาให้อัตโนมัติ' : '👤 ลูกค้าประสงค์เลือกช่างเอง'}</strong></span>
            </div>
          </div>

          <!-- ฝั่งขวา: ข้อมูลช่าง & เรา (Technician & Ops Side 🔧🏛️) -->
          <div class="dual-panel">
            <div class="dual-panel-header">
              <h4 class="dual-panel-title">🔧 ฝั่งช่าง & เรา (Technician & Ops)</h4>
              <span style="font-size: 11px; color: var(--gray-500);">ฝั่งที่ 2</span>
            </div>

            <!-- Dropdown Pro Technicians 15 Candidates -->
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label class="form-label" style="font-weight: 600; color: var(--navy); font-size: 13px; margin: 0;">
                  👷‍♂️ ช่าง Pro ผู้รับผิดชอบ (ขั้นตอนที่ 3)
                </label>
                <span style="font-size: 11px; background: #bbf7d0; color: #14532d; padding: 2px 6px; border-radius: 10px; font-weight: 600;">
                  ✓ ทะเบียนช่าง Pro 15 คน
                </span>
              </div>

              <select id="modal-assign-tech-select" class="form-input select-input" style="width: 100%; font-size: 12px; margin-bottom: 8px;">
                <option value="">-- กรุณาเลือกช่าง Pro จากทะเบียนช่าง --</option>
                <optgroup label="⭐ ช่างแนะนำที่ตรงกับหมวดงาน (${category.name})">
                  ${matchedTechs.map(t => `
                    <option value="${t.id}" ${currentSelectedTechId === t.id ? 'selected' : ''}>
                      [${t.id}] ${t.name} (${t.nickname}) ⭐${t.customerRating} — ${t.tradeName} [${t.status === 'active' ? '🟢 ว่าง' : '🟡 ไม่ว่าง'}]
                    </option>
                  `).join('')}
                </optgroup>
                ${otherTechs.length > 0 ? `
                  <optgroup label="🛠️ ช่าง Pro สาขาอื่นๆ ในทำเนียบ">
                    ${otherTechs.map(t => `
                      <option value="${t.id}" ${currentSelectedTechId === t.id ? 'selected' : ''}>
                        [${t.id}] ${t.name} (${t.nickname}) ⭐${t.customerRating} — ${t.tradeName} [${t.status === 'active' ? '🟢 ว่าง' : '🟡 ไม่ว่าง'}]
                      </option>
                    `).join('')}
                  </optgroup>
                ` : ''}
              </select>

              <!-- Dynamic Technician Live Preview Card -->
              <div id="tech-live-preview" style="background: #ffffff; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 10px; font-size: 12px;">
                <!-- Rendered dynamically -->
              </div>
            </div>

            <!-- Technician Portal Quick Link -->
            <div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200);">
              <span style="font-size: 12px; color: var(--gray-600);">📱 หน้าจอมือถือช่าง:</span>
              <a href="/tech.html?techId=${currentSelectedTechId || 'RPS-T01'}" target="_blank" style="color: var(--mint-600); font-weight: 600; text-decoration: none; font-size: 12px;">
                เปิดหน้าจอมือถือช่าง (Tech Portal) ↗
              </a>
            </div>

            <!-- Dispatch Button if not yet assigned -->
            ${isPendingReview ? `
              <button class="btn-mint" id="btn-assign-and-send" style="width: 100%; font-weight: 600; padding: 10px; font-size: 13px;">
                📤 ขั้นตอนที่ 3: ส่งงานให้ช่างรับ (Dispatch)
              </button>
            ` : ''}
          </div>
        </div>

        <!-- ขั้นตอนที่ 6: เราประสานงาน (อะไหล่ + ช่าง + ลูกค้า) (Ops 3-Way Coordination Box) -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: var(--radius-sm); padding: 14px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h4 style="margin: 0; color: var(--navy); font-size: 13px; font-weight: 600;">
              ⚙️ ขั้นตอนที่ 6: เราประสานงาน (อะไหล่แท้ + ช่าง + ลูกค้า)
            </h4>
            <span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 11px;">Ops 3-Way Coordination</span>
          </div>
          
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--gray-700); margin-bottom: 10px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="chk-parts" ${job.coordination?.partsChecked ? 'checked' : ''}>
              <span>🔍 ตรวจสอบอะไหล่แท้/อุปกรณ์มาตรฐานครบถ้วน (ไม่ใช้อะไหล่เทียบหรืออะไหล่ดัดแปลง)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="chk-tech-ready" ${job.coordination?.techReadyChecked ? 'checked' : ''}>
              <span>👷 ช่างยืนยันความพร้อม คิวเวลาเดินทาง และอุปกรณ์ความปลอดภัย</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="chk-customer-confirm" ${job.coordination?.customerConfirmChecked ? 'checked' : ''}>
              <span>📞 โทรยืนยันวันเวลานัดหมายและพิกัดหน้างานกับลูกค้าเรียบร้อย</span>
            </label>
          </div>

          <div style="display: flex; gap: 8px;">
            <input type="text" id="input-coord-notes" class="form-input" placeholder="บันทึกการประสานงาน (เช่น ยืนยันเบิกคอมเพรสเซอร์แท้ศูนย์, ช่างเข้า 10:00 น.)..." value="${escapeHtml(job.coordination?.notes || '')}" style="margin-bottom: 0; flex: 1; font-size: 12px;">
            <button class="secondary btn-sm" id="btn-save-coord" style="white-space: nowrap;">💾 บันทึกประสานงาน</button>
          </div>
        </div>

        <!-- ขั้นตอนที่ 7: เราให้ช่างเริ่มงาน (Authorize Start) -->
        ${(job.status === 'assigned' || job.status === 'traveling' || isRework) ? `
          <div style="background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: var(--radius-sm); padding: 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: #1e40af; font-size: 13px;">🚀 ขั้นตอนที่ 7: เราอนุญาตให้ช่างเริ่มทำงานให้ลูกค้า</strong>
              <div style="font-size: 12px; color: #1e3a8a; margin-top: 2px;">เมื่อการประสานงานอะไหล่และความพร้อมเรียบร้อย ให้กดอนุญาตเพื่อให้ช่างลงมือซ่อมหน้างานได้</div>
            </div>
            <button class="btn-mint" id="btn-authorize-start" style="font-weight: 600; white-space: nowrap; padding: 8px 16px;">
              🚀 อนุญาตให้ช่างเริ่มงาน
            </button>
          </div>
        ` : ''}

        <!-- ขั้นตอนที่ 8 & 9: ช่างส่งงาน & เราตรวจส่งต่อลูกค้า (QC Gate 1) -->
        ${(isSubmittedForReview || isCustomerReview || job.beforePhotos || job.afterPhotos || isCompleted) ? `
          <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: var(--radius-sm); padding: 16px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <h4 style="margin: 0; color: var(--navy); font-size: 14px; font-weight: 600;">
                📸 ขั้นตอนที่ 8 & 9: ผลงานช่าง & เราตรวจงานส่งต่อลูกค้า (QC Gate 1)
              </h4>
              <span class="badge" style="background: #dbeafe; color: #1e40af; font-size: 11px;">Quality Inspection</span>
            </div>
            
            <div class="qc-compare-grid" style="margin-bottom: 12px;">
              <div class="qc-photo-box">
                <div class="qc-photo-title">📷 รูปก่อนทำ (Before)</div>
                ${(job.beforePhotos && job.beforePhotos.length > 0) ? `
                  <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                    ${job.beforePhotos.map(url => `
                      <img src="${url}" style="max-height: 130px; max-width: 100%; border-radius: 4px; object-fit: cover; border: 1px solid #cbd5e1;" alt="Before" />
                    `).join('')}
                  </div>
                ` : '<div style="color: var(--gray-400); font-size: 12px; padding: 24px 0;">ไม่มีรูปภาพ Before</div>'}
              </div>

              <div class="qc-photo-box">
                <div class="qc-photo-title">📷 รูปหลังทำเสร็จ (After)</div>
                ${(job.afterPhotos && job.afterPhotos.length > 0) ? `
                  <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                    ${job.afterPhotos.map(url => `
                      <img src="${url}" style="max-height: 130px; max-width: 100%; border-radius: 4px; object-fit: cover; border: 1px solid #cbd5e1;" alt="After" />
                    `).join('')}
                  </div>
                ` : '<div style="color: var(--gray-400); font-size: 12px; padding: 24px 0;">ไม่มีรูปภาพ After</div>'}
              </div>
            </div>

            ${job.techNotes ? `
              <div style="background: #fff; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200); font-size: 12px; margin-bottom: 12px;">
                <strong>📝 หมายเหตุจากช่างหน้างาน:</strong> ${escapeHtml(job.techNotes)}
              </div>
            ` : ''}

            <!-- Inspection Actions for QC Gate 1 -->
            ${isSubmittedForReview ? `
              <div style="background: #fff; padding: 12px; border-radius: var(--radius-sm); border: 1px solid #93c5fd; display: flex; flex-direction: column; gap: 10px;">
                <div style="font-weight: 600; font-size: 13px; color: var(--navy);">
                  🔍 ด่านตรวจเรา (QC Gate 1): ตรวจสอบความถูกต้องก่อนส่งให้ลูกค้าตรวจรับ
                </div>
                <input type="text" id="qc-inspector-notes" class="form-input" placeholder="ความเห็นผู้ตรวจ PPT (เช่น ล้างสะอาดเรียบร้อย เช็คแรงดันน้ำยาแอร์ปกติ)..." style="margin-bottom: 0; font-size: 12px;">
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                  <button class="secondary btn-sm" id="btn-reject-qc1" style="color: #b91c1c; border-color: #fca5a5;">
                    ❌ ไม่ผ่าน QC - ตีกลับให้ช่างแก้ไข
                  </button>
                  <button class="btn-mint btn-sm" id="btn-pass-qc1" style="font-weight: 600;">
                    ✅ ผ่าน QC เรา - ส่งต่อลูกค้าตรวจรับ (ไปสเต็ป 10)
                  </button>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- ขั้นตอนที่ 10: ลูกค้าตรวจรับงาน หรือไม่รับงานและขอแก้ไข (QC Gate 2 Gatekeeper) -->
        ${(isCustomerReview || (job.status === 'in_progress' && (job.qcPassedAt || job.afterPhotos))) ? `
          <div style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: var(--radius-sm); padding: 14px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h4 style="margin: 0; color: #166534; font-size: 13px; font-weight: 600;">
                🎯 ขั้นตอนที่ 10: ลูกค้าตรวจรับงาน (QC Gate 2 & เริ่มนับประกัน)
              </h4>
              <span class="badge" style="background: #bbf7d0; color: #14532d; font-size: 11px;">Customer Sign-off</span>
            </div>
            <p style="font-size: 12px; color: #15803d; margin: 0 0 10px 0;">
              ลูกค้ารับชมผลงาน: หากลูกค้ายอมรับงาน จะเริ่มนับประกันดิจิทัล ${defaultWarrantyDays} วันทันที / หากลูกค้าไม่รับงาน จะวนลูปกลับไปข้อ 6 พร้อมบันทึก Accountability Penalty
            </p>
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
              <button class="secondary" id="btn-customer-reject" style="color: #991b1b; border-color: #f87171; font-weight: 600;">
                ⚠️ ลูกค้าไม่รับงาน & ขอแก้ไข (วนกลับไปข้อ 6)
              </button>
              <button class="btn-mint" id="btn-customer-accept" style="font-weight: 600;">
                🎉 ลูกค้ารับงานสมบูรณ์ (เริ่มนับประกันดิจิทัล)
              </button>
            </div>
          </div>
        ` : ''}

        <!-- Footer Bar with Manual Override & Close -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--gray-200); padding-top: 14px; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 12px; color: var(--gray-600);">ปรับสถานะแมนนวล:</span>
            <select id="modal-override-status" class="form-input select-input" style="font-size: 12px; margin-bottom: 0; width: 150px;">
              ${STATUS_STEPS.map(s => `
                <option value="${s.value}" ${job.status === s.value ? 'selected' : ''}>${s.label}</option>
              `).join('')}
            </select>
            <button class="secondary btn-sm" id="btn-save-assign-change">บันทึก</button>
          </div>
          
          <div>
            <button class="secondary" id="modal-btn-close">ปิดหน้าต่าง</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Dynamic preview function
  const selectElem = document.getElementById('modal-assign-tech-select');
  const previewContainer = document.getElementById('tech-live-preview');

  function renderSelectedTechPreview(techId) {
    if (!previewContainer) return;
    const tech = getTechnicianById(techId);
    if (!tech) {
      previewContainer.innerHTML = `
        <div style="color: var(--gray-400); text-align: center; padding: 6px;">
          ยังไม่ได้เลือกช่าง — กรุณาเลือกช่าง Pro จาก Dropdown ด้านบน
        </div>
      `;
      return;
    }

    const firstReview = tech.customerReviews && tech.customerReviews[0];

    previewContainer.innerHTML = `
      <div style="display: flex; gap: 10px; align-items: flex-start;">
        <div style="width: 38px; height: 38px; border-radius: 50%; background: #e0f2fe; color: #0369a1; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; font-weight: bold;">
          👷
        </div>
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-weight: 700; color: var(--navy); font-size: 13px;">
              ${tech.name} ${tech.nickname ? `(${tech.nickname})` : ''}
              <span style="font-family: monospace; font-size: 11px; color: var(--gray-500); font-weight: normal;">[${tech.id}]</span>
            </div>
            <span class="badge" style="${tech.status === 'active' ? 'background: #dcfce7; color: #15803d;' : 'background: #fef3c7; color: #b45309;'} font-size: 11px;">
              ${tech.status === 'active' ? '🟢 พร้อมรับงาน' : '🟡 กำลังทำงาน'}
            </span>
          </div>

          <div style="display: flex; gap: 12px; margin-top: 4px; font-size: 11px; color: var(--gray-600); flex-wrap: wrap;">
            <span>📞 <strong>${tech.phone}</strong></span>
            <span>📍 บริการ: <strong>${tech.coverageArea}</strong></span>
            <span>🏆 ผ่านงาน: <strong>${tech.completedJobs} งาน</strong></span>
          </div>

          <div style="display: flex; gap: 10px; margin-top: 4px; font-size: 11px; align-items: center;">
            <span style="color: #b45309; font-weight: 600;">⭐ ลูกค้า: ${tech.customerRating} / 5.0 (${tech.reviewCount} รีวิว)</span>
            <span style="color: #0369a1; font-weight: 600;">🛡️ PPT Audit: ${tech.companyScore}% (ตรงเวลา ${tech.companyAudit?.punctuality || 98}%)</span>
          </div>

          ${firstReview ? `
            <div style="margin-top: 6px; font-size: 11px; background: #f8fafc; padding: 4px 8px; border-radius: 4px; border-left: 3px solid #10b981; color: var(--gray-700);">
              💬 <em>"${firstReview.comment}"</em> — <span style="color: var(--gray-500);">${firstReview.customer}</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Initial preview
  if (currentSelectedTechId) {
    selectElem.value = currentSelectedTechId;
    renderSelectedTechPreview(currentSelectedTechId);
  } else {
    renderSelectedTechPreview('');
  }

  // Change handler
  selectElem.onchange = (e) => {
    renderSelectedTechPreview(e.target.value);
  };

  // Close handlers
  const closeModal = () => { modalContainer.innerHTML = ''; };
  document.getElementById('job-modal-close').onclick = closeModal;
  document.getElementById('modal-btn-close').onclick = closeModal;
  document.getElementById('job-modal-backdrop').onclick = (e) => {
    if (e.target.id === 'job-modal-backdrop') closeModal();
  };

  // Step 3 Action: Assign and send to technician
  const btnAssignAndSend = document.getElementById('btn-assign-and-send');
  if (btnAssignAndSend) {
    btnAssignAndSend.onclick = async () => {
      const selectedId = selectElem.value;
      if (!selectedId) {
        alert('กรุณาเลือกช่าง Pro จาก Dropdown ก่อนทำการมอบหมายงานค่ะ');
        return;
      }
      const tech = getTechnicianById(selectedId);
      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          assignedTeamId: tech.id,
          assignedTechId: tech.id,
          assignedTechName: tech.name,
          assignedTechPhone: tech.phone,
          status: 'assigned', // Safe 1-of-5 status
          workflowStep: 3,
          workflowStatus: 'assigned',
          assignedAt: new Date().toISOString(),
        });
        closeModal();
        showToast(`มอบหมายงานให้ [${tech.id}] ${tech.name} เรียบร้อยแล้ว (ขั้นตอนที่ 3)`, 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาดในการมอบหมายช่าง: ${err.message}`);
      }
    };
  }

  // Step 6 Action: Save 3-Way Coordination
  const btnSaveCoord = document.getElementById('btn-save-coord');
  if (btnSaveCoord) {
    btnSaveCoord.onclick = async () => {
      const partsChecked = document.getElementById('chk-parts')?.checked || false;
      const techReadyChecked = document.getElementById('chk-tech-ready')?.checked || false;
      const customerConfirmChecked = document.getElementById('chk-customer-confirm')?.checked || false;
      const notes = document.getElementById('input-coord-notes')?.value.trim() || '';

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          coordination: {
            partsChecked,
            techReadyChecked,
            customerConfirmChecked,
            notes,
            coordinatedAt: new Date().toISOString(),
            coordinator: auth.currentUser?.email || 'admin@ppt.com',
          },
          workflowStep: 6,
        });
        showToast('บันทึกข้อมูลการประสานงาน 3 ฝ่ายเรียบร้อยแล้ว', 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาดในการบันทึกประสานงาน: ${err.message}`);
      }
    };
  }

  // Step 7 Action: Authorize Start
  const btnAuthorizeStart = document.getElementById('btn-authorize-start');
  if (btnAuthorizeStart) {
    btnAuthorizeStart.onclick = async () => {
      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress', // Safe 1-of-5 status
          workflowStep: 7,
          workflowStatus: 'in_progress',
          opsAuthorizedStart: true,
          opsAuthorizedAt: new Date().toISOString(),
        });
        closeModal();
        showToast('อนุมัติให้ช่างเริ่มปฏิบัติงานหน้างานเรียบร้อยแล้ว (ขั้นตอนที่ 7)', 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    };
  }

  // Step 9 QC Gate 1: Pass QC and send to Customer Review
  const btnPassQc1 = document.getElementById('btn-pass-qc1');
  if (btnPassQc1) {
    btnPassQc1.onclick = async () => {
      const qcNotes = document.getElementById('qc-inspector-notes')?.value.trim() || 'ตรวจงานผ่านเกณฑ์มาตรฐาน PPT';
      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress', // Safe 1-of-5 status
          workflowStep: 9,
          workflowStatus: 'customer_review',
          qcInspector: auth.currentUser?.email || 'admin@ppt.com',
          qcNotes,
          qcPassedAt: new Date().toISOString(),
        });
        closeModal();
        showToast('ผ่าน QC ด่านเราเรียบร้อย ส่งต่อลูกค้าตรวจรับ (ขั้นตอนที่ 9)', 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    };
  }

  // Step 9 QC Gate 1: Reject QC and send back to Tech for on-site revision
  const btnRejectQc1 = document.getElementById('btn-reject-qc1');
  if (btnRejectQc1) {
    btnRejectQc1.onclick = async () => {
      const qcNotes = prompt('ระบุจุดที่ช่างต้องแก้ไขหน้างาน:');
      if (!qcNotes) return;
      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress', // Safe 1-of-5 status
          workflowStep: 8,
          workflowStatus: 'tech_revision_required',
          qcRejectionNotes: qcNotes,
          qcRejectedAt: new Date().toISOString(),
        });
        closeModal();
        showToast('ตีกลับให้ช่างแก้ไขหน้างานเรียบร้อยแล้ว', 'info');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    };
  }

  // Step 10 QC Gate 2: Customer Accepts Job & Activate Digital Warranty
  const btnCustomerAccept = document.getElementById('btn-customer-accept');
  if (btnCustomerAccept) {
    btnCustomerAccept.onclick = async () => {
      const now = new Date();
      const end = new Date();
      end.setDate(now.getDate() + defaultWarrantyDays);

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'completed', // Safe 1-of-5 status
          workflowStep: 10,
          workflowStatus: 'completed',
          completedAt: now.toISOString(),
          payoutStatus: 'unlocked',
          warranty: {
            days: defaultWarrantyDays,
            startDate: now.toISOString(),
            endDate: end.toISOString(),
            status: 'active',
          },
        });
        closeModal();
        showToast(`ลูกค้ารับงานเรียบร้อย เริ่มนับประกันดิจิทัล ${defaultWarrantyDays} วัน ปิดงานสำเร็จ 🎉`, 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    };
  }

  // Step 10 QC Gate 2: Customer Rejects Job -> Trigger Accountability Penalty & Loopback to Step 6
  const btnCustomerReject = document.getElementById('btn-customer-reject');
  if (btnCustomerReject) {
    btnCustomerReject.onclick = async () => {
      const reason = prompt('ระบุเหตุผลที่ลูกค้าไม่รับงานและขอแก้ไข (ข้อบกพร่องหน้างาน):');
      if (!reason) return;

      const inspectorEmail = job.qcInspector || auth.currentUser?.email || 'ทีมตรวจ PPT';
      const techId = job.assignedTeamId || 'ช่างผู้ปฏิบัติงาน';

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress', // Safe 1-of-5 status
          workflowStep: 6, // Loopback to Step 6 (เราประสานงาน)
          workflowStatus: 'rework_needed',
          accountability: {
            penalizedInspector: inspectorEmail,
            penalizedTechnician: techId,
            rejectionReason: reason,
            penaltyFlag: true,
            rejectedAt: new Date().toISOString(),
          },
        });
        closeModal();
        showToast(`ลูกค้าไม่รับงาน: บันทึก Accountability โทษคู่ (${inspectorEmail} + ${techId}) และวนกลับไปขั้นตอนที่ 6 ทันที`, 'info');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    };
  }

  // Manual Override Button
  const btnSaveChange = document.getElementById('btn-save-assign-change');
  if (btnSaveChange) {
    btnSaveChange.onclick = async () => {
      const selectedId = selectElem.value;
      const newStatus = document.getElementById('modal-override-status').value;
      const tech = selectedId ? getTechnicianById(selectedId) : null;
      try {
        const updatePayload = {
          status: newStatus,
        };
        if (tech) {
          updatePayload.assignedTeamId = tech.id;
          updatePayload.assignedTechId = tech.id;
          updatePayload.assignedTechName = tech.name;
          updatePayload.assignedTechPhone = tech.phone;
        }
        await updateDoc(doc(db, 'jobs', job.id), updatePayload);
        closeModal();
        showToast('บันทึกการเปลี่ยนแปลงสถานะแมนนวลเรียบร้อยแล้ว', 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    };
  }
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
