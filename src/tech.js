/**
 * รักบ้าน@CNX — จอช่างมืออาชีพ (Technician Mobile Portal Controller)
 * ออกแบบตามกติกาคุณเชิด 8 ข้อ (Senior-First & Frameless Clean UI):
 * 1. อากงอาม่า ตัวหนังสือใหญ่ คอนทราสต์สูง สบายตา
 * 2. ไม่ฟุ่มเฟือย ประโยคเดียวจบในตัว ไร้คำอธิบายซ้ำซาก
 * 3. จบใน 1 หน้าจอ ไม่เลื่อนยาว
 * 4. แถบแท็บ 3 เรื่องชัดเจน (งานที่ต้องทำ / รอตรวจงาน / งานเสร็จแล้ว)
 * 5. ธีมเฉพาะส้มช่าง (Safety Artisan Orange) ไม่ซ้ำสีลูกค้า
 * 6. ภาษาไทยล้วน ห้ามมีวงเล็บภาษาอังกฤษ
 * 7. ใช้คำตรงกับจอลูกค้า (เวลานัดหมาย, ราคารวมสุทธิ, ที่อยู่หน้างาน)
 * 8. ปุ่มกดใหญ่ 54px แตะง่าย เหมาะกับคนทำงานหน้างาน
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
  updateDoc,
} from 'firebase/firestore';
import {
  TECHNICIANS,
  getTechnicians,
  getTechnicianById,
} from './technicians-data.js';
import { logAgentActivity } from './audit-logger.js';

// State
let currentTech = null;
let currentTab = 'active'; // 'active', 'submitted', 'completed'
let allMyJobs = [];
let unsubscribe = null;

// Before/After photo cache per job
const photoDrafts = new Map();

// Sample mock photos for quick preview / demo testing
const SAMPLE_PHOTOS = {
  air_before: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=500&auto=format&fit=crop&q=60',
  air_after: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=500&auto=format&fit=crop&q=60',
  elec_before: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=500&auto=format&fit=crop&q=60',
  elec_after: 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=500&auto=format&fit=crop&q=60',
  plumb_before: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=500&auto=format&fit=crop&q=60',
  plumb_after: 'https://images.unsplash.com/photo-1507652313519-d4e9174996dd?w=500&auto=format&fit=crop&q=60',
  general_before: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=500&auto=format&fit=crop&q=60',
  general_after: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=500&auto=format&fit=crop&q=60',
};

// แปลงชื่อหมวดช่างเป็นภาษาไทยชาวบ้าน (ปลอดศัพท์ย่อภาษาอังกฤษ)
function getTradeLabel(trade) {
  switch (trade) {
    case 'air': return 'ช่างแอร์';
    case 'electrical': return 'ช่างไฟฟ้า';
    case 'plumbing': return 'ช่างประปา';
    case 'roof': return 'ช่างหลังคา';
    default: return 'ช่างทั่วไป';
  }
}

// Initialize
initTechPortal();

function initTechPortal() {
  const urlParams = new URLSearchParams(window.location.search);
  const paramTechId = urlParams.get('techId');
  const savedTechId = localStorage.getItem('rakbaan_tech_id');

  const targetId = paramTechId || savedTechId || 'RPS-T01';
  setTechIdentity(targetId);

  // Setup tab listeners
  const tabs = document.querySelectorAll('.tech-tab');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.getAttribute('data-tab');
      renderJobsFeed();
    };
  });

  // ปุ่มเปิดคู่มือช่าง (Aviation SOP Playbook)
  const btnPlaybook = document.getElementById('btn-open-tech-playbook');
  if (btnPlaybook) {
    btnPlaybook.onclick = openTechPlaybookModal;
  }
}

function setTechIdentity(techId) {
  const found = getTechnicianById(techId) || TECHNICIANS[0];
  currentTech = found;
  localStorage.setItem('rakbaan_tech_id', found.id);

  renderHeaderProfile();
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.warn('Tech Anonymous auth note:', e.message);
      }
    }
    startListeningJobs();
  });
}

function renderHeaderProfile() {
  const slot = document.getElementById('tech-profile-slot');
  if (!slot || !currentTech) return;

  slot.innerHTML = `
    <div class="tech-profile-info">
      <div>
        <div class="tech-name">${escapeHtml(currentTech.name)}</div>
        <div class="tech-meta">
          <span>รหัส ${escapeHtml(currentTech.id)}</span> · <span>${getTradeLabel(currentTech.trade)}</span>
        </div>
      </div>
    </div>
  `;
}

function openTechSelectModal() {
  const container = document.getElementById('tech-login-modal-container');
  if (!container) return;

  const all = getTechnicians();

  container.innerHTML = `
    <div class="tech-modal-overlay" id="tech-modal-overlay">
      <div class="tech-modal-box">
        <div class="tech-modal-header">
          <h3 class="tech-modal-title">สลับชื่อช่าง</h3>
          <button id="btn-close-modal" style="background: none; border: none; font-size: 15px; font-weight: 700; cursor: pointer; color: #64748b;">ปิด</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${all.map(t => {
            const isSelected = t.id === currentTech.id;
            return `
              <div class="tech-select-item ${isSelected ? 'selected' : ''}" data-id="${t.id}">
                <div style="flex: 1;">
                  <div class="tech-select-name">
                    ${t.name} ${t.nickname ? `(${t.nickname})` : ''}
                  </div>
                  <div class="tech-select-sub">
                    <span style="font-family: monospace; font-weight: 700; color: #ea580c;">${t.id}</span> · ${getTradeLabel(t.trade)}
                  </div>
                </div>
                <div style="text-align: right;">
                  <span style="font-size: 12px; font-weight: 700; color: ${t.status === 'active' ? '#15803d' : '#b45309'};">
                    ${t.status === 'active' ? 'พร้อมรับงาน' : 'ติดงานหน้างาน'}
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-close-modal').onclick = () => { container.innerHTML = ''; };
  document.getElementById('tech-modal-overlay').onclick = (e) => {
    if (e.target.id === 'tech-modal-overlay') container.innerHTML = '';
  };

  const items = container.querySelectorAll('.tech-select-item');
  items.forEach(item => {
    item.onclick = () => {
      const id = item.getAttribute('data-id');
      setTechIdentity(id);
      container.innerHTML = '';
      showToast(`เข้าสู่ระบบในนามช่าง [${id}] เรียบร้อยแล้ว`, 'success');
    };
  });
}

function startListeningJobs() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  const feed = document.getElementById('tech-jobs-feed');
  feed.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⏳</div>
      <div class="empty-title">กำลังเชื่อมต่อข้อมูลคิวงาน...</div>
    </div>
  `;

  const jobsQuery = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(100));

  unsubscribe = onSnapshot(jobsQuery, (snapshot) => {
    const rawDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filter jobs assigned to current technician
    allMyJobs = rawDocs.filter(j => {
      const assigned = (j.assignedTeamId || j.assignedTechId || '').trim().toUpperCase();
      const currentId = currentTech.id.toUpperCase();
      return assigned === currentId ||
             assigned.includes(currentId) ||
             (j.assignedTechName && j.assignedTechName.includes(currentTech.name)) ||
             (j.customerSelectedTech && j.customerSelectedTech.includes(currentTech.name));
    });

    updateTabBadges();
    renderJobsFeed();
  }, (err) => {
    feed.innerHTML = `<div class="empty-state" style="color: #ef4444;"><div class="empty-title">โหลดงานไม่สำเร็จ: ${err.message}</div></div>`;
  });
}

function updateTabBadges() {
  const activeCount = allMyJobs.filter(j => {
    if (j.status === 'completed' || j.status === 'cancelled') return false;
    if (j.workflowStatus === 'tech_submitted') return false;
    return true; // assigned, traveling, in_progress
  }).length;

  const submittedCount = allMyJobs.filter(j => {
    return j.workflowStatus === 'tech_submitted' && j.status !== 'completed';
  }).length;

  const completedCount = allMyJobs.filter(j => j.status === 'completed').length;

  document.getElementById('tab-count-active').textContent = activeCount;
  document.getElementById('tab-count-submitted').textContent = submittedCount;
  document.getElementById('tab-count-completed').textContent = completedCount;
}

function renderJobsFeed() {
  const feed = document.getElementById('tech-jobs-feed');
  if (!feed) return;

  let displayJobs = [];

  if (currentTab === 'active') {
    displayJobs = allMyJobs.filter(j => {
      if (j.status === 'completed' || j.status === 'cancelled') return false;
      if (j.workflowStatus === 'tech_submitted') return false;
      return true;
    });
  } else if (currentTab === 'submitted') {
    displayJobs = allMyJobs.filter(j => {
      return j.workflowStatus === 'tech_submitted' && j.status !== 'completed';
    });
  } else if (currentTab === 'completed') {
    displayJobs = allMyJobs.filter(j => j.status === 'completed');
  }

  if (displayJobs.length === 0) {
    let emptyTitle = 'ไม่มีงานที่ต้องทำในขณะนี้';
    if (currentTab === 'submitted') {
      emptyTitle = 'ไม่มีงานที่รอตรวจในขณะนี้';
    } else if (currentTab === 'completed') {
      emptyTitle = 'ไม่มีประวัติงานที่เสร็จสิ้น';
    }

    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">${emptyTitle}</div>
      </div>
    `;
    return;
  }

  feed.innerHTML = displayJobs.map(job => renderJobCardHtml(job)).join('');

  // Attach card event listeners
  displayJobs.forEach(job => attachJobCardEvents(job));
}

function renderJobCardHtml(job) {
  const dateObj = new Date(job.scheduledDate || job.createdAt);
  const dateStr = dateObj.toLocaleDateString('th-TH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const isAssigned = job.status === 'assigned';
  const isTraveling = job.status === 'traveling';
  const isInProgress = job.status === 'in_progress';
  const isSubmitted = job.workflowStatus === 'tech_submitted';
  const isCompleted = job.status === 'completed';

  let statusBadgeClass = 'status-assigned';
  let statusText = 'มอบหมายแล้ว รอรับงาน';

  if (isTraveling) {
    statusBadgeClass = 'status-traveling';
    statusText = 'กำลังเดินทาง';
  } else if (isSubmitted) {
    statusBadgeClass = 'status-submitted';
    statusText = 'ส่งงานแล้ว รอตรวจงาน';
  } else if (isInProgress) {
    statusBadgeClass = 'status-in-progress';
    statusText = 'กำลังทำงานหน้างาน';
  } else if (isCompleted) {
    statusBadgeClass = 'status-completed';
    statusText = 'งานเสร็จสิ้น';
  }

  const draft = photoDrafts.get(job.id) || { beforePhoto: '', afterPhoto: '', notes: '' };
  const beforePhoto = draft.beforePhoto || (job.beforePhotos && job.beforePhotos[0]) || '';
  const afterPhoto = draft.afterPhoto || (job.afterPhotos && job.afterPhotos[0]) || '';
  const currentNotes = draft.notes || job.techNotes || '';

  const customerName = job.customerName || (job.customerId ? job.customerId.slice(0, 16) : 'คุณเชิดศักดิ์ (เจ้าของบ้าน)');
  const addressText = job.addressDetail || '88/12 ถ.สุเทพ ต.สุเทพ อ.เมือง จ.เชียงใหม่';

  return `
    <div class="tech-job-card" id="card-${job.id}">
      <div class="job-header">
        <div class="job-code">#${job.id.slice(0, 8).toUpperCase()}</div>
        <div class="job-status-badge ${statusBadgeClass}">${statusText}</div>
      </div>

      <div class="job-body">
        <!-- กรอบชื่องาน -->
        <div class="job-title-box">
          <div class="job-title">
            ${escapeHtml(job.title || 'งานบริการช่าง')}
          </div>
        </div>

        <!-- กรอบข้อมูลสำคัญตรงกับจอลูกค้า -->
        <div class="job-info-grid">
          <div class="job-info-item">
            <div class="job-info-label">เวลานัดหมาย</div>
            <div class="job-info-value">${dateStr}</div>
          </div>
          <div class="job-info-item">
            <div class="job-info-label">ราคารวมสุทธิ</div>
            <div class="job-info-value job-price-value">฿${(job.price || 0).toLocaleString()}</div>
          </div>
          <div class="job-info-item full-width">
            <div class="job-info-label">ชื่อลูกค้า</div>
            <div class="job-info-value">${escapeHtml(customerName)}</div>
          </div>
        </div>

        <!-- กรอบที่อยู่หน้างาน + ปุ่มนำทาง -->
        <div class="job-location-box">
          <div class="job-location-text">
            ที่อยู่หน้างาน: ${escapeHtml(addressText)}
          </div>
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}" target="_blank" class="btn-tech-nav">เปิดแผนที่นำทาง</a>
        </div>

        <!-- กรอบแจ้งกลับแอดมินเมื่อติดขัด (ห้ามติดต่อลูกค้าโดยตรง) -->
        <div class="job-admin-box">
          <div class="job-admin-text">
            หากติดขัดหรือพบปัญหาหน้างาน:
          </div>
          <button type="button" class="btn-contact-admin" id="btn-admin-${job.id}">
            แจ้งกลับแอดมิน
          </button>
        </div>

        <!-- ปุ่มและแบบฟอร์มการทำงานตามขั้นตอน -->
        <div class="job-actions">
          ${isAssigned ? `
            <button class="btn-tech-action btn-tech-orange" id="btn-accept-${job.id}">
              รับงานแล้ว เริ่มเดินทาง
            </button>
          ` : ''}

          ${isTraveling ? `
            <button class="btn-tech-action btn-tech-orange" id="btn-arrive-${job.id}">
              ถึงหน้างาน เริ่มทำงาน
            </button>
          ` : ''}

          ${(isInProgress && !isSubmitted) ? `
            <!-- ด่านเช็กลิสต์: ระยะที่ 2 ขณะปฏิบัติงาน -->
            <div style="background: #fff7ed; border: 1.5px solid #fed7aa; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px;">
              <div style="font-size: 15px; font-weight: 800; color: #c2410c; margin-bottom: 4px;">
                ขณะปฏิบัติงาน (มาตรฐานความปลอดภัย)
              </div>
              <div style="font-size: 13.5px; color: #7c2d12; line-height: 1.45;">
                • ดับเบรกเกอร์หรือปิดวาล์วน้ำหลักก่อนลงมือทุกครั้ง<br>
                • ใช้อะไหล่แท้ตรงรุ่นมาตรฐาน ไม่ดัดแปลง<br>
                • ถ่ายรูปชำรุดก่อนลงมือซ่อม
              </div>
            </div>

            <!-- ด่านเช็กลิสต์: ระยะที่ 3 หลังปฏิบัติงาน & ส่งตรวจงาน -->
            <div class="submit-form-card">
              <div class="submit-form-title">
                ด่านตรวจหลังปฏิบัติงาน (ก่อนส่งงาน)
              </div>

              <!-- เช็กลิสต์บังคับ 3 ข้อ -->
              <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px;">
                <div style="font-size: 13.5px; font-weight: 700; color: #475569; margin-bottom: 8px;">
                  ยืนยันการปฏิบัติ 3 ข้อตามคู่มือช่าง:
                </div>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #1e293b; margin-bottom: 8px; cursor: pointer;">
                  <input type="checkbox" id="post-chk-clean-${job.id}" style="width: 18px; height: 18px; accent-color: var(--tech-primary);" />
                  <span>1. ทำความสะอาดพื้นที่และม้วนเก็บผ้ายางเรียบร้อย</span>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #1e293b; margin-bottom: 8px; cursor: pointer;">
                  <input type="checkbox" id="post-chk-demo-${job.id}" style="width: 18px; height: 18px; accent-color: var(--tech-primary);" />
                  <span>2. ทดสอบระบบการทำงานต่อหน้าลูกค้าแล้ว</span>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #1e293b; cursor: pointer;">
                  <input type="checkbox" id="post-chk-nocash-${job.id}" style="width: 18px; height: 18px; accent-color: var(--tech-primary);" />
                  <span>3. ยืนยันไม่รับเงินสดหน้างาน โอนผ่านระบบเพียบพร้อมทำเท่านั้น</span>
                </label>
              </div>

              <div class="photo-upload-grid">
                <!-- รูปก่อนทำ -->
                <div class="photo-upload-box ${beforePhoto ? 'has-photo' : ''}" id="box-before-${job.id}">
                  <div class="photo-upload-label">รูปก่อนทำ</div>
                  ${beforePhoto ? `
                    <img src="${beforePhoto}" class="photo-preview-img" alt="รูปก่อนทำ" />
                  ` : `
                    <span style="font-size: 14px; font-weight: 700; color: #64748b; margin: 12px 0;">แตะถ่ายรูป</span>
                  `}
                  <input type="file" accept="image/*" class="file-input-hidden" id="file-before-${job.id}" />
                  <button type="button" class="btn-mock-photo" id="mock-before-${job.id}">
                    ${beforePhoto ? 'เปลี่ยนรูป' : 'ใช้รูปตัวอย่าง'}
                  </button>
                </div>

                <!-- รูปหลังทำ -->
                <div class="photo-upload-box ${afterPhoto ? 'has-photo' : ''}" id="box-after-${job.id}">
                  <div class="photo-upload-label">รูปหลังทำ</div>
                  ${afterPhoto ? `
                    <img src="${afterPhoto}" class="photo-preview-img" alt="รูปหลังทำ" />
                  ` : `
                    <span style="font-size: 14px; font-weight: 700; color: #64748b; margin: 12px 0;">แตะถ่ายรูป</span>
                  `}
                  <input type="file" accept="image/*" class="file-input-hidden" id="file-after-${job.id}" />
                  <button type="button" class="btn-mock-photo" id="mock-after-${job.id}">
                    ${afterPhoto ? 'เปลี่ยนรูป' : 'ใช้รูปตัวอย่าง'}
                  </button>
                </div>
              </div>

              <textarea class="tech-notes-input" id="notes-${job.id}" placeholder="ระบุรายละเอียดงาน หรือข้อความถึงฝ่ายตรวจงาน...">${escapeHtml(currentNotes)}</textarea>

              <button class="btn-tech-action btn-tech-orange" id="btn-submit-ops-${job.id}">
                ส่งตรวจงาน
              </button>
            </div>
          ` : ''}

          ${isSubmitted ? `
            <div class="tech-alert-card warning">
              ส่งงานเรียบร้อยแล้ว รอฝ่ายตรวจงานตรวจสอบ
            </div>
          ` : ''}

          ${isCompleted ? `
            <div class="tech-alert-card success">
              งานเสร็จสิ้นเรียบร้อยแล้ว
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function attachJobCardEvents(job) {
  // ปุ่มรับงาน & เริ่มเดินทาง
  const btnAccept = document.getElementById(`btn-accept-${job.id}`);
  if (btnAccept) {
    btnAccept.onclick = async () => {
      btnAccept.disabled = true;
      btnAccept.textContent = 'กำลังบันทึก...';
      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'traveling',
          workflowStep: 5,
          workflowStatus: 'traveling',
          travelStartedAt: new Date().toISOString(),
        });

        await logAgentActivity({
          agentId: 'agent-2-tech',
          agentName: `Agent-2: ช่าง [${currentTech.id}] ${currentTech.name}`,
          step: 5,
          stepName: '5. ช่างรับงาน (Tech Accepts & Travel)',
          action: 'TECH_ACCEPT_AND_TRAVEL',
          jobId: job.id,
          status: 'success',
          details: {
            techId: currentTech.id,
            techName: currentTech.name,
            phone: currentTech.phone,
          },
        });

        showToast('รับงานแล้ว กำลังเดินทางไปหน้างาน', 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
        btnAccept.disabled = false;
        btnAccept.textContent = 'รับงานแล้ว เริ่มเดินทาง';
      }
    };
  }

  // ปุ่มถึงหน้างาน & ด่านตรวจความพร้อม 3 ข้อ
  const btnArrive = document.getElementById(`btn-arrive-${job.id}`);
  if (btnArrive) {
    btnArrive.onclick = () => {
      openPreflightModal(job);
    };
  }

  // ปุ่มแจ้งกลับแอดมิน (ห้ามโทรหาลูกค้าโดยตรง)
  const btnAdmin = document.getElementById(`btn-admin-${job.id}`);
  if (btnAdmin) {
    btnAdmin.onclick = () => {
      openAdminContactModal(job);
    };
  }

  // ตัวจัดการรูปภาพ
  const fileBefore = document.getElementById(`file-before-${job.id}`);
  const fileAfter = document.getElementById(`file-after-${job.id}`);
  const mockBefore = document.getElementById(`mock-before-${job.id}`);
  const mockAfter = document.getElementById(`mock-after-${job.id}`);
  const notesElem = document.getElementById(`notes-${job.id}`);

  const updateDraft = (key, val) => {
    const draft = photoDrafts.get(job.id) || { beforePhoto: '', afterPhoto: '', notes: '' };
    draft[key] = val;
    photoDrafts.set(job.id, draft);
  };

  if (notesElem) {
    notesElem.oninput = (e) => {
      updateDraft('notes', e.target.value);
    };
  }

  if (fileBefore) {
    fileBefore.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          updateDraft('beforePhoto', event.target.result);
          renderJobsFeed();
          showToast('แนบรูปก่อนทำเรียบร้อย', 'success');
        };
        reader.readAsDataURL(file);
      }
    };
  }

  if (fileAfter) {
    fileAfter.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          updateDraft('afterPhoto', event.target.result);
          renderJobsFeed();
          showToast('แนบรูปหลังทำเรียบร้อย', 'success');
        };
        reader.readAsDataURL(file);
      }
    };
  }

  if (mockBefore) {
    mockBefore.onclick = (e) => {
      e.stopPropagation();
      const sample = SAMPLE_PHOTOS[`${currentTech.trade}_before`] || SAMPLE_PHOTOS.air_before;
      updateDraft('beforePhoto', sample);
      renderJobsFeed();
      showToast('ใช้รูปตัวอย่างก่อนทำเรียบร้อย', 'success');
    };
  }

  if (mockAfter) {
    mockAfter.onclick = (e) => {
      e.stopPropagation();
      const sample = SAMPLE_PHOTOS[`${currentTech.trade}_after`] || SAMPLE_PHOTOS.air_after;
      updateDraft('afterPhoto', sample);
      renderJobsFeed();
      showToast('ใช้รูปตัวอย่างหลังทำเรียบร้อย', 'success');
    };
  }

  // ปุ่มส่งตรวจงาน
  const btnSubmitOps = document.getElementById(`btn-submit-ops-${job.id}`);
  if (btnSubmitOps) {
    btnSubmitOps.onclick = async () => {
      const draft = photoDrafts.get(job.id) || { beforePhoto: '', afterPhoto: '', notes: '' };
      const beforeImg = draft.beforePhoto || (job.beforePhotos && job.beforePhotos[0]);
      const afterImg = draft.afterPhoto || (job.afterPhotos && job.afterPhotos[0]);
      const notes = (notesElem ? notesElem.value : draft.notes) || 'ช่างปฏิบัติงานเรียบร้อยตามมาตรฐาน ทดสอบระบบทำงานได้ปกติ';

      const chkClean = document.getElementById(`post-chk-clean-${job.id}`);
      const chkDemo = document.getElementById(`post-chk-demo-${job.id}`);
      const chkNocash = document.getElementById(`post-chk-nocash-${job.id}`);

      if ((chkClean && !chkClean.checked) || (chkDemo && !chkDemo.checked) || (chkNocash && !chkNocash.checked)) {
        alert('กรุณายืนยันการปฏิบัติงานครบทั้ง 3 ข้อ (ทำความสะอาด / ทดสอบระบบ / ไม่รับเงินสด) ก่อนส่งตรวจงานนะคะ');
        return;
      }

      if (!beforeImg || !afterImg) {
        alert('กรุณาแนบรูปทั้งก่อนทำและหลังทำให้ครบถ้วนก่อนส่งตรวจงานนะคะ');
        return;
      }

      btnSubmitOps.disabled = true;
      btnSubmitOps.textContent = 'กำลังส่งตรวจงาน...';

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress',
          workflowStep: 8,
          workflowStatus: 'tech_submitted',
          beforePhotos: [beforeImg],
          afterPhotos: [afterImg],
          techNotes: notes,
          techSubmittedAt: new Date().toISOString(),
          postFlightChecklist: {
            cleanArea: true,
            demoTested: true,
            noCashConfirmed: true,
            confirmedAt: new Date().toISOString(),
          },
          qcData: {
            beforePhoto: beforeImg,
            afterPhoto: afterImg,
            techNotes: notes,
            techId: currentTech.id,
            techName: currentTech.name,
            submittedAt: new Date().toISOString(),
          }
        });

        await logAgentActivity({
          agentId: 'agent-2-tech',
          agentName: `Agent-2: ช่าง [${currentTech.id}] ${currentTech.name}`,
          step: 8,
          stepName: '8. ช่างส่งงาน (Tech Submits Photos)',
          action: 'TECH_SUBMIT_PHOTOS_FOR_QC',
          jobId: job.id,
          status: 'success',
          details: {
            techId: currentTech.id,
            techName: currentTech.name,
            hasBeforePhoto: Boolean(beforeImg),
            hasAfterPhoto: Boolean(afterImg),
            notes: notes.slice(0, 100),
          },
        });

        photoDrafts.delete(job.id);
        showToast('ส่งตรวจงานเรียบร้อยแล้ว', 'success');
        
        // สลับไปแท็บส่งตรวจแล้ว
        currentTab = 'submitted';
        const tabs = document.querySelectorAll('.tech-tab');
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="submitted"]')?.classList.add('active');
      } catch (err) {
        alert(`เกิดข้อผิดพลาดในการส่งงาน: ${err.message}`);
        btnSubmitOps.disabled = false;
        btnSubmitOps.textContent = 'ส่งตรวจงาน';
      }
    };
  }
}

function openPreflightModal(job) {
  const container = document.getElementById('preflight-modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="preflight-overlay" id="preflight-overlay">
      <div class="preflight-modal-card">
        <div class="preflight-header">
          <div>
            <div class="preflight-title">ด่านตรวจความพร้อมก่อนเริ่มงาน</div>
            <div style="font-size: 13.5px; color: #64748b;">(ตามมาตรฐานรักบ้าน ก่อนเริ่มงาน)</div>
          </div>
        </div>

        <p style="font-size: 14.5px; color: #334155; margin-bottom: 14px; line-height: 1.4;">
          กรุณายืนยันการปฏิบัติตามมาตรฐาน 3 ข้อก่อนเริ่มงาน:
        </p>

        <label class="preflight-item">
          <input type="checkbox" id="chk-uniform" />
          <div>
            <div class="preflight-text-title">1. สวมเสื้อยูนิฟอร์มรักบ้านเรียบร้อย</div>
            <div class="preflight-text-desc">แต่งกายสุภาพ พร้อมป้ายชื่อช่างและอุปกรณ์ความปลอดภัย</div>
          </div>
        </label>

        <label class="preflight-item">
          <input type="checkbox" id="chk-dropcloth" />
          <div>
            <div class="preflight-text-title">2. ปูผ้ายางกันเปื้อนหน้างานแล้ว</div>
            <div class="preflight-text-desc">รองผ้ายางใต้เครื่องมือ ป้องกันพื้นบ้านลูกค้าเป็นรอยหรือเปรอะเปื้อน</div>
          </div>
        </label>

        <label class="preflight-item">
          <input type="checkbox" id="chk-scope" />
          <div>
            <div class="preflight-text-title">3. ทบทวนราคาสุทธิและขอบเขตงานแล้ว</div>
            <div class="preflight-text-desc">ยืนยันงาน "${escapeHtml(job.title)}" โอนผ่านระบบเพียบพร้อมทำเท่านั้น ไม่มีเรียกเก็บเงินสดหน้างาน</div>
          </div>
        </label>

        <div style="display: flex; gap: 10px; margin-top: 18px;">
          <button type="button" class="btn-tech-action" id="btn-preflight-cancel" style="background: #e2e8f0; color: #334155; flex: 1;">
            ยกเลิก
          </button>
          <button type="button" class="btn-tech-action btn-tech-orange" id="btn-preflight-confirm" style="flex: 2;" disabled>
            ยืนยันเริ่มปฏิบัติงาน
          </button>
        </div>
      </div>
    </div>
  `;

  const chk1 = document.getElementById('chk-uniform');
  const chk2 = document.getElementById('chk-dropcloth');
  const chk3 = document.getElementById('chk-scope');
  const btnConfirm = document.getElementById('btn-preflight-confirm');
  const btnCancel = document.getElementById('btn-preflight-cancel');

  const checkValidation = () => {
    btnConfirm.disabled = !(chk1.checked && chk2.checked && chk3.checked);
  };

  chk1.onchange = checkValidation;
  chk2.onchange = checkValidation;
  chk3.onchange = checkValidation;

  btnCancel.onclick = () => {
    container.innerHTML = '';
  };

  btnConfirm.onclick = async () => {
    btnConfirm.disabled = true;
    btnConfirm.textContent = 'กำลังเริ่มงาน...';
    try {
      await updateDoc(doc(db, 'jobs', job.id), {
        status: 'in_progress',
        workflowStep: 7,
        workflowStatus: 'in_progress',
        workStartedAt: new Date().toISOString(),
        preflightChecklist: {
          uniform: true,
          dropCloth: true,
          scopeConfirmed: true,
          confirmedAt: new Date().toISOString(),
          techId: currentTech.id,
        }
      });

      await logAgentActivity({
        agentId: 'agent-2-tech',
        agentName: `Agent-2: ช่าง [${currentTech.id}] ${currentTech.name}`,
        step: 7,
        stepName: '7. ช่างถึงหน้างาน & ผ่านเกณฑ์ปูผ้ายาง',
        action: 'TECH_CONFIRMED_PREFLIGHT_CHECKLIST',
        jobId: job.id,
        status: 'success',
        details: {
          techId: currentTech.id,
          uniformChecked: true,
          dropClothChecked: true,
          scopeChecked: true,
        },
      });

      container.innerHTML = '';
      showToast('ผ่านด่านตรวจความพร้อม เริ่มต้นลงมือทำงานได้', 'success');
    } catch (err) {
      alert(`เกิดข้อผิดพลาด: ${err.message}`);
      btnConfirm.disabled = false;
      btnConfirm.textContent = 'ยืนยันเริ่มปฏิบัติงาน';
    }
  };
}

function openAdminContactModal(job) {
  let modalContainer = document.getElementById('tech-login-modal-container');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="tech-modal-overlay" id="admin-modal-overlay">
      <div class="tech-modal-box">
        <div class="tech-modal-header">
          <h3 class="tech-modal-title">แจ้งกลับแอดมินส่วนกลาง</h3>
          <button id="btn-close-admin-modal" style="background: none; border: none; font-size: 14px; font-weight: 700; cursor: pointer; color: #64748b;">ปิด</button>
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; font-size: 13.5px; color: #475569; line-height: 1.4;">
          เพื่อความสะดวกของลูกค้า แอดมินรักบ้านจะเป็นผู้ประสานงานกับลูกค้าให้โดยตรง (ห้ามช่างติดต่อลูกค้าโดยตรง)
        </div>

        <div style="margin-bottom: 12px;">
          <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">เลือกปัญหาที่พบ:</div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #334155; cursor: pointer;">
              <input type="radio" name="admin-issue" value="หาบ้านไม่เจอ / เส้นทางติดขัด" checked style="accent-color: var(--tech-primary);" />
              <span>หาบ้านไม่เจอ หรือเส้นทางติดขัด</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #334155; cursor: pointer;">
              <input type="radio" name="admin-issue" value="ลูกค้าไม่อยู่บ้าน / เข้าหน้างานไม่ได้" style="accent-color: var(--tech-primary);" />
              <span>ลูกค้าไม่อยู่บ้าน หรือเข้าหน้างานไม่ได้</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #334155; cursor: pointer;">
              <input type="radio" name="admin-issue" value="อาการหน้างานไม่ตรงกับที่ระบุ" style="accent-color: var(--tech-primary);" />
              <span>อาการหน้างานไม่ตรงกับที่ระบุในรายการ</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #334155; cursor: pointer;">
              <input type="radio" name="admin-issue" value="ต้องการปรึกษาแอดมินด่วน" style="accent-color: var(--tech-primary);" />
              <span>ต้องการปรึกษาแอดมินด่วน</span>
            </label>
          </div>
        </div>

        <div style="margin-bottom: 14px;">
          <textarea id="admin-issue-notes" class="tech-notes-input" placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)..." style="min-height: 60px; margin-bottom: 0;"></textarea>
        </div>

        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; font-size: 13.5px; color: #c2410c; text-align: center;">
          สายด่วนแอดมินรักบ้าน: <strong>053-222-111</strong>
        </div>

        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-tech-action" id="btn-admin-cancel" style="background: #e2e8f0; color: #334155; flex: 1; min-height: 44px; font-size: 15px;">
            ปิด
          </button>
          <button type="button" class="btn-tech-action btn-tech-orange" id="btn-admin-submit" style="flex: 2; min-height: 44px; font-size: 15px;">
            ส่งแจ้งแอดมิน
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-close-admin-modal').onclick = () => { modalContainer.innerHTML = ''; };
  document.getElementById('btn-admin-cancel').onclick = () => { modalContainer.innerHTML = ''; };
  document.getElementById('admin-modal-overlay').onclick = (e) => {
    if (e.target.id === 'admin-modal-overlay') modalContainer.innerHTML = '';
  };

  document.getElementById('btn-admin-submit').onclick = async () => {
    const selectedRadio = document.querySelector('input[name="admin-issue"]:checked');
    const issueType = selectedRadio ? selectedRadio.value : 'แจ้งปัญหาหน้างาน';
    const notes = document.getElementById('admin-issue-notes')?.value || '';

    try {
      await logAgentActivity({
        agentId: 'agent-2-tech',
        agentName: `Agent-2: ช่าง [${currentTech.id}] ${currentTech.name}`,
        step: 6,
        stepName: '6. ช่างแจ้งปัญหาหน้างานถึงแอดมิน',
        action: 'TECH_REPORTED_ISSUE_TO_ADMIN',
        jobId: job.id,
        status: 'warning',
        details: {
          techId: currentTech.id,
          techName: currentTech.name,
          issueType,
          notes,
          jobCode: job.id.slice(0, 8).toUpperCase(),
        },
      });

      modalContainer.innerHTML = '';
      showToast('แจ้งแอดมินส่วนกลางเรียบร้อยแล้ว แอดมินจะประสานงานกับลูกค้าให้ทันที', 'success');
    } catch (e) {
      alert(`ไม่สามารถส่งข้อความได้: ${e.message}`);
    }
  };
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
  toast.innerHTML = `<span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 2200);
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

function openTechPlaybookModal() {
  const container = document.getElementById('tech-playbook-modal-container');
  if (!container) return;

  container.innerHTML = `
    <div class="playbook-overlay" id="playbook-overlay">
      <div class="playbook-card">
        <div class="playbook-header">
          <div>
            <div class="playbook-title">
              คู่มือช่างรักบ้าน (SOP ปฏิบัติการ)
            </div>
            <div style="font-size: 13.5px; color: #64748b; margin-top: 2px;">
              มาตรฐานปฏิบัติงาน ปลอดภัย โปร่งใส วินัยเต็มร้อย
            </div>
          </div>
          <button type="button" class="playbook-close-btn" id="btn-playbook-close" style="font-size: 14px; font-weight: 700;">ปิด</button>
        </div>

        <!-- หมวดที่ 1: เช็กลิสต์การทำงาน 3 ระยะ -->
        <div class="playbook-section" style="border-left: 4px solid var(--tech-primary);">
          <div class="playbook-section-title">
            1. เช็กลิสต์การทำงาน 3 ระยะ
          </div>
          <ul class="playbook-list">
            <li>
              <span class="playbook-badge-step">ระยะ 1</span>
              <div>
                <strong>ก่อนเริ่มงาน (Pre-Flight):</strong> สวมยูนิฟอร์มและป้ายชื่อช่าง, ปูผ้ายางกันเปื้อนรองเครื่องมือ, ทบทวนราคาสุทธิกับลูกค้า (โอนผ่านระบบเพียบพร้อมทำเท่านั้น)
              </div>
            </li>
            <li>
              <span class="playbook-badge-step" style="background: #d97706;">ระยะ 2</span>
              <div>
                <strong>ขณะปฏิบัติงาน (In-Flight):</strong> ดับเบรกเกอร์หรือปิดวาล์วน้ำเพื่อความปลอดภัย, ใช้อะไหล่แท้ตรงรุ่นมาตรฐาน, ถ่ายรูปสภาพชำรุดก่อนแก้ไข (รูปก่อนทำ)
              </div>
            </li>
            <li>
              <span class="playbook-badge-step" style="background: #16a34a;">ระยะ 3</span>
              <div>
                <strong>หลังปฏิบัติงาน (Post-Flight):</strong> ทำความสะอาดพื้นที่และเก็บผ้ายาง, ทดสอบระบบให้ลูกค้าดูต่อหน้า, ถ่ายรูปหลังทำ, ส่งมอบงานผ่านแอป
              </div>
            </li>
          </ul>
        </div>

        <!-- หมวดที่ 2: ข้อบังคับการยินยอมเปิด GPS ติดตามตำแหน่ง -->
        <div class="playbook-section" style="border-left: 4px solid #0284c7;">
          <div class="playbook-section-title">
            2. ข้อบังคับการยินยอมเปิด GPS ติดตามตำแหน่ง
          </div>
          <p style="font-size: 14.5px; color: #334155; line-height: 1.5;">
            • ช่างต้องยินยอมเปิดระบบพิกัดตำแหน่ง (GPS) ตลอดเวลาขณะปฏิบัติงาน เพื่อให้ฝ่ายปฏิบัติการสามารถติดตามการเดินทางและสนับสนุนความปลอดภัยหน้างานได้ทันท่วงที
          </p>
        </div>

        <!-- หมวดที่ 3: กฎระเบียบการติดต่อประสานงาน -->
        <div class="playbook-section" style="border-left: 4px solid #8b5cf6;">
          <div class="playbook-section-title">
            3. กฎระเบียบการติดต่อประสานงาน (ห้ามติดต่อลูกค้าโดยตรง)
          </div>
          <p style="font-size: 14.5px; color: #334155; line-height: 1.5;">
            • ห้ามช่างโทรหาหรือติดต่อลูกค้าโดยตรงทุกกรณี เพื่อไม่ให้รบกวนลูกค้าและป้องกันการสื่อสารคลาดเคลื่อน<br>
            • หากหาบ้านไม่เจอ เข้าหน้างานไม่ได้ หรือเกิดปัญหาหน้างาน ให้แจ้งกลับแอดมินส่วนกลางเท่านั้น แอดมินรักบ้านจะเป็นผู้ประสานงานกับลูกค้าให้ทันที
          </p>
        </div>

        <!-- หมวดที่ 4: กฎเหล็กห้ามรับเงินสดหน้างานทุกกรณี -->
        <div class="playbook-section" style="border-left: 4px solid #ef4444; background: #fef2f2;">
          <div class="playbook-section-title" style="color: #991b1b;">
            4. กฎเหล็กห้ามรับเงินสดหน้างานทุกกรณี โอนผ่านระบบเพียบพร้อมทำเท่านั้น
          </div>
          <p style="font-size: 14.5px; color: #7f1d1d; line-height: 1.5; margin-bottom: 6px;">
            • <strong>ห้ามรับเงินสดจากลูกค้าหน้างานทุกกรณี</strong> ไม่ว่าจะเป็นค่าบริการ ค่าอะไหล่ หรือค่าน้ำชา<br>
            • เงินทุกบาทลูกค้าชำระเข้าบัญชี บจก. เพียบพร้อมทำ เรียบร้อยแล้ว<br>
            • ระบบจะโอนเงินค่าจ้างเข้าบัญชีช่างโดยตรงหลังผ่านการตรวจงานเรียบร้อย
          </p>
        </div>

        <!-- หมวดที่ 5: วินัย Trust Score 100 แต้ม -->
        <div class="playbook-section" style="border-left: 4px solid #64748b;">
          <div class="playbook-section-title">
            5. วินัยช่าง 100 แต้ม (Trust Score)
          </div>
          <ul class="playbook-list">
            <li>
              <div><strong>เกรด A (90–100 แต้ม):</strong> ช่างแถวหน้า รับสิทธิ์จ่ายงานด่วนและงานเหมาพรีเมียมก่อน</div>
            </li>
            <li>
              <div><strong>เกรด B (80–89 แต้ม):</strong> ช่างมาตรฐาน รับงานตามคิวงานปกติ</div>
            </li>
            <li>
              <div><strong>เกรด C (70–79 แต้ม):</strong> ติดทัณฑ์บน ต้องเข้าอบรมทบทวนมาตรฐาน</div>
            </li>
            <li>
              <div><strong>เกรด F (&lt; 70 แต้ม):</strong> พักงานทันที ระบบล็อกไม่จ่ายงานให้เด็ดขาด</div>
            </li>
          </ul>
        </div>

        <button type="button" class="btn-tech-action btn-tech-orange" id="btn-playbook-ok" style="margin-top: 8px;">
          เข้าใจและพร้อมปฏิบัติตามมาตรฐาน
        </button>
      </div>
    </div>
  `;

  const overlay = document.getElementById('playbook-overlay');
  const btnClose = document.getElementById('btn-playbook-close');
  const btnOk = document.getElementById('btn-playbook-ok');

  const close = () => {
    container.innerHTML = '';
  };

  if (btnClose) btnClose.onclick = close;
  if (btnOk) btnOk.onclick = close;
  if (overlay) {
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
  }
}

// Window exports for dev & automation testing
window.openTechPlaybookModal = openTechPlaybookModal;
window.openPreflightModal = openPreflightModal;

