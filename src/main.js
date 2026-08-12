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
  { value: 'pending_review', label: 'รอรับเรื่อง', badge: 'pending', action: 'มอบหมายช่าง' },
  { value: 'assigned', label: 'มอบหมายช่างแล้ว', badge: '', action: 'เริ่มเดินทาง' },
  { value: 'traveling', label: 'กำลังเดินทาง', badge: '', action: 'เริ่มซ่อม' },
  { value: 'in_progress', label: 'กำลังซ่อม', badge: '', action: 'งานเสร็จสิ้น' },
  { value: 'completed', label: 'เสร็จสิ้น', badge: 'done', action: null },
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
  // this session started (see that script's own comment) shows up without
  // requiring a full sign-out first -- getIdTokenResult(user, true) still
  // needs a *new* ID token from Google, so this only helps after the token
  // has actually been reissued server-side; a stubborn stale claim still
  // means "sign out, sign in again".
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
    <h1>รักบ้าน@CNX — Ops (เดินงาน)</h1>
    <div class="card">
      <input id="email" type="email" placeholder="อีเมล" autocomplete="username" />
      <input id="password" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" />
      <p class="error" id="error"></p>
      <div class="row">
        <button class="primary" id="signin">เข้าสู่ระบบ</button>
        <button class="secondary" id="signup">สร้างบัญชี staff ใหม่</button>
      </div>
    </div>
    <p class="meta">
      บัญชีใหม่ยังไม่มีสิทธิ์ staff จนกว่าจะรัน <code>scripts/grant-staff-role.js</code>
      ให้ก่อน (ดู README) — สร้างบัญชีที่นี่ได้ก่อน แล้วไปรัน script ทีหลัง
    </p>
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
    <h1>รักบ้าน@CNX — Ops (เดินงาน)</h1>
    <div class="notice">
      บัญชี <strong>${user.email}</strong> ยังไม่มีสิทธิ์ staff (role ปัจจุบัน: <code>${role}</code>).<br />
      ให้ผู้ดูแลระบบรัน:<br />
      <code>node scripts/grant-staff-role.js ${user.email}</code><br />
      แล้วกด "ออกจากระบบ" ด้านล่าง แล้ว "เข้าสู่ระบบ" ใหม่อีกครั้ง (custom claim จะติดกับ ID token ใหม่เท่านั้น)
    </div>
    <button class="secondary" id="signout">ออกจากระบบ</button>
  `;
  document.getElementById('signout').onclick = () => signOut(auth);
}

function renderDashboard(user, role) {
  app.innerHTML = `
    <div class="topbar">
      <h1>แดชบอร์ดงาน (เล็ก+ใหญ่)</h1>
      <div>
        <span class="meta">${user.email} · ${role}</span>
        <button class="link" id="signout">ออกจากระบบ</button>
      </div>
    </div>
    <div id="kpis"></div>
    <div id="jobs"><p class="meta">กำลังโหลด...</p></div>
  `;
  document.getElementById('signout').onclick = () => signOut(auth);

  // ไม่กรอง status ออกแล้ว -- แดชบอร์ดนี้ต้องเห็นงานทุกสถานะ (รวม completed)
  // ต่างจาก MVP รอบแรกที่โชว์แค่ "งานที่ต้องเดิน" (pending_review ถึง in_progress)
  const jobsQuery = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(50));
  unsubscribeJobs = onSnapshot(jobsQuery, (snapshot) => {
    // recordStatus<=3 mirrors firestore.rules canRead() for isTeamOrAdmin()
    // -- 4/5 (staff-deleted/purged) stay hidden from this dashboard on purpose.
    const jobs = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((j) => (j.recordStatus ?? 0) <= 3);
    renderKpis(jobs);
    renderJobs(jobs);
  }, (err) => {
    document.getElementById('jobs').innerHTML = `<p class="error">โหลดงานไม่สำเร็จ: ${err.message}</p>`;
  });
}

function renderKpis(jobs) {
  const active = jobs.filter((j) => j.status !== 'completed');
  const repairCount = jobs.filter((j) => (j.jobType || 'repair') === 'repair').length;
  const constructionCount = jobs.filter((j) => j.jobType === 'construction').length;
  const tiles = [
    { label: 'งานทั้งหมด', value: jobs.length },
    { label: 'กำลังดำเนินการ', value: active.length },
    { label: 'เสร็จสิ้น', value: jobs.length - active.length },
    { label: 'งานเล็ก (ซ่อม)', value: repairCount },
    { label: 'งานใหญ่ (ก่อสร้าง)', value: constructionCount },
  ];
  document.getElementById('kpis').innerHTML = `
    <div class="kpi-row">
      ${tiles.map((t) => `<div class="kpi-tile"><div class="kpi-value">${t.value}</div><div class="kpi-label">${t.label}</div></div>`).join('')}
    </div>
  `;
}

async function renderJobs(jobs) {
  const container = document.getElementById('jobs');
  if (jobs.length === 0) {
    container.innerHTML = '<p class="meta">ยังไม่มีงานในระบบ</p>';
    return;
  }
  container.innerHTML = jobs.map((j) => jobCardHtml(j)).join('');

  for (const j of jobs) {
    const addressEl = document.getElementById(`address-${j.id}`);
    if (addressEl) {
      addressEl.textContent = j.addressId ? await resolveAddress(j.addressId) : '(ไม่มีที่อยู่)';
    }
    if (j.jobType === 'construction') {
      const el = document.getElementById(`milestones-${j.id}`);
      if (el) el.innerHTML = await resolveMilestoneProgress(j.id);
    }
    const step = STATUS_STEPS.find((s) => s.value === j.status);
    const btn = document.getElementById(`advance-${j.id}`);
    if (btn && step?.action) {
      btn.onclick = () => advanceJob(j, step);
    }
  }
}

function jobCardHtml(job) {
  const category = CATEGORIES[job.category] || { name: job.category, icon: '🔧' };
  const step = STATUS_STEPS.find((s) => s.value === job.status) || STATUS_STEPS[0];
  const jobType = JOB_TYPE_LABELS[job.jobType] || JOB_TYPE_LABELS.repair;
  return `
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: baseline;">
        <strong>${category.icon} ${category.name}</strong>
        <span class="badge ${step.badge}">${step.label}</span>
      </div>
      <span class="badge jobtype-${jobType.className}">${jobType.label}</span>
      <p class="meta">งาน: ${job.id}</p>
      <p class="meta">รายละเอียด: ${job.title || '-'}</p>
      <p class="meta">ที่อยู่: <span id="address-${job.id}">กำลังโหลด...</span></p>
      <p class="meta">ลูกค้า: ${job.customerId?.slice(0, 10) || '-'}</p>
      <p class="meta">ช่าง: ${job.assignedTeamId || 'ยังไม่มอบหมาย'}</p>
      ${job.jobType === 'construction' ? `<div id="milestones-${job.id}" class="meta">กำลังโหลดงวดงาน...</div>` : ''}
      ${
        step.value === 'pending_review'
          ? `<div class="row">
              <input id="tech-${job.id}" placeholder="ชื่อช่างที่จะมอบหมาย" style="margin-bottom:0;" />
              <button class="primary" id="advance-${job.id}">${step.action}</button>
            </div>`
          : step.action
            ? `<button class="primary" id="advance-${job.id}">${step.action}</button>`
            : ''
      }
    </div>
  `;
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

// งวดงานตาม rakbaan_md/12-database-structure-front-end.md §2.14 --
// jobs/{jobId}/milestones/{milestoneId}, status ใน ['pending','in_progress','completed','approved','paid'].
// ยังไม่มี UI ให้ staff สร้าง/แก้งวดงานเลย (ต้องเพิ่มทีหลัง) -- ตอนนี้แค่ "อ่านแสดง"
// ถ้ามีข้อมูลอยู่แล้ว (เช่น เพิ่มตรงผ่าน Firebase Console)
async function resolveMilestoneProgress(jobId) {
  try {
    const snap = await getDocs(collection(db, 'jobs', jobId, 'milestones'));
    const milestones = snap.docs
      .map((d) => d.data())
      .filter((m) => (m.recordStatus ?? 0) <= 3);
    if (milestones.length === 0) return 'งวดงาน: ยังไม่มีการแบ่งงวด';

    const doneStatuses = ['completed', 'approved', 'paid'];
    const totalAmount = milestones.reduce((sum, m) => sum + (m.amount || 0), 0);
    const doneAmount = milestones
      .filter((m) => doneStatuses.includes(m.status))
      .reduce((sum, m) => sum + (m.amount || 0), 0);
    const donePercent = totalAmount > 0 ? Math.round((doneAmount / totalAmount) * 100) : 0;
    const doneCount = milestones.filter((m) => doneStatuses.includes(m.status)).length;

    return `งวดงาน: ${doneCount}/${milestones.length} งวด (${donePercent}% ของมูลค่ารวม ${totalAmount.toLocaleString()}฿)`;
  } catch {
    return 'งวดงาน: อ่านไม่ได้';
  }
}

async function advanceJob(job, step) {
  const updates = {};
  if (step.value === 'pending_review') {
    const input = document.getElementById(`tech-${job.id}`);
    const technician = input?.value.trim();
    if (!technician) {
      input?.focus();
      return;
    }
    updates.assignedTeamId = technician;
    updates.status = 'assigned';
  } else {
    updates.status = STATUS_STEPS[STATUS_STEPS.findIndex((s) => s.value === step.value) + 1].value;
  }
  try {
    await updateDoc(doc(db, 'jobs', job.id), updates);
  } catch (e) {
    window.alert(`อัปเดตไม่สำเร็จ: ${e.message}`);
  }
}
