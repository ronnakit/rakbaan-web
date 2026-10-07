import { auth, db } from './firebase.js';
import {
  onAuthStateChanged,
  signInAnonymously,
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
import { logAgentActivity } from './audit-logger.js';

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
let activeTab = window.location.hash === '#catalog' ? 'catalog' : 'jobs';

const urlParams = new URLSearchParams(window.location.search);
const isDevAdmin = urlParams.get('devAdmin') === 'true' || localStorage.getItem('rakbaan_dev_admin') === 'true';

if (isDevAdmin) {
  // 0ms Instant UI Render for Cockpit & Local Dev
  renderDashboard({ email: 'admin@rakbaan.com (Ops Lead)', uid: 'demo_ops_admin' }, 'admin');
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.warn('DevAdmin Anonymous auth note:', e.message);
      }
    } else {
      // Re-trigger jobs listener if needed once authenticated
      if (activeTab === 'jobs' && (!window._allJobs || window._allJobs.length === 0)) {
        const content = document.getElementById('view-content');
        if (content) renderJobsView(content);
      }
    }
  });
} else {
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
}

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
        <button class="btn-mint" id="btn-demo-admin" style="width: 100%; margin-top: 12px; font-weight: 700; padding: 10px; font-size: 13px;">
          ⚡ เข้าสู่ระบบแบบจำลอง (Demo Ops Admin Mode)
        </button>
      </div>
      <p class="meta" style="text-align: center;">
        บัญชีใหม่ต้องได้รับสิทธิ์ staff ผ่าน <code>node scripts/grant-staff-role.js [email]</code> ก่อนเข้าใช้งาน
      </p>
    </div>
  `;
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const error = document.getElementById('error');

  const btnDemoAdmin = document.getElementById('btn-demo-admin');
  if (btnDemoAdmin) {
    btnDemoAdmin.onclick = async () => {
      localStorage.setItem('rakbaan_dev_admin', 'true');
      if (!auth.currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (e) {}
      }
      renderDashboard({ email: 'admin@rakbaan.com (Ops Lead)', uid: 'demo_ops_admin' }, 'admin');
    };
  }

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
          <div>
            <h1 class="brand-title">การบริหารรักบ้าน</h1>
            <div class="brand-subtitle">ระบบบริหารจัดการงานซ่อมครบวงจร</div>
          </div>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-item ${activeTab === 'jobs' ? 'active' : ''}" id="nav-jobs" style="display: flex; align-items: center; justify-content: space-between;">
            <span>🚆 คิวเดินรถซ่อมสด</span>
            <span id="sidebar-incident-badge" style="display: none; background: #ea580c; color: #fff; font-size: 11px; font-weight: 700; border-radius: 10px; padding: 1px 7px;">0</span>
          </button>
          <button class="nav-item ${activeTab === 'history' ? 'active' : ''}" id="nav-history">
            <span>📦 อู่ประวัติเดินรถ</span>
          </button>
          <button class="nav-item ${activeTab === 'catalog' ? 'active' : ''}" id="nav-catalog">
            <span>🏷️ รายการงานบริการ</span>
          </button>
          <button class="nav-item ${activeTab === 'technicians' ? 'active' : ''}" id="nav-technicians">
            <span>🔧 ทะเบียนคนขับช่าง</span>
          </button>
          <button class="nav-item ${activeTab === 'customers' ? 'active' : ''}" id="nav-customers">
            <span>👤 ข้อมูลคนโดยสาร</span>
          </button>
          <button class="nav-item ${activeTab === 'finance' ? 'active' : ''}" id="nav-finance">
            <span>💰 สรุปการเงิน</span>
          </button>
          <button class="nav-item" id="nav-ops-playbook" style="margin-top: 14px; background: #ecfdf5; border: 1.5px solid #10b981; color: #047857; font-weight: 700; cursor: pointer; text-align: left; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span>📖 คู่มือเดินรถ (SOP)</span>
          </button>
          <a href="/cockpit.html" target="_blank" class="nav-item" style="text-decoration: none; color: #fff; margin-top: 8px; background: linear-gradient(135deg, #059669 0%, #0d9488 100%); border-radius: var(--radius-md); font-size: 13px; font-weight: 700; box-shadow: 0 4px 10px rgba(5, 150, 105, 0.3); text-align: center;">
            ศูนย์ควบคุม 3 หน้าจอ ↗
          </a>
          <a href="/tech.html" target="_blank" class="nav-item" style="text-decoration: none; color: #d97706; margin-top: 6px; background: #fffbeb; border: 1px dashed #f59e0b; border-radius: var(--radius-md); font-size: 13px; text-align: center;">
            จอคนขับช่าง ↗
          </a>
          <a href="/customer.html" target="_blank" class="nav-item" style="text-decoration: none; color: var(--mint-600); margin-top: 6px; background: var(--mint-100); border: 1px dashed var(--mint); border-radius: var(--radius-md); font-size: 13px; text-align: center;">
            จอคนโดยสาร ↗
          </a>
        </nav>
        <div class="sidebar-footer">
          <div class="user-chip" style="margin-bottom: 12px;">
            <div class="user-info">
              <span class="meta">${user.email}</span>
              <span class="role-badge">${role === 'admin' ? 'ฝ่ายบริหาร' : (role === 'team' ? 'ฝ่ายช่าง' : role)}</span>
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
  document.getElementById('nav-ops-playbook').onclick = openOpsPlaybookModal;

  const tabs = ['jobs', 'history', 'catalog', 'technicians', 'customers', 'finance'];
  const switchTab = (tab) => {
    activeTab = tab;
    window.location.hash = tab;
    tabs.forEach(t => {
      const el = document.getElementById(`nav-${t}`);
      if (el) el.classList.toggle('active', t === tab);
    });
    renderActiveTab(user, role);
  };

  tabs.forEach(t => {
    const el = document.getElementById(`nav-${t}`);
    if (el) el.onclick = () => switchTab(t);
  });

  renderActiveTab(user, role);
}

async function renderActiveTab(user, role) {
  const content = document.getElementById('view-content');
  if (!content) return;

  if (activeTab === 'jobs') {
    currentJobTab = 'all';
    renderJobsView(content);
  } else if (activeTab === 'history') {
    currentJobTab = 'history';
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
        <h2 class="catalog-title">ทำเนียบกำลังพลช่างฝีมือเชียงใหม่ 15 ท่าน</h2>
        <p class="catalog-subtitle">ทะเบียนช่างมืออาชีพผ่านการคัดกรองมาตรฐานรักบ้าน — ตรวจประวัติอาชญากรรมเรียบร้อย</p>
      </div>
      <div>
        <a href="/tech.html" target="_blank" class="btn-mint" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
          เปิดหน้าจอช่าง ↗
        </a>
      </div>
    </div>
    
    <div class="kpi-row" style="margin-bottom: 20px;">
      <div class="kpi-tile"><div class="kpi-value">${all}</div><div class="kpi-label">ช่างในระบบทั้งหมด</div></div>
      <div class="kpi-tile" style="border-color: var(--mint);"><div class="kpi-value text-mint">${available}</div><div class="kpi-label">พร้อมรับงาน</div></div>
      <div class="kpi-tile" style="border-color: var(--amber);"><div class="kpi-value text-amber">${busy}</div><div class="kpi-label">ติดงานหน้างาน</div></div>
      <div class="kpi-tile" style="border-color: var(--gray-400);"><div class="kpi-value" style="color: var(--gray-500);">${leave}</div><div class="kpi-label">ลาพัก / เตรียมพร้อม</div></div>
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
            <th style="width: 150px;">คะแนนการประเมิน</th>
            <th style="width: 100px; text-align: center;">เข้าจอช่าง</th>
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
                  ${t.status === 'active' ? 'พร้อมรับงาน' : 'กำลังทำงาน'}
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
                  <span style="color: #0284c7;">วินัย Trust: <strong>${Math.round(t.companyScore || 95)}/100 (${Math.round(t.companyScore || 95) >= 95 ? 'เกรด A' : 'เกรด B'})</strong></span>
                  <span style="color: #d97706;">ลูกค้า: <strong>${t.customerRating}</strong> (${t.reviewCount})</span>
                </div>
              </td>
              <td style="text-align: center;">
                <a href="/tech.html?techId=${t.id}" target="_blank" class="secondary btn-sm" style="text-decoration: none; font-size: 11px; padding: 3px 8px;" title="เข้าสู่ระบบในนามช่างคนนี้">
                  เข้าจอช่าง
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
        <h2 class="catalog-title">ข้อมูลลูกค้า</h2>
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


// ---------------------------------------------------------------------------
// แบบจำลองศูนย์ควบคุมการเดินรถซ่อมรักบ้าน (Subway OCC Paradigm):
// 🚆 รถไฟ -> งาน (Job)
// 🔧 คนขับ -> ช่าง (Technician)
// 👤 คนโดยสาร -> ลูกค้า (Customer)
// 🏛️ ศูนย์ควบคุม -> Admin (OCC Ops Control Center)
// ---------------------------------------------------------------------------

let currentJobTab = 'all'; // 'all', 'urgent', 'active', 'pending', 'history'
let filterMonth = 'all';
let filterYear = 'all';
window._simIssuesActive = false; // สลับเปิด-ปิดจำลองสถานการณ์ 4 ขบวนติดปัญหาพร้อมกัน

const MOCK_MULTI_ISSUES = [
  {
    id: 'SIM-AIR01',
    title: 'ล้างแอร์ทั่วไป (ติดผนัง) (ห้องนอนอาม่า)',
    category: 'air_con',
    price: 600,
    status: 'traveling',
    scheduledDate: new Date().toISOString(),
    customerId: 'customer_cherd',
    addressId: null,
    addressText: '88/12 ซอย 2 ต.สุเทพ อ.เมือง จ.เชียงใหม่',
    assignedTeamId: 'RPS-T01',
    assignedTechName: 'ช่างสมหมาย ใจซื่อ (ช่างหมาย)',
    adminIssue: {
      issueType: 'หาบ้านไม่เจอ / เส้นทางติดขัด',
      notes: 'หาบ้านเลขที่ 88/12 ไม่เจอ ซอยตันค่ะ',
      status: 'pending_admin',
      reportedAt: new Date(Date.now() - 6 * 60000).toISOString(),
      techId: 'RPS-T01',
      techName: 'ช่างสมหมาย ใจซื่อ (ช่างหมาย)',
    }
  },
  {
    id: 'SIM-ELEC02',
    title: 'ตรวจเช็คแก้ไขไฟฟ้าดับเฉพาะจุด / ปลั๊กไฟช็อต',
    category: 'electrical',
    price: 550,
    status: 'traveling',
    scheduledDate: new Date().toISOString(),
    customerId: 'customer_somsri',
    addressId: null,
    addressText: '142 หมู่ 4 ต.แม่เหียะ อ.เมือง จ.เชียงใหม่',
    assignedTeamId: 'RPS-T07',
    assignedTechName: 'ช่างกิตติศักดิ์ เมืองแก้ว (ช่างศักดิ์)',
    adminIssue: {
      issueType: 'ลูกค้าไม่อยู่บ้าน / ประตูรั้วล็อค',
      notes: 'กดกริ่ง 3 ครั้งไม่มีคนออกมารับ โทรไม่ติดครับ',
      status: 'pending_admin',
      reportedAt: new Date(Date.now() - 4 * 60000).toISOString(),
      techId: 'RPS-T07',
      techName: 'ช่างกิตติศักดิ์ (ช่างศักดิ์)',
    }
  },
  {
    id: 'SIM-PLUMB03',
    title: 'ซ่อมท่อประปารั่วซึม / ชักโครกกดไม่ลง',
    category: 'plumbing',
    price: 750,
    status: 'in_progress',
    scheduledDate: new Date().toISOString(),
    customerId: 'customer_thanapat',
    addressId: null,
    addressText: '55/9 ต.ช้างเผือก อ.เมือง จ.เชียงใหม่',
    assignedTeamId: 'RPS-T03',
    assignedTechName: 'ช่างวิชัย นามวงศ์ (ช่างวิทย์)',
    adminIssue: {
      issueType: 'พบจุดซ่อมเพิ่มเติมหน้างาน',
      notes: 'สกัดปูนพบท่อฝังผนังแตกเพิ่ม ต้องขออนุมัติเพิ่มงานครับ',
      status: 'pending_admin',
      reportedAt: new Date(Date.now() - 2 * 60000).toISOString(),
      techId: 'RPS-T03',
      techName: 'ช่างวิชัย (ช่างวิทย์)',
    }
  },
  {
    id: 'SIM-DOOR04',
    title: 'ซ่อมประตูบานเลื่อนตกราง / ปรับระดับราง',
    category: 'door_window',
    price: 500,
    status: 'traveling',
    scheduledDate: new Date().toISOString(),
    customerId: 'customer_nittaya',
    addressId: null,
    addressText: '201 หมู่บ้านกรีนวัลเลย์ ต.แม่ริม จ.เชียงใหม่',
    assignedTeamId: 'RPS-T04',
    assignedTechName: 'ช่างเอกชัย บุญเรือง (ช่างเอก)',
    adminIssue: {
      issueType: 'นิติบุคคลไม่อนุญาตให้เข้าโครงการ',
      notes: 'รปภ. แจ้งว่าต้องให้เจ้าของบ้านโทรแจ้งป้อมก่อนครับ',
      status: 'pending_admin',
      reportedAt: new Date(Date.now() - 1 * 60000).toISOString(),
      techId: 'RPS-T04',
      techName: 'ช่างเอกชัย (ช่างเอก)',
    }
  }
];

function renderJobsView(container) {
  container.innerHTML = `
    <div class="catalog-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
      <div>
        <h2 class="catalog-title" style="display: flex; align-items: center; gap: 8px;">
          <span>การบริหารรักบ้าน</span>
          <span style="font-size: 14.5px; font-weight: 600; color: var(--gray-600);">— ศูนย์ควบคุมการเดินรถซ่อม (OCC)</span>
        </h2>
        <p class="catalog-subtitle" style="font-size: 13px; color: var(--gray-600); margin-top: 2px;">
          ศูนย์สั่งการและแก้ปัญหา (Admin) · 🚆 รถไฟ ➔ งาน | 🔧 คนขับ ➔ ช่าง | 👤 คนโดยสาร ➔ ลูกค้า
        </p>
      </div>
      <div>
        <button id="btn-toggle-sim-issues" style="background: ${window._simIssuesActive ? '#ea580c' : '#fff7ed'}; color: ${window._simIssuesActive ? '#ffffff' : '#c2410c'}; border: 1.5px solid #ea580c; border-radius: 8px; padding: 7px 14px; font-weight: 700; font-size: 12.5px; cursor: pointer; transition: all 0.15s;">
          ${window._simIssuesActive ? '🧪 ปิดโหมดจำลอง (กลับข้อมูลจริง)' : '🧪 จำลองช่างติดปัญหา 4 ขบวน'}
        </button>
      </div>
    </div>
    
    <!-- แถบ 3 ลำดับความสำคัญ + อู่ประวัติเดินรถ (OCC Priority Tabs) -->
    <div class="nav-tabs" style="margin-bottom: 16px; display: flex; gap: 8px; overflow-x: auto; padding: 4px;">
      <button class="nav-tab ${currentJobTab === 'all' ? 'active' : ''}" data-tab="all" style="font-weight: 700;">
        🚆 ขบวนรถสดทั้งหมด <span id="tab-count-all" class="badge" style="background: var(--navy); color: #fff; font-size: 11px; margin-left: 4px;">0</span>
      </button>
      <button class="nav-tab ${currentJobTab === 'urgent' ? 'active' : ''}" data-tab="urgent" style="${currentJobTab === 'urgent' ? 'background: #ea580c; color: #fff;' : 'color: #c2410c; background: #fff7ed; border-color: #fdba74;'} font-weight: 700;">
        🚨 1. รถไฟติดปัญหา (ด่วน) <span id="tab-count-urgent" class="badge" style="background: #dc2626; color: #fff; font-size: 11px; margin-left: 4px;">0</span>
      </button>
      <button class="nav-tab ${currentJobTab === 'active' ? 'active' : ''}" data-tab="active" style="font-weight: 700;">
        🟢 2. รถไฟกำลังแล่นบนราง <span id="tab-count-active" class="badge" style="background: #10b981; color: #fff; font-size: 11px; margin-left: 4px;">0</span>
      </button>
      <button class="nav-tab ${currentJobTab === 'pending' ? 'active' : ''}" data-tab="pending" style="font-weight: 700;">
        🟡 3. คนโดยสารรอรถ <span id="tab-count-pending" class="badge" style="background: #f59e0b; color: #fff; font-size: 11px; margin-left: 4px;">0</span>
      </button>
      <button class="nav-tab ${currentJobTab === 'history' ? 'active' : ''}" data-tab="history" style="font-weight: 700; margin-left: auto;">
        📦 อู่ประวัติเดินรถ (History) <span id="tab-count-history" class="badge" style="background: var(--gray-600); color: #fff; font-size: 11px; margin-left: 4px;">0</span>
      </button>
    </div>

    <!-- Date Filters -->
    <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center;">
      <span style="font-size: 13.5px; font-weight: 600; color: var(--gray-700);">ตัวกรองเวลา:</span>
      <select id="filter-month" class="form-input select-input" style="width: 140px; margin-bottom: 0; font-size: 13px;">
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
      <select id="filter-year" class="form-input select-input" style="width: 120px; margin-bottom: 0; font-size: 13px;">
        <option value="all" ${filterYear === 'all' ? 'selected' : ''}>ทุกปี</option>
        <option value="2569" ${filterYear === '2569' ? 'selected' : ''}>2569 (2026)</option>
        <option value="2568" ${filterYear === '2568' ? 'selected' : ''}>2568 (2025)</option>
      </select>
    </div>

    <!-- Table View -->
    <div class="table-responsive card" style="padding: 0; overflow: hidden; margin-bottom: 20px;" id="jobs-table-container">
      กำลังโหลดข้อมูลเดินรถ...
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

  // Attach sim toggle
  const simBtn = container.querySelector('#btn-toggle-sim-issues');
  if (simBtn) {
    simBtn.onclick = () => {
      window._simIssuesActive = !window._simIssuesActive;
      const content = document.getElementById('view-content');
      if (content) renderJobsView(content);
    };
  }

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

  // รวมงานจริงและงานจำลองสถานการณ์
  const allCombined = [
    ...(window._allJobs || []),
    ...(window._simIssuesActive ? MOCK_MULTI_ISSUES : [])
  ];

  // ค้นหารถไฟที่ติดปัญหาทั้งหมด (Priority 1: Urgent Issues)
  const allPendingIssues = allCombined.filter(j => j.adminIssue && j.adminIssue.status === 'pending_admin');
  allPendingIssues.sort((a, b) => new Date(a.adminIssue.reportedAt || a.createdAt || 0) - new Date(b.adminIssue.reportedAt || b.createdAt || 0));

  // นับจำนวนขบวนในแต่ละหมวด
  const urgentCount = allPendingIssues.length;
  const activeCount = allCombined.filter(j => j.status !== 'completed' && ['assigned', 'traveling', 'in_progress'].includes(j.status)).length;
  const pendingCount = allCombined.filter(j => j.status !== 'completed' && (j.status === 'pending_review' || j.status === 'requested')).length;
  const historyCount = allCombined.filter(j => j.status === 'completed').length;
  const allActiveCount = allCombined.filter(j => j.status !== 'completed').length;

  // อัปเดตตัวเลขบนแท็บ
  const elAll = document.getElementById('tab-count-all');
  if (elAll) elAll.textContent = allActiveCount;
  const elUrgent = document.getElementById('tab-count-urgent');
  if (elUrgent) elUrgent.textContent = urgentCount;
  const elActive = document.getElementById('tab-count-active');
  if (elActive) elActive.textContent = activeCount;
  const elPending = document.getElementById('tab-count-pending');
  if (elPending) elPending.textContent = pendingCount;
  const elHistory = document.getElementById('tab-count-history');
  if (elHistory) elHistory.textContent = historyCount;

  // อัปเดตป้ายแจ้งเตือนบน Sidebar เมนูด้านข้าง
  const sbBadge = document.getElementById('sidebar-incident-badge');
  if (sbBadge) {
    if (urgentCount > 0) {
      sbBadge.style.display = 'inline-block';
      sbBadge.textContent = `🚨 ${urgentCount}`;
    } else {
      sbBadge.style.display = 'none';
    }
  }

  // ตัวกรองตารางตามแท็บที่เลือก
  let filtered = allCombined.filter(j => {
    if (currentJobTab === 'urgent') {
      return j.adminIssue && j.adminIssue.status === 'pending_admin';
    } else if (currentJobTab === 'active') {
      if (j.status === 'completed') return false;
      return ['assigned', 'traveling', 'in_progress'].includes(j.status) || ['tech_submitted', 'rework_needed'].includes(j.workflowStatus);
    } else if (currentJobTab === 'pending') {
      if (j.status === 'completed') return false;
      return j.status === 'pending_review' || j.status === 'requested';
    } else if (currentJobTab === 'history') {
      return j.status === 'completed';
    } else {
      // แท็บ 'all' = งานสดทั้งหมด (ไม่รวมงานที่เสร็จแล้ว ย้ายเข้า History ตามกฎคุณเชิด)
      return j.status !== 'completed';
    }
  });

  // กรองตามเดือนและปี
  filtered = filtered.filter(j => {
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

  // แผงควบคุมปัญหาด่วนบนสุดเสมอ (Multi-Incident Control Deck)
  let deckHtml = '';
  if (allPendingIssues.length > 0) {
    deckHtml = `
      <div class="metro-incident-deck" style="background: #fff7ed; border: 2.5px solid #ea580c; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px; box-shadow: 0 4px 16px rgba(234, 88, 12, 0.15);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1.5px solid #fed7aa; padding-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 22px;">🚨</span>
            <div>
              <div style="font-size: 16px; font-weight: 800; color: #9a3412;">
                สัญญาณหยุดฉุกเฉิน: รถไฟติดปัญหา ${allPendingIssues.length} ขบวน (คนขับกำลังจอดรอคำตอบ — ศูนย์ควบคุมต้องเคลียร์ด่วน)
              </div>
              <div style="font-size: 12.5px; color: #c2410c;">
                จัดลำดับตามเวลาจอดนิ่งนานที่สุด (Longest Delay First) · ช่างไม่รองาน สื่อสารกับคนโดยสารและปลดล็อกคนขับผ่านแอป 100%
              </div>
            </div>
          </div>
          <span class="badge" style="background: #dc2626; color: #fff; font-size: 13px; font-weight: 800; padding: 4px 12px; border-radius: 20px;">
            ค้างรอ ${allPendingIssues.length} ขบวน
          </span>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px;">
          ${allPendingIssues.map((j, idx) => {
            const waitMins = Math.max(1, Math.round((Date.now() - new Date(j.adminIssue.reportedAt || j.createdAt || 0).getTime()) / 60000));
            const isLongest = idx === 0;
            return `
              <div class="incident-card" style="background: #ffffff; border: ${isLongest ? '2px solid #dc2626' : '1.5px solid #fed7aa'}; border-radius: 10px; padding: 12px 14px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                    <span style="font-family: monospace; font-weight: 800; color: var(--navy); font-size: 12px;">🚆 ขบวน ${j.id.slice(0, 10).toUpperCase()}</span>
                    <span class="badge" style="background: ${isLongest ? '#fee2e2' : '#ffedd5'}; color: ${isLongest ? '#991b1b' : '#c2410c'}; font-size: 11px; font-weight: 800; border: 1px solid ${isLongest ? '#fca5a5' : '#fdba74'};">
                      ⏱️ จอดนิ่ง ${waitMins} นาที ${isLongest ? '(นานสุด ⚠️)' : ''}
                    </span>
                  </div>
                  <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 4px;">
                    🔧 คนขับ: ${escapeHtml(j.adminIssue.techName || j.assignedTechName || 'ช่างประจำขบวน')}
                  </div>
                  <div style="font-size: 12px; color: #475569; margin-bottom: 6px;">
                    👤 คนโดยสาร: ${escapeHtml(j.customerId || 'ลูกค้า')} · ${escapeHtml(j.title || 'งานบริการ')}
                  </div>
                  <div style="background: #fff7ed; border-left: 3px solid #ea580c; padding: 6px 8px; border-radius: 4px; font-size: 12px; color: #9a3412; margin-bottom: 8px;">
                    <strong>เรื่อง:</strong> ${escapeHtml(j.adminIssue.issueType)}
                    ${j.adminIssue.notes ? `<div style="font-style: italic; margin-top: 2px;">"${escapeHtml(j.adminIssue.notes)}"</div>` : ''}
                  </div>
                </div>
                <button class="btn-sm btn-quick-issue-open" data-id="${j.id}" style="background: ${isLongest ? '#dc2626' : '#ea580c'}; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; font-weight: 700; cursor: pointer; width: 100%; font-size: 12.5px; transition: all 0.15s;">
                  🚨 สับรางเคลียร์ขบวนนี้ ➔
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  } else {
    deckHtml = `
      <div class="metro-occ-normal-bar" style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 10px 16px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">🟢</span>
          <span style="font-size: 13.5px; font-weight: 700; color: #166534;">
            สัญญาณเดินรถปกติ: ทุกขบวนแล่นตามกำหนดเวลา ไม่มีรถไฟติดปัญหาหน้างาน (0 ขบวน)
          </span>
        </div>
        <span style="font-size: 12px; color: #15803d; font-weight: 600;">
          ศูนย์ควบคุมการเดินรถพร้อมสั่งการ 100%
        </span>
      </div>
    `;
  }

  // ตารางเดินรถไฟ (OCC Traction Table)
  let tableHtml = `
    <table class="catalog-table">
      <thead>
        <tr>
          <th style="width: 110px;"># 🚆 ขบวนรถ</th>
          <th style="width: 130px;">⏱️ เวลานัดหมาย</th>
          <th>🛠️ รายการงาน</th>
          <th style="width: 160px; text-align:center;">📍 สถานีเดินรถ</th>
          <th style="width: 140px;">👤 คนโดยสาร</th>
          <th style="width: 160px;">🏠 ที่หมายปลายทาง</th>
          <th style="width: 160px;">🔧 คนขับประจำขบวน</th>
          <th style="width: 110px;">💰 ค่าบริการ</th>
          <th style="width: 100px; text-align: center;">⚙️ สั่งการ</th>
        </tr>
      </thead>
      <tbody>
  `;

  if (filtered.length === 0) {
    tableHtml += `<tr><td colspan="9" class="meta" style="text-align: center; padding: 32px 16px;">ไม่พบรายการขบวนรถในหมวดนี้</td></tr>`;
  } else {
    for (const j of filtered) {
      const category = CATEGORIES[j.category] || 
        (j.category === 'air' ? CATEGORIES.air_con : null) || 
        { name: j.serviceTitle || j.title || j.category || 'งานบริการซ่อม', icon: '' };
      const dateObj = new Date(j.scheduledDate || j.createdAt);
      const dateStr = dateObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const address = j.addressText || (j.addressId ? await resolveAddress(j.addressId) : '(ไม่มีที่อยู่)');
      const step = STATUS_STEPS.find((s) => s.value === j.status) || STATUS_STEPS[0];
      
      const techId = j.assignedTeamId || j.assignedTechId || j.techId;
      let assignedTech = techId ? getTechnicianById(techId) : null;
      if (!assignedTech && (j.customerSelectedTech || j.assignedTechName)) {
        const queryName = j.customerSelectedTech || j.assignedTechName;
        assignedTech = TECHNICIANS.find(t => t.name.includes(queryName) || t.id === queryName || (t.nickname && t.nickname.includes(queryName)));
      }
      const techDisplay = assignedTech
        ? `[${assignedTech.id}] ${assignedTech.nickname || assignedTech.name}`
        : (j.assignedTechName ? (techId ? `[${techId}] ` : '') + j.assignedTechName : (techId || 'รอจัดคนขับ'));

      // สัญลักษณ์ประกอบสถานีเดินรถ (Stations along the line)
      let stationBadge = `<span class="badge ${step.badge}" style="font-size: 11px;">🟢 ${step.label}</span>`;
      if (j.workflowStatus === 'rework_needed') {
        stationBadge = `<span class="badge" style="background: #fee2e2; color: #991b1b; font-size: 11px; border: 1px solid #fca5a5;">⚠️ วนกลับสถานี 6 (สั่งแก้)</span>`;
      } else if (j.workflowStatus === 'tech_submitted') {
        stationBadge = `<span class="badge" style="background: #fef3c7; color: #b45309; font-size: 11px; border: 1px solid #fde68a;">🔍 สถานี 9 (รอตรวจ QC)</span>`;
      } else if (j.workflowStatus === 'customer_review') {
        stationBadge = `<span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 11px; border: 1px solid #bae6fd;">👤 สถานี 10 (คนโดยสารตรวจ)</span>`;
      } else if (j.status === 'completed') {
        stationBadge = `<span class="badge" style="background: #dcfce7; color: #166534; font-size: 11px; border: 1px solid #86efac;">📦 เข้าอู่ประวัติ/มีประกัน</span>`;
      }

      const hasPendingIssue = j.adminIssue && j.adminIssue.status === 'pending_admin';
      if (hasPendingIssue) {
        stationBadge = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span class="badge" style="background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; font-size: 11px; font-weight: 800;">
              🚨 ติดสัญญาณฉุกเฉิน
            </span>
            <span style="font-size: 10.5px; color: #c2410c; font-weight: 700;">คนขับรอคำตอบ</span>
          </div>
        `;
      } else if (j.adminIssue && j.adminIssue.status === 'resolved') {
        stationBadge += `<div style="margin-top: 3px;"><span class="badge" style="background: #f0fdf4; color: #166534; border: 1px solid #86efac; font-size: 10px; font-weight: 700;">🟢 สับรางเรียบร้อย</span></div>`;
      }

      tableHtml += `
        <tr class="service-row" id="job-row-${j.id}" style="${hasPendingIssue ? 'background: #fff7ed; border-left: 4px solid #ea580c;' : ''}">
          <td style="font-family: monospace; font-weight: 700; color: var(--navy); font-size: 12px;">${j.id.slice(0, 10).toUpperCase()}</td>
          <td style="font-size: 12px; color: var(--gray-700);">${dateStr}</td>
          <td>
            <div style="font-weight: 600; color: var(--gray-900);">${category.name}</div>
            <div style="font-size: 11px; color: var(--gray-600);">${escapeHtml(j.title || '-')}</div>
          </td>
          <td style="text-align:center;">${stationBadge}</td>
          <td style="font-size: 12px; font-weight: 600;">${escapeHtml(j.customerId?.slice(0, 15) || '-')}</td>
          <td style="font-size: 12px; color: var(--gray-600); max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(address)}">${escapeHtml(address)}</td>
          <td style="font-size: 12px; font-weight: 600; color: ${j.assignedTeamId ? 'var(--mint-600)' : 'var(--amber)'};">${escapeHtml(techDisplay)}</td>
          <td style="font-weight: 600; color: var(--navy);">฿${(j.price || 0).toLocaleString()}</td>
          <td style="text-align: center;">
            <button class="secondary btn-sm btn-job-detail" data-id="${j.id}" style="font-size: 12px; padding: 4px 10px; font-weight: 600; white-space: nowrap;">
              ⚙️ เปิดดูขบวน
            </button>
          </td>
        </tr>
      `;
    }
  }
  
  tableHtml += `</tbody></table>`;
  container.innerHTML = deckHtml + tableHtml;

  // ผูกตัวดักฟังปุ่มดูรายละเอียดขบวน
  const detailBtns = container.querySelectorAll('.btn-job-detail');
  detailBtns.forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const job = allCombined.find(j => j.id === id);
      if (job) openJobModal(job);
    };
  });

  // ผูกตัวดักฟังปุ่มเปิดเคลียร์เคสฉุกเฉินด่วน
  const quickIssueBtns = container.querySelectorAll('.btn-quick-issue-open');
  quickIssueBtns.forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const job = allCombined.find(j => j.id === id);
      if (job) openJobModal(job);
    };
  });
}

async function openJobModal(job) {
  const modalContainer = document.getElementById('job-modal-container');
  if (!modalContainer) return;
  
  const category = CATEGORIES[job.category] || 
    (job.category === 'air' ? CATEGORIES.air_con : null) || 
    { name: job.serviceTitle || job.serviceName || job.title || 'งานบริการซ่อม', icon: '' };
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
            <span style="font-size: 13px; color: var(--navy); font-weight: 700; font-family: monospace;">🚆 ขบวนรถ: ${job.id}</span>
            <div style="display: flex; gap: 6px; align-items: center;">
              <span class="badge ${step.badge}" style="font-size: 12px;">สถานีเดินรถ: ${step.label}</span>
              ${isRework ? '<span class="badge" style="background: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 700;">⚠️ วนกลับสถานี 6 (สั่งแก้ไข)</span>' : ''}
              ${isSubmittedForReview ? '<span class="badge" style="background: #fef3c7; color: #b45309; font-size: 12px; font-weight: 700;">🔍 สถานี 9: รอตรวจ QC</span>' : ''}
              ${isCustomerReview ? '<span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 12px; font-weight: 700;">👤 สถานี 10: คนโดยสารตรวจ</span>' : ''}
              ${isCompleted ? '<span class="badge" style="background: #dcfce7; color: #166534; font-size: 12px; font-weight: 700;">📦 เข้าอู่ประวัติ/มีประกัน</span>' : ''}
            </div>
          </div>
          <h2 style="margin: 0; color: var(--navy); display: flex; align-items: center; gap: 8px;">
            ${category.name}
            <span style="font-size: 14px; font-weight: normal; color: var(--gray-600);">— ศูนย์สั่งการเดินรถ (OCC)</span>
          </h2>
        </div>

        <!-- 10-Step Interactive Workflow Pipeline Stepper -->
        <div class="workflow-pipeline" title="ขั้นตอนการทำงาน 10 ขั้นตอนตามกฎคุณเชิด">
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
          <div class="pipeline-step ${currentStepNum >= 9 ? 'done' : ''} ${currentStepNum === 9 ? 'active' : ''}">9. เราตรวจงาน</div>
          <span class="pipeline-arrow">➔</span>
          <div class="pipeline-step ${currentStepNum >= 10 ? 'done' : ''} ${currentStepNum === 10 ? 'active' : ''}">10. ลูกค้ารับงาน/ประกัน</div>
        </div>

        <!-- Accountability Banner (Cherd's Law: เกิดข้อบกพร่องร่วม เมื่อลูกค้าไม่รับงานหลังผ่านการตรวจงาน) -->
        ${(isRework || job.accountability) ? `
          <div class="accountability-banner">
            <div class="accountability-title">⚠️ บันทึกความรับผิดชอบร่วม</div>
            <div class="accountability-desc">
              ลูกค้าไม่รับงานและขอให้แก้ไขตามเหตุผล: <em>"${escapeHtml(job.accountability?.rejectionReason || 'พบจุดบกพร่องที่ต้องแก้ไขเพิ่มเติมหน้างาน')}"</em><br>
              📌 <strong>บันทึกความรับผิดชอบร่วมตามกฎคุณเชิด:</strong> ผู้ตรวจในขั้นตอนที่ 9 (<code>${escapeHtml(job.accountability?.penalizedInspector || 'ทีมตรวจ')}</code>) และช่างผู้ปฏิบัติงาน (<code>${escapeHtml(job.assignedTeamId || '-')}</code>)<br>
              🔄 <strong>ระบบวนลูปกลับมาที่:</strong> <strong>ขั้นตอนที่ 6 (เราประสานงาน)</strong> เพื่อตรวจสอบอะไหล่และนัดหมายแก้ไขให้ลูกค้าโดยด่วน
            </div>
          </div>
        ` : ''}

        <!-- Digital Warranty Banner (ถ้าจบงานแล้ว) -->
        ${isCompleted ? `
          <div class="warranty-card">
            <div class="warranty-header">
              <span class="warranty-title">🛡️ ความคุ้มครองการรับประกันเปิดใช้งานแล้ว</span>
              <span class="badge" style="background: #10b981; color: #fff; font-size: 11px;">มีผลคุ้มครอง</span>
            </div>
            <div style="font-size: 13px; color: #065f46; line-height: 1.6;">
              <div>• <strong>ระยะเวลารับประกัน:</strong> ${job.warranty?.days || defaultWarrantyDays} วัน (ครอบคลุมงานฝีมือและชิ้นส่วนที่เปลี่ยน)</div>
              <div>• <strong>วันเริ่มต้น - สิ้นสุด:</strong> ${job.warranty?.startDate ? new Date(job.warranty.startDate).toLocaleDateString('th-TH') : '-'} ถึง <strong>${job.warranty?.endDate ? new Date(job.warranty.endDate).toLocaleDateString('th-TH') : '-'}</strong></div>
              <div>• <strong>สถานะการเงิน:</strong> ปลดล็อกยอดโอนเงินให้ช่างสมบูรณ์</div>
            </div>
          </div>
        ` : ''}

        <!-- ศูนย์ประสานงานปัญหาหน้างาน (Two-Way In-App Closed Loop 100% ห้ามโทรศัพท์) -->
        ${job.adminIssue ? `
          <div style="background: #fff7ed; border: 2px solid ${job.adminIssue.status === 'pending_admin' ? '#ea580c' : '#16a34a'}; border-radius: var(--radius-sm); padding: 16px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h4 style="margin: 0; color: #9a3412; font-size: 14px; font-weight: 700;">
                🚨 ศูนย์แก้ปัญหาฉุกเฉิน (สื่อสารผ่านแอป 100% ห้ามโทรศัพท์)
              </h4>
              <span class="badge" style="background: ${job.adminIssue.status === 'pending_admin' ? '#fee2e2' : '#dcfce7'}; color: ${job.adminIssue.status === 'pending_admin' ? '#991b1b' : '#15803d'}; font-size: 11px; font-weight: 800; border: 1px solid ${job.adminIssue.status === 'pending_admin' ? '#fca5a5' : '#86efac'};">
                ${job.adminIssue.status === 'pending_admin' ? '🚨 คนขับรอคำตอบ' : (job.adminIssue.status === 'resolved' ? '🟢 สับรางเรียบร้อย' : 'ช่างรับทราบผลแล้ว')}
              </span>
            </div>

            <!-- กล่องที่ 1: รายละเอียดปัญหาที่คนขับช่างแจ้งเข้ามา -->
            <div style="background: #ffffff; border: 1px solid #fed7aa; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px;">
              <div style="font-weight: 700; color: #c2410c; margin-bottom: 2px;">
                🔧 คนขับผู้แจ้ง: ${escapeHtml(job.adminIssue.techName || job.assignedTechName || '-')} [${escapeHtml(job.adminIssue.techId || job.assignedTeamId || '')}]
              </div>
              <div style="color: #431407;">
                <strong>เรื่อง:</strong> ${escapeHtml(job.adminIssue.issueType)} ${job.adminIssue.notes ? `— <em>"${escapeHtml(job.adminIssue.notes)}"</em>` : ''}
              </div>
              <div style="font-size: 11px; color: #9a3412; margin-top: 4px;">
                เวลาที่แจ้ง: ${new Date(job.adminIssue.reportedAt).toLocaleDateString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
              </div>
            </div>

            <!-- กล่องที่ 2: ช่องทางแอดมินสื่อสารกับคนโดยสารผ่านแอป -->
            <div style="background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="font-weight: 700; color: #0369a1; font-size: 13px;">
                  👤 สื่อสารกับคนโดยสาร (ลูกค้า) ผ่านแอป:
                </div>
                ${job.customerInAppMessage ? `
                  <span class="badge" style="background: ${job.customerReply ? '#dcfce7' : '#fef3c7'}; color: ${job.customerReply ? '#15803d' : '#92400e'}; font-size: 11px;">
                    ${job.customerReply ? 'คนโดยสารตอบกลับแล้ว' : 'รอคนโดยสารเปิดอ่าน'}
                  </span>
                ` : ''}
              </div>

              <!-- ข้อความที่เคยส่ง หรือคำตอบจากลูกค้า -->
              ${job.customerInAppMessage ? `
                <div style="background: #ffffff; border: 1px solid #e0f2fe; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; font-size: 12.5px; color: #075985;">
                  <div><strong>ข้อความถึงคนโดยสาร:</strong> "${escapeHtml(job.customerInAppMessage.message)}"</div>
                  <div style="font-size: 11px; color: #64748b; margin-top: 2px;">ส่งเมื่อ: ${new Date(job.customerInAppMessage.sentAt).toLocaleTimeString('th-TH')}</div>
                </div>
              ` : ''}

              ${job.customerReply ? `
                <div style="background: #ecfdf5; border: 1.5px solid #86efac; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; font-size: 13px; color: #166534;">
                  <div><strong>คำตอบจากคนโดยสาร:</strong> "${escapeHtml(job.customerReply.text)}"</div>
                  <div style="font-size: 11px; color: #15803d; margin-top: 2px;">ตอบกลับเมื่อ: ${new Date(job.customerReply.repliedAt).toLocaleTimeString('th-TH')}</div>
                </div>
              ` : ''}

              <!-- แม่แบบข้อความด่วนสำหรับแอดมินส่งหาลูกค้า -->
              <div style="font-size: 12px; font-weight: 600; color: #0369a1; margin-bottom: 4px;">เลือกข้อความด่วนส่งหาคนโดยสาร:</div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
                <button type="button" class="btn-template-msg" data-text="คนขับถึงซอยหน้าบ้านแล้วแต่หาบ้านเลขที่ไม่เจอ ขอหมุดหรือจุดสังเกตเพิ่มเติมค่ะ" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; padding: 4px 10px; font-size: 11.5px; cursor: pointer;">
                  หาบ้านไม่เจอ ขอจุดสังเกต
                </button>
                <button type="button" class="btn-template-msg" data-text="คนขับถึงหน้าบ้านแล้ว ประตูรั้วปิดอยู่ รบกวนเปิดประตูบ้านให้คนขับด้วยค่ะ" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; padding: 4px 10px; font-size: 11.5px; cursor: pointer;">
                  ถึงหน้าบ้านแล้ว รบกวนเปิดประตู
                </button>
                <button type="button" class="btn-template-msg" data-text="คนขับตรวจพบจุดแก้ไขเพิ่มเติมหน้างาน ขอประสานงานรายละเอียดการซ่อมค่ะ" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; padding: 4px 10px; font-size: 11.5px; cursor: pointer;">
                  ตรวจพบจุดซ่อมเพิ่มเติม
                </button>
              </div>

              <div style="display: flex; gap: 8px;">
                <input type="text" id="admin-cust-msg-input" class="form-input" placeholder="พิมพ์ข้อความส่งหาคนโดยสารผ่านแอป..." style="margin-bottom: 0; font-size: 12px; flex: 1;">
                <button type="button" class="btn-mint btn-sm" id="btn-send-msg-cust" style="white-space: nowrap; font-weight: 600; padding: 6px 12px;">
                  📢 ส่งแจ้งคนโดยสาร
                </button>
              </div>
            </div>

            <!-- กล่องที่ 3: สรุปผลประสานงานส่งกลับให้คนขับ (ปลดล็อกช่าง) -->
            <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 6px; padding: 12px;">
              <div style="font-weight: 700; color: #166534; font-size: 13px; margin-bottom: 6px;">
                🟢 ส่งผลประสานงานให้คนขับ (สับรางปลดล็อกจอช่าง):
              </div>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="admin-tech-resolution-input" class="form-input" placeholder="คำแนะนำให้คนขับ (เช่น ลูกค้าแจ้งว่าบ้านอยู่หลังรั้วสีขาว เข้าไปได้เลย)..." value="${escapeHtml(job.adminIssue.resolutionNotes || '')}" style="margin-bottom: 0; font-size: 12px; flex: 1;">
                <button type="button" class="btn-mint btn-sm" id="btn-send-resolution-tech" style="background: #16a34a; white-space: nowrap; font-weight: 600; padding: 6px 12px;">
                  🟢 สับรางปลดล็อกคนขับ
                </button>
              </div>
            </div>

            <!-- ปุ่มเคลียร์ขบวนถัดไป (Next Train Flow) ถ้ามีขบวนติดปัญหาอื่นค้างอยู่ -->
            ${(() => {
              const allC = [...(window._allJobs || []), ...(window._simIssuesActive ? MOCK_MULTI_ISSUES : [])];
              const others = allC.filter(o => o.id !== job.id && o.adminIssue && o.adminIssue.status === 'pending_admin');
              if (others.length === 0) return '';
              return `
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1.5px dashed #fed7aa; display: flex; justify-content: flex-end; align-items: center; gap: 10px;">
                  <span style="font-size: 12.5px; color: #c2410c; font-weight: 700;">มีรถไฟติดปัญหาค้างรออีก ${others.length} ขบวน:</span>
                  <button type="button" id="btn-next-train-flow" data-id="${others[0].id}" style="background: #ea580c; color: #ffffff; border: none; border-radius: 6px; padding: 8px 14px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                    ⏩ เคลียร์ขบวนถัดไป: [${others[0].id.slice(0, 10)}] ➔
                  </button>
                </div>
              `;
            })()}
          </div>
        ` : ''}

        <!-- Dual-Sided Panel: Customer Side vs Technician & Ops Side -->
        <div class="dual-container">
          <!-- ฝั่งซ้าย: ข้อมูลคนโดยสาร (Customer Side 👤) -->
          <div class="dual-panel">
            <div class="dual-panel-header">
              <h4 class="dual-panel-title">👤 ข้อมูลคนโดยสาร (ลูกค้า)</h4>
              <span style="font-size: 11px; color: var(--gray-500);">ข้อมูลผู้แจ้ง</span>
            </div>

            <div style="font-size: 13px; color: var(--gray-700); line-height: 1.6;">
              <div><strong>รหัสลูกค้า:</strong> ${escapeHtml(job.customerId || '-')}</div>
              <div><strong>เวลานัดหมาย:</strong> ${dateStr}</div>
              <div>
                <strong>ที่อยู่หน้างาน:</strong> ${escapeHtml(address)}
                <div style="margin-top: 4px;">
                  <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" style="color: #0284c7; text-decoration: none; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                    เปิดแผนที่นำทาง ↗
                  </a>
                </div>
              </div>
            </div>

            <div style="background: #fff; padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200); font-size: 13px;">
              <strong style="color: var(--navy);">รายการแจ้งซ่อม:</strong>
              <div style="color: var(--gray-800); margin-top: 4px; line-height: 1.4;">${escapeHtml(job.title || 'ไม่มีรายละเอียด')}</div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200);">
              <span style="font-size: 13px; color: var(--gray-600);">ราคารวมสุทธิ:</span>
              <span style="font-size: 16px; font-weight: 700; color: var(--navy);">฿${(job.price || 0).toLocaleString()}</span>
            </div>

            <!-- Escrow Held Badge (Step 4) -->
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: var(--radius-sm); padding: 10px; font-size: 12px; color: #065f46;">
              <div style="font-weight: 700; display: flex; align-items: center; gap: 4px;">
                <span>ขั้นตอนที่ 4: พักเงินค่าบริการเรียบร้อย</span>
              </div>
              <div style="margin-top: 2px; color: #047857;">
                ยอด ฿${(job.price || 0).toLocaleString()} ชำระเงินเรียบร้อย (พักเงินรอไว้ ปลดล็อกเมื่อลูกค้าตรวจรับงาน)
              </div>
            </div>

            <div style="font-size: 12px; color: var(--gray-600); border-top: 1px dashed var(--gray-200); padding-top: 6px;">
              <span>การเลือกช่าง: <strong>${job.technicianPreference === 'ai' ? 'ระบบจัดหาให้อัตโนมัติ' : 'ลูกค้าเลือกช่างเอง'}</strong></span>
            </div>
          </div>

          <!-- ฝั่งขวา: ข้อมูลช่าง & เรา (Technician & Ops Side) -->
          <div class="dual-panel">
            <div class="dual-panel-header">
              <h4 class="dual-panel-title">ช่างผู้รับผิดชอบ และฝ่ายบริหาร</h4>
              <span style="font-size: 11px; color: var(--gray-500);">ข้อมูลผู้ปฏิบัติงาน</span>
            </div>

            <!-- Dropdown Pro Technicians 15 Candidates -->
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label class="form-label" style="font-weight: 600; color: var(--navy); font-size: 13px; margin: 0;">
                  ช่างผู้รับผิดชอบ (ขั้นตอนที่ 3)
                </label>
                <span style="font-size: 11px; background: #bbf7d0; color: #14532d; padding: 2px 6px; border-radius: 10px; font-weight: 600;">
                  ทะเบียนช่าง 15 ท่าน
                </span>
              </div>

              <select id="modal-assign-tech-select" class="form-input select-input" style="width: 100%; font-size: 12px; margin-bottom: 8px;">
                <option value="">-- กรุณาเลือกช่างจากทะเบียนช่าง --</option>
                <optgroup label="ช่างแนะนำที่ตรงกับหมวดงาน (${category.name})">
                  ${matchedTechs.map(t => `
                    <option value="${t.id}" ${currentSelectedTechId === t.id ? 'selected' : ''}>
                      [${t.id}] ${t.name} (${t.nickname}) คะแนน ${t.customerRating} — ${t.tradeName} [${t.status === 'active' ? 'ว่าง' : 'ไม่ว่าง'}]
                    </option>
                  `).join('')}
                </optgroup>
                ${otherTechs.length > 0 ? `
                  <optgroup label="ช่างสาขาอื่นๆ ในทะเบียน">
                    ${otherTechs.map(t => `
                      <option value="${t.id}" ${currentSelectedTechId === t.id ? 'selected' : ''}>
                        [${t.id}] ${t.name} (${t.nickname}) คะแนน ${t.customerRating} — ${t.tradeName} [${t.status === 'active' ? 'ว่าง' : 'ไม่ว่าง'}]
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
              <span style="font-size: 12px; color: var(--gray-600);">หน้าจอช่าง:</span>
              <a href="/tech.html?techId=${currentSelectedTechId || 'RPS-T01'}" target="_blank" style="color: var(--mint-600); font-weight: 600; text-decoration: none; font-size: 12px;">
                เปิดหน้าจอช่าง ↗
              </a>
            </div>

            <!-- Dispatch Button if not yet assigned -->
            ${isPendingReview ? `
              <button class="btn-mint" id="btn-assign-and-send" style="width: 100%; font-weight: 600; padding: 10px; font-size: 13px;">
                ขั้นตอนที่ 3: ส่งงานให้ช่างรับ
              </button>
            ` : ''}
          </div>
        </div>

        <!-- ขั้นตอนที่ 6: เราประสานงาน (อะไหล่ + ช่าง + ลูกค้า) -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: var(--radius-sm); padding: 14px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h4 style="margin: 0; color: var(--navy); font-size: 13px; font-weight: 600;">
              ขั้นตอนที่ 6: เราประสานงาน (อะไหล่แท้ + ช่าง + ลูกค้า)
            </h4>
            <span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 11px;">ประสานงาน 3 ฝ่าย</span>
          </div>
          
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--gray-700); margin-bottom: 10px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="chk-parts" ${job.coordination?.partsChecked ? 'checked' : ''}>
              <span>ตรวจสอบอะไหล่แท้/อุปกรณ์มาตรฐานครบถ้วน (ไม่ใช้อะไหล่เทียบหรืออะไหล่ดัดแปลง)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="chk-tech-ready" ${job.coordination?.techReadyChecked ? 'checked' : ''}>
              <span>ช่างยืนยันความพร้อม คิวเวลาเดินทาง และอุปกรณ์ความปลอดภัย</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="chk-customer-confirm" ${job.coordination?.customerConfirmChecked ? 'checked' : ''}>
              <span>ส่งข้อความยืนยันเวลานัดหมายและพิกัดหน้างานผ่านแอปเรียบร้อย (งดโทรศัพท์ 100%)</span>
            </label>
          </div>

          <div style="display: flex; gap: 8px;">
            <input type="text" id="input-coord-notes" class="form-input" placeholder="บันทึกการประสานงาน (เช่น ยืนยันเบิกคอมเพรสเซอร์แท้ศูนย์, ช่างเข้า 10:00 น.)..." value="${escapeHtml(job.coordination?.notes || '')}" style="margin-bottom: 0; flex: 1; font-size: 12px;">
            <button class="secondary btn-sm" id="btn-save-coord" style="white-space: nowrap;">บันทึกประสานงาน</button>
          </div>
        </div>

        <!-- ขั้นตอนที่ 7: เราให้ช่างเริ่มงาน -->
        ${(job.status === 'assigned' || job.status === 'traveling' || isRework) ? `
          <div style="background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: var(--radius-sm); padding: 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: #1e40af; font-size: 13px;">ขั้นตอนที่ 7: เราอนุญาตให้ช่างเริ่มทำงานให้ลูกค้า</strong>
              <div style="font-size: 12px; color: #1e3a8a; margin-top: 2px;">เมื่อการประสานงานอะไหล่และความพร้อมเรียบร้อย ให้กดอนุญาตเพื่อให้ช่างลงมือซ่อมหน้างานได้</div>
            </div>
            <button class="btn-mint" id="btn-authorize-start" style="font-weight: 600; white-space: nowrap; padding: 8px 16px;">
              อนุญาตให้ช่างเริ่มงาน
            </button>
          </div>
        ` : ''}

        <!-- ขั้นตอนที่ 8 & 9: ช่างส่งงาน & เราตรวจส่งต่อลูกค้า -->
        ${(isSubmittedForReview || isCustomerReview || job.beforePhotos || job.afterPhotos || isCompleted) ? `
          <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: var(--radius-sm); padding: 16px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <h4 style="margin: 0; color: var(--navy); font-size: 14px; font-weight: 600;">
                ขั้นตอนที่ 8 และ 9: ผลงานช่าง และเราตรวจงานส่งต่อลูกค้า
              </h4>
              <span class="badge" style="background: #dbeafe; color: #1e40af; font-size: 11px;">การตรวจงาน</span>
            </div>
            
            <div class="qc-compare-grid" style="margin-bottom: 12px;">
              <div class="qc-photo-box">
                <div class="qc-photo-title">รูปก่อนทำ</div>
                ${(job.beforePhotos && job.beforePhotos.length > 0) ? `
                  <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                    ${job.beforePhotos.map(url => `
                      <img src="${url}" style="max-height: 130px; max-width: 100%; border-radius: 4px; object-fit: cover; border: 1px solid #cbd5e1;" alt="Before" />
                    `).join('')}
                  </div>
                ` : '<div style="color: var(--gray-400); font-size: 12px; padding: 24px 0;">ไม่มีรูปภาพก่อนทำ</div>'}
              </div>

              <div class="qc-photo-box">
                <div class="qc-photo-title">รูปหลังทำเสร็จ</div>
                ${(job.afterPhotos && job.afterPhotos.length > 0) ? `
                  <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                    ${job.afterPhotos.map(url => `
                      <img src="${url}" style="max-height: 130px; max-width: 100%; border-radius: 4px; object-fit: cover; border: 1px solid #cbd5e1;" alt="After" />
                    `).join('')}
                  </div>
                ` : '<div style="color: var(--gray-400); font-size: 12px; padding: 24px 0;">ไม่มีรูปภาพหลังทำเสร็จ</div>'}
              </div>
            </div>

            ${job.techNotes ? `
              <div style="background: #fff; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200); font-size: 12px; margin-bottom: 12px;">
                <strong>หมายเหตุจากช่างหน้างาน:</strong> ${escapeHtml(job.techNotes)}
              </div>
            ` : ''}

            <!-- Inspection Actions -->
            ${isSubmittedForReview ? `
              <div style="background: #fff; padding: 12px; border-radius: var(--radius-sm); border: 1px solid #93c5fd; display: flex; flex-direction: column; gap: 10px;">
                <div style="font-weight: 600; font-size: 13px; color: var(--navy);">
                  ตรวจสอบงาน: ตรวจสอบความถูกต้องก่อนส่งให้ลูกค้าตรวจรับ
                </div>
                <input type="text" id="qc-inspector-notes" class="form-input" placeholder="ความเห็นผู้ตรวจงาน (เช่น ล้างสะอาดเรียบร้อย เช็คแรงดันน้ำยาแอร์ปกติ)..." style="margin-bottom: 0; font-size: 12px;">
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                  <button class="secondary btn-sm" id="btn-reject-qc1" style="color: #b91c1c; border-color: #fca5a5;">
                    ไม่ผ่านการตรวจ - ส่งกลับให้ช่างแก้ไข
                  </button>
                  <button class="btn-mint btn-sm" id="btn-pass-qc1" style="font-weight: 600;">
                    ผ่านการตรวจ - ส่งต่อลูกค้าตรวจรับงาน (ไปขั้นตอนที่ 10)
                  </button>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- ขั้นตอนที่ 10: ลูกค้าตรวจรับงาน หรือไม่รับงานและขอแก้ไข -->
        ${(isCustomerReview || (job.status === 'in_progress' && (job.qcPassedAt || job.afterPhotos))) ? `
          <div style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: var(--radius-sm); padding: 14px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h4 style="margin: 0; color: #166534; font-size: 13px; font-weight: 600;">
                ขั้นตอนที่ 10: ลูกค้าตรวจรับงาน (เริ่มนับประกัน)
              </h4>
              <span class="badge" style="background: #bbf7d0; color: #14532d; font-size: 11px;">การตรวจรับงาน</span>
            </div>
            <p style="font-size: 12px; color: #15803d; margin: 0 0 10px 0;">
              ลูกค้าตรวจดูผลงาน: หากลูกค้ายอมรับงาน จะเริ่มนับประกัน ${defaultWarrantyDays} วันทันที / หากลูกค้าไม่รับงาน จะวนกลับไปข้อ 6 พร้อมบันทึกความรับผิดชอบร่วม
            </p>
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
              <button class="secondary" id="btn-customer-reject" style="color: #991b1b; border-color: #f87171; font-weight: 600;">
                ลูกค้าไม่รับงาน & ขอแก้ไข (วนกลับไปข้อ 6)
              </button>
              <button class="btn-mint" id="btn-customer-accept" style="font-weight: 600;">
                ลูกค้ารับงานสมบูรณ์ (เริ่มนับประกัน)
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
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-weight: 700; color: var(--navy); font-size: 13px;">
              ${tech.name} ${tech.nickname ? `(${tech.nickname})` : ''}
              <span style="font-family: monospace; font-size: 11px; color: var(--gray-500); font-weight: normal;">[${tech.id}]</span>
            </div>
            <span class="badge" style="${tech.status === 'active' ? 'background: #dcfce7; color: #15803d;' : 'background: #fef3c7; color: #b45309;'} font-size: 11px;">
              ${tech.status === 'active' ? 'พร้อมรับงาน' : 'กำลังทำงาน'}
            </span>
          </div>

          <div style="display: flex; gap: 12px; margin-top: 4px; font-size: 11px; color: var(--gray-600); flex-wrap: wrap;">
            <span>โทรศัพท์: <strong>${tech.phone}</strong></span>
            <span>พื้นที่บริการ: <strong>${tech.coverageArea}</strong></span>
            <span>ผ่านงาน: <strong>${tech.completedJobs} งาน</strong></span>
          </div>

          <div style="display: flex; gap: 10px; margin-top: 4px; font-size: 11px; align-items: center;">
            <span style="color: #b45309; font-weight: 600;">คะแนนลูกค้า: ${tech.customerRating} / 5.0 (${tech.reviewCount} รีวิว)</span>
            <span style="color: #0369a1; font-weight: 600;">คะแนนวินัย: ${Math.round(tech.companyScore || 95)}/100 (${Math.round(tech.companyScore || 95) >= 95 ? 'เกรด A' : 'เกรด B'})</span>
          </div>

          ${firstReview ? `
            <div style="margin-top: 6px; font-size: 11px; background: #f8fafc; padding: 4px 8px; border-radius: 4px; border-left: 3px solid #10b981; color: var(--gray-700);">
              <em>"${firstReview.comment}"</em> — <span style="color: var(--gray-500);">${firstReview.customer}</span>
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

  // Issue Coordination Center: Quick Template Buttons
  const templateBtns = modalContainer.querySelectorAll('.btn-template-msg');
  templateBtns.forEach(btn => {
    btn.onclick = () => {
      const msgInput = document.getElementById('admin-cust-msg-input');
      if (msgInput) {
        msgInput.value = btn.getAttribute('data-text');
        msgInput.focus();
      }
    };
  });

  // Issue Coordination Center: Send In-App Message to Customer
  const btnSendMsgCust = document.getElementById('btn-send-msg-cust');
  if (btnSendMsgCust) {
    btnSendMsgCust.onclick = async () => {
      const msgInput = document.getElementById('admin-cust-msg-input');
      const message = msgInput?.value.trim();
      if (!message) {
        alert('กรุณากรอกข้อความที่จะส่งถึงลูกค้าค่ะ');
        return;
      }

      btnSendMsgCust.disabled = true;
      btnSendMsgCust.textContent = 'กำลังส่ง...';

      if (job.id.startsWith('SIM-')) {
        const simJob = MOCK_MULTI_ISSUES.find(s => s.id === job.id);
        if (simJob) {
          simJob.customerInAppMessage = {
            message,
            sentAt: new Date().toISOString()
          };
          simJob.customerReply = {
            text: 'รับทราบค่ะ ประสานงานเรียบร้อยแล้วค่ะ คนขับเข้ามาได้เลย',
            repliedAt: new Date().toISOString()
          };
        }
        showToast('ส่งข้อความประสานงานถึงคนโดยสารผ่านแอปเรียบร้อยแล้วค่ะ', 'success');
        refreshJobsTable();
        openJobModal(simJob || job);
        return;
      }

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          customerInAppMessage: {
            id: Date.now().toString(),
            message: message,
            status: 'pending',
            sentAt: new Date().toISOString(),
            sender: auth.currentUser?.email || 'admin@rakbaan.com',
          }
        });

        await logAgentActivity({
          agentId: 'agent-3-ops',
          agentName: 'Agent-3: แอดมิน Ops 🏛️',
          step: 6,
          stepName: '6. เราประสานงาน (ส่งข้อความถึงคนโดยสารในแอป)',
          action: 'ADMIN_SENT_INAPP_MESSAGE_TO_CUSTOMER',
          jobId: job.id,
          status: 'success',
          details: {
            message,
            customerId: job.customerId,
          }
        });

        showToast('ส่งข้อความประสานงานถึงคนโดยสารผ่านแอปเรียบร้อยแล้วค่ะ', 'success');
        const updatedSnap = await getDoc(doc(db, 'jobs', job.id));
        if (updatedSnap.exists()) {
          openJobModal({ id: updatedSnap.id, ...updatedSnap.data() });
        }
      } catch (err) {
        alert(`เกิดข้อผิดพลาดในการส่งข้อความ: ${err.message}`);
        btnSendMsgCust.disabled = false;
        btnSendMsgCust.textContent = '📢 ส่งแจ้งคนโดยสาร';
      }
    };
  }

  // Issue Coordination Center: Send Resolution Advice to Tech (Unlock Tech)
  const btnSendResolutionTech = document.getElementById('btn-send-resolution-tech');
  if (btnSendResolutionTech) {
    btnSendResolutionTech.onclick = async () => {
      const resInput = document.getElementById('admin-tech-resolution-input');
      const resolutionNotes = resInput?.value.trim() || 'ศูนย์ควบคุมประสานงานเรียบร้อยแล้ว สามารถเข้าปฏิบัติงานต่อได้ทันที';

      btnSendResolutionTech.disabled = true;
      btnSendResolutionTech.textContent = 'กำลังส่ง...';

      if (job.id.startsWith('SIM-')) {
        const simJob = MOCK_MULTI_ISSUES.find(s => s.id === job.id);
        if (simJob) {
          simJob.adminIssue.status = 'resolved';
          simJob.adminIssue.resolutionNotes = resolutionNotes;
          simJob.adminIssue.resolvedAt = new Date().toISOString();
        }
        showToast('สับรางปลดล็อกคนขับขบวนนี้เรียบร้อยแล้วค่ะ', 'success');
        refreshJobsTable();
        openJobModal(simJob || job);
        return;
      }

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          'adminIssue.status': 'resolved',
          'adminIssue.resolutionNotes': resolutionNotes,
          'adminIssue.resolvedAt': new Date().toISOString(),
          'adminIssue.resolvedBy': auth.currentUser?.email || 'admin@rakbaan.com',
        });

        await logAgentActivity({
          agentId: 'agent-3-ops',
          agentName: 'Agent-3: แอดมิน Ops 🏛️',
          step: 6,
          stepName: '6. เราประสานงาน (ส่งผลประสานงานปลดล็อกคนขับ)',
          action: 'ADMIN_RESOLVED_ISSUE_FOR_TECH',
          jobId: job.id,
          status: 'success',
          details: {
            techId: job.adminIssue?.techId || job.assignedTeamId,
            resolutionNotes,
          }
        });

        showToast('สับรางปลดล็อกคนขับเรียบร้อยแล้ว (คนขับจะเห็นปุ่มเริ่มงานต่อ)', 'success');
        const updatedSnap = await getDoc(doc(db, 'jobs', job.id));
        if (updatedSnap.exists()) {
          openJobModal({ id: updatedSnap.id, ...updatedSnap.data() });
        }
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
        btnSendResolutionTech.disabled = false;
        btnSendResolutionTech.textContent = '🟢 สับรางปลดล็อกคนขับ';
      }
    };
  }

  // Next Train Flow Button (สลับเปิดขบวนถัดไปทันที)
  const btnNextTrainFlow = document.getElementById('btn-next-train-flow');
  if (btnNextTrainFlow) {
    btnNextTrainFlow.onclick = () => {
      const nextId = btnNextTrainFlow.getAttribute('data-id');
      const allC = [...(window._allJobs || []), ...(window._simIssuesActive ? MOCK_MULTI_ISSUES : [])];
      const nextJob = allC.find(j => j.id === nextId);
      if (nextJob) openJobModal(nextJob);
    };
  }

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

        // Agent-3 Audit Log: Ops ส่งงานให้ช่าง Pro รับงาน (สเต็ป 3)
        await logAgentActivity({
          agentId: 'agent-3-ops',
          agentName: 'Agent-3: แอดมิน Ops 🏛️',
          step: 3,
          stepName: '3. ส่งช่างรับ (Dispatch Pro Tech)',
          action: 'DISPATCH_PRO_TECH',
          jobId: job.id,
          status: 'success',
          details: {
            assignedTechId: tech.id,
            assignedTechName: tech.name,
            phone: tech.phone,
            rating: tech.customerRating,
          },
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

        // Agent-3 Audit Log: Ops ประสานงาน 3 ฝ่าย (สเต็ป 6)
        await logAgentActivity({
          agentId: 'agent-3-ops',
          agentName: 'Agent-3: แอดมิน Ops 🏛️',
          step: 6,
          stepName: '6. เราประสานงาน (Ops 3-Way Coordination)',
          action: 'OPS_COORDINATE_3WAY',
          jobId: job.id,
          status: 'success',
          details: {
            partsChecked,
            techReadyChecked,
            customerConfirmChecked,
            notes,
          },
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

        // Agent-3 Audit Log: Ops สั่งเริ่มงานอย่างเป็นทางการ (สเต็ป 7)
        await logAgentActivity({
          agentId: 'agent-3-ops',
          agentName: 'Agent-3: แอดมิน Ops 🏛️',
          step: 7,
          stepName: '7. เราสั่งเริ่มงาน (Ops Authorizes Work)',
          action: 'OPS_AUTHORIZE_START_WORK',
          jobId: job.id,
          status: 'success',
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

        // Agent-4 Audit Log: ผู้ตรวจ QC ผ่านงานสเต็ป 9 และส่งต่อให้ลูกค้าตรวจรับ
        await logAgentActivity({
          agentId: 'agent-4-qc',
          agentName: 'Agent-4: ผู้ตรวจ QC 🔍',
          step: 9,
          stepName: '9. เราตรวจ QC (Ops/QC Inspects)',
          action: 'QC_INSPECTION_PASSED',
          jobId: job.id,
          status: 'success',
          details: {
            qcNotes,
            inspector: auth.currentUser?.email || 'admin@ppt.com',
          },
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

        // Agent-4 Audit Log: ผู้ตรวจ QC ตีกลับให้ช่างแก้ไขหน้างาน
        await logAgentActivity({
          agentId: 'agent-4-qc',
          agentName: 'Agent-4: ผู้ตรวจ QC 🔍',
          step: 9,
          stepName: '9. เราตรวจ QC (Ops/QC Inspects)',
          action: 'QC_INSPECTION_REJECTED',
          jobId: job.id,
          status: 'warning',
          details: {
            qcRejectionNotes: qcNotes,
          },
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

        // Agent-1 & Agent-3 Audit Log: ปิดงานและเปิดรับประกันดิจิทัล (สเต็ป 10)
        await logAgentActivity({
          agentId: 'agent-1-customer',
          agentName: 'Agent-1: ลูกค้า 👤',
          step: 10,
          stepName: '10. ลูกค้ารับงาน/ประกัน (Customer Accepts)',
          action: 'CUSTOMER_ACCEPT_JOB',
          jobId: job.id,
          status: 'success',
          details: {
            warrantyDays: defaultWarrantyDays,
            payoutUnlocked: true,
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

        // Agent-1 & Agent-4 Audit Log: ตีกลับวนลูปข้อ 6 พร้อมธงโทษความรับผิดชอบร่วม
        await logAgentActivity({
          agentId: 'agent-1-customer',
          agentName: 'Agent-1: ลูกค้า 👤',
          step: 10,
          stepName: '10. ลูกค้าสั่งแก้ไขงาน (Accountability Triggered)',
          action: 'CUSTOMER_REJECT_JOB_REWORK',
          jobId: job.id,
          status: 'warning',
          details: {
            rejectionReason: reason,
            loopbackToStep: 6,
            penalizedInspector: inspectorEmail,
            penalizedTechnician: techId,
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

function openOpsPlaybookModal() {
  let modalContainer = document.getElementById('ops-playbook-modal-container');
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'ops-playbook-modal-container';
    document.body.appendChild(modalContainer);
  }

  modalContainer.innerHTML = `
    <div style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(5px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px;">
      <div style="background: #fff; border-radius: 18px; max-width: 680px; width: 100%; max-height: 90vh; overflow-y: auto; padding: 24px; box-shadow: 0 25px 50px rgba(0,0,0,0.4); border: 2px solid #10b981; animation: toastIn 0.25s ease;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f1f5f9; padding-bottom: 14px; margin-bottom: 18px;">
          <div>
            <div style="font-size: 21px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
              <span>📖</span> <span>คู่มือปฏิบัติการส่วนกลาง (Ops SOP Hub)</span>
            </div>
            <div style="font-size: 14px; color: #64748b; margin-top: 2px;">
              ระเบียบปฏิบัติ 4 กะเวลาประจำวัน • สูตรจ่ายงาน 5D • รับมือเหตุฉุกเฉิน
            </div>
          </div>
          <button type="button" id="btn-ops-playbook-close" style="background: #f1f5f9; border: none; font-size: 20px; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; color: #475569;">✕</button>
        </div>

        <!-- กะเวลา 4 ช่วง -->
        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;">
          <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
            <span>⏰</span> <span>1. จังหวะทำงาน 4 ช่วงเวลาประจำวัน (Daily Rhythm)</span>
          </div>
          <div style="font-size: 14px; color: #334155; line-height: 1.55;">
            • <strong>07:30 น. (กะเช้า):</strong> ตรวจสอบเคสค้างคืน ยืนยันนัดหมาย และปล่อยช่างรอบแรก<br>
            • <strong>08:30–17:00 น. (กะกลางวัน):</strong> มอนิเตอร์ Live SLA และแก้ปัญหาช่างล่าช้าเกิน 15 นาที<br>
            • <strong>17:00–20:00 น. (กะค่ำ):</strong> ปิดรับงานด่วนมาก (Hotline) ตัดรอบงานหลัง 17:00 ไปรอบ 08:00 วันถัดไป<br>
            • <strong>20:00 น. (ตัดรอบวัน):</strong> ยุติการทำงานช่าง ตรวจสอบยอดเงินพัก บจก.เพียบพร้อมทำ
          </div>
        </div>

        <!-- เกณฑ์ 5D -->
        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-left: 4px solid #0284c7; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;">
          <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
            <span>🎯</span> <span>2. เกณฑ์การจ่ายงาน 5 มิติ (5D Dispatch)</span>
          </div>
          <div style="font-size: 14px; color: #334155; line-height: 1.55;">
            1. <strong>Skill (ทักษะตรงสาย):</strong> ช่างมีใบรับรองและทักษะตรงประเภทงานซ่อม<br>
            2. <strong>GPS (ระยะทางใกล้สุด):</strong> คิดค่าเดินทางมาตรฐาน (+15฿/กม. เกิน 10 กม.)<br>
            3. <strong>SLA (เวลาลงตัว):</strong> ไม่จัดคิวงานซ้อนเหลื่อมเวลากัน ป้องกันช่างสาย<br>
            4. <strong>Trust Score (วินัยสูง):</strong> ช่างเกรด A/B (≥ 80 แต้ม) ได้รับคิวงานก่อน ช่างเกรด F ระบบล็อกอัตโนมัติ<br>
            5. <strong>Fairness (กระจายงานเป็นธรรม):</strong> เกลี่ยงานให้ช่างอย่างสมดุล ไม่กระจุกตัว
          </div>
        </div>

        <!-- Exception Matrix -->
        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-left: 4px solid #f59e0b; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;">
          <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
            <span>🚨</span> <span>3. ตารางรับมือเหตุฉุกเฉิน (Exception Matrix)</span>
          </div>
          <div style="font-size: 14px; color: #334155; line-height: 1.55;">
            • <strong>ช่างไม่ตอบรับเกิน 15 นาที:</strong> จ่ายงานให้ช่างสำรองทันที และตัด 5 คะแนนวินัย<br>
            • <strong>ลูกค้าไม่อยู่บ้าน:</strong> รอ 15 นาที โทรประสานงาน 2 ครั้ง หากติดต่อไม่ได้ ยกเลิกพร้อมคิดค่าตรวจเช็ค<br>
            • <strong>หน้างานมีงานงอก/อะไหล่เพิ่ม:</strong> ออกใบเสนอราคาเสริมผ่านระบบ ห้ามช่างเรียกเก็บเงินสดหน้างาน
          </div>
        </div>

        <!-- Escrow Rule -->
        <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-left: 4px solid #ef4444; border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;">
          <div style="font-size: 16px; font-weight: 800; color: #991b1b; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
            <span>💰</span> <span>4. กฎเงินพัก บจก. เพียบพร้อมทำ ห้ามรับเงินสดหน้างานทุกกรณี</span>
          </div>
          <div style="font-size: 14px; color: #7f1d1d; line-height: 1.55;">
            เงินทุกบาทลูกค้าชำระเข้าบัญชีกลาง บจก. เพียบพร้อมทำ ก่อนเริ่มงาน • ปลดล็อกโอนให้ช่างเมื่อผ่าน QC รูปถ่าย และลูกค้ายืนยันตรวจรับงานแล้วเท่านั้น • ตรวจสอบพบรับเงินสดหน้างาน ปรับเงินและตัดสิทธิ์ช่างทันที
          </div>
        </div>

        <button type="button" id="btn-ops-playbook-ok" style="width: 100%; background: #10b981; color: #fff; border: none; border-radius: 10px; padding: 12px; font-size: 16px; font-weight: 700; cursor: pointer;">
          เข้าใจและพร้อมปฏิบัติงานตามมาตรฐาน Ops ➔
        </button>
      </div>
    </div>
  `;

  const close = () => {
    modalContainer.innerHTML = '';
  };

  document.getElementById('btn-ops-playbook-close').onclick = close;
  document.getElementById('btn-ops-playbook-ok').onclick = close;
}

window.openOpsPlaybookModal = openOpsPlaybookModal;

