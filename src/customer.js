/**
 * รักบ้าน@CNX — Customer Mobile Web Controller
 * ถอดแบบจาก Flutter rakbaan_page1 (Ver 1.2.5) 100%
 * Senior-First & Frameless Clean UI
 * ครอบคลุม: หน้าแรก (Home) + ตารางติดตาม Step Light + แจ้งซ่อม 3 ขั้นตอน + ตรวจรับงานสเต็ป 10
 */

import { auth, db } from './firebase.js';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
} from 'firebase/firestore';
import { getTechnicians } from './technicians-data.js';
import { logAgentActivity } from './audit-logger.js';

// ข้อมูลจำลองผู้ใช้งานประจำ (คุณเชิดศักดิ์)
const CUSTOMER_ID = 'customer_cherd';
const CUSTOMER_NAME = 'คุณเชิดศักดิ์ (เจ้าของบ้าน)';
const CUSTOMER_PHONE = '081-882-9988';
const CUSTOMER_ADDRESS = '88/12 ถ.สุเทพ ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200';

// แคตตาล็อกบริการมาตรฐาน (ภาษาชาวบ้าน ปลอดศัพท์ช่าง)
const CATALOG_SERVICES = [
  {
    id: 'air_clean',
    category: 'air_con',
    categoryName: 'แอร์',
    categoryIcon: '❄️',
    name: 'ล้างแอร์ทั่วไป (ติดผนัง)',
    desc: 'ล้างคอยล์เย็น คอยล์ร้อน เช็คระบบความเย็น',
    price: 600,
    warrantyDays: 90,
    scope: ['ล้างแผงคอยล์เย็นด้วยโฟมฆ่าเชื้อ', 'ล้างคอยล์ร้อนนอกบ้าน', 'เป่าท่อน้ำทิ้งป้องกันน้ำรั่ว', 'ตรวจเช็คแรงดันน้ำยาแอร์'],
  },
  {
    id: 'pipe_leak',
    category: 'plumbing',
    categoryName: 'ประปา',
    categoryIcon: '🚰',
    name: 'ซ่อมท่อประปารั่วซึม / ก๊อกหัก',
    desc: 'ตรวจหาจุดรั่ว ซ่อมเปลี่ยนข้อต่อ อุปกรณ์มาตรฐาน',
    price: 550,
    warrantyDays: 90,
    scope: ['สกัดตรวจจุดท่อแตกรั่ว', 'เปลี่ยนท่อ PVC และข้อต่อหนา', 'ทดสอบแรงดันน้ำหลังซ่อม', 'รับประกันรอยต่อน้ำไม่รั่วซึม'],
  },
  {
    id: 'elec_switch',
    category: 'electrical',
    categoryName: 'ไฟฟ้า',
    categoryIcon: '⚡',
    name: 'ซ่อมสวิตช์ไฟ / เต้ารับ / เช็คไฟช็อต',
    desc: 'ตรวจเช็คความปลอดภัย เปลี่ยนอุปกรณ์มาตรฐาน มอก.',
    price: 500,
    warrantyDays: 90,
    scope: ['ตรวจเช็คแรงดันและความปลอดภัย', 'เปลี่ยนสวิตช์/เต้ารับมาตรฐาน', 'ตรวจสายดินป้องกันไฟรั่ว', 'ทำความสะอาดหน้างานเรียบร้อย'],
  },
  {
    id: 'roof_repair',
    category: 'roof_structure',
    categoryName: 'หลังคา-โครงสร้าง',
    categoryIcon: '🏠',
    name: 'ซ่อมหลังคารั่วซึม / รางน้ำชำรุด',
    desc: 'อุดรอยรั่ว เปลี่ยนกระเบื้องแตก แผ่นกันซึม',
    price: 1200,
    warrantyDays: 180,
    scope: ['ตรวจจุดรั่วบนหลังคา', 'ทาน้ำยากันซึมคุณภาพสูง', 'เปลี่ยนกระเบื้อง/รางน้ำตรงสเปก', 'รับประกันยาวนาน 180 วัน'],
  },
];

// App State
let activeNav = 'home'; // 'home', 'book', 'tracking'
let wizardStep = 1; // 1: งาน&ไมค์, 2: วันเวลา&ช่าง, 3: สรุปรายการ
let allMyJobs = [];
let unsubscribe = null;

// Booking Draft State (Multi-Task Work Orders)
let workOrders = [
  {
    id: 1,
    service: CATALOG_SERVICES[0],
    location: 'ห้องนั่งเล่น/รับแขก',
    qty: 1,
    tech1: 'สมหมาย',
    tech2: 'เกรียงศักดิ์',
  },
];
let selectedLocation = 'ห้องนั่งเล่น/รับแขก';
let selectedCatalogService = CATALOG_SERVICES[0];
let selectedSla = 'normal'; // 'normal', 'urgent', 'hotline'
let selectedTechChoice = 'auto'; // 'auto' or tech ID
let hasCarePlus = false;
let isMicListening = false;
let micTimer = null;

// Initialize
init();

function init() {
  bindNavTabs();
  renderCurrentView(); // Render immediately so screen appears in 0ms

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.warn('Anonymous auth note:', e.message);
      }
    }
    startListeningJobs();
  });
}

function bindNavTabs() {
  const tabHome = document.getElementById('tab-home');
  const tabBook = document.getElementById('tab-book');
  const tabTracking = document.getElementById('tab-tracking');

  if (tabHome) {
    tabHome.onclick = () => {
      activeNav = 'home';
      updateNavButtons();
      renderCurrentView();
    };
  }

  if (tabBook) {
    tabBook.onclick = () => {
      activeNav = 'book';
      wizardStep = 1;
      updateNavButtons();
      renderCurrentView();
    };
  }

  if (tabTracking) {
    tabTracking.onclick = () => {
      activeNav = 'tracking';
      updateNavButtons();
      renderCurrentView();
    };
  }
}

function updateNavButtons() {
  const tabHome = document.getElementById('tab-home');
  const tabBook = document.getElementById('tab-book');
  const tabTracking = document.getElementById('tab-tracking');
  if (tabHome) tabHome.classList.toggle('active', activeNav === 'home');
  if (tabBook) tabBook.classList.toggle('active', activeNav === 'book');
  if (tabTracking) tabTracking.classList.toggle('active', activeNav === 'tracking');
}

function startListeningJobs() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  try {
    const q = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(50));
    unsubscribe = onSnapshot(q, (snapshot) => {
      allMyJobs = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(j => j.customerId === CUSTOMER_ID || !j.customerId || j.customerId.includes('cherd'));

      renderCurrentView();
    }, (err) => {
      console.warn('Firestore snapshot error:', err.message);
    });
  } catch (err) {
    console.warn('Query setup error:', err.message);
  }
}

function renderCurrentView() {
  const root = document.getElementById('customer-view-root');
  if (!root) return;

  if (activeNav === 'home') {
    renderHomeScreen(root);
  } else if (activeNav === 'book') {
    renderBookingWizard(root);
  } else if (activeNav === 'tracking') {
    renderTrackingScreen(root);
  }
}

// =============================================================================
// SCREEN 01: HOME SCREEN (ถอดแบบจาก home_screen.dart ใน Flutter 100%)
// =============================================================================
function renderHomeScreen(container) {
  // หากมีงานที่ยังไม่จบ (ค้างอยู่) ให้แสดงงานแรกใน Step Light Bar
  const activeJob = allMyJobs.find(j => j.status !== 'completed');

  let stepLightHtml = '';
  if (activeJob) {
    const stepNum = calculateStepNumber(activeJob.status);
    stepLightHtml = `
      <div class="step-light-container">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 24px;">${activeJob.category === 'plumbing' ? '🚰' : (activeJob.category === 'electrical' ? '⚡' : (activeJob.category === 'roof_structure' ? '🏠' : '❄️'))}</span>
            <strong style="font-size: 17px; color: var(--navy-900);">
              ${escapeHtml(activeJob.title || 'งานแจ้งซ่อม')}
            </strong>
          </div>
          <span style="font-family: monospace; font-size: 13px; color: #64748b;">${activeJob.id.slice(0, 8).toUpperCase()}</span>
        </div>

        <!-- แถบไฟสเต็ปสว่าง Realtime 4 ดวง -->
        <div class="step-light-bar">
          <div class="step-node ${stepNum === 1 ? 'active' : (stepNum > 1 ? 'passed' : '')}">
            <div class="step-circle">${stepNum > 1 ? '✓' : '1'}</div>
            <span>รับเรื่อง</span>
          </div>
          <div class="step-line ${stepNum > 1 ? 'passed' : ''}"></div>
          
          <div class="step-node ${stepNum === 2 ? 'active' : (stepNum > 2 ? 'passed' : '')}">
            <div class="step-circle">${stepNum > 2 ? '✓' : '2'}</div>
            <span>ช่างเดินทาง</span>
          </div>
          <div class="step-line ${stepNum > 2 ? 'passed' : ''}"></div>

          <div class="step-node ${stepNum === 3 ? 'active' : (stepNum > 3 ? 'passed' : '')}">
            <div class="step-circle">${stepNum > 3 ? '✓' : '3'}</div>
            <span>กำลังทำ</span>
          </div>
          <div class="step-line ${stepNum > 3 ? 'passed' : ''}"></div>

          <div class="step-node ${stepNum === 4 ? 'active' : ''}">
            <div class="step-circle">4</div>
            <span>เสร็จสิ้น</span>
          </div>
        </div>

        <!-- ยอดชำระ & ปุ่มดูงาน -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 12px;">
          <div>
            <span style="font-size: 14px; color: #64748b;">ยอดชำระสุทธิ: </span>
            <span style="font-size: 24px; font-weight: 800; color: var(--navy-900);">฿${(activeJob.price || 600).toLocaleString()}</span>
          </div>
          <button class="btn-senior-primary" id="btn-home-goto-tracking" style="width: auto; padding: 10px 18px; font-size: 16px;">
            💳 ดูงาน / ชำระเงิน ➔
          </button>
        </div>
      </div>
    `;
  } else {
    stepLightHtml = `
      <div style="background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 16px; margin-bottom: 20px; display: flex; align-items: center; gap: 14px;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--mint-100); display: flex; align-items: center; justify-content: center; font-size: 24px; color: var(--mint-700);">
          ✓
        </div>
        <div>
          <div style="font-size: 17px; font-weight: 700; color: var(--navy-900);">ติดตาม: (ยังไม่มีรายการ)</div>
          <div style="font-size: 14px; color: #64748b; margin-top: 2px;">
            ขณะนี้ไม่มีงานที่รอดำเนินการ เมื่อท่านแจ้งงานช่าง สถานะไฟสว่างจะแสดงที่นี่ทันทีค่ะ
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div>
      <!-- ข้อความต้อนรับส่วนตัว (ตัวหนังสือใหญ่ ชัดเจน) -->
      <div class="welcome-card">
        <span style="font-size: 26px;">🏡</span>
        <div class="welcome-text">ยินดีต้อนรับกลับมา คุณเชิด</div>
      </div>

      <!-- ส่วนที่ 1: แถบติดตามสถานะงานพร้อมไฟสเต็ปสว่าง Realtime -->
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
        <span style="font-size: 20px;">📍</span>
        <strong style="font-size: 19px; color: var(--navy-900);">ติดตามสถานะงาน</strong>
      </div>
      ${stepLightHtml}

      <!-- ส่วนที่ 2: พื้นที่ป้ายโฆษณา / แบนเนอร์โปรโมชั่นขนาดใหญ่ (Hero Banner Slider) -->
      <div class="hero-banner">
        <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; opacity: 0.85; margin-bottom: 4px;">
          PROMOTION · RAKBAAN CNX
        </div>
        <div class="hero-banner-title">✨ ล้างแอร์ 2 เครื่อง ลดทันที 150 บาท</div>
        <div class="hero-banner-desc">
          ช่างมืออาชีพพร้อมน้ำยาฆ่าเชื้อมาตรฐาน มอก. พร้อมรับประกันงานซ่อมนาน 90 วันเต็ม
        </div>
      </div>

      <!-- ส่วนที่ 3: หมวดบริการ 4 เสาหลักช่างเชียงใหม่ -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <strong style="font-size: 19px; color: var(--navy-900);">🛠️ 4 เสาหลักบริการช่าง</strong>
        <span style="font-size: 13px; color: #059669; font-weight: 600;">รับประกัน 90-180 วัน</span>
      </div>

      <div class="pillar-grid">
        <div class="pillar-card" data-cat="air_con">
          <div class="pillar-icon">❄️</div>
          <div class="pillar-name">แอร์บ้าน</div>
          <div class="pillar-sub">ล้างแอร์ • ซ่อมแอร์ • เติมน้ำยา</div>
        </div>
        <div class="pillar-card" data-cat="plumbing">
          <div class="pillar-icon">🚰</div>
          <div class="pillar-name">ประปา</div>
          <div class="pillar-sub">ท่อรั่ว • ก๊อกหัก • ปั๊มน้ำ</div>
        </div>
        <div class="pillar-card" data-cat="electrical">
          <div class="pillar-icon">⚡</div>
          <div class="pillar-name">ไฟฟ้า</div>
          <div class="pillar-sub">ไฟช็อต • สวิตช์ • เต้ารับ</div>
        </div>
        <div class="pillar-card" data-cat="roof_structure">
          <div class="pillar-icon">🏠</div>
          <div class="pillar-name">หลังคา-โครงสร้าง</div>
          <div class="pillar-sub">หลังคารั่ว • รางน้ำ • ซ่อมซึม</div>
        </div>
      </div>

      <!-- ปุ่มเริ่มแจ้งซ่อม 3 ขั้นตอน -->
      <button class="btn-senior-primary" id="btn-start-booking" style="margin-top: 10px;">
        <span>🟢 แจ้งซ่อมบ้านทันที (ระบบ 3 ขั้นตอน) ➔</span>
      </button>

      <!-- สายด่วนฉุกเฉิน 24 ชม. -->
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 14px; margin-top: 20px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-size: 16px; font-weight: 700; color: #991b1b;">🚨 สายด่วนฉุกเฉิน 24 ชม.</div>
          <div style="font-size: 13px; color: #b91c1c;">ไฟดับทั้งบ้าน ท่อประปาแตกฉุกเฉิน</div>
        </div>
        <a href="tel:053999999" style="background: #dc2626; color: #fff; padding: 8px 14px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px;">
          📞 โทรทันที
        </a>
      </div>
    </div>
  `;

  // Attach Home events
  const btnGotoTracking = document.getElementById('btn-home-goto-tracking');
  if (btnGotoTracking) {
    btnGotoTracking.onclick = () => {
      activeNav = 'tracking';
      updateNavButtons();
      renderCurrentView();
    };
  }

  document.getElementById('btn-start-booking').onclick = () => {
    activeNav = 'book';
    wizardStep = 1;
    updateNavButtons();
    renderCurrentView();
  };

  container.querySelectorAll('.pillar-card').forEach(card => {
    card.onclick = () => {
      const cat = card.getAttribute('data-cat');
      const found = CATALOG_SERVICES.find(s => s.category === cat);
      if (found) {
        selectedCatalogService = found;
      }
      activeNav = 'book';
      wizardStep = 1;
      updateNavButtons();
      renderCurrentView();
    };
  });
}

function calculateStepNumber(status) {
  if (status === 'completed') return 4;
  if (status === 'in_progress') return 3;
  if (status === 'traveling' || status === 'assigned') return 2;
  return 1;
}

// =============================================================================
// SCREEN 02: 3-STEP REPAIR WIZARD (REPAIR_WORKFLOW_3_STEPS.md)
// =============================================================================
function renderBookingWizard(container) {
  const allTechs = getTechnicians();

  // Grand Total Calculation
  const itemsTotal = workOrders.reduce((sum, item) => sum + (item.service.price * item.qty), 0);
  const urgencyFee = selectedSla === 'hotline' ? 200 : (selectedSla === 'urgent' ? 150 : 0);
  const carePlusFee = hasCarePlus ? 199 : 0;
  const grandTotal = itemsTotal + urgencyFee + carePlusFee;

  let wizardContent = '';

  // -------------------------------------------------------------
  // STEP 1: เลือกงาน & พูดสั่งงาน (Smart Voice & Multi-Task Table)
  // -------------------------------------------------------------
  if (wizardStep === 1) {
    wizardContent = `
      <div>
        <h2 style="font-size: 20px; font-weight: 800; color: var(--navy-900); margin: 0 0 6px 0;">
          ขั้นตอนที่ 1: เลือกงานซ่อม & พูดสั่งงาน
        </h2>
        <p style="font-size: 15px; color: #64748b; margin: 0 0 16px 0;">
          พูดผ่านไมค์ หรือแตะเลือกบริการมาตรฐาน • ฟรีค่าเดินทาง 10 กม.
        </p>

        <!-- Tap-to-Talk Mic Box (96x96, Red Pulse) -->
        <div class="mic-box">
          <button class="mic-btn-large ${isMicListening ? 'listening' : ''}" id="btn-mic-toggle">
            🎤
          </button>
          <div class="mic-status-label" id="mic-status-text">
            ${isMicListening ? '🔴 กำลังฟังเสียง...' : 'แตะไมค์ 1 ครั้งเพื่อพูดสั่งงาน'}
          </div>
          <div class="mic-hint">
            ${isMicListening
              ? 'ระบบกำลังรับฟังเสียง... (ลองพูด "ล้างแอร์ห้องนั่งเล่น" หรือ "ซ่อมท่อประปารั่ว")'
              : 'พูดชื่ออาการ เช่น "ล้างแอร์ห้องนอน", "ก๊อกน้ำรั่ว" ระบบจะเลือกให้ทันที'}
          </div>

          <!-- Quick Speech Simulator Pills for easy browser testing -->
          <div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; margin-top: 12px;">
            <button class="badge" style="background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; cursor: pointer; padding: 6px 10px;" id="sim-voice-air">
              🗣️ พูด: "ล้างแอร์ห้องนั่งเล่น"
            </button>
            <button class="badge" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; cursor: pointer; padding: 6px 10px;" id="sim-voice-pipe">
              🗣️ พูด: "ก๊อกน้ำรั่วในครัว"
            </button>
            <button class="badge" style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; cursor: pointer; padding: 6px 10px;" id="sim-voice-elec">
              🗣️ พูด: "ไฟช็อตสวิตช์เสีย"
            </button>
          </div>
        </div>

        <!-- สถานที่ & พิกัด GPS (Senior-First) -->
        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 18px;">
          <div style="font-size: 15px; font-weight: 700; color: #059669;">📍 สถานที่นัดหมาย:</div>
          <div style="font-size: 17px; font-weight: 700; color: var(--navy-900); margin: 2px 0;">${CUSTOMER_NAME}</div>
          <div style="font-size: 14px; color: #475569;">${CUSTOMER_ADDRESS}</div>
          <div class="gps-badge">✨ ฟรีค่าเดินทาง (3.2 กม. จากสามกษัตริย์)</div>
        </div>

        <!-- การ์ดเลือกบริการมาตรฐาน (Smart Service Cards) -->
        <strong style="font-size: 17px; color: var(--navy-900);">เลือกรายการบริการ:</strong>
        <div style="margin: 8px 0 16px;">
          ${CATALOG_SERVICES.map(srv => `
            <div class="smart-service-card ${selectedCatalogService.id === srv.id ? 'selected' : ''}" data-id="${srv.id}">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                  <div class="service-title">${srv.categoryIcon} ${srv.name}</div>
                  <div style="font-size: 14px; color: #64748b; margin: 2px 0 6px;">${srv.desc}</div>
                </div>
                <div class="service-price">฿${srv.price.toLocaleString()}</div>
              </div>

              <!-- Scope of work with green checkmarks -->
              <div style="background: #ffffff; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 13px; color: #334155; margin-top: 6px;">
                <strong style="color: #059669;">สิ่งที่ท่านจะได้รับ:</strong>
                <div style="display: flex; flex-direction: column; gap: 3px; margin-top: 4px;">
                  ${srv.scope.map(s => `<div>✓ ${s}</div>`).join('')}
                </div>
                <div style="margin-top: 6px; font-weight: 700; color: #0284c7;">
                  🛡️ รับประกันงานซ่อม ${srv.warrantyDays} วันเต็ม
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- เลือกห้อง / จุดซ่อม และปุ่มเพิ่มรายการ -->
        <div style="background: #f1f5f9; padding: 14px; border-radius: 12px; margin-bottom: 18px;">
          <div style="display: flex; gap: 10px; align-items: center;">
            <div style="flex: 1;">
              <label style="font-size: 14px; font-weight: 700; color: var(--navy-800); display: block; margin-bottom: 4px;">ระบุห้อง / พื้นที่:</label>
              <select id="select-room-location" class="form-input select-input" style="width: 100%; margin-bottom: 0;">
                <option value="ห้องนั่งเล่น/รับแขก" ${selectedLocation === 'ห้องนั่งเล่น/รับแขก' ? 'selected' : ''}>ห้องนั่งเล่น / รับแขก</option>
                <option value="ห้องนอนใหญ่" ${selectedLocation === 'ห้องนอนใหญ่' ? 'selected' : ''}>ห้องนอนใหญ่</option>
                <option value="ห้องครัว" ${selectedLocation === 'ห้องครัว' ? 'selected' : ''}>ห้องครัว</option>
                <option value="ห้องน้ำ" ${selectedLocation === 'ห้องน้ำ' ? 'selected' : ''}>ห้องน้ำ</option>
                <option value="นอกตัวบ้าน" ${selectedLocation === 'นอกตัวบ้าน' ? 'selected' : ''}>นอกตัวบ้าน</option>
              </select>
            </div>
            <button class="btn-senior-primary" id="btn-add-work-order" style="width: auto; padding: 12px 16px; margin-top: 22px; font-size: 16px;">
              ➕ เพิ่มรายการ
            </button>
          </div>
        </div>

        <!-- ตารางสั่งงานหลายจุดในบิลเดียว (Multi-Task Work Order Table 6 คอลัมน์) -->
        <strong style="font-size: 17px; color: var(--navy-900);">
          📋 ตารางรายการงานซ่อมในบิลนี้ (${workOrders.length} รายการ):
        </strong>

        <div style="overflow-x: auto; margin-top: 8px;">
          <table class="multi-task-table">
            <thead>
              <tr>
                <th style="width: 35px;">ลำดับ</th>
                <th class="text-left">รายการและห้อง</th>
                <th>จำนวนเงิน</th>
                <th>ช่าง 1</th>
                <th>ช่าง 2</th>
                <th style="width: 45px;">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              ${workOrders.map((wo, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td class="text-left">
                    <strong>${wo.service.name}</strong><br />
                    <span style="font-size: 12px; color: #64748b;">📍 ${wo.location}</span>
                  </td>
                  <td><strong>฿${(wo.service.price * wo.qty).toLocaleString()}</strong></td>
                  <td><span class="badge" style="background: #e2e8f0; font-size: 12px;">${wo.tech1}</span></td>
                  <td><span class="badge" style="background: #e2e8f0; font-size: 12px;">${wo.tech2}</span></td>
                  <td>
                    ${workOrders.length > 1 ? `
                      <button class="btn-remove-item" data-idx="${index}" style="background: #fee2e2; color: #dc2626; border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-weight: 700;">
                        ✕
                      </button>
                    ` : '<span style="color: #94a3b8;">-</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- ยอดรวมสุทธิแบบ Frameless -->
        <div class="frameless-price-box">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 18px; font-weight: 700; color: var(--navy-800);">ราคารวมสุทธิ (ค่าบริการ):</span>
            <span class="grand-total-amount">฿${itemsTotal.toLocaleString()}</span>
          </div>
          <div style="font-size: 13px; color: #059669; margin-top: 2px;">
            ✓ รวมค่าแรง • รวมอุปกรณ์มาตรฐาน • ไม่มีค่าใช้จ่ายแอบแฝง
          </div>
        </div>

        <!-- ปุ่มก้าวหน้าสู่ขั้นตอนที่ 2 -->
        <button class="btn-senior-primary" id="btn-goto-step-2">
          <span>ขั้นตอนถัดไป: วันเวลา & ช่าง (ขั้นที่ 2/3) ➔</span>
        </button>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // STEP 2: ตรวจตาราง & นัดเวลาช่าง (Appointment & Technician)
  // -------------------------------------------------------------
  else if (wizardStep === 2) {
    wizardContent = `
      <div>
        <h2 style="font-size: 20px; font-weight: 800; color: var(--navy-900); margin: 0 0 6px 0;">
          ขั้นตอนที่ 2: นัดหมายวันเวลา & เลือกทีมช่าง
        </h2>
        <p style="font-size: 15px; color: #64748b; margin: 0 0 16px 0;">
          เลือกระดับความเร่งด่วน SLA และทีมช่างผู้ชำนาญการ
        </p>

        <!-- ทบทวนรายการงาน -->
        <div style="background: #f8fafc; border-radius: 12px; padding: 12px 14px; margin-bottom: 18px; border: 1px solid #e2e8f0;">
          <strong style="color: var(--navy-900);">รายการที่แจ้งซ่อม:</strong>
          <div style="margin-top: 4px; font-size: 14px; color: #475569;">
            ${workOrders.map(w => `• ${w.service.name} (${w.location}) ฿${w.service.price}`).join('<br>')}
          </div>
        </div>

        <!-- เลือกระดับความเร่งด่วนในการนัดหมาย (Urgency SLA) -->
        <strong style="font-size: 17px; color: var(--navy-900);">1. เลือกระดับความเร่งด่วน (Appointment SLA):</strong>
        <div style="margin: 8px 0 18px;">
          <div class="sla-card ${selectedSla === 'normal' ? 'selected' : ''}" data-sla="normal">
            <input type="radio" name="sla" value="normal" ${selectedSla === 'normal' ? 'checked' : ''} style="width: 20px; height: 20px;">
            <div style="flex: 1;">
              <div style="font-size: 17px; font-weight: 700; color: var(--navy-900);">เวลานัดปกติ (08:00 - 17:00 น.)</div>
              <div style="font-size: 14px; color: #059669; font-weight: 700;">ฟรีค่าบริการจัดคิว (0 บาท)</div>
            </div>
          </div>

          <div class="sla-card ${selectedSla === 'urgent' ? 'selected' : ''}" data-sla="urgent">
            <input type="radio" name="sla" value="urgent" ${selectedSla === 'urgent' ? 'checked' : ''} style="width: 20px; height: 20px;">
            <div style="flex: 1;">
              <div style="font-size: 17px; font-weight: 700; color: var(--navy-900);">งานด่วนมาก (ภายใน 24 ชม.)</div>
              <div style="font-size: 14px; color: #d97706; font-weight: 700;">ค่าธรรมเนียมจัดคิวเร่งด่วน (+150 บาท)</div>
            </div>
          </div>

          <div class="sla-card ${selectedSla === 'hotline' ? 'selected' : ''}" data-sla="hotline">
            <input type="radio" name="sla" value="hotline" ${selectedSla === 'hotline' ? 'checked' : ''} style="width: 20px; height: 20px;">
            <div style="flex: 1;">
              <div style="font-size: 17px; font-weight: 700; color: var(--navy-900);">งานด่วนพิเศษ Hotline (ภายใน 12 ชม.)</div>
              <div style="font-size: 14px; color: #dc2626; font-weight: 700;">ค่าธรรมเนียมคิวพิเศษ (+200 บาท)</div>
            </div>
          </div>

          <!-- ข้อกำหนด SLA ตัดรอบ 2 ทุ่ม -->
          <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 10px; font-size: 13px; color: #92400e; margin-top: 6px;">
            ⚠️ <strong>ข้อกำหนดเวลาปฏิบัติงาน:</strong> ช่างปฏิบัติงานไม่เกิน 20:00 น. ตัดรอบรับงานด่วนหลัง 17:00 น. ไปรอบเช้า 08:00 น. วันถัดไป
          </div>
        </div>

        <!-- การเลือกทีมช่าง (Technician Selection) -->
        <strong style="font-size: 17px; color: var(--navy-900);">2. เลือกทีมช่าง:</strong>
        <div style="margin: 8px 0 20px;">
          <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px;">
            <label style="display: flex; align-items: center; gap: 10px; font-size: 16px; margin-bottom: 10px; cursor: pointer;">
              <input type="radio" name="tech_mode" value="auto" ${selectedTechChoice === 'auto' ? 'checked' : ''} style="width: 18px; height: 18px;">
              <span><strong>🤖 ระบบจัดช่างให้อัตโนมัติ (Mali Auto-Assign 5 มิติ)</strong><br><small style="color: #64748b;">(แนะนำ — คัดเลือกช่างคะแนน QC สูงสุดและใกล้บ้านท่านที่สุด)</small></span>
            </label>

            <label style="display: flex; align-items: center; gap: 10px; font-size: 16px; cursor: pointer;">
              <input type="radio" name="tech_mode" value="custom" ${selectedTechChoice !== 'auto' ? 'checked' : ''} style="width: 18px; height: 18px;">
              <span><strong>👤 ลูกค้าเลือกช่างเอง (Customer Choice)</strong></span>
            </label>

            <div id="tech-picker-wrapper" style="margin-top: 10px; display: ${selectedTechChoice !== 'auto' ? 'block' : 'none'};">
              <select id="select-tech-pro" class="form-input select-input" style="width: 100%; font-size: 15px;">
                ${allTechs.map(t => `
                  <option value="${t.id}" ${selectedTechChoice === t.id ? 'selected' : ''}>
                    [${t.id}] ${t.name} (${t.nickname}) — ${t.tradeName} ⭐${t.customerRating} (${t.completedJobs} งาน)
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- ยอดรวมสะสม Frameless -->
        <div class="frameless-price-box">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 18px; font-weight: 700; color: var(--navy-800);">ราคารวมสะสม:</span>
            <span class="grand-total-amount">฿${(itemsTotal + urgencyFee).toLocaleString()}</span>
          </div>
          ${urgencyFee > 0 ? `<div style="font-size: 13px; color: #d97706; margin-top: 2px;">(รวมค่าธรรมเนียมจัดคิวเร่งด่วน +฿${urgencyFee})</div>` : ''}
        </div>

        <!-- ปุ่มก้าวหน้า -->
        <button class="btn-senior-primary" id="btn-goto-step-3">
          <span>ขั้นตอนถัดไป: สรุปรายการ (ขั้นที่ 3/3) ➔</span>
        </button>

        <button class="btn-senior-secondary" id="btn-back-to-step-1">
          ⬅️ ย้อนกลับไปขั้นตอนที่ 1
        </button>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // STEP 3: สรุปรายการแจ้งซ่อม & ยืนยัน (Summary & Confirm)
  // -------------------------------------------------------------
  else if (wizardStep === 3) {
    const chosenTech = selectedTechChoice === 'auto'
      ? 'จัดสรรช่าง Pro อัตโนมัติ (Mali Auto-Assign 5 มิติ)'
      : (allTechs.find(t => t.id === selectedTechChoice)?.name || 'ช่างที่เลือก');

    wizardContent = `
      <div>
        <!-- หัวข้อ Frameless ถอด BOQ และประมาณการออก 100% -->
        <h2 style="font-size: 22px; font-weight: 800; color: var(--navy-900); margin: 0 0 6px 0;">
          สรุปรายการแจ้งซ่อม
        </h2>
        <p style="font-size: 15px; color: #64748b; margin: 0 0 16px 0;">
          ตรวจสอบความถูกต้องก่อนส่งงาน • เงินพักในระบบ PPT Escrow ปลอดภัย 100%
        </p>

        <!-- หมวดหมู่ข้อมูล 3 ส่วนตามพิมพ์เขียว -->
        <div style="background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 16px; margin-bottom: 16px;">
          <!-- ส่วนที่ 1: สถานที่ & เวลานัดหมาย -->
          <div style="font-size: 16px; font-weight: 700; color: #059669; margin-bottom: 6px;">
            1. สถานที่ & นัดหมายช่าง:
          </div>
          <div style="font-size: 15px; color: var(--navy-900); line-height: 1.5;">
            <div>• <strong>ผู้แจ้ง:</strong> ${CUSTOMER_NAME} (${CUSTOMER_PHONE})</div>
            <div>• <strong>ที่อยู่:</strong> ${CUSTOMER_ADDRESS}</div>
            <div>• <strong>ระดับความเร่งด่วน:</strong> ${selectedSla === 'hotline' ? 'ด่วนพิเศษ Hotline (12 ชม.)' : (selectedSla === 'urgent' ? 'ด่วนมาก (24 ชม.)' : 'เวลานัดปกติ')}</div>
            <div>• <strong>ทีมช่างผู้รับผิดชอบ:</strong> ${chosenTech}</div>
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 12px 0;" />

          <!-- ส่วนที่ 2: รายการงานซ่อม & ค่าบริการ -->
          <div style="font-size: 16px; font-weight: 700; color: #059669; margin-bottom: 6px;">
            2. รายการงานซ่อม & ระยะเวลารับประกัน:
          </div>
          <div style="font-size: 15px; color: var(--navy-900);">
            ${workOrders.map((w, i) => `
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <div>
                  <strong>${i + 1}. ${w.service.name}</strong> (${w.location})<br>
                  <span style="font-size: 13px; color: #0284c7;">🛡️ รับประกันงานซ่อม ${w.service.warrantyDays} วันเต็ม</span>
                </div>
                <div style="font-weight: 700;">฿${(w.service.price * w.qty).toLocaleString()}</div>
              </div>
            `).join('')}
            ${urgencyFee > 0 ? `
              <div style="display: flex; justify-content: space-between; color: #d97706; margin-top: 6px;">
                <div>• ค่าธรรมเนียมจัดคิวเร่งด่วน:</div>
                <div style="font-weight: 700;">+฿${urgencyFee}</div>
              </div>
            ` : ''}
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 12px 0;" />

          <!-- ส่วนที่ 3: สิทธิ์คุ้มครองพิเศษ (RakBaan Care Plus) -->
          <div style="font-size: 16px; font-weight: 700; color: #059669; margin-bottom: 6px;">
            3. สิทธิ์คุ้มครองพิเศษ:
          </div>
          <label style="display: flex; align-items: flex-start; gap: 10px; font-size: 15px; cursor: pointer;">
            <input type="checkbox" id="chk-care-plus" ${hasCarePlus ? 'checked' : ''} style="width: 18px; height: 18px; margin-top: 2px;">
            <div>
              <strong>RakBaan Care Plus (+199 บาท)</strong>
              <div style="font-size: 13px; color: #64748b;">
                คุ้มครองความเสียหายต่อทรัพย์สินวงเงินสูงสุด 50,000 บาท ระหว่างช่างปฏิบัติงาน
              </div>
            </div>
          </label>
        </div>

        <!-- ราคารวมสุทธิสุดท้าย (Grand Total) -->
        <div class="frameless-price-box">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 19px; font-weight: 800; color: var(--navy-900);">ราคารวมสุทธิ:</span>
            <span class="grand-total-amount" style="font-size: 32px;">฿${grandTotal.toLocaleString()}</span>
          </div>
          <div style="font-size: 14px; color: #059669; margin-top: 4px; font-weight: 600;">
            🛡️ ระบบพักเงิน PPT Escrow: ท่านจะจ่ายจริงหลังเซ็นตรวจรับงานเท่านั้น
          </div>
        </div>

        <!-- ปุ่มกดส่งงาน ("ส่งข้อมูลแจ้งซ่อม") -->
        <button class="btn-senior-primary" id="btn-submit-repair-order">
          <span>🟢 ยืนยันส่งข้อมูลแจ้งซ่อม ➔</span>
        </button>

        <button class="btn-senior-secondary" id="btn-back-to-step-2">
          ⬅️ ย้อนกลับไปแก้ไขวันเวลา/ช่าง
        </button>
      </div>
    `;
  }

  // Render Wizard Shell with Stepper Header
  container.innerHTML = `
    <div>
      <div class="stepper-header">
        <div class="step-pill ${wizardStep === 1 ? 'active' : ''}">1. เลือกงาน & สั่งงาน</div>
        <div class="step-pill ${wizardStep === 2 ? 'active' : ''}">2. วันเวลา & ช่าง</div>
        <div class="step-pill ${wizardStep === 3 ? 'active' : ''}">3. สรุปรายการ</div>
      </div>

      ${wizardContent}
    </div>
  `;

  // Attach Wizard Step Events
  bindWizardEvents(container);
}

function bindWizardEvents(container) {
  // Step 1 Events
  if (wizardStep === 1) {
    // Mic Button
    const btnMic = document.getElementById('btn-mic-toggle');
    if (btnMic) {
      btnMic.onclick = () => toggleMicListening();
    }

    // Voice Simulations
    const btnSimAir = document.getElementById('sim-voice-air');
    if (btnSimAir) {
      btnSimAir.onclick = () => applyVoiceResult('air_clean', 'ห้องนั่งเล่น/รับแขก');
    }
    const btnSimPipe = document.getElementById('sim-voice-pipe');
    if (btnSimPipe) {
      btnSimPipe.onclick = () => applyVoiceResult('pipe_leak', 'ห้องครัว');
    }
    const btnSimElec = document.getElementById('sim-voice-elec');
    if (btnSimElec) {
      btnSimElec.onclick = () => applyVoiceResult('elec_switch', 'ห้องนอนใหญ่');
    }

    // Service Card Selection
    container.querySelectorAll('.smart-service-card').forEach(card => {
      card.onclick = () => {
        const id = card.getAttribute('data-id');
        const found = CATALOG_SERVICES.find(s => s.id === id);
        if (found) {
          selectedCatalogService = found;
          renderCurrentView();
        }
      };
    });

    // Room Selection
    const roomSelect = document.getElementById('select-room-location');
    if (roomSelect) {
      roomSelect.onchange = (e) => {
        selectedLocation = e.target.value;
      };
    }

    // Add Work Order Button
    const btnAddWo = document.getElementById('btn-add-work-order');
    if (btnAddWo) {
      btnAddWo.onclick = () => {
        workOrders.push({
          id: Date.now(),
          service: selectedCatalogService,
          location: selectedLocation,
          qty: 1,
          tech1: 'สมหมาย',
          tech2: 'เกรียงศักดิ์',
        });
        renderCurrentView();
      };
    }

    // Remove Work Order Buttons
    container.querySelectorAll('.btn-remove-item').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (workOrders.length > 1) {
          workOrders.splice(idx, 1);
          renderCurrentView();
        }
      };
    });

    // Go to Step 2
    const btnGoto2 = document.getElementById('btn-goto-step-2');
    if (btnGoto2) {
      btnGoto2.onclick = () => {
        wizardStep = 2;
        renderCurrentView();
      };
    }
  }

  // Step 2 Events
  else if (wizardStep === 2) {
    // SLA Selection Cards
    container.querySelectorAll('.sla-card').forEach(card => {
      card.onclick = () => {
        selectedSla = card.getAttribute('data-sla');
        renderCurrentView();
      };
    });

    // Tech Mode Radios
    const techRadios = container.querySelectorAll('input[name="tech_mode"]');
    techRadios.forEach(r => {
      r.onchange = () => {
        selectedTechChoice = r.value === 'auto' ? 'auto' : 'RPS-T01';
        renderCurrentView();
      };
    });

    // Tech Picker Dropdown
    const techSelect = document.getElementById('select-tech-pro');
    if (techSelect) {
      techSelect.onchange = (e) => {
        selectedTechChoice = e.target.value;
      };
    }

    // Navigation Buttons
    document.getElementById('btn-back-to-step-1').onclick = () => {
      wizardStep = 1;
      renderCurrentView();
    };
    document.getElementById('btn-goto-step-3').onclick = () => {
      wizardStep = 3;
      renderCurrentView();
    };
  }

  // Step 3 Events
  else if (wizardStep === 3) {
    const chkCare = document.getElementById('chk-care-plus');
    if (chkCare) {
      chkCare.onchange = (e) => {
        hasCarePlus = e.target.checked;
        renderCurrentView();
      };
    }

    document.getElementById('btn-back-to-step-2').onclick = () => {
      wizardStep = 2;
      renderCurrentView();
    };

    document.getElementById('btn-submit-repair-order').onclick = handleSubmitRepairOrder;
  }
}

function toggleMicListening() {
  if (isMicListening) {
    stopMicListening();
  } else {
    startMicListening();
  }
}

function startMicListening() {
  isMicListening = true;
  renderCurrentView();

  // Web Speech API fallback with auto simulation
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'th-TH';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      stopMicListening();
      processSpeechTranscript(transcript);
    };
    recognition.onerror = () => {
      // If error or denied, fallback to simulated response after timer
      fallbackSimulatedSpeech();
    };
    try {
      recognition.start();
    } catch {
      fallbackSimulatedSpeech();
    }
  } else {
    fallbackSimulatedSpeech();
  }
}

function fallbackSimulatedSpeech() {
  if (micTimer) clearTimeout(micTimer);
  micTimer = setTimeout(() => {
    stopMicListening();
    applyVoiceResult('air_clean', 'ห้องนั่งเล่น/รับแขก');
  }, 2500);
}

function stopMicListening() {
  isMicListening = false;
  if (micTimer) clearTimeout(micTimer);
  renderCurrentView();
}

function processSpeechTranscript(text) {
  if (text.includes('แอร์') || text.includes('ไม่เย็น')) {
    applyVoiceResult('air_clean', text.includes('ห้องนอน') ? 'ห้องนอนใหญ่' : 'ห้องนั่งเล่น/รับแขก');
  } else if (text.includes('ท่อ') || text.includes('ก๊อก') || text.includes('น้ำ')) {
    applyVoiceResult('pipe_leak', 'ห้องครัว');
  } else if (text.includes('ไฟ') || text.includes('สวิตช์')) {
    applyVoiceResult('elec_switch', 'ห้องนอนใหญ่');
  } else {
    applyVoiceResult('air_clean', 'ห้องนั่งเล่น/รับแขก');
  }
}

function applyVoiceResult(serviceId, room) {
  const found = CATALOG_SERVICES.find(s => s.id === serviceId);
  if (found) {
    selectedCatalogService = found;
    selectedLocation = room;

    // Update first work order or add new
    if (workOrders.length > 0) {
      workOrders[0].service = found;
      workOrders[0].location = room;
    } else {
      workOrders.push({
        id: Date.now(),
        service: found,
        location: room,
        qty: 1,
        tech1: 'สมหมาย',
        tech2: 'เกรียงศักดิ์',
      });
    }

    alert(`🎤 ได้ยินว่า: "${found.name} ที่ ${room}"\nระบบได้เลือกรายการและห้องให้ท่านเรียบร้อยแล้วค่ะ!`);
    renderCurrentView();
  }
}

async function handleSubmitRepairOrder() {
  const btn = document.getElementById('btn-submit-repair-order');
  btn.disabled = true;
  btn.innerText = '⏳ กำลังบันทึกข้อมูลและส่งเรื่อง...';

  const itemsTotal = workOrders.reduce((sum, item) => sum + (item.service.price * item.qty), 0);
  const urgencyFee = selectedSla === 'hotline' ? 200 : (selectedSla === 'urgent' ? 150 : 0);
  const carePlusFee = hasCarePlus ? 199 : 0;
  const grandTotal = itemsTotal + urgencyFee + carePlusFee;

  const chosenTechId = selectedTechChoice === 'auto' ? null : selectedTechChoice;
  const primaryService = workOrders[0].service;

  try {
    const newJobPayload = {
      customerId: CUSTOMER_ID,
      customerName: CUSTOMER_NAME,
      customerPhone: CUSTOMER_PHONE,
      title: `${primaryService.name} (${workOrders.length > 1 ? `และอีก ${workOrders.length - 1} รายการ` : workOrders[0].location})`,
      category: primaryService.category,
      price: grandTotal,
      status: 'pending_review', // Safe 1-of-5 status
      workflowStep: 1, // Step 1 completed, waiting for Step 2 Ops
      workflowStatus: 'new_booking',
      technicianPreference: selectedTechChoice === 'auto' ? 'auto' : 'custom',
      customerSelectedTech: chosenTechId,
      addressId: 'addr_suthep_cherd',
      addressDetail: CUSTOMER_ADDRESS,
      workOrders: workOrders.map(w => ({
        serviceId: w.service.id,
        serviceName: w.service.name,
        price: w.service.price,
        location: w.location,
        qty: w.qty,
      })),
      urgencySla: selectedSla,
      urgencyFee: urgencyFee,
      carePlus: hasCarePlus,
      scopeOfWork: primaryService.scope,
      warrantyDays: primaryService.warrantyDays,
      escrowStatus: 'held_ppt', // Step 4 Escrow
      createdAt: new Date().toISOString(),
      scheduledDate: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, 'jobs'), newJobPayload);

    // Agent-1 Audit Log: บันทึกร่องรอยการสั่งงาน
    await logAgentActivity({
      agentId: 'agent-1-customer',
      agentName: 'Agent-1: ลูกค้า 👤',
      step: 1,
      stepName: '1. ลูกค้าจ้าง (Customer Books)',
      action: 'SUBMIT_REPAIR_ORDER',
      jobId: docRef.id,
      status: 'success',
      details: {
        title: newJobPayload.title,
        grandTotal: grandTotal,
        urgencySla: selectedSla,
        selectedTech: selectedTechChoice,
        carePlus: hasCarePlus,
      },
    });

    alert(`🎉 แจ้งซ่อมบ้านสำเร็จแล้วค่ะ!\nรหัสงาน: ${docRef.id.slice(0, 8).toUpperCase()}\nระบบกำลังเชื่อมต่อไปยังส่วนกลาง (เราเห็น)`);

    // Switch to Tracking Tab
    activeNav = 'tracking';
    updateNavButtons();
    renderCurrentView();
  } catch (err) {
    alert(`เกิดข้อผิดพลาด: ${err.message}`);
    btn.disabled = false;
    btn.innerText = '🟢 ยืนยันส่งข้อมูลแจ้งซ่อม ➔';
  }
}

// =============================================================================
// SCREEN 03: JOB TRACKING & STEP 10 INSPECTION GATE
// =============================================================================
function renderTrackingScreen(container) {
  if (allMyJobs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 10px;">
        <div style="font-size: 56px; margin-bottom: 12px;">🏡</div>
        <h3 style="font-size: 20px; font-weight: 700; color: var(--navy-900); margin: 0 0 6px 0;">ยังไม่มีประวัติการแจ้งซ่อม</h3>
        <p style="font-size: 16px; color: #64748b;">
          ท่านสามารถกดปุ่ม "แจ้งซ่อม 3 ขั้น" ด้านบนเพื่อเริ่มแจ้งซ่อมได้ทันทีค่ะ
        </p>
        <button class="btn-senior-primary" id="btn-tracking-start-booking" style="margin-top: 16px;">
          🟢 เริ่มต้นแจ้งซ่อมบ้าน
        </button>
      </div>
    `;
    const btn = document.getElementById('btn-tracking-start-booking');
    if (btn) {
      btn.onclick = () => {
        activeNav = 'book';
        wizardStep = 1;
        updateNavButtons();
        renderCurrentView();
      };
    }
    return;
  }

  container.innerHTML = `
    <div>
      <h2 style="font-size: 20px; font-weight: 800; color: var(--navy-900); margin: 0 0 6px 0;">
        📍 ติดตามสถานะงานซ่อม (${allMyJobs.length} รายการ)
      </h2>
      <p style="font-size: 15px; color: #64748b; margin: 0 0 16px 0;">
        แสดงผลแบบ Realtime 10 สเต็ป • เงินพักในระบบ PPT Escrow ปลอดภัย 100%
      </p>

      <div style="display: flex; flex-direction: column; gap: 16px;">
        ${allMyJobs.map(job => renderJobTrackingCard(job)).join('')}
      </div>
    </div>
  `;

  // Attach Step 10 Accept / Reject Buttons
  allMyJobs.forEach(job => {
    const btnAccept = document.getElementById(`btn-cust-accept-${job.id}`);
    if (btnAccept) {
      btnAccept.onclick = () => handleCustomerAcceptJob(job);
    }
    const btnReject = document.getElementById(`btn-cust-reject-${job.id}`);
    if (btnReject) {
      btnReject.onclick = () => handleCustomerRejectJob(job);
    }
  });
}

function renderJobTrackingCard(job) {
  const isCompleted = job.status === 'completed';
  const isRework = job.workflowStatus === 'rework_needed';
  const isSubmittedForReview = job.workflowStatus === 'tech_submitted';
  const isCustomerReview = job.workflowStatus === 'customer_review';
  const stepNum = calculateStepNumber(job.status);
  const warrantyDays = job.warranty?.days || job.warrantyDays || 90;

  return `
    <div style="background: #ffffff; border: 2px solid ${isCustomerReview ? '#38bdf8' : (isCompleted ? '#86efac' : '#e2e8f0')}; border-radius: 16px; padding: 18px; box-shadow: 0 4px 14px rgba(0,0,0,0.05);">
      <!-- Card Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <span style="font-family: monospace; font-size: 13px; color: #64748b;">รหัสงาน: ${job.id.slice(0, 8).toUpperCase()}</span>
        <span class="badge" style="background: ${isCompleted ? '#dcfce7' : (isRework ? '#fee2e2' : '#e0f2fe')}; color: ${isCompleted ? '#15803d' : (isRework ? '#991b1b' : '#0369a1')}; font-size: 13px; padding: 4px 10px; font-weight: 700;">
          ${isCompleted ? '✓ 10. งานเสร็จสิ้น & รับประกันดิจิทัล' : (isRework ? '⚠️ วนกลับข้อ 6: นัดแก้ไข' : (isCustomerReview ? '🎯 10. รอท่านตรวจรับงาน' : 'กำลังดำเนินการ'))}
        </span>
      </div>

      <!-- Title & Price -->
      <div style="font-size: 19px; font-weight: 700; color: var(--navy-900); margin-bottom: 4px;">
        ${escapeHtml(job.title || 'งานซ่อมบำรุง')}
      </div>
      <div style="font-size: 18px; font-weight: 800; color: #059669; margin-bottom: 12px;">
        ราคารวมสุทธิ: ฿${(job.price || 0).toLocaleString()}
      </div>

      <!-- Step Light Bar -->
      <div class="step-light-bar" style="margin: 6px 0 14px;">
        <div class="step-node ${stepNum === 1 ? 'active' : (stepNum > 1 ? 'passed' : '')}">
          <div class="step-circle">${stepNum > 1 ? '✓' : '1'}</div>
          <span>รับเรื่อง</span>
        </div>
        <div class="step-line ${stepNum > 1 ? 'passed' : ''}"></div>
        <div class="step-node ${stepNum === 2 ? 'active' : (stepNum > 2 ? 'passed' : '')}">
          <div class="step-circle">${stepNum > 2 ? '✓' : '2'}</div>
          <span>ช่างเดินทาง</span>
        </div>
        <div class="step-line ${stepNum > 2 ? 'passed' : ''}"></div>
        <div class="step-node ${stepNum === 3 ? 'active' : (stepNum > 3 ? 'passed' : '')}">
          <div class="step-circle">${stepNum > 3 ? '✓' : '3'}</div>
          <span>กำลังทำ</span>
        </div>
        <div class="step-line ${stepNum > 3 ? 'passed' : ''}"></div>
        <div class="step-node ${stepNum === 4 ? 'active' : ''}">
          <div class="step-circle">4</div>
          <span>เสร็จสิ้น</span>
        </div>
      </div>

      <!-- Step 4 Escrow Notice -->
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 10px 12px; font-size: 14px; color: #166534; margin-bottom: 12px;">
        <strong>🛡️ สถานะเงินของท่าน (ขั้นตอนที่ 4):</strong> พักเงินในระบบ PPT Escrow
        <div style="font-size: 13px; color: #15803d; margin-top: 2px;">
          เงินของท่านปลอดภัย 100% — ช่างจะยังไม่ได้รับเงินจนกว่าท่านจะตรวจรับงานเรียบร้อย
        </div>
      </div>

      <!-- Assigned Technician Info -->
      <div style="background: #f8fafc; border-radius: 10px; padding: 10px 14px; font-size: 15px; margin-bottom: 12px; color: #334155;">
        <span>👷 ช่างผู้ดูแล: <strong>${escapeHtml(job.assignedTechName || job.assignedTeamId || 'กำลังจัดสรรช่าง Pro')}</strong></span>
        ${job.assignedTechPhone ? `<span style="margin-left: 8px;">📞 ${job.assignedTechPhone}</span>` : ''}
      </div>

      <!-- STEP 10: CUSTOMER INSPECTION & APPROVAL GATE -->
      ${(isCustomerReview || (isSubmittedForReview && job.afterPhotos)) ? `
        <div style="background: #f0fdf4; border: 2px solid #86efac; border-radius: 14px; padding: 16px; margin-top: 12px;">
          <div style="font-size: 18px; font-weight: 800; color: #065f46; margin-bottom: 6px;">
            🎯 ขั้นตอนที่ 10: ช่างส่งงานแล้ว ขอเชิญท่านตรวจรับงาน
          </div>
          <p style="font-size: 15px; color: #15803d; margin: 0 0 12px 0;">
            กรุณาตรวจดูรูปผลงานก่อนและหลังทำด้านล่างนี้ หากเรียบร้อยกดรับงานเพื่อเริ่มนับประกันดิจิทัลค่ะ
          </p>

          <!-- Before / After Photo Display -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
            <div style="background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; text-align: center;">
              <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 4px;">📷 ก่อนทำ (Before)</div>
              ${(job.beforePhotos && job.beforePhotos.length > 0) ? `
                <img src="${job.beforePhotos[0]}" style="width: 100%; height: 110px; object-fit: cover; border-radius: 6px;" alt="Before">
              ` : '<div style="font-size: 13px; color: #94a3b8; padding: 30px 0;">ไม่มีรูป</div>'}
            </div>

            <div style="background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; text-align: center;">
              <div style="font-size: 13px; font-weight: 700; color: #059669; margin-bottom: 4px;">📷 หลังทำ (After)</div>
              ${(job.afterPhotos && job.afterPhotos.length > 0) ? `
                <img src="${job.afterPhotos[0]}" style="width: 100%; height: 110px; object-fit: cover; border-radius: 6px;" alt="After">
              ` : '<div style="font-size: 13px; color: #94a3b8; padding: 30px 0;">ไม่มีรูป</div>'}
            </div>
          </div>

          <!-- Decision Buttons -->
          <button class="btn-senior-primary" id="btn-cust-accept-${job.id}" style="font-size: 18px; padding: 14px;">
            🎉 ตรวจรับงานเรียบร้อย (เริ่มนับประกันดิจิทัล)
          </button>

          <button class="btn-senior-secondary" id="btn-cust-reject-${job.id}" style="background: #fee2e2; color: #991b1b; border-color: #fca5a5; font-size: 16px;">
            ⚠️ ยังมีจุดบกพร่อง / ขอให้แก้ไข (วนกลับข้อ 6)
          </button>
        </div>
      ` : ''}

      <!-- COMPLETED DIGITAL WARRANTY BADGE -->
      ${isCompleted ? `
        <div style="background: #ecfdf5; border: 2px solid #10b981; border-radius: 12px; padding: 14px; margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 16px; font-weight: 800; color: #065f46;">🛡️ บัตรรับประกันดิจิทัล (Digital Warranty)</span>
            <span class="badge" style="background: #10b981; color: #fff; font-size: 12px;">Active</span>
          </div>
          <div style="font-size: 15px; color: #047857; line-height: 1.5;">
            <div>• รับประกันงานซ่อม: <strong>${warrantyDays} วันเต็ม</strong></div>
            <div>• สิ้นสุดความคุ้มครอง: <strong>${job.warranty?.endDate ? new Date(job.warranty.endDate).toLocaleDateString('th-TH') : '90 วันนับจากวันจบงาน'}</strong></div>
            <div>• หากเกิดปัญหาเดิมในระยะประกัน ช่างและ PPT เข้าแก้ไขฟรี 100%</div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function handleCustomerAcceptJob(job) {
  const warrantyDays = job.warrantyDays || 90;
  const now = new Date();
  const end = new Date();
  end.setDate(now.getDate() + warrantyDays);

  try {
    await updateDoc(doc(db, 'jobs', job.id), {
      status: 'completed', // Safe 1-of-5 status
      workflowStep: 10,
      workflowStatus: 'completed',
      customerAcceptedAt: now.toISOString(),
      payoutStatus: 'unlocked',
      warranty: {
        days: warrantyDays,
        startDate: now.toISOString(),
        endDate: end.toISOString(),
        status: 'active',
      },
    });

    // Agent-1 Audit Log: ลูกค้าตรวจรับงานสมบูรณ์
    await logAgentActivity({
      agentId: 'agent-1-customer',
      agentName: 'Agent-1: ลูกค้า 👤',
      step: 10,
      stepName: '10. ลูกค้ารับงาน/ประกัน (Customer Accepts)',
      action: 'CUSTOMER_ACCEPT_JOB',
      jobId: job.id,
      status: 'success',
      details: {
        warrantyDays,
        payoutUnlocked: true,
      },
    });

    alert(`🎉 ขอบพระคุณค่ะ!\nท่านได้ตรวจรับงานเรียบร้อยแล้ว\nความคุ้มครองรับประกันดิจิทัล ${warrantyDays} วัน เริ่มต้นนับแล้วค่ะ`);
  } catch (err) {
    alert(`เกิดข้อผิดพลาด: ${err.message}`);
  }
}

async function handleCustomerRejectJob(job) {
  const reason = prompt('กรุณาระบุสิ่งที่ท่านต้องการให้ช่างแก้ไขเพิ่มเติมหน้างานค่ะ:');
  if (!reason) return;

  try {
    await updateDoc(doc(db, 'jobs', job.id), {
      status: 'in_progress', // Safe 1-of-5 status
      workflowStep: 6, // Loopback to Step 6 per Cherd's Law
      workflowStatus: 'rework_needed',
      accountability: {
        penalizedInspector: job.qcInspector || 'ทีมตรวจ PPT',
        penalizedTechnician: job.assignedTeamId || 'ช่างผู้ปฏิบัติงาน',
        rejectionReason: reason,
        rejectedAt: new Date().toISOString(),
        penaltyFlag: true,
      },
    });

    // Agent-1 Audit Log: ลูกค้าไม่รับงาน & สั่งแก้ไขหน้างาน (วนกลับข้อ 6 พร้อม Accountability Flag)
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
        penalizedInspector: job.qcInspector || 'ทีมตรวจ PPT',
        penalizedTechnician: job.assignedTeamId || 'ช่างผู้ปฏิบัติงาน',
      },
    });

    alert(`⚠️ รับเรื่องแก้ไขเรียบร้อยแล้วค่ะ!\nระบบได้ส่งเรื่องกลับไปยังขั้นตอนที่ 6 (เราประสานงาน) เพื่อตรวจสอบและส่งช่างเข้าแก้ไขให้ท่านโดยด่วนค่ะ`);
  } catch (err) {
    alert(`เกิดข้อผิดพลาด: ${err.message}`);
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
