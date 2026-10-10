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
  QC_INSPECTORS,
  getQCInspectorById,
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
  renderDashboard({ email: 'admin@rakbaan.com (หัวหน้าฝ่ายบริหาร)', uid: 'demo_ops_admin' }, 'admin');
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
          <h1 class="brand-title" style="font-size: 22px;">การบริหารรักบ้าน</h1>
          <div class="brand-subtitle">ระบบบริหารจัดการสำหรับทีมงานและฝ่ายบริหาร</div>
        </div>
      </div>
      <div class="card">
        <h2 style="font-size: 16px; margin-bottom: 14px;">เข้าสู่ระบบเจ้าหน้าที่ฝ่ายบริหาร</h2>
        <input id="email" type="email" placeholder="อีเมล" autocomplete="username" />
        <input id="password" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" />
        <p class="error" id="error"></p>
        <div class="row">
          <button class="primary" id="signin" style="flex: 1;">เข้าสู่ระบบ</button>
          <button class="secondary" id="signup">สร้างบัญชีใหม่</button>
        </div>
        <button class="btn-mint" id="btn-demo-admin" style="width: 100%; margin-top: 12px; font-weight: 700; padding: 10px; font-size: 13px;">
          เข้าสู่ระบบแบบจำลองสำหรับทดสอบ
        </button>
      </div>
      <p class="meta" style="text-align: center;">
        บัญชีใหม่ต้องได้รับสิทธิ์จากผู้ดูแลระบบก่อนเข้าใช้งาน
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
      renderDashboard({ email: 'admin@rakbaan.com (ผู้ดูแลระบบ)', uid: 'demo_ops_admin' }, 'admin');
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
          <h1 class="brand-title" style="font-size: 22px;">รักบ้าน@CNX — การบริหารรักบ้าน</h1>
        </div>
      </div>
      <div class="notice">
        บัญชี <strong>${user.email}</strong> ยังไม่มีสิทธิ์เจ้าหน้าที่ (สถานะปัจจุบัน: <code>${role}</code>)<br />
        กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์การใช้งาน<br />
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
            <span>คิวงานซ่อมสด</span>
            <span id="sidebar-incident-badge" style="display: none; background: #ea580c; color: #fff; font-size: 11px; font-weight: 700; border-radius: 10px; padding: 1px 7px;">0</span>
          </button>
          <button class="nav-item ${activeTab === 'history' ? 'active' : ''}" id="nav-history">
            <span>ประวัติงานที่เสร็จสิ้น</span>
          </button>
          <button class="nav-item ${activeTab === 'catalog' ? 'active' : ''}" id="nav-catalog">
            <span>รายการงานบริการ</span>
          </button>
          <button class="nav-item ${activeTab === 'technicians' ? 'active' : ''}" id="nav-technicians">
            <span>ทะเบียนช่าง</span>
          </button>
          <button class="nav-item ${activeTab === 'customers' ? 'active' : ''}" id="nav-customers">
            <span>ข้อมูลลูกค้า</span>
          </button>
          <button class="nav-item ${activeTab === 'finance' ? 'active' : ''}" id="nav-finance">
            <span>สรุปการเงิน</span>
          </button>
          <button class="nav-item" id="nav-ops-playbook" style="margin-top: 14px; background: #ecfdf5; border: 1.5px solid #10b981; color: #047857; font-weight: 700; cursor: pointer; text-align: left; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span>คู่มือปฏิบัติการ</span>
          </button>
          <a href="/cockpit.html" target="_blank" class="nav-item" style="text-decoration: none; color: #fff; margin-top: 8px; background: linear-gradient(135deg, #059669 0%, #0d9488 100%); border-radius: var(--radius-md); font-size: 13px; font-weight: 700; box-shadow: 0 4px 10px rgba(5, 150, 105, 0.3); text-align: center;">
            ศูนย์ควบคุม 3 หน้าจอ
          </a>
          <a href="/tech.html" target="_blank" class="nav-item" style="text-decoration: none; color: #d97706; margin-top: 6px; background: #fffbeb; border: 1px dashed #f59e0b; border-radius: var(--radius-md); font-size: 13px; text-align: center;">
            จอช่าง
          </a>
          <a href="/customer.html" target="_blank" class="nav-item" style="text-decoration: none; color: var(--mint-600); margin-top: 6px; background: var(--mint-100); border: 1px dashed var(--mint); border-radius: var(--radius-md); font-size: 13px; text-align: center;">
            จอลูกค้า
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
            ระบบบริหารจัดการรักบ้าน
          </div>
        </div>
      </aside>

      <main class="main-content">
        <div style="margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
          <button id="btn-toggle-sidebar" class="btn-toggle-sidebar" title="ซ่อนหรือแสดงแถบเมนูด้านซ้าย">
            <span id="sidebar-toggle-text">ซ่อนแถบเมนูข้าง</span>
          </button>
        </div>
        <div id="view-content"></div>
      </main>
    </div>
  `;

  document.getElementById('signout').onclick = () => signOut(auth);
  document.getElementById('nav-ops-playbook').onclick = openOpsPlaybookModal;

  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const toggleSidebarFn = () => {
    const sidebar = document.querySelector('.sidebar');
    const text = document.getElementById('sidebar-toggle-text');
    if (sidebar) {
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      if (text) text.textContent = isCollapsed ? 'แสดงแถบเมนูข้าง' : 'ซ่อนแถบเมนูข้าง';
    }
  };

  if (btnToggleSidebar) {
    btnToggleSidebar.onclick = toggleSidebarFn;
  }

  // Keyboard shortcut
  if (!window._sidebarShortcutAttached) {
    window._sidebarShortcutAttached = true;
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleSidebarFn();
      }
    });
  }

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
    if (!['urgent', 'active', 'pending', 'delivering', 'history'].includes(currentJobTab)) {
      currentJobTab = 'urgent';
    }
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
  { id: 'PPT-TC01', name: 'สมชาย ใจดี (ชาย)', gender: 'ชาย', age: 35, phone: '081-111-2222', skills: ['แอร์', 'ไฟฟ้า'], qcScore: 4.8, reviewScore: 4.9, paymentModel: 'ส่วนแบ่ง %', status: 'available' },
  { id: 'PPT-TC02', name: 'วิชัย รักงาน (ชัย)', gender: 'ชาย', age: 42, phone: '082-222-3333', skills: ['ประปา', 'ซ่อมบ้าน'], qcScore: 4.5, reviewScore: 4.7, paymentModel: 'เงินเดือน', status: 'busy' },
  { id: 'PPT-TC03', name: 'นพดล เก่งมาก (นพ)', gender: 'ชาย', age: 28, phone: '083-333-4444', skills: ['แอร์'], qcScore: 4.9, reviewScore: 5.0, paymentModel: 'เหมาต่องาน', status: 'available' },
  { id: 'PPT-TC04', name: 'สุดา ช่างแอร์ (ดา)', gender: 'หญิง', age: 31, phone: '084-444-5555', skills: ['แอร์', 'ไฟฟ้า'], qcScore: 4.6, reviewScore: 4.8, paymentModel: 'ส่วนแบ่ง %', status: 'inactive' },
  { id: 'PPT-TC05', name: 'อำนาจ ทรงพลัง (อ่ำ)', gender: 'ชาย', age: 45, phone: '085-555-6666', skills: ['ซ่อมบ้าน', 'ประปา', 'ไฟฟ้า'], qcScore: 4.7, reviewScore: 4.6, paymentModel: 'เหมาต่องาน', status: 'busy' },
];

let mockCustomers = [
  { id: 'CUST-01', name: 'คุณนารี สวยเสมอ', phone: '091-111-1111', zone: 'นิมมาน, เชียงใหม่', currentStatus: 'normal', jobCount: 5, totalSpend: 15500, history: [{ date: '2026-09-10', code: 'AC-CLN-001', service: 'ล้างแอร์ติดผนัง', tech: 'สมชาย ใจดี', price: 550, review: 'ดีมาก ช่างตรงต่อเวลา (5/5)' }] },
  { id: 'CUST-02', name: 'บจก. คาเฟ่ เชียงใหม่', phone: '092-222-2222', zone: 'แม่เหียะ, เชียงใหม่', currentStatus: 'in_progress', jobCount: 12, totalSpend: 45000, history: [{ date: '2026-09-08', code: 'EL-REP-005', service: 'ซ่อมไฟช็อต', tech: 'อำนาจ ทรงพลัง', price: 1200, review: 'แก้ไขได้รวดเร็ว (4/5)' }] },
  { id: 'CUST-03', name: 'ดร. วิชาญ เรียนดี', phone: '093-333-3333', zone: 'สันผีเสื้อ, เชียงใหม่', currentStatus: 'pending', jobCount: 2, totalSpend: 2800, history: [{ date: '2026-09-01', code: 'PL-LEK-002', service: 'ซ่อมท่อประปารั่ว', tech: 'วิชัย รักงาน', price: 800, review: 'งานเรียบร้อยดี (5/5)' }] },
  { id: 'CUST-04', name: 'ร้านอาหาร ไทยล้านนา', phone: '094-444-4444', zone: 'ช้างคลาน, เชียงใหม่', currentStatus: 'normal', jobCount: 8, totalSpend: 23400, history: [{ date: '2026-08-25', code: 'AC-REP-009', service: 'ซ่อมแอร์ไม่เย็น', tech: 'นพดล เก่งมาก', price: 3500, review: 'แอร์เย็นฉ่ำเหมือนใหม่ (5/5)' }] },
  { id: 'CUST-05', name: 'คุณสมศักดิ์ มั่งมี', phone: '095-555-5555', zone: 'สันทราย, เชียงใหม่', currentStatus: 'normal', jobCount: 1, totalSpend: 550, history: [{ date: '2026-08-20', code: 'AC-CLN-010', service: 'ล้างแอร์ติดผนัง', tech: 'สุดา ช่างแอร์', price: 550, review: 'ช่างอัธยาศัยดี (5/5)' }] },
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
          เปิดหน้าจอช่าง
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
                  <span style="color: #0284c7;">คะแนนวินัย: <strong>${Math.round(t.companyScore || 95)}/100 (${Math.round(t.companyScore || 95) >= 95 ? 'ระดับดีเยี่ยม' : 'ระดับดี'})</strong></span>
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

  const btnAddTech = document.getElementById('btn-add-tech');
  if (btnAddTech) {
    btnAddTech.onclick = () => {
      const m = document.getElementById('tech-modal-container');
      m.innerHTML = `
        <div class="modal-backdrop" id="tech-modal-backdrop" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;">
          <div class="modal-dialog card" style="width: 500px; max-width: 90%; position: relative; padding: 24px;">
            <button class="modal-close-btn" id="tech-modal-close" style="position: absolute; right: 16px; top: 16px; background: none; border: none; font-size: 18px; cursor: pointer;">✕</button>
            <h3 style="margin: 0 0 16px 0;">เพิ่มหรือแก้ไขข้อมูลช่าง</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
              <div><label class="form-label">ชื่อ-สกุล (ชื่อเล่น)</label><input class="form-input" style="margin:0;" type="text"></div>
              <div><label class="form-label">เบอร์โทรศัพท์</label><input class="form-input" style="margin:0;" type="text"></div>
              <div>
                <label class="form-label">ทักษะความชำนาญ</label>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  <label><input type="checkbox"> แอร์</label>
                  <label><input type="checkbox"> ไฟฟ้า</label>
                  <label><input type="checkbox"> ประปา</label>
                  <label><input type="checkbox"> ซ่อมบ้าน</label>
                </div>
              </div>
              <div>
                <label class="form-label">โมเดลค่าแรง</label>
                <select class="form-input select-input" style="margin:0;">
                  <option>ส่วนแบ่ง %</option><option>เหมาต่องาน</option><option>เงินเดือน</option>
                </select>
              </div>
              <div>
                <label class="form-label">สถานะ</label>
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
        <p class="catalog-subtitle">ระบบค้นหาและประวัติงานซ่อม</p>
      </div>
    </div>
    <div class="card" style="margin-bottom: 20px;">
      <div class="search-input-wrapper" style="margin-bottom: 0;">
        <input type="text" id="cust-search" class="catalog-search-input" placeholder="ค้นหา ชื่อ, สกุล, เบอร์โทร, โซนที่อยู่..." value="${customerSearchKeyword}" />
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
            let badge = '<span class="badge" style="background: var(--mint-100); color: var(--mint-600);">ปกติ</span>';
            if (c.currentStatus === 'in_progress') badge = '<span class="badge" style="background: var(--amber-100); color: var(--amber);">กำลังซ่อม</span>';
            else if (c.currentStatus === 'pending') badge = '<span class="badge" style="background: var(--navy-100); color: var(--navy);">รอนัดหมาย</span>';
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
                <button class="secondary btn-sm btn-cust-history" data-id="${c.id}">ประวัติงาน</button>
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
    renderCustomersView(container);
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
        <h2 class="catalog-title">สรุปการเงิน</h2>
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
// ระบบบริหารจัดการงานซ่อมครบวงจร (Ops Admin Hub):
// 5 ลำดับแท็บการทำงาน:
// 1. ปัญหาด่วน (ด่วน - ช่างติดปัญหาหน้างาน แอดมินต้องเคลียร์ทันที)
// 2. กำลังดำเนินการ (กำลังเดินทาง / กำลังซ่อม)
// 3. รอมอบหมาย (งานใหม่รอมอบหมายช่าง)
// 4. กำลังส่งมอบ (ช่างส่งงาน / รอตรวจ QC / ลูกค้าตรวจรับ)
// 5. ประวัติ (งานเสร็จสิ้นสมบูรณ์)
// ---------------------------------------------------------------------------

let currentJobTab = 'urgent'; // 'urgent', 'active', 'pending', 'delivering', 'history'
let filterMonth = 'all';
let filterYear = 'all';
window._simIssuesActive = false; // สลับเปิด-ปิดจำลองสถานการณ์ 4 งานติดปัญหาพร้อมกัน

const MOCK_MULTI_ISSUES = [
  {
    id: 'NM-01-ABANDON',
    title: 'ซ่อมท่อประปาฝังผนังแตก / ท่อเมนรั่ว',
    category: 'plumbing',
    price: 750,
    status: 'in_progress',
    scheduledDate: new Date().toISOString(),
    customerId: 'customer_weera',
    addressId: null,
    addressText: '45/8 หมู่ 5 ต.สุเทพ อ.เมือง จ.เชียงใหม่',
    assignedTeamId: 'RPS-T01',
    assignedTechName: 'ช่างสมหมาย ใจซื่อ (ช่างหมาย)',
    adminIssue: {
      issueType: 'ช่างทิ้งงานเพราะไม่ไหวจริงๆ (ท่อเมนเหล็กผุทั้งแนว)',
      notes: 'สกัดผนังเจอท่อเมนเหล็กสนิมผุยาว 3 เมตร น้ำทะลัก เครื่องมือเชื่อมท่อไม่พอ ช่างไม่ไหวครับ ขอยกเลิกงาน',
      status: 'pending_admin',
      reportedAt: new Date(Date.now() - 10 * 60000).toISOString(),
      techId: 'RPS-T01',
      techName: 'ช่างสมหมาย (ช่างหมาย)',
      sopGuide: '1. ตรวจสอบสภาพงาน ➔ 2. มอบหมายช่างมือหนึ่ง (ช่างวิชัย RPS-T03) เข้าเสียบแทน ➔ 3. ส่งแจ้งลูกค้าผ่านแอป',
      quickActionLabel: 'มอบหมายช่างวิชัย (มือหนึ่ง) แทนทันที และส่งแจ้งลูกค้า',
      recommendedTechId: 'RPS-T03',
      recommendedTechName: 'ช่างวิชัย นามวงศ์ (ช่างวิทย์)',
      customerTemplate: 'รักบ้านขออภัยในความไม่สะดวกค่ะ ได้ประสานงานส่งช่างวิชัย (ผู้เชี่ยวชาญระบบท่ออาวุโส) พร้อมเครื่องมือพิเศษเข้าแก้ไขแทนทันทีใน 30 นาทีค่ะ',
      techResolution: 'โอนย้ายงานให้ช่างวิชัย (RPS-T03) เข้าดำเนินการแทนเรียบร้อย ไม่หักเครดิตช่างเดิมเนื่องจากรายงานตามจริง'
    }
  },
  {
    id: 'NM-02-MIA',
    title: 'ตรวจเช็คแก้ไขระบบไฟดับทั้งบ้าน / เบรกเกอร์ทริป',
    category: 'electrical',
    price: 650,
    status: 'in_progress',
    scheduledDate: new Date().toISOString(),
    customerId: 'customer_kitti',
    addressId: null,
    addressText: '112/4 ต.ช้างเผือก อ.เมือง จ.เชียงใหม่',
    assignedTeamId: 'RPS-T07',
    assignedTechName: 'ช่างกิตติศักดิ์ เมืองแก้ว (ช่างศักดิ์)',
    adminIssue: {
      issueType: 'ช่างมีธุระด่วน เดี๋ยวกลับมาแล้วไม่แจ้ง (ขาดการติดต่อ 2 ชม.)',
      notes: 'ลูกค้าแจ้งว่าช่างขอตัวออกไปข้างนอกตั้งแต่ 13:00 น. ตอนนี้ 15:00 น. ยังไม่กลับมา โทรหาช่างไม่รับสาย ลูกค้ารอเก้อ',
      status: 'pending_admin',
      reportedAt: new Date(Date.now() - 8 * 60000).toISOString(),
      techId: 'RPS-T07',
      techName: 'ช่างกิตติศักดิ์ (ช่างศักดิ์)',
      sopGuide: '1. ส่งสัญญาณตรวจพิกัด ➔ 2. ตั้งเวลาเตือน 15 นาที ➔ 3. หากไม่ตอบ ส่งช่างสำรองแทนทันที',
      quickActionLabel: 'ส่งสัญญาณเตือนช่าง และแจ้งเวลากับลูกค้า',
      customerTemplate: 'รักบ้านกำลังส่งสัญญาณตรวจสอบพิกัดช่างด่วนค่ะ หากช่างไม่ติดต่อกลับภายใน 15 นาที จะจัดส่งช่างสำรองเข้าดำเนินการแทนทันทีค่ะ',
      techResolution: 'ระบบส่งสัญญาณเตือนช่าง หากไม่กลับเข้าหน้างานภายใน 15 นาทีจะถูกปรับตัดสิทธิ์และส่งช่างสำรอง'
    }
  },
  {
    id: 'NM-03-LOWPRICE',
    title: 'เปลี่ยนลูกบิดประตูห้องนอน / ปรับเดือยล็อค',
    category: 'door_window',
    price: 250,
    status: 'pending_review',
    scheduledDate: new Date().toISOString(),
    customerId: 'customer_malee',
    addressId: null,
    addressText: '201 หมู่บ้านกรีนวัลเลย์ ต.แม่ริม จ.เชียงใหม่',
    assignedTeamId: null,
    assignedTechName: null,
    adminIssue: {
      issueType: 'งานราคาถูก / งานโปรโมชั่น ไม่มีช่างรับ (ค้างเกิน 45 นาที)',
      notes: 'งานราคา 250 บาท ช่างในพื้นที่มองว่าไม่คุ้มค่าน้ำมัน ไม่มีช่างกดรับงานในรัศมี 5 กม.',
      status: 'pending_admin',
      reportedAt: new Date(Date.now() - 6 * 60000).toISOString(),
      techId: null,
      techName: 'ยังไม่มีช่างรับงาน',
      sopGuide: '1. เปิดประกันค่าน้ำมันขั้นต่ำ (+100 บาท) ➔ 2. ผูกงานกับงานแอร์ละแวกเดียวกัน ➔ 3. มอบหมายช่างเอก',
      quickActionLabel: 'เปิดประกันค่าเดินทาง (+100 บาท) และมอบหมายช่างเอก',
      recommendedTechId: 'RPS-T04',
      recommendedTechName: 'ช่างเอกชัย บุญเรือง (ช่างเอก)',
      customerTemplate: 'ระบบยืนยันคิวงานเรียบร้อยแล้วค่ะ ช่างเอกชัยจะเข้าให้บริการตามเวลานัดหมายค่ะ',
      techResolution: 'เพิ่มค่าเดินทางพิเศษ +100 บาท พร้อมจับคู่ผูกงานในพื้นที่แม่ริมให้ช่างเอก'
    }
  },
  {
    id: 'NM-04-OVERREACT',
    title: 'ล้างแอร์ทั่วไป (ติดผนัง) 24,000 BTU (ห้องรับแขก)',
    category: 'air_con',
    price: 650,
    status: 'in_progress',
    workflowStatus: 'customer_review',
    scheduledDate: new Date().toISOString(),
    customerId: 'customer_sasithorn',
    addressId: null,
    addressText: '88/12 ซอย 2 ต.สุเทพ อ.เมือง จ.เชียงใหม่',
    assignedTeamId: 'RPS-T01',
    assignedTechName: 'ช่างสมหมาย ใจซื่อ (ช่างหมาย)',
    adminIssue: {
      issueType: 'งานเรียบร้อยแต่ลูกค้าจอมโวยวาย (มีละอองฝุ่นนิดหน่อย)',
      notes: 'แอร์ล้างสะอาด วัดอุณหภูมิได้ 20.5°C มีรูปก่อนและหลังทำครบ แต่มีละอองฝุ่นตกบนพรม 2 จุด ลูกค้าโวยวายขู่จะฟ้องร้อง',
      status: 'pending_admin',
      reportedAt: new Date(Date.now() - 4 * 60000).toISOString(),
      techId: 'RPS-T01',
      techName: 'ช่างสมหมาย (ช่างหมาย)',
      sopGuide: '1. ตรวจรูปถ่ายก่อนและหลังทำ ➔ 2. ส่งภาพยืนยันอย่างสุภาพ ➔ 3. มอบบริการทีมทำความสะอาดเสริม (ไม่ตัดแต้มช่าง)',
      quickActionLabel: 'ส่งภาพถ่ายยืนยัน และมอบบริการทำความสะอาด',
      customerTemplate: 'รักบ้านตรวจสอบภาพผลงานแอร์ทำงานสมบูรณ์แล้วค่ะ เพื่อความสบายใจสูงสุดของท่าน ทางเราขอมอบบริการทีมทำความสะอาดเก็บกวาดจุดฝุ่นฟรีทันทีค่ะ',
      techResolution: 'ตรวจสอบผลงานผ่านเกณฑ์มาตรฐาน 100% ปกป้องช่าง ไม่มีการตัดคะแนน ช่างปิดงานได้ตามปกติ'
    }
  },
  {
    id: 'NM-05-DISPUTE',
    title: 'ซ่อมประตูม้วนโรงรถ / มอเตอร์ติดขัด',
    category: 'door_window',
    price: 850,
    status: 'in_progress',
    workflowStatus: 'customer_review',
    scheduledDate: new Date().toISOString(),
    customerId: 'customer_charnchai',
    addressId: null,
    addressText: '55/9 ต.แม่เหียะ อ.เมือง จ.เชียงใหม่',
    assignedTeamId: 'RPS-T04',
    assignedTechName: 'ช่างเอกชัย บุญเรือง (ช่างเอก)',
    adminIssue: {
      issueType: 'ลูกค้าเจตนาชักดาบขอเงินคืนทุกกรณี (งานเสร็จแต่หาเรื่องปฏิเสธ)',
      notes: 'ซ่อมประตูเปิดปิดได้ปกติ มีคลิปทดสอบครบถ้วน แต่ลูกค้าอ้างว่าเสียงยังดังไม่ถูกใจ จะกดยกเลิกขอเงินคืน 100% ในระบบชำระเงิน',
      status: 'pending_admin',
      reportedAt: new Date(Date.now() - 2 * 60000).toISOString(),
      techId: 'RPS-T04',
      techName: 'ช่างเอกชัย (ช่างเอก)',
      sopGuide: '1. ตรวจสอบคลิปหลักฐานการทำงาน ➔ 2. ยืนยันผลงานสมบูรณ์ ➔ 3. ปลดล็อกเงินให้ช่าง (เงินถูกพักไว้ในระบบ)',
      quickActionLabel: 'ยืนยันผลงานสมบูรณ์ ปลดล็อกโอนเงินให้ช่าง',
      customerTemplate: 'จากการตรวจสอบคลิปทดสอบการทำงาน ประตูม้วนทำงานได้ตามมาตรฐานแล้วค่ะ ระบบขอสงวนสิทธิ์การคืนเงินเต็มจำนวน แต่รับประกันงานซ่อม 90 วันค่ะ',
      techResolution: 'ผลงานผ่านการพิจารณาจากฝ่ายไกล่เกลี่ย ปลดล็อกยอดเงิน 850 บาทเข้าบัญชีช่างเรียบร้อยแล้ว'
    }
  }
];

function renderJobsView(container) {
  container.innerHTML = `
    <div class="catalog-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
      <div>
        <h2 class="catalog-title" style="display: flex; align-items: center; gap: 8px;">
          <span>การบริหารรักบ้าน</span>
          <span style="font-size: 14.5px; font-weight: 600; color: var(--gray-600);">— ศูนย์บริหารจัดการงานซ่อม (ฝ่ายปฏิบัติการส่วนกลาง)</span>
        </h2>
        <p class="catalog-subtitle" style="font-size: 13px; color: var(--gray-600); margin-top: 2px;">
          ศูนย์สั่งการและประสานงานซ่อมผ่านระบบแอป 100% ไร้เสียงโทรศัพท์ · ช่างติดปัญหาหน้างานแอดมินเคลียร์ทันที
        </p>
      </div>
      <div>
        <button id="btn-toggle-sim-issues" style="background: ${window._simIssuesActive ? '#ea580c' : '#fff7ed'}; color: ${window._simIssuesActive ? '#ffffff' : '#c2410c'}; border: 1.5px solid #ea580c; border-radius: 8px; padding: 7px 14px; font-weight: 700; font-size: 12.5px; cursor: pointer; transition: all 0.15s;">
          ${window._simIssuesActive ? 'ปิดโหมดจำลอง (กลับข้อมูลจริง)' : 'จำลอง 5 เคสปัญหาหน้างาน'}
        </button>
      </div>
    </div>
    
    <!-- แถบ 5 ลำดับการทำงาน (Workflow Tabs 1-5) -->
    <div class="nav-tabs" style="margin-bottom: 16px; display: flex; gap: 8px; overflow-x: auto; padding: 4px;">
      <button class="nav-tab ${currentJobTab === 'urgent' ? 'active' : ''}" data-tab="urgent" style="${currentJobTab === 'urgent' ? 'background: #ea580c; color: #fff;' : 'color: #c2410c; background: #fff7ed; border-color: #fdba74;'} font-weight: 700;">
        1. ปัญหาด่วน <span id="tab-count-urgent" class="badge" style="background: #dc2626; color: #fff; font-size: 11px; margin-left: 4px;">0</span>
      </button>
      <button class="nav-tab ${currentJobTab === 'active' ? 'active' : ''}" data-tab="active" style="font-weight: 700;">
        2. กำลังดำเนินการ <span id="tab-count-active" class="badge" style="background: #10b981; color: #fff; font-size: 11px; margin-left: 4px;">0</span>
      </button>
      <button class="nav-tab ${currentJobTab === 'pending' ? 'active' : ''}" data-tab="pending" style="font-weight: 700;">
        3. รอมอบหมาย <span id="tab-count-pending" class="badge" style="background: #f59e0b; color: #fff; font-size: 11px; margin-left: 4px;">0</span>
      </button>
      <button class="nav-tab ${currentJobTab === 'delivering' ? 'active' : ''}" data-tab="delivering" style="font-weight: 700;">
        4. กำลังส่งมอบ <span id="tab-count-delivering" class="badge" style="background: #0284c7; color: #fff; font-size: 11px; margin-left: 4px;">0</span>
      </button>
      <button class="nav-tab ${currentJobTab === 'history' ? 'active' : ''}" data-tab="history" style="font-weight: 700; margin-left: auto;">
        5. ประวัติ <span id="tab-count-history" class="badge" style="background: var(--gray-600); color: #fff; font-size: 11px; margin-left: 4px;">0</span>
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
      กำลังโหลดข้อมูลงานซ่อม...
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

  // ค้นหางานที่ติดปัญหาทั้งหมด (Priority 1: Urgent Issues)
  const allPendingIssues = allCombined.filter(j => j.adminIssue && j.adminIssue.status === 'pending_admin');
  allPendingIssues.sort((a, b) => new Date(a.adminIssue.reportedAt || a.createdAt || 0) - new Date(b.adminIssue.reportedAt || b.createdAt || 0));

  // นิยามเงื่อนไขงานแต่ละกลุ่ม
  const isDeliveringJob = (j) => j.status !== 'completed' && (['tech_submitted', 'customer_review', 'rework_needed'].includes(j.workflowStatus) || j.status === 'under_review');
  const isActiveJob = (j) => j.status !== 'completed' && ['assigned', 'traveling', 'in_progress'].includes(j.status) && !isDeliveringJob(j);

  // นับจำนวนงานในแต่ละหมวด 5 แท็บ
  const urgentCount = allPendingIssues.length;
  const activeCount = allCombined.filter(isActiveJob).length;
  const pendingCount = allCombined.filter(j => j.status !== 'completed' && (j.status === 'pending_review' || j.status === 'requested')).length;
  const deliveringCount = allCombined.filter(isDeliveringJob).length;
  const historyCount = allCombined.filter(j => j.status === 'completed').length;

  // อัปเดตตัวเลขบนแท็บ 1-5
  const elUrgent = document.getElementById('tab-count-urgent');
  if (elUrgent) elUrgent.textContent = urgentCount;
  const elActive = document.getElementById('tab-count-active');
  if (elActive) elActive.textContent = activeCount;
  const elPending = document.getElementById('tab-count-pending');
  if (elPending) elPending.textContent = pendingCount;
  const elDelivering = document.getElementById('tab-count-delivering');
  if (elDelivering) elDelivering.textContent = deliveringCount;
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

  // ตัวกรองตารางตามแท็บที่เลือก (5 แท็บ)
  let filtered = allCombined.filter(j => {
    if (currentJobTab === 'urgent') {
      return j.adminIssue && j.adminIssue.status === 'pending_admin';
    } else if (currentJobTab === 'active') {
      return isActiveJob(j);
    } else if (currentJobTab === 'pending') {
      if (j.status === 'completed') return false;
      return j.status === 'pending_review' || j.status === 'requested';
    } else if (currentJobTab === 'delivering') {
      return isDeliveringJob(j);
    } else if (currentJobTab === 'history') {
      return j.status === 'completed';
    } else {
      return j.adminIssue && j.adminIssue.status === 'pending_admin';
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

  // แผงควบคุมปัญหาด่วนบนสุดเสมอ
  let deckHtml = '';
  if (allPendingIssues.length > 0) {
    deckHtml = `
      <div class="metro-incident-deck" style="background: #fff7ed; border: 2.5px solid #ea580c; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px; box-shadow: 0 4px 16px rgba(234, 88, 12, 0.15);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1.5px solid #fed7aa; padding-bottom: 10px;">
          <div>
            <div style="font-size: 16px; font-weight: 800; color: #9a3412;">
              สัญญาณแจ้งเตือนฉุกเฉิน: ช่างติดปัญหาหน้างาน ${allPendingIssues.length} รายการ (ช่างกำลังรอคำตอบ — แอดมินต้องเคลียร์ด่วน)
            </div>
            <div style="font-size: 12.5px; color: #c2410c; margin-top: 2px;">
              จัดลำดับตามเวลารอนานที่สุด · ช่างไม่รองาน สื่อสารกับลูกค้าและปลดล็อกช่างผ่านแอป 100%
            </div>
          </div>
          <span class="badge" style="background: #dc2626; color: #fff; font-size: 13px; font-weight: 800; padding: 4px 12px; border-radius: 20px;">
            ค้างรอ ${allPendingIssues.length} รายการ
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
                    <span style="font-family: monospace; font-weight: 800; color: var(--navy); font-size: 12px;">รหัสงาน ${j.id.slice(0, 10).toUpperCase()}</span>
                    <span class="badge" style="background: ${isLongest ? '#fee2e2' : '#ffedd5'}; color: ${isLongest ? '#991b1b' : '#c2410c'}; font-size: 11px; font-weight: 800; border: 1px solid ${isLongest ? '#fca5a5' : '#fdba74'};">
                      รอนาน ${waitMins} นาที ${isLongest ? '(รอนานสุด)' : ''}
                    </span>
                  </div>
                  <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 4px;">
                    ทีมช่าง: ${escapeHtml(j.adminIssue.techName || j.assignedTechName || 'ช่างผู้รับผิดชอบ')}
                  </div>
                  <div style="font-size: 12px; color: #475569; margin-bottom: 6px;">
                    ลูกค้า: ${escapeHtml(j.customerId || 'ลูกค้า')} · ${escapeHtml(j.title || 'งานบริการ')}
                  </div>
                  <div style="background: #fff7ed; border-left: 3px solid #ea580c; padding: 6px 8px; border-radius: 4px; font-size: 12px; color: #9a3412; margin-bottom: 8px;">
                    <strong>เรื่อง:</strong> ${escapeHtml(j.adminIssue.issueType)}
                    ${j.adminIssue.notes ? `<div style="font-style: italic; margin-top: 2px;">"${escapeHtml(j.adminIssue.notes)}"</div>` : ''}
                  </div>
                </div>
                <button class="btn-sm btn-quick-issue-open" data-id="${j.id}" style="background: ${isLongest ? '#dc2626' : '#ea580c'}; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; font-weight: 700; cursor: pointer; width: 100%; font-size: 12.5px; transition: all 0.15s;">
                  จัดการเคลียร์ปัญหานี้
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
          <span style="font-size: 13.5px; font-weight: 700; color: #166534;">
            สัญญาณปฏิบัติงานปกติ: ทุกงานดำเนินไปตามกำหนดเวลา ไม่มีงานติดปัญหาหน้างาน (0 รายการ)
          </span>
        </div>
        <span style="font-size: 12px; color: #15803d; font-weight: 600;">
          ระบบบริหารจัดการงานซ่อมพร้อมปฏิบัติการ 100%
        </span>
      </div>
    `;
  }

  // ตารางรายการงานซ่อม (Jobs Table)
  let tableHtml = `
    <table class="catalog-table">
      <thead>
        <tr>
          <th style="width: 105px;">รหัสงาน</th>
          <th style="width: 125px;">เวลานัดหมาย</th>
          <th style="min-width: 290px;">รายการงาน</th>
          <th style="width: 170px; text-align: center;">สถานะงาน</th>
          <th style="width: 130px;">ลูกค้า</th>
          <th style="width: 160px;">ที่อยู่หน้างาน</th>
          <th style="width: 150px;">ทีมช่าง</th>
          <th style="width: 110px; text-align: right;">ค่าบริการ</th>
          <th style="width: 95px; text-align: center;">สั่งการ</th>
        </tr>
      </thead>
      <tbody>
  `;

  if (filtered.length === 0) {
    tableHtml += `<tr><td colspan="9" class="meta" style="text-align: center; padding: 32px 16px;">ไม่พบรายการงานในหมวดนี้</td></tr>`;
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
        : (j.assignedTechName ? (techId ? `[${techId}] ` : '') + j.assignedTechName : (techId || 'รอจัดช่าง'));

      // สัญลักษณ์ประกอบขั้นตอนการทำงาน (Workflow steps)
      let stationBadge = `<span class="badge ${step.badge}" style="font-size: 11px;">${step.label}</span>`;
      if (j.workflowStatus === 'rework_needed') {
        stationBadge = `<span class="badge" style="background: #fee2e2; color: #991b1b; font-size: 11px; border: 1px solid #fca5a5;">วนกลับขั้นตอนที่ 6 (สั่งแก้)</span>`;
      } else if (j.workflowStatus === 'tech_submitted') {
        stationBadge = `<span class="badge" style="background: #fef3c7; color: #b45309; font-size: 11px; border: 1px solid #fde68a;">ขั้นตอนที่ 9 (รอตรวจงาน)</span>`;
      } else if (j.workflowStatus === 'customer_review') {
        stationBadge = `<span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 11px; border: 1px solid #bae6fd;">ขั้นตอนที่ 10 (ลูกค้าตรวจรับ)</span>`;
      } else if (j.status === 'completed') {
        stationBadge = `<span class="badge" style="background: #dcfce7; color: #166534; font-size: 11px; border: 1px solid #86efac;">ประวัติงาน (มีประกัน)</span>`;
      }

      const hasPendingIssue = j.adminIssue && j.adminIssue.status === 'pending_admin';
      if (hasPendingIssue) {
        stationBadge = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span class="badge" style="background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; font-size: 11px; font-weight: 700;">
              ติดปัญหาด่วน
            </span>
            <span style="font-size: 10.5px; color: #c2410c; font-weight: 700;">ช่างรอคำตอบ</span>
          </div>
        `;
      } else if (j.adminIssue && j.adminIssue.status === 'resolved') {
        stationBadge += `<div style="margin-top: 3px;"><span class="badge" style="background: #f0fdf4; color: #166534; border: 1px solid #86efac; font-size: 10px; font-weight: 700;">จัดการปัญหาเรียบร้อย</span></div>`;
      }

      tableHtml += `
        <tr class="service-row" id="job-row-${j.id}" style="${hasPendingIssue ? 'background: #fff7ed; border-left: 4px solid #ea580c;' : ''}">
          <td style="font-family: monospace; font-weight: 700; color: var(--navy); font-size: 12px;">${j.id.slice(0, 10).toUpperCase()}</td>
          <td style="font-size: 12px; color: var(--gray-700);">${dateStr}</td>
          <td style="min-width: 290px; padding: 14px 16px;">
            <div style="font-size: 14.5px; font-weight: 600; color: #0f172a; line-height: 1.4; margin-bottom: 4px;">${category.name}</div>
            <div style="font-size: 13px; color: #475569; line-height: 1.45;">${escapeHtml(j.title || '-')}</div>
          </td>
          <td style="text-align: center;">${stationBadge}</td>
          <td style="font-size: 12.5px; font-weight: 600; color: #1e293b;">${escapeHtml(j.customerId?.slice(0, 15) || '-')}</td>
          <td style="font-size: 12px; color: var(--gray-600); max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(address)}">${escapeHtml(address)}</td>
          <td style="font-size: 12.5px; font-weight: 600; color: ${j.assignedTeamId ? 'var(--mint-600)' : 'var(--amber)'};">${escapeHtml(techDisplay)}</td>
          <td style="font-weight: 700; color: var(--navy); text-align: right; font-size: 13px;">฿${(j.price || 0).toLocaleString()}</td>
          <td style="text-align: center;">
            <button class="secondary btn-sm btn-job-detail" data-id="${j.id}" style="font-size: 12px; padding: 5px 12px; font-weight: 600; white-space: nowrap; border-radius: 6px;">
              เปิดดูงาน
            </button>
          </td>
        </tr>
      `;
    }
  }
  
  tableHtml += `</tbody></table>`;
  container.innerHTML = deckHtml + tableHtml;

  // ผูกตัวดักฟังปุ่มดูรายละเอียดงาน
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

  // ข้อมูลสำหรับขั้นตอนงานซ่อม 10 ขั้นตอน (10-Step Workflow Journey)
  const techId = job.assignedTeamId || job.assignedTechId || job.techId;
  let assignedTech = techId ? getTechnicianById(techId) : null;
  const techDisplayName = assignedTech
    ? `[${assignedTech.id}] ${assignedTech.name}`
    : (job.assignedTechName || 'ช่างผู้รับผิดชอบ');

  const customerDisplayName = job.customerName || (job.customerId ? `ลูกค้า (${job.customerId.slice(0, 10)})` : 'คุณวิภา สุขเจริญ');
  const qcInspectorDisplayName = job.qcInspectorName || (job.qcInspector ? String(job.qcInspector) : 'คุณวิชัย ตรวจการ (QC-01)');

  // มาตรวัดเวลา 6 เสาหลัก (Time Metrics)
  const tm = job.timeMetrics || {
    responseMins: job.responseMinutes || 2,
    dispatchMins: job.dispatchMinutes || 3,
    travelMins: job.travelMinutes || 22,
    procurementMins: job.procurementMinutes || 15,
    executionMins: job.executionMinutes || 40,
    qcMins: job.qcMinutes || 8,
    totalElapsedMins: job.totalElapsedMinutes || (currentStepNum >= 10 ? 90 : (currentStepNum >= 9 ? 82 : (currentStepNum >= 8 ? 74 : (currentStepNum >= 5 ? 27 : 5)))),
    slaTargetMins: job.slaTargetMinutes || 120,
  };

  const slaRemaining = tm.slaTargetMins - tm.totalElapsedMins;
  const slaStatusText = slaRemaining >= 0 
    ? `ตรงเวลา (เร็วกว่าเป้าหมาย ${slaRemaining} นาที)` 
    : `ล่าช้ากว่าเป้าหมาย ${Math.abs(slaRemaining)} นาที`;

  const workflowSteps = [
    {
      num: 1,
      title: 'ลูกค้าจ้าง',
      person: `👤 ${customerDisplayName}`,
      cargo: `คำขอแจ้งซ่อม (฿${(job.price || 600).toLocaleString()})`,
      dwell: '0 นาที',
      status: currentStepNum >= 1 ? (currentStepNum === 1 ? 'active' : 'done') : 'upcoming',
    },
    {
      num: 2,
      title: 'เราเห็น',
      person: '🏛️ แอดมิน OCC (คุณรินรดา AD-02)',
      cargo: 'รับเรื่อง & ตรวจสอบพิกัด GPS',
      dwell: `${tm.responseMins} นาที`,
      status: currentStepNum >= 2 ? (currentStepNum === 2 ? 'active' : 'done') : 'upcoming',
    },
    {
      num: 3,
      title: 'ส่งช่างรับ',
      person: `🏛️ แอดมิน ➔ ${techDisplayName}`,
      cargo: 'ใบมอบหมายงานช่างตรงสาย',
      dwell: `${tm.dispatchMins} นาที`,
      status: currentStepNum >= 3 ? (currentStepNum === 3 ? 'active' : 'done') : 'upcoming',
    },
    {
      num: 4,
      title: 'พักเงิน PPT',
      person: '💰 บัญชี Escrow ปลอดภัย',
      cargo: `พักเงินค่าบริการ ฿${(job.price || 600).toLocaleString()}`,
      dwell: '0 นาที (ระบบอัตโนมัติ)',
      status: currentStepNum >= 4 ? (currentStepNum === 4 ? 'active' : 'done') : 'upcoming',
    },
    {
      num: 5,
      title: 'ช่างรับงาน & เดินทาง',
      person: `🔧 ${techDisplayName}`,
      cargo: 'เครื่องมือช่าง & เช็คอินพิกัด',
      dwell: `${tm.travelMins} นาที`,
      status: currentStepNum >= 5 ? (currentStepNum === 5 ? 'active' : 'done') : 'upcoming',
    },
    {
      num: 6,
      title: 'เราประสานงาน',
      person: `🏛️🔧 แอดมิน & ${techDisplayName}`,
      cargo: 'ตรวจหน้างาน & จัดหาอะไหล่แท้',
      dwell: `${tm.procurementMins} นาที`,
      status: currentStepNum >= 6 ? (currentStepNum === 6 ? 'active' : 'done') : 'upcoming',
    },
    {
      num: 7,
      title: 'เราสั่งเริ่มงาน',
      person: '🏛️ แอดมิน OCC ปล่อยไฟเขียว',
      cargo: 'คำสั่งอนุมัติเริ่มซ่อม',
      dwell: '1 นาที',
      status: currentStepNum >= 7 ? (currentStepNum === 7 ? 'active' : 'done') : 'upcoming',
    },
    {
      num: 8,
      title: 'ช่างส่งงาน',
      person: `🔧 ${techDisplayName}`,
      cargo: `รูปคู่ ก่อนทำ-หลังทำ (${job.afterPhotos?.length || 2} รูป)`,
      dwell: `${tm.executionMins} นาที`,
      status: currentStepNum >= 8 ? (currentStepNum === 8 ? 'active' : 'done') : 'upcoming',
    },
    {
      num: 9,
      title: 'เราตรวจ QC',
      person: `🔍 ${qcInspectorDisplayName}`,
      cargo: 'ตรวจรูปคู่ & ประเมิน Senior-First',
      dwell: `${tm.qcMins} นาที`,
      status: currentStepNum >= 9 ? (currentStepNum === 9 ? 'active' : 'done') : 'upcoming',
    },
    {
      num: 10,
      title: 'ถึงปลายทาง (รับงาน)',
      person: `👤 ${customerDisplayName}`,
      cargo: `ออกใบรับประกัน ${job.warranty?.days || defaultWarrantyDays} วัน`,
      dwell: `รวม ${tm.totalElapsedMins} นาที`,
      status: currentStepNum >= 10 ? 'done' : 'upcoming',
    },
  ];

  modalContainer.innerHTML = `
    <div class="modal-backdrop" id="job-modal-backdrop" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;">
      <div class="modal-dialog card" style="width: 860px; max-width: 95%; max-height: 92vh; overflow-y: auto; padding: 24px; position: relative;">
        <button class="modal-close-btn" id="job-modal-close" style="position: absolute; right: 16px; top: 16px; background: none; border: none; font-size: 20px; cursor: pointer; color: var(--gray-600);">✕</button>
        
        <!-- Header -->
        <div style="margin-bottom: 16px; border-bottom: 1px solid var(--gray-200); padding-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 13px; color: var(--navy); font-weight: 700; font-family: monospace;">รหัสงาน: ${job.id}</span>
            <div style="display: flex; gap: 6px; align-items: center;">
              <span class="badge ${step.badge}" style="font-size: 12px;">สถานะงาน: ${step.label}</span>
              ${isRework ? '<span class="badge" style="background: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 700;">วนกลับขั้นตอนที่ 6 (สั่งแก้ไข)</span>' : ''}
              ${isSubmittedForReview ? '<span class="badge" style="background: #fef3c7; color: #b45309; font-size: 12px; font-weight: 700;">ขั้นตอนที่ 9: รอตรวจงาน</span>' : ''}
              ${isCustomerReview ? '<span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 12px; font-weight: 700;">ขั้นตอนที่ 10: ลูกค้าตรวจรับ</span>' : ''}
              ${isCompleted ? '<span class="badge" style="background: #dcfce7; color: #166534; font-size: 12px; font-weight: 700;">ประวัติงาน (มีประกัน)</span>' : ''}
            </div>
          </div>
          <h2 style="margin: 0; color: var(--navy); display: flex; align-items: center; gap: 8px;">
            ${category.name}
            <span style="font-size: 14px; font-weight: normal; color: var(--gray-600);">— รายละเอียดงานซ่อมและศูนย์สั่งการ</span>
          </h2>
        </div>

        <!-- ประวัติขั้นตอนงานซ่อม 10 ขั้นตอน & มาตรวัดเวลา MVP -->
        <div class="journey-deck">
          <div class="journey-motto-bar">
            <div class="journey-motto-title">
              <span>ประวัติขั้นตอนงานซ่อม 10 ขั้นตอน</span>
              <span class="journey-motto-badge">ปรัชญาการบริการ: เวลาคือสิ่งล้ำค่ามากกว่าเงิน</span>
            </div>
            <div class="journey-time-summary">
              <span>เวลารวมตั้งแต่เริ่มต้น:</span>
              <span class="journey-time-value">${tm.totalElapsedMins} นาที</span>
              <span style="font-size: 11.5px; opacity: 0.9;">(${slaStatusText})</span>
            </div>
          </div>

          <!-- Time Metrics 6 Pills -->
          <div class="journey-metrics-pills">
            <div class="journey-metric-pill">
              <span class="journey-metric-label">⚡ เวลาตอบรับ</span>
              <span class="journey-metric-num">${tm.responseMins} นาที</span>
            </div>
            <div class="journey-metric-pill">
              <span class="journey-metric-label">📲 ช่างกดรับ</span>
              <span class="journey-metric-num">${tm.dispatchMins} นาที</span>
            </div>
            <div class="journey-metric-pill">
              <span class="journey-metric-label">🚗 เวลาเดินทาง</span>
              <span class="journey-metric-num">${tm.travelMins} นาที</span>
            </div>
            <div class="journey-metric-pill">
              <span class="journey-metric-label">📦 จัดหาอะไหล่</span>
              <span class="journey-metric-num">${tm.procurementMins} นาที</span>
            </div>
            <div class="journey-metric-pill">
              <span class="journey-metric-label">🛠️ ลงมือซ่อม</span>
              <span class="journey-metric-num">${tm.executionMins} นาที</span>
            </div>
            <div class="journey-metric-pill">
              <span class="journey-metric-label">🔍 ตรวจมาตรฐาน (${job.qcInspectorId || 'QC-01'})</span>
              <span class="journey-metric-num">${tm.qcMins} นาที</span>
            </div>
          </div>

          <!-- 10 Steps List -->
          <div class="journey-steps-list">
            ${workflowSteps.map(st => `
              <div class="journey-step-row ${st.status}">
                <div class="station-identity">
                  <span class="station-num">ขั้นตอนที่ ${st.num}</span>
                  <span class="station-title">${st.title}</span>
                </div>
                <div class="station-person">
                  <span>${escapeHtml(st.person)}</span>
                </div>
                <div class="station-cargo">
                  <span>${escapeHtml(st.cargo)}</span>
                </div>
                <div class="station-time">
                  <span>⏱️ ${st.dwell}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Accountability Banner -->
        ${(isRework || job.accountability) ? `
          <div class="accountability-banner">
            <div class="accountability-title">บันทึกความรับผิดชอบร่วม</div>
            <div class="accountability-desc">
              ลูกค้าไม่รับงานและขอให้แก้ไขตามเหตุผล: <em>"${escapeHtml(job.accountability?.rejectionReason || 'พบจุดบกพร่องที่ต้องแก้ไขเพิ่มเติมหน้างาน')}"</em><br>
              <strong>บันทึกความรับผิดชอบร่วม:</strong> ผู้ตรวจในขั้นตอนที่ 9 (<code>${escapeHtml(job.accountability?.penalizedInspector || 'ทีมตรวจ')}</code>) และช่างผู้ปฏิบัติงาน (<code>${escapeHtml(job.assignedTeamId || '-')}</code>)<br>
              <strong>ระบบวนกลับมาที่:</strong> <strong>ขั้นตอนที่ 6 (เราประสานงาน)</strong> เพื่อตรวจสอบอะไหล่และนัดหมายแก้ไขให้ลูกค้าโดยด่วน
            </div>
          </div>
        ` : ''}

        <!-- Digital Warranty Banner (ถ้าจบงานแล้ว) -->
        ${isCompleted ? `
          <div class="warranty-card">
            <div class="warranty-header">
              <span class="warranty-title">ความคุ้มครองการรับประกันเปิดใช้งานแล้ว</span>
              <span class="badge" style="background: #10b981; color: #fff; font-size: 11px;">มีผลคุ้มครอง</span>
            </div>
            <div style="font-size: 13px; color: #065f46; line-height: 1.6;">
              <div>• <strong>ระยะเวลารับประกัน:</strong> ${job.warranty?.days || defaultWarrantyDays} วัน (ครอบคลุมงานฝีมือและชิ้นส่วนที่เปลี่ยน)</div>
              <div>• <strong>วันเริ่มต้น - สิ้นสุด:</strong> ${job.warranty?.startDate ? new Date(job.warranty.startDate).toLocaleDateString('th-TH') : '-'} ถึง <strong>${job.warranty?.endDate ? new Date(job.warranty.endDate).toLocaleDateString('th-TH') : '-'}</strong></div>
              <div>• <strong>สถานะการเงิน:</strong> ปลดล็อกยอดโอนเงินให้ช่างสมบูรณ์</div>
            </div>
          </div>
        ` : ''}

        <!-- ศูนย์ประสานงานปัญหาหน้างาน -->
        ${job.adminIssue ? `
          <div style="background: #fff7ed; border: 2px solid ${job.adminIssue.status === 'pending_admin' ? '#ea580c' : '#16a34a'}; border-radius: var(--radius-sm); padding: 16px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h4 style="margin: 0; color: #9a3412; font-size: 14px; font-weight: 700;">
                ศูนย์แก้ปัญหาฉุกเฉิน (สื่อสารผ่านแอป 100% ห้ามโทรศัพท์)
              </h4>
              <span class="badge" style="background: ${job.adminIssue.status === 'pending_admin' ? '#fee2e2' : '#dcfce7'}; color: ${job.adminIssue.status === 'pending_admin' ? '#991b1b' : '#15803d'}; font-size: 11px; font-weight: 800; border: 1px solid ${job.adminIssue.status === 'pending_admin' ? '#fca5a5' : '#86efac'};">
                ${job.adminIssue.status === 'pending_admin' ? 'ช่างรอคำตอบ' : (job.adminIssue.status === 'resolved' ? 'จัดการปัญหาเรียบร้อย' : 'ช่างรับทราบผลแล้ว')}
              </span>
            </div>

            <!-- แถบนำทางด่วน & ตัวช่วยแอดมิน -->
            ${job.adminIssue.sopGuide ? `
              <div style="background: #ffffff; border: 1.5px solid #fed7aa; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px;">
                <div style="font-size: 13px; font-weight: 700; color: #9a3412; margin-bottom: 4px;">
                  ขั้นตอนนำทาง: ${escapeHtml(job.adminIssue.sopGuide)}
                </div>
                ${job.adminIssue.quickActionLabel ? `
                  <div style="margin-top: 6px;">
                    <button type="button" id="btn-sop-quick-action" style="background: #ea580c; color: #ffffff; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer;">
                      ${escapeHtml(job.adminIssue.quickActionLabel)}
                    </button>
                  </div>
                ` : ''}
              </div>
            ` : ''}

            <!-- กล่องที่ 1: รายละเอียดปัญหาที่ช่างแจ้งเข้ามา -->
            <div style="background: #ffffff; border: 1px solid #fed7aa; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px;">
              <div style="font-weight: 700; color: #c2410c; margin-bottom: 2px;">
                ช่างผู้แจ้ง: ${escapeHtml(job.adminIssue.techName || job.assignedTechName || '-')} [${escapeHtml(job.adminIssue.techId || job.assignedTeamId || '')}]
              </div>
              <div style="color: #431407;">
                <strong>เรื่อง:</strong> ${escapeHtml(job.adminIssue.issueType)} ${job.adminIssue.notes ? `— <em>"${escapeHtml(job.adminIssue.notes)}"</em>` : ''}
              </div>
              <div style="font-size: 11px; color: #9a3412; margin-top: 4px;">
                เวลาที่แจ้ง: ${new Date(job.adminIssue.reportedAt).toLocaleDateString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
              </div>
            </div>

            <!-- กล่องที่ 2: ช่องทางแอดมินสื่อสารกับลูกค้าผ่านแอป -->
            <div style="background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="font-weight: 700; color: #0369a1; font-size: 13px;">
                  สื่อสารกับลูกค้าผ่านแอป:
                </div>
                ${job.customerInAppMessage ? `
                  <span class="badge" style="background: ${job.customerReply ? '#dcfce7' : '#fef3c7'}; color: ${job.customerReply ? '#15803d' : '#92400e'}; font-size: 11px;">
                    ${job.customerReply ? 'ลูกค้าตอบกลับแล้ว' : 'รอลูกค้าเปิดอ่าน'}
                  </span>
                ` : ''}
              </div>

              <!-- ข้อความที่เคยส่ง หรือคำตอบจากลูกค้า -->
              ${job.customerInAppMessage ? `
                <div style="background: #ffffff; border: 1px solid #e0f2fe; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; font-size: 12.5px; color: #075985;">
                  <div><strong>ข้อความถึงลูกค้า:</strong> "${escapeHtml(job.customerInAppMessage.message)}"</div>
                  <div style="font-size: 11px; color: #64748b; margin-top: 2px;">ส่งเมื่อ: ${new Date(job.customerInAppMessage.sentAt).toLocaleTimeString('th-TH')}</div>
                </div>
              ` : ''}

              ${job.customerReply ? `
                <div style="background: #ecfdf5; border: 1.5px solid #86efac; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; font-size: 13px; color: #166534;">
                  <div><strong>คำตอบจากลูกค้า:</strong> "${escapeHtml(job.customerReply.text)}"</div>
                  <div style="font-size: 11px; color: #15803d; margin-top: 2px;">ตอบกลับเมื่อ: ${new Date(job.customerReply.repliedAt).toLocaleTimeString('th-TH')}</div>
                </div>
              ` : ''}

              <!-- แม่แบบข้อความด่วนสำหรับแอดมินส่งหาลูกค้า -->
              <div style="font-size: 12px; font-weight: 600; color: #0369a1; margin-bottom: 4px;">เลือกข้อความด่วนส่งหาลูกค้า:</div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
                <button type="button" class="btn-template-msg" data-text="ช่างถึงซอยหน้าบ้านแล้วแต่หาบ้านเลขที่ไม่เจอ ขอหมุดหรือจุดสังเกตเพิ่มเติมค่ะ" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; padding: 4px 10px; font-size: 11.5px; cursor: pointer;">
                  หาบ้านไม่เจอ ขอจุดสังเกต
                </button>
                <button type="button" class="btn-template-msg" data-text="ช่างถึงหน้าบ้านแล้ว ประตูรั้วปิดอยู่ รบกวนเปิดประตูบ้านให้ช่างด้วยค่ะ" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; padding: 4px 10px; font-size: 11.5px; cursor: pointer;">
                  ถึงหน้าบ้านแล้ว รบกวนเปิดประตู
                </button>
                <button type="button" class="btn-template-msg" data-text="ช่างตรวจพบจุดแก้ไขเพิ่มเติมหน้างาน ขอประสานงานรายละเอียดการซ่อมค่ะ" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; padding: 4px 10px; font-size: 11.5px; cursor: pointer;">
                  ตรวจพบจุดซ่อมเพิ่มเติม
                </button>
              </div>

              <div style="display: flex; gap: 8px;">
                <input type="text" id="admin-cust-msg-input" class="form-input" placeholder="พิมพ์ข้อความส่งหาลูกค้าผ่านแอป..." style="margin-bottom: 0; font-size: 12px; flex: 1;">
                <button type="button" class="btn-mint btn-sm" id="btn-send-msg-cust" style="white-space: nowrap; font-weight: 600; padding: 6px 12px;">
                  ส่งแจ้งลูกค้า
                </button>
              </div>
            </div>

            <!-- กล่องที่ 3: สรุปผลประสานงานส่งกลับให้ช่าง (ปลดล็อกช่าง) -->
            <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 6px; padding: 12px;">
              <div style="font-weight: 700; color: #166534; font-size: 13px; margin-bottom: 6px;">
                ส่งผลประสานงานให้ช่าง (ปลดล็อกหน้าจอช่าง):
              </div>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="admin-tech-resolution-input" class="form-input" placeholder="คำแนะนำให้ช่าง (เช่น ลูกค้าแจ้งว่าบ้านอยู่หลังรั้วสีขาว เข้าไปได้เลย)..." value="${escapeHtml(job.adminIssue.resolutionNotes || '')}" style="margin-bottom: 0; font-size: 12px; flex: 1;">
                <button type="button" class="btn-mint btn-sm" id="btn-send-resolution-tech" style="background: #16a34a; white-space: nowrap; font-weight: 600; padding: 6px 12px;">
                  ปลดล็อกให้ช่างเริ่มงานต่อ
                </button>
              </div>
            </div>

            <!-- ปุ่มเคลียร์งานถัดไปถ้ามีงานติดปัญหาอื่นค้างอยู่ -->
            ${(() => {
              const allC = [...(window._allJobs || []), ...(window._simIssuesActive ? MOCK_MULTI_ISSUES : [])];
              const others = allC.filter(o => o.id !== job.id && o.adminIssue && o.adminIssue.status === 'pending_admin');
              if (others.length === 0) return '';
              return `
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1.5px dashed #fed7aa; display: flex; justify-content: flex-end; align-items: center; gap: 10px;">
                  <span style="font-size: 12.5px; color: #c2410c; font-weight: 700;">มีงานติดปัญหาค้างรออีก ${others.length} งาน:</span>
                  <button type="button" id="btn-next-pending-issue" data-id="${others[0].id}" style="background: #ea580c; color: #ffffff; border: none; border-radius: 6px; padding: 8px 14px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                    เคลียร์งานถัดไป: [${others[0].id.slice(0, 10)}]
                  </button>
                </div>
              `;
            })()}
          </div>
        ` : ''}

        <!-- Dual-Sided Panel: Customer Side vs Technician & Ops Side -->
        <div class="dual-container">
          <!-- ฝั่งซ้าย: ข้อมูลลูกค้า -->
          <div class="dual-panel">
            <div class="dual-panel-header">
              <h4 class="dual-panel-title">ข้อมูลลูกค้า</h4>
              <span style="font-size: 11px; color: var(--gray-500);">ข้อมูลผู้แจ้ง</span>
            </div>

            <div style="font-size: 13px; color: var(--gray-700); line-height: 1.6;">
              <div><strong>รหัสลูกค้า:</strong> ${escapeHtml(job.customerId || '-')}</div>
              <div><strong>เวลานัดหมาย:</strong> ${dateStr}</div>
              <div>
                <strong>ที่อยู่หน้างาน:</strong> ${escapeHtml(address)}
                <div style="margin-top: 4px;">
                  <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" style="color: #0284c7; text-decoration: none; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                    เปิดแผนที่นำทาง
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

          <!-- ฝั่งขวา: ข้อมูลช่าง และฝ่ายบริหาร -->
          <div class="dual-panel">
            <div class="dual-panel-header">
              <h4 class="dual-panel-title">ช่างผู้รับผิดชอบ และฝ่ายบริหาร</h4>
              <span style="font-size: 11px; color: var(--gray-500);">ข้อมูลผู้ปฏิบัติงาน</span>
            </div>

            <!-- Dropdown Technicians 15 Candidates -->
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
                เปิดหน้าจอช่าง
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
              <div style="background: #fff; padding: 14px; border-radius: var(--radius-sm); border: 1.5px solid #93c5fd; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div style="font-weight: 600; font-size: 13px; color: var(--navy);">
                    ขั้นตอนที่ 9: ตรวจสอบและอนุมัติคุณภาพงาน (ความรับผิดชอบรายบุคคล 100%)
                  </div>
                  <span class="badge" style="background: #dbeafe; color: #1e40af; font-size: 11px;">ความรับผิดชอบร่วม</span>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                  <div>
                    <label style="font-size: 12px; color: #334155; font-weight: 600; display: block; margin-bottom: 4px;">
                      เจ้าหน้าที่ผู้ตรวจ QC (ชื่อคนจริง):
                    </label>
                    <select id="qc-inspector-select" class="form-input" style="font-size: 12px; margin-bottom: 0;">
                      ${QC_INSPECTORS.map(q => `
                        <option value="${q.id}" ${q.id === (job.qcInspectorId || 'QC-01') ? 'selected' : ''}>
                          ${q.name} (${q.id}) — ${q.role}
                        </option>
                      `).join('')}
                    </select>
                  </div>
                  <div>
                    <label style="font-size: 12px; color: #334155; font-weight: 600; display: block; margin-bottom: 4px;">
                      เวลาที่ใช้ในการตรวจคุณภาพ:
                    </label>
                    <input type="text" id="qc-inspector-time" class="form-input" value="8 นาที (ตามเกณฑ์มาตรฐาน)" style="margin-bottom: 0; font-size: 12px;" readonly>
                  </div>
                </div>

                <input type="text" id="qc-inspector-notes" class="form-input" placeholder="ความเห็นผู้ตรวจงาน (เช่น ตรวจสอบภาพเปรียบเทียบเรียบร้อย งานสะอาดตามเกณฑ์อาวุโส)..." style="margin-bottom: 0; font-size: 12px;">
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                  <button class="secondary btn-sm" id="btn-reject-qc1" style="color: #b91c1c; border-color: #fca5a5;">
                    ไม่ผ่านการตรวจ - ส่งกลับให้ช่างแก้ไข
                  </button>
                  <button class="btn-mint btn-sm" id="btn-pass-qc1" style="font-weight: 600;">
                    อนุมัติผ่านงาน - ส่งต่อลูกค้าตรวจรับงาน (ไปขั้นตอนที่ 10)
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
                ลูกค้าไม่รับงานและขอแก้ไข (วนกลับไปข้อ 6)
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
          ยังไม่ได้เลือกช่าง — กรุณาเลือกช่างจากรายการด้านบน
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
            <span style="color: #0369a1; font-weight: 600;">คะแนนวินัย: ${Math.round(tech.companyScore || 95)}/100 (${Math.round(tech.companyScore || 95) >= 95 ? 'ระดับดีเยี่ยม' : 'ระดับดี'})</span>
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

  // Clean SOP Quick Action Button (ตัวช่วยแอดมิน 1 คลิก)
  const btnSopQuick = document.getElementById('btn-sop-quick-action');
  if (btnSopQuick && job.adminIssue) {
    btnSopQuick.onclick = () => {
      if (job.adminIssue.customerTemplate) {
        const custInput = document.getElementById('admin-cust-msg-input');
        if (custInput) custInput.value = job.adminIssue.customerTemplate;
      }
      if (job.adminIssue.techResolution) {
        const techInput = document.getElementById('admin-tech-resolution-input');
        if (techInput) techInput.value = job.adminIssue.techResolution;
      }
      if (job.adminIssue.recommendedTechId) {
        job.assignedTeamId = job.adminIssue.recommendedTechId;
        job.assignedTechName = job.adminIssue.recommendedTechName;
      }
      showToast('ระบบกรอกข้อความและเลือกแนวทางแก้ไขให้อัตโนมัติแล้วค่ะ', 'success');
    };
  }

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

      if (job.id.startsWith('SIM-') || job.id.startsWith('NM-')) {
        const simJob = MOCK_MULTI_ISSUES.find(s => s.id === job.id);
        if (simJob) {
          simJob.customerInAppMessage = {
            message,
            sentAt: new Date().toISOString()
          };
          simJob.customerReply = {
            text: 'รับทราบค่ะ ประสานงานเรียบร้อยแล้วค่ะ ช่างเข้ามาได้เลย',
            repliedAt: new Date().toISOString()
          };
        }
        showToast('ส่งข้อความประสานงานถึงลูกค้าผ่านแอปเรียบร้อยแล้วค่ะ', 'success');
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
          agentName: 'บทบาทที่ 3: ฝ่ายบริหารรักบ้าน 🏛️',
          step: 6,
          stepName: '6. เราประสานงาน (ส่งข้อความถึงลูกค้าในแอป)',
          action: 'ADMIN_SENT_INAPP_MESSAGE_TO_CUSTOMER',
          jobId: job.id,
          status: 'success',
          details: {
            message,
            customerId: job.customerId,
          }
        });

        showToast('ส่งข้อความประสานงานถึงลูกค้าผ่านแอปเรียบร้อยแล้วค่ะ', 'success');
        const updatedSnap = await getDoc(doc(db, 'jobs', job.id));
        if (updatedSnap.exists()) {
          openJobModal({ id: updatedSnap.id, ...updatedSnap.data() });
        }
      } catch (err) {
        alert(`เกิดข้อผิดพลาดในการส่งข้อความ: ${err.message}`);
        btnSendMsgCust.disabled = false;
        btnSendMsgCust.textContent = '📢 ส่งแจ้งลูกค้า';
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

      if (job.id.startsWith('SIM-') || job.id.startsWith('NM-')) {
        const simJob = MOCK_MULTI_ISSUES.find(s => s.id === job.id);
        if (simJob) {
          simJob.adminIssue.status = 'resolved';
          simJob.adminIssue.resolutionNotes = resolutionNotes;
          simJob.adminIssue.resolvedAt = new Date().toISOString();
        }
        showToast('ปลดล็อกให้ช่างปฏิบัติงานต่อเรียบร้อยแล้วค่ะ', 'success');
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
          agentName: 'บทบาทที่ 3: ฝ่ายบริหารรักบ้าน 🏛️',
          step: 6,
          stepName: '6. เราประสานงาน (ส่งผลประสานงานปลดล็อกช่าง)',
          action: 'ADMIN_RESOLVED_ISSUE_FOR_TECH',
          jobId: job.id,
          status: 'success',
          details: {
            techId: job.adminIssue?.techId || job.assignedTeamId,
            resolutionNotes,
          }
        });

        showToast('ปลดล็อกให้ช่างเรียบร้อยแล้ว (ช่างจะเห็นปุ่มเริ่มงานต่อ)', 'success');
        const updatedSnap = await getDoc(doc(db, 'jobs', job.id));
        if (updatedSnap.exists()) {
          openJobModal({ id: updatedSnap.id, ...updatedSnap.data() });
        }
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
        btnSendResolutionTech.disabled = false;
        btnSendResolutionTech.textContent = '🟢 ปลดล็อกให้ช่างเริ่มงานต่อ';
      }
    };
  }

  // Next Job Flow Button (สลับเปิดงานถัดไปทันที)
  const btnNextPendingIssue = document.getElementById('btn-next-pending-issue');
  if (btnNextPendingIssue) {
    btnNextPendingIssue.onclick = () => {
      const nextId = btnNextPendingIssue.getAttribute('data-id');
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
        alert('กรุณาเลือกช่างมืออาชีพจากรายชื่อก่อนทำการมอบหมายงานค่ะ');
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

        // บันทึกประวัติการทำงาน: ส่งงานให้ช่างรับงาน (สเต็ป 3)
        await logAgentActivity({
          agentId: 'agent-3-ops',
          agentName: 'ฝ่ายบริหารส่วนกลาง',
          step: 3,
          stepName: '3. ส่งช่างรับ',
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
            coordinator: auth.currentUser?.email || 'admin@rakbaan.com',
          },
          workflowStep: 6,
        });

        // บันทึกประวัติการทำงาน: ประสานงาน 3 ฝ่าย (สเต็ป 6)
        await logAgentActivity({
          agentId: 'agent-3-ops',
          agentName: 'ฝ่ายบริหารส่วนกลาง',
          step: 6,
          stepName: '6. เราประสานงาน',
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

        // บันทึกประวัติการทำงาน: สั่งเริ่มงานอย่างเป็นทางการ (สเต็ป 7)
        await logAgentActivity({
          agentId: 'agent-3-ops',
          agentName: 'ฝ่ายบริหารส่วนกลาง',
          step: 7,
          stepName: '7. เราสั่งเริ่มงาน',
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

  // Step 9: Pass and send to Customer Review
  const btnPassQc1 = document.getElementById('btn-pass-qc1');
  if (btnPassQc1) {
    btnPassQc1.onclick = async () => {
      const qcNotes = document.getElementById('qc-inspector-notes')?.value.trim() || 'ตรวจงานผ่านเกณฑ์มาตรฐาน';
      const inspectorId = document.getElementById('qc-inspector-select')?.value || 'QC-01';
      const selectedInspector = getQCInspectorById(inspectorId);
      const qcInspectorName = `${selectedInspector.name} (${selectedInspector.id})`;

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress', // Safe 1-of-5 status
          workflowStep: 9,
          workflowStatus: 'customer_review',
          qcInspector: qcInspectorName,
          qcInspectorId: selectedInspector.id,
          qcInspectorName: qcInspectorName,
          qcInspectorTitle: selectedInspector.role,
          qcNotes,
          qcPassedAt: new Date().toISOString(),
        });

        // บันทึกประวัติการทำงาน: ผ่านงานสเต็ป 9 และส่งต่อให้ลูกค้าตรวจรับ
        await logAgentActivity({
          agentId: 'agent-4-qc',
          agentName: qcInspectorName,
          actorName: qcInspectorName,
          step: 9,
          stepName: '9. เราตรวจงาน',
          action: 'QC_INSPECTION_PASSED',
          jobId: job.id,
          status: 'success',
          dwellMinutes: 8,
          timeSpent: 'ตรวจรับรองคุณภาพ 8 นาที',
          items: 'ผ่านเกณฑ์ตรวจสอบรูปคู่ก่อนทำและหลังทำ 100%',
          details: {
            qcNotes,
            inspector: selectedInspector,
            inspectorName: qcInspectorName,
          },
        });

        closeModal();
        showToast(`ผู้ตรวจ ${qcInspectorName} อนุมัติผ่านงานเรียบร้อย (ขั้นตอนที่ 9)`, 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    };
  }

  // Step 9: Reject and send back to Tech for on-site revision
  const btnRejectQc1 = document.getElementById('btn-reject-qc1');
  if (btnRejectQc1) {
    btnRejectQc1.onclick = async () => {
      const qcNotes = prompt('ระบุจุดที่ช่างต้องแก้ไขหน้างาน:');
      if (!qcNotes) return;
      const inspectorId = document.getElementById('qc-inspector-select')?.value || 'QC-01';
      const selectedInspector = getQCInspectorById(inspectorId);
      const qcInspectorName = `${selectedInspector.name} (${selectedInspector.id})`;

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress', // Safe 1-of-5 status
          workflowStep: 8,
          workflowStatus: 'tech_revision_required',
          qcInspector: qcInspectorName,
          qcInspectorId: selectedInspector.id,
          qcInspectorName: qcInspectorName,
          qcRejectionNotes: qcNotes,
          qcRejectedAt: new Date().toISOString(),
        });

        // บันทึกประวัติการทำงาน: ตีกลับให้ช่างแก้ไขหน้างาน
        await logAgentActivity({
          agentId: 'agent-4-qc',
          agentName: qcInspectorName,
          actorName: qcInspectorName,
          step: 9,
          stepName: '9. เราตรวจงาน',
          action: 'QC_INSPECTION_REJECTED',
          jobId: job.id,
          status: 'warning',
          dwellMinutes: 5,
          timeSpent: 'ส่งแก้ไขหน้างาน 5 นาที',
          items: `ขอแก้ไข: ${qcNotes}`,
          details: {
            qcRejectionNotes: qcNotes,
            inspector: selectedInspector,
            inspectorName: qcInspectorName,
          },
        });

        closeModal();
        showToast(`ผู้ตรวจ ${qcInspectorName} ตีกลับให้ช่างแก้ไขหน้างานเรียบร้อยแล้ว`, 'info');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    };
  }

  // Step 10: Customer Accepts Job & Activate Digital Warranty
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

        // บันทึกประวัติการทำงาน: ปิดงานและเปิดรับประกันดิจิทัล (สเต็ป 10)
        await logAgentActivity({
          agentId: 'agent-1-customer',
          agentName: 'ลูกค้า',
          step: 10,
          stepName: '10. ลูกค้ารับงานและประกัน',
          action: 'CUSTOMER_ACCEPT_JOB',
          jobId: job.id,
          status: 'success',
          details: {
            warrantyDays: defaultWarrantyDays,
            payoutUnlocked: true,
          },
        });

        closeModal();
        showToast(`ลูกค้ารับงานเรียบร้อย เริ่มนับประกันดิจิทัล ${defaultWarrantyDays} วัน ปิดงานสำเร็จ`, 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    };
  }

  // Step 10: Customer Rejects Job -> Trigger Accountability Penalty & Loopback to Step 6
  const btnCustomerReject = document.getElementById('btn-customer-reject');
  if (btnCustomerReject) {
    btnCustomerReject.onclick = async () => {
      const reason = prompt('ระบุเหตุผลที่ลูกค้าไม่รับงานและขอแก้ไข (ข้อบกพร่องหน้างาน):');
      if (!reason) return;

      const inspectorName = job.qcInspectorName || job.qcInspector || 'คุณวิชัย ตรวจการ (QC-01)';
      const techDisplay = job.assignedTechName ? `${job.assignedTechName} [${job.assignedTeamId || 'Pro'}]` : (job.assignedTeamId || 'ช่างผู้ปฏิบัติงาน');

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress', // Safe 1-of-5 status
          workflowStep: 6, // Loopback to Step 6
          workflowStatus: 'rework_needed',
          accountability: {
            penalizedInspector: inspectorName,
            penalizedTechnician: techDisplay,
            rejectionReason: reason,
            penaltyFlag: true,
            rejectedAt: new Date().toISOString(),
          },
        });

        // บันทึกประวัติการทำงาน: ตีกลับวนลูปข้อ 6 พร้อมธงโทษความรับผิดชอบร่วม
        await logAgentActivity({
          agentId: 'agent-1-customer',
          agentName: 'ลูกค้า',
          step: 10,
          stepName: '10. ลูกค้าสั่งแก้ไขงาน',
          action: 'CUSTOMER_REJECT_JOB_REWORK',
          jobId: job.id,
          status: 'warning',
          details: {
            rejectionReason: reason,
            loopbackToStep: 6,
            penalizedInspector: inspectorName,
            penalizedTechnician: techDisplay,
          },
        });

        closeModal();
        showToast(`ลูกค้าไม่รับงาน: บันทึกความรับผิดชอบร่วม (${inspectorName} และ ${techDisplay}) และวนกลับไปขั้นตอนที่ 6 ทันที`, 'info');
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
        showToast('บันทึกการเปลี่ยนแปลงสถานะเรียบร้อยแล้ว', 'success');
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
  toast.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : 'ℹ'}</span><span class="toast-msg">${message}</span>`;
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
            <div style="font-size: 21px; font-weight: 800; color: #0f172a;">
              คู่มือปฏิบัติการส่วนกลาง
            </div>
            <div style="font-size: 14px; color: #64748b; margin-top: 2px;">
              ระเบียบปฏิบัติ 4 ช่วงเวลาประจำวัน • เกณฑ์จ่ายงาน 5 มิติ • การรับมือเหตุฉุกเฉิน
            </div>
          </div>
          <button type="button" id="btn-ops-playbook-close" style="background: #f1f5f9; border: none; font-size: 20px; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; color: #475569;">✕</button>
        </div>

        <!-- กะเวลา 4 ช่วง -->
        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;">
          <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 8px;">
            1. จังหวะทำงาน 4 ช่วงเวลาประจำวัน
          </div>
          <div style="font-size: 14px; color: #334155; line-height: 1.55;">
            • <strong>07:30 น. (รอบเช้า):</strong> ตรวจสอบงานค้างคืน ยืนยันนัดหมาย และปล่อยช่างรอบแรก<br>
            • <strong>08:30–17:00 น. (รอบกลางวัน):</strong> ติดตามเวลาทำงาน และแก้ปัญหาช่างล่าช้าเกิน 15 นาที<br>
            • <strong>17:00–20:00 น. (รอบค่ำ):</strong> ปิดรับงานด่วนมาก ตัดรอบงานหลัง 17:00 น. ไปรอบ 08:00 น. วันถัดไป<br>
            • <strong>20:00 น. (ตัดรอบวัน):</strong> ยุติการทำงานช่าง ตรวจสอบยอดเงินพัก บจก. เพียบพร้อมทำ
          </div>
        </div>

        <!-- เกณฑ์ 5 มิติ -->
        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-left: 4px solid #0284c7; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;">
          <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 8px;">
            2. เกณฑ์การจ่ายงาน 5 มิติ
          </div>
          <div style="font-size: 14px; color: #334155; line-height: 1.55;">
            1. <strong>ทักษะตรงสาย:</strong> ช่างมีใบรับรองและทักษะตรงประเภทงานซ่อม<br>
            2. <strong>ระยะทางใกล้สุด:</strong> คิดค่าเดินทางมาตรฐาน (+15 บาท/กม. เกิน 10 กม.)<br>
            3. <strong>เวลาลงตัว:</strong> ไม่จัดคิวงานซ้อนเหลื่อมเวลากัน ป้องกันช่างสาย<br>
            4. <strong>วินัยและความประพฤติ:</strong> ช่างเกรด A/B (≥ 80 แต้ม) ได้รับคิวงานก่อน ช่างเกรด F ระบบล็อกอัตโนมัติ<br>
            5. <strong>กระจายงานเป็นธรรม:</strong> เกลี่ยงานให้ช่างอย่างสมดุล ไม่กระจุกตัว
          </div>
        </div>

        <!-- ตารางรับมือเหตุฉุกเฉิน -->
        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-left: 4px solid #f59e0b; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;">
          <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 8px;">
            3. ตารางรับมือเหตุฉุกเฉิน
          </div>
          <div style="font-size: 14px; color: #334155; line-height: 1.55;">
            • <strong>ช่างไม่ตอบรับเกิน 15 นาที:</strong> จ่ายงานให้ช่างสำรองทันที และตัด 5 คะแนนวินัย<br>
            • <strong>ลูกค้าไม่อยู่บ้าน:</strong> รอ 15 นาที ประสานงาน 2 ครั้ง หากติดต่อไม่ได้ ยกเลิกพร้อมคิดค่าตรวจเช็ค<br>
            • <strong>หน้างานมีงานงอกหรืออะไหล่เพิ่ม:</strong> ออกใบสรุปรายการเสริมผ่านระบบ ห้ามช่างเรียกเก็บเงินสดหน้างาน
          </div>
        </div>

        <!-- กฎเงินพัก -->
        <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-left: 4px solid #ef4444; border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;">
          <div style="font-size: 16px; font-weight: 800; color: #991b1b; margin-bottom: 6px;">
            4. กฎเงินพัก บจก. เพียบพร้อมทำ ห้ามรับเงินสดหน้างานทุกกรณี
          </div>
          <div style="font-size: 14px; color: #7f1d1d; line-height: 1.55;">
            เงินทุกบาทลูกค้าชำระเข้าบัญชีกลาง บจก. เพียบพร้อมทำ ก่อนเริ่มงาน • ปลดล็อกโอนให้ช่างเมื่อผ่านการตรวจรูปถ่าย และลูกค้ายืนยันตรวจรับงานแล้วเท่านั้น • ตรวจสอบพบรับเงินสดหน้างาน ปรับเงินและตัดสิทธิ์ช่างทันที
          </div>
        </div>

        <button type="button" id="btn-ops-playbook-ok" style="width: 100%; background: #10b981; color: #fff; border: none; border-radius: 10px; padding: 12px; font-size: 16px; font-weight: 700; cursor: pointer;">
          เข้าใจและพร้อมปฏิบัติงานตามมาตรฐาน
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

