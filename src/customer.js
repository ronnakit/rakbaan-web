/**
 * รักบ้าน@CNX — Customer Mobile Web Simulator Controller
 * หน้าจอฝั่งลูกค้าเจ้าของบ้าน (Senior-First & Frameless Clean UI)
 * รองรับขั้นตอนที่ 1 (จ้างงาน), ขั้นตอนที่ 4 (พักเงิน), และขั้นตอนที่ 10 (ตรวจรับงาน/ประกัน หรือขอแก้ไข)
 */

import { db } from './firebase.js';
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

const CUSTOMER_ID = 'customer_cherd';
const CUSTOMER_NAME = 'คุณเชิดศักดิ์ (เจ้าของบ้าน)';
const CUSTOMER_ADDRESS = '88/12 ถ.สุเทพ ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200';

// Senior-First Service Presets (ภาษาง่าย ปลอดศัพท์ช่าง)
const PRESET_SERVICES = [
  {
    id: 'air_clean_wall',
    category: 'air_con',
    name: 'ล้างแอร์ทั่วไป (ติดผนัง)',
    subtitle: 'ล้างคอยล์เย็น คอยล์ร้อน เช็คระบบความเย็น',
    price: 650,
    unit: 'เครื่อง',
    scope: ['ล้างแผงคอยล์เย็นด้วยโฟมฆ่าเชื้อ', 'ล้างคอยล์ร้อนนอกบ้าน', 'เป่าท่อน้ำทิ้งป้องกันน้ำรั่ว', 'ตรวจเช็คแรงดันน้ำยาแอร์'],
    warrantyDays: 90,
  },
  {
    id: 'plumb_pipe_leak',
    category: 'plumbing',
    name: 'ซ่อมท่อประปารั่วซึม / ก๊อกน้ำหัก',
    subtitle: 'ตรวจหาจุดรั่ว ซ่อมเปลี่ยนข้อต่อ อุปกรณ์มาตรฐาน',
    price: 550,
    unit: 'จุด',
    scope: ['สกัดตรวจจุดท่อแตกรั่ว', 'เปลี่ยนท่อ PVC และข้อต่อหนา', 'ทดสอบแรงดันน้ำหลังซ่อม', 'รับประกันรอยต่อน้ำไม่รั่วซึม'],
    warrantyDays: 90,
  },
  {
    id: 'elec_switch_replace',
    category: 'electrical',
    name: 'ซ่อมสวิตช์ไฟ / เต้ารับ / เช็คไฟช็อต',
    subtitle: 'ตรวจเช็คความปลอดภัย เปลี่ยนอุปกรณ์มาตรฐาน มอก.',
    price: 500,
    unit: 'จุด',
    scope: ['ตรวจเช็คแรงดันและความปลอดภัย', 'เปลี่ยนสวิตช์/เต้ารับมาตรฐาน', 'ตรวจสายดินป้องกันไฟรั่ว', 'ทำความสะอาดหน้างานเรียบร้อย'],
    warrantyDays: 90,
  },
  {
    id: 'roof_leak_repair',
    category: 'roof_structure',
    name: 'ซ่อมหลังคารั่วซึม / รางน้ำชำรุด',
    subtitle: 'อุดรอยรั่ว เปลี่ยนกระเบื้องแตก แผ่นกันซึม',
    price: 1200,
    unit: 'จุด',
    scope: ['ตรวจจุดรั่วบนหลังคา', 'ทาน้ำยากันซึมคุณภาพสูง', 'เปลี่ยนกระเบื้อง/รางน้ำตรงสเปก', 'รับประกันยาวนาน 180 วัน'],
    warrantyDays: 180,
  },
];

let currentTab = 'book'; // 'book' or 'myjobs'
let selectedService = PRESET_SERVICES[0];
let selectedTechPreference = 'ai'; // 'ai' or specific tech ID
let allMyJobs = [];
let unsubscribe = null;

initCustomerApp();

function initCustomerApp() {
  // Tab Switchers
  const navBook = document.getElementById('nav-book');
  const navMyJobs = document.getElementById('nav-myjobs');

  navBook.onclick = () => {
    currentTab = 'book';
    navBook.classList.add('active');
    navMyJobs.classList.remove('active');
    renderBookScreen();
  };

  navMyJobs.onclick = () => {
    currentTab = 'myjobs';
    navMyJobs.classList.add('active');
    navBook.classList.remove('active');
    renderMyJobsScreen();
  };

  // Start real-time listener for customer jobs
  startListeningJobs();
  renderBookScreen();
}

function startListeningJobs() {
  if (unsubscribe) unsubscribe();

  const q = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(50));
  unsubscribe = onSnapshot(q, (snapshot) => {
    allMyJobs = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(j => j.customerId === CUSTOMER_ID || !j.customerId || j.customerId.includes('cherd'));

    if (currentTab === 'myjobs') {
      renderMyJobsScreen();
    }
  });
}

function renderBookScreen() {
  const container = document.getElementById('customer-app');
  if (!container) return;

  const allTechs = getTechnicians();

  container.innerHTML = `
    <div>
      <h2 class="senior-title">🛠️ เลือกงานที่ต้องการให้ช่างดูแล</h2>
      <p style="font-size: 16px; color: #475569; margin: 0 0 16px 0;">
        ราคามาตรฐานคงที่ รวมค่าแรงและอุปกรณ์ • ปลอดภัยด้วยช่าง Pro คัดกรอง 100%
      </p>

      <!-- Service Selection Cards -->
      <div style="margin-bottom: 20px;">
        ${PRESET_SERVICES.map(srv => `
          <div class="service-card-senior ${selectedService.id === srv.id ? 'selected' : ''}" data-id="${srv.id}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div class="service-name-senior">${srv.name}</div>
                <div style="font-size: 15px; color: #64748b; margin-bottom: 8px;">${srv.subtitle}</div>
              </div>
              <div class="service-price-senior">฿${srv.price.toLocaleString()}</div>
            </div>
            
            <!-- Scope of Work with green checkmarks -->
            <div style="background: #fff; padding: 10px 12px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 14px; color: #334155;">
              <strong style="color: #059669;">สิ่งที่ท่านจะได้รับ:</strong>
              <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                ${srv.scope.map(s => `<div>✓ ${s}</div>`).join('')}
              </div>
              <div style="margin-top: 6px; font-weight: 600; color: #0284c7; font-size: 13px;">
                🛡️ รับประกันงานซ่อม ${srv.warrantyDays} วันเต็ม
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Address Card -->
      <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 16px; margin-bottom: 18px;">
        <div style="font-size: 16px; font-weight: 700; color: #065f46; margin-bottom: 6px;">📍 สถานที่นัดหมายช่าง:</div>
        <div style="font-size: 17px; font-weight: 600; color: #0f172a;">${CUSTOMER_NAME}</div>
        <div style="font-size: 15px; color: #475569; line-height: 1.4; margin-top: 2px;">${CUSTOMER_ADDRESS}</div>
      </div>

      <!-- Technician Preference (Rule of Cherd) -->
      <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 16px; margin-bottom: 24px;">
        <div style="font-size: 16px; font-weight: 700; color: #065f46; margin-bottom: 8px;">👷‍♂️ ความประสงค์เรื่องช่าง:</div>
        
        <label style="display: flex; align-items: center; gap: 10px; font-size: 16px; margin-bottom: 10px; cursor: pointer;">
          <input type="radio" name="tech_pref" value="ai" ${selectedTechPreference === 'ai' ? 'checked' : ''} style="width: 18px; height: 18px;">
          <span><strong>🤖 ให้ระบบ AI คัดสรรช่างที่เหมาะที่สุด</strong> (แนะนำ — รวดเร็วและคะแนนสูงสุด)</span>
        </label>

        <label style="display: flex; align-items: center; gap: 10px; font-size: 16px; cursor: pointer;">
          <input type="radio" name="tech_pref" value="custom" ${selectedTechPreference !== 'ai' ? 'checked' : ''} style="width: 18px; height: 18px;">
          <span>👤 ข้าพเจ้าต้องการเลือกช่างด้วยตนเอง</span>
        </label>

        <div id="tech-select-box" style="margin-top: 10px; display: ${selectedTechPreference !== 'ai' ? 'block' : 'none'};">
          <select id="cust-tech-picker" class="form-input select-input" style="font-size: 15px; width: 100%;">
            ${allTechs.map(t => `
              <option value="${t.id}">[${t.id}] ${t.name} (${t.nickname}) — ${t.tradeName} ⭐${t.customerRating}</option>
            `).join('')}
          </select>
        </div>
      </div>

      <!-- Summary & Order Button (Zero Formula Display) -->
      <div style="background: #ecfdf5; border: 2px solid #a7f3d0; border-radius: 14px; padding: 16px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 17px; color: #065f46;">ราคารวมสุทธิ:</span>
          <span style="font-size: 26px; font-weight: 800; color: #059669;">฿${selectedService.price.toLocaleString()}</span>
        </div>
        <div style="font-size: 13px; color: #047857; margin-top: 4px;">
          ✓ รวมค่าแรงช่าง • รวมอะไหล่มาตรฐาน • ไม่มีค่าใช้จ่ายแอบแฝง
        </div>
      </div>

      <button class="btn-senior-primary" id="btn-submit-booking">
        <span>🟢 ยืนยันแจ้งซ่อมบ้าน (ขั้นตอนที่ 1)</span>
      </button>
    </div>
  `;

  // Attach card clicks
  container.querySelectorAll('.service-card-senior').forEach(card => {
    card.onclick = () => {
      const id = card.getAttribute('data-id');
      const found = PRESET_SERVICES.find(s => s.id === id);
      if (found) {
        selectedService = found;
        renderBookScreen();
      }
    };
  });

  // Attach radio clicks
  const radios = container.querySelectorAll('input[name="tech_pref"]');
  radios.forEach(r => {
    r.onchange = () => {
      selectedTechPreference = r.value;
      const box = document.getElementById('tech-select-box');
      if (box) box.style.display = r.value === 'custom' ? 'block' : 'none';
    };
  });

  // Submit button
  document.getElementById('btn-submit-booking').onclick = handleCreateBooking;
}

async function handleCreateBooking() {
  const btn = document.getElementById('btn-submit-booking');
  btn.disabled = true;
  btn.innerText = '⏳ กำลังส่งเรื่อง...';

  const chosenTechId = selectedTechPreference === 'custom'
    ? (document.getElementById('cust-tech-picker')?.value || 'RPS-T01')
    : null;

  try {
    const newJobPayload = {
      customerId: CUSTOMER_ID,
      customerName: CUSTOMER_NAME,
      title: `${selectedService.name} — ${selectedService.subtitle}`,
      category: selectedService.category,
      price: selectedService.price,
      status: 'pending_review', // Safe 1-of-5 status
      workflowStep: 1, // Step 1: ลูกค้าจ้าง
      workflowStatus: 'new_booking',
      technicianPreference: selectedTechPreference,
      customerSelectedTech: chosenTechId,
      addressId: 'addr_suthep_cherd',
      addressDetail: CUSTOMER_ADDRESS,
      scheduledDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      scopeOfWork: selectedService.scope,
      warrantyDays: selectedService.warrantyDays,
      escrowStatus: 'held_ppt', // Step 4 Escrow
    };

    const docRef = await addDoc(collection(db, 'jobs'), newJobPayload);
    alert(`🎉 แจ้งซ่อมบ้านสำเร็จแล้วค่ะ!\nรหัสงาน: ${docRef.id.slice(0, 8).toUpperCase()}\nระบบกำลังเชื่อมต่อไปยังส่วนกลาง (เราเห็น)`);
    
    // Switch to my jobs tab to view status
    currentTab = 'myjobs';
    document.getElementById('nav-book').classList.remove('active');
    document.getElementById('nav-myjobs').classList.add('active');
    renderMyJobsScreen();
  } catch (err) {
    alert(`เกิดข้อผิดพลาด: ${err.message}`);
    btn.disabled = false;
    btn.innerText = '🟢 ยืนยันแจ้งซ่อมบ้าน (ขั้นตอนที่ 1)';
  }
}

function renderMyJobsScreen() {
  const container = document.getElementById('customer-app');
  if (!container) return;

  if (allMyJobs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 10px;">
        <div style="font-size: 50px; margin-bottom: 12px;">🏡</div>
        <h3 class="senior-title">ยังไม่มีรายการแจ้งซ่อม</h3>
        <p class="senior-text" style="color: #64748b;">ท่านสามารถกดปุ่ม "แจ้งซ่อมใหม่" ด้านล่างเพื่อเริ่มแจ้งซ่อมได้ทันทีค่ะ</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div>
      <h2 class="senior-title">📋 ติดตามสถานะงานซ่อมของท่าน</h2>
      <p style="font-size: 15px; color: #475569; margin: 0 0 16px 0;">
        แสดงผลแบบเรียลไทม์ 10 สเต็ป • ปลอดภัยด้วยระบบพักเงินบริษัทเพียบพร้อมทำ
      </p>

      <div style="display: flex; flex-direction: column; gap: 16px;">
        ${allMyJobs.map(job => renderCustomerJobCard(job)).join('')}
      </div>
    </div>
  `;

  // Attach button events
  allMyJobs.forEach(job => {
    // Step 10: Customer Accept Button
    const btnAccept = document.getElementById(`btn-cust-accept-${job.id}`);
    if (btnAccept) {
      btnAccept.onclick = () => handleCustomerAcceptJob(job);
    }

    // Step 10: Customer Reject Button
    const btnReject = document.getElementById(`btn-cust-reject-${job.id}`);
    if (btnReject) {
      btnReject.onclick = () => handleCustomerRejectJob(job);
    }
  });
}

function renderCustomerJobCard(job) {
  const isCompleted = job.status === 'completed';
  const isRework = job.workflowStatus === 'rework_needed';
  const isSubmittedForReview = job.workflowStatus === 'tech_submitted';
  const isCustomerReview = job.workflowStatus === 'customer_review';

  // Step Status Label
  let stepText = '1. ได้รับเรื่องแล้ว';
  let stepBadgeBg = '#e2e8f0';
  let stepBadgeColor = '#334155';

  if (isCompleted) {
    stepText = '10. งานเสร็จสิ้น & รับประกันดิจิทัล';
    stepBadgeBg = '#dcfce7';
    stepBadgeColor = '#15803d';
  } else if (isRework) {
    stepText = '⚠️ วนกลับข้อ 6: กำลังประสานงานแก้ไข';
    stepBadgeBg = '#fee2e2';
    stepBadgeColor = '#991b1b';
  } else if (isCustomerReview) {
    stepText = '10. รอท่านตรวจรับงาน';
    stepBadgeBg = '#e0f2fe';
    stepBadgeColor = '#0369a1';
  } else if (isSubmittedForReview) {
    stepText = '9. ช่างส่งงานแล้ว / รอ Ops ตรวจสอบ';
    stepBadgeBg = '#fef3c7';
    stepBadgeColor = '#b45309';
  } else if (job.status === 'in_progress') {
    stepText = '7. ช่างกำลังลงมือซ่อมหน้างาน';
    stepBadgeBg = '#e0f2fe';
    stepBadgeColor = '#0284c7';
  } else if (job.status === 'traveling') {
    stepText = '5. ช่างกำลังเดินทางมาหาท่าน';
    stepBadgeBg = '#fef3c7';
    stepBadgeColor = '#b45309';
  } else if (job.status === 'assigned') {
    stepText = '3. มอบหมายช่างเรียบร้อยแล้ว';
    stepBadgeBg = '#dcfce7';
    stepBadgeColor = '#166534';
  }

  const warrantyDays = job.warranty?.days || job.warrantyDays || 90;

  return `
    <div style="background: #fff; border: 2px solid ${isCustomerReview ? '#38bdf8' : (isCompleted ? '#86efac' : '#e2e8f0')}; border-radius: 16px; padding: 18px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
      <!-- Card Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <span style="font-family: monospace; font-size: 13px; color: #64748b;">รหัสงาน: ${job.id.slice(0, 8).toUpperCase()}</span>
        <span class="badge" style="background: ${stepBadgeBg}; color: ${stepBadgeColor}; font-size: 13px; padding: 4px 10px; font-weight: 700;">
          ${stepText}
        </span>
      </div>

      <!-- Job Title & Price -->
      <div style="font-size: 19px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
        ${escapeHtml(job.title || 'งานซ่อมบำรุง')}
      </div>

      <div style="font-size: 18px; font-weight: 800; color: #059669; margin-bottom: 12px;">
        ราคารวมสุทธิ: ฿${(job.price || 0).toLocaleString()}
      </div>

      <!-- Step 4 Escrow Badge -->
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 10px; font-size: 14px; color: #166534; margin-bottom: 14px;">
        <strong>🛡️ สถานะเงินของท่าน (ขั้นตอนที่ 4):</strong> พักเงินในระบบ PPT Escrow
        <div style="font-size: 13px; color: #15803d; margin-top: 2px;">
          เงินของท่านปลอดภัย 100% — ช่างจะยังไม่ได้รับเงินจนกว่าท่านจะตรวจรับงานเรียบร้อย
        </div>
      </div>

      <!-- Assigned Technician Info -->
      <div style="background: #f8fafc; border-radius: 10px; padding: 10px 14px; font-size: 15px; margin-bottom: 14px; color: #334155;">
        <span>👷 ช่างผู้ดูแล: <strong>${escapeHtml(job.assignedTechName || job.assignedTeamId || 'กำลังจัดสรรช่าง Pro')}</strong></span>
        ${job.assignedTechPhone ? `<span style="margin-left: 8px;">📞 ${job.assignedTechPhone}</span>` : ''}
      </div>

      <!-- STEP 10: CUSTOMER REVIEW & INSPECTION GATE -->
      ${(isCustomerReview || (isSubmittedForReview && job.afterPhotos)) ? `
        <div style="background: #f0fdf4; border: 2px solid #86efac; border-radius: 14px; padding: 16px; margin-top: 14px;">
          <div style="font-size: 18px; font-weight: 800; color: #065f46; margin-bottom: 6px;">
            🎯 ขั้นตอนที่ 10: ช่างส่งงานแล้ว ขอเชิญท่านตรวจรับงาน
          </div>
          <p style="font-size: 15px; color: #15803d; margin: 0 0 12px 0;">
            กรุณาตรวจดูรูปผลงานก่อนและหลังทำด้านล่างนี้ หากพอใจกดรับงานเพื่อเริ่มนับประกันดิจิทัลค่ะ
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

          <!-- Customer Decision Buttons -->
          <button class="btn-senior-primary" id="btn-cust-accept-${job.id}" style="font-size: 18px; padding: 14px;">
            🎉 ตรวจรับงานเรียบร้อย (เริ่มนับประกันดิจิทัล)
          </button>

          <button class="btn-senior-danger" id="btn-cust-reject-${job.id}">
            ⚠️ ยังมีจุดบกพร่อง / ขอให้แก้ไข (วนกลับข้อ 6)
          </button>
        </div>
      ` : ''}

      <!-- COMPLETED & DIGITAL WARRANTY BADGE -->
      ${isCompleted ? `
        <div style="background: #ecfdf5; border: 2px solid #10b981; border-radius: 12px; padding: 14px; margin-top: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 16px; font-weight: 800; color: #065f46;">🛡️ บัตรรับประกันดิจิทัล (Digital Warranty)</span>
            <span class="badge" style="background: #10b981; color: #fff; font-size: 12px;">Active</span>
          </div>
          <div style="font-size: 15px; color: #047857; line-height: 1.5;">
            <div>• รับประกันงานซ่อม: <strong>${warrantyDays} วันเต็ม</strong></div>
            <div>• สิ้นสุดความคุ้มครอง: <strong>${job.warranty?.endDate ? new Date(job.warranty.endDate).toLocaleDateString('th-TH') : '90 วันนับจากวันจบงาน'}</strong></div>
            <div>• มีปัญหาในระยะประกัน ช่างและ PPT เข้าดูแลทันทีโดยไม่มีค่าใช้จ่ายเพิ่ม</div>
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
