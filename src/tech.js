/**
 * รักบ้าน@CNX — Technician Mobile Portal Controller
 * จัดการหน้าจอมือถือสำหรับช่าง Pro 15 คน
 * รองรับขั้นตอนที่ 5 (ยอมรับงาน & เดินทาง) และขั้นตอนที่ 8 (ส่งรูป Before/After ให้ Ops ตรวจ)
 * ดูแลโดย น้องกุหลาบ (Kulap) Data Architect Sub-Agent
 */

import { db } from './firebase.js';
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
  TRADE_LABELS,
} from './technicians-data.js';

// State
let currentTech = null;
let currentTab = 'active'; // 'active', 'submitted', 'completed'
let allMyJobs = [];
let unsubscribe = null;

// Before/After photo cache per job for the form before submission
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

// Initialize
initTechPortal();

function initTechPortal() {
  // Check URL params first: ?techId=RPS-T01
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
}

function setTechIdentity(techId) {
  const found = getTechnicianById(techId) || TECHNICIANS[0];
  currentTech = found;
  localStorage.setItem('rakbaan_tech_id', found.id);

  renderHeaderProfile();
  startListeningJobs();
}

function renderHeaderProfile() {
  const slot = document.getElementById('tech-profile-slot');
  if (!slot || !currentTech) return;

  slot.innerHTML = `
    <div class="tech-profile-info">
      <div class="tech-avatar">
        ${currentTech.id === 'RPS-T01' ? '👨‍🔧' : (currentTech.trade === 'electrical' ? '⚡' : (currentTech.trade === 'plumbing' ? '💧' : '👷'))}
      </div>
      <div class="tech-name-box">
        <div class="tech-name">${currentTech.name} ${currentTech.nickname ? `(${currentTech.nickname})` : ''}</div>
        <div class="tech-meta">
          <span style="font-family: monospace; color: #38bdf8; font-weight: 700;">${currentTech.id}</span> • ${currentTech.tradeName}
        </div>
      </div>
    </div>
    <div class="tech-stats-badge">
      <div class="tech-rating-pill">
        ⭐ ${currentTech.customerRating}
      </div>
      <div>
        <button class="btn-switch-tech" id="btn-open-tech-picker">
          สลับช่าง ▾
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-open-tech-picker').onclick = openTechSelectModal;
}

function openTechSelectModal() {
  const container = document.getElementById('tech-login-modal-container');
  if (!container) return;

  const all = getTechnicians();

  container.innerHTML = `
    <div class="tech-modal-overlay" id="tech-modal-overlay">
      <div class="tech-modal-box">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div>
            <h3 style="margin: 0; font-size: 16px; color: #0f172a;">👷‍♂️ สลับตัวตนช่าง Pro (15 ท่าน)</h3>
            <p style="margin: 2px 0 0 0; font-size: 11px; color: #64748b;">เลือกรหัสช่างของคุณเพื่อเข้าสู่ระบบปฏิบัติงาน</p>
          </div>
          <button id="btn-close-modal" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #94a3b8;">✕</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${all.map(t => `
            <div class="tech-select-item ${t.id === currentTech.id ? 'selected' : ''}" data-id="${t.id}">
              <div style="width: 36px; height: 36px; border-radius: 50%; background: #e0f2fe; color: #0369a1; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;">
                👷
              </div>
              <div style="flex: 1;">
                <div style="font-weight: 700; font-size: 13px; color: #0f172a;">
                  ${t.name} ${t.nickname ? `(${t.nickname})` : ''}
                </div>
                <div style="font-size: 11px; color: #64748b;">
                  <span style="font-family: monospace; font-weight: 700; color: #0284c7;">${t.id}</span> | ${t.tradeName}
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 11px; font-weight: 700; color: #b45309;">⭐ ${t.customerRating}</div>
                <span class="badge" style="${t.status === 'active' ? 'background: #dcfce7; color: #15803d;' : 'background: #fef3c7; color: #b45309;'} font-size: 10px; padding: 1px 6px;">
                  ${t.status === 'active' ? 'ว่าง' : 'ติดงาน'}
                </span>
              </div>
            </div>
          `).join('')}
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
      showToast(`เข้าสู่ระบบในนาม [${id}] สำเร็จแล้ว`, 'success');
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
      <p>กำลังเชื่อมต่อระบบและดึงข้อมูลคิวงาน...</p>
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
    feed.innerHTML = `<div class="empty-state" style="color: #ef4444;"><p>โหลดงานไม่สำเร็จ: ${err.message}</p></div>`;
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
    let emptyMsg = 'ไม่มีงานที่ต้องทำในขณะนี้';
    if (currentTab === 'submitted') emptyMsg = 'ยังไม่มีงานที่อยู่ระหว่างรอ Ops ตรวจสอบ';
    if (currentTab === 'completed') emptyMsg = 'ยังไม่มีประวัติงานที่เสร็จสิ้น';

    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${currentTab === 'completed' ? '🏁' : '☕'}</div>
        <h4 style="margin: 0 0 6px 0; color: #475569;">${emptyMsg}</h4>
        <p style="font-size: 12px; margin: 0;">เมื่อ Ops มอบหมายงานใหม่ ระบบจะแจ้งเตือนและแสดงที่นี่ทันที</p>
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
  let statusText = 'มอบหมายแล้ว (รอรับงาน)';

  if (isTraveling) {
    statusBadgeClass = 'status-traveling';
    statusText = '🚗 กำลังเดินทาง';
  } else if (isSubmitted) {
    statusBadgeClass = 'status-submitted';
    statusText = '⏳ ส่งงานแล้ว (รอ Ops ตรวจ)';
  } else if (isInProgress) {
    statusBadgeClass = 'status-in-progress';
    statusText = '🔧 กำลังซ่อมหน้างาน';
  } else if (isCompleted) {
    statusBadgeClass = 'status-completed';
    statusText = '✓ งานเสร็จสิ้น';
  }

  const draft = photoDrafts.get(job.id) || { beforePhoto: '', afterPhoto: '', notes: '' };
  const beforePhoto = draft.beforePhoto || (job.beforePhotos && job.beforePhotos[0]) || '';
  const afterPhoto = draft.afterPhoto || (job.afterPhotos && job.afterPhotos[0]) || '';
  const currentNotes = draft.notes || job.techNotes || '';

  return `
    <div class="tech-job-card" id="card-${job.id}">
      <div class="job-header">
        <div class="job-code">#${job.id.slice(0, 8).toUpperCase()}</div>
        <div class="job-status-badge ${statusBadgeClass}">${statusText}</div>
      </div>

      <div class="job-body">
        <div class="job-title">
          <span>🛠️</span> ${escapeHtml(job.title || 'งานบริการช่าง')}
        </div>

        <div class="job-desc">
          <strong>Scope:</strong> ${escapeHtml(job.title || 'บริการตามมาตรฐาน RakBaan Pro')}
        </div>

        <div class="job-info-grid">
          <div class="job-info-item">
            <div class="job-info-label">เวลานัดหมาย</div>
            <div class="job-info-value">📅 ${dateStr}</div>
          </div>
          <div class="job-info-item">
            <div class="job-info-label">ราคาประเมิน</div>
            <div class="job-info-value" style="color: #0f766e;">฿${(job.price || 0).toLocaleString()}</div>
          </div>
          <div class="job-info-item">
            <div class="job-info-label">ชื่อลูกค้า</div>
            <div class="job-info-value">${escapeHtml(job.customerId ? job.customerId.slice(0, 16) : 'ลูกค้าสมาชิก')}</div>
          </div>
          <div class="job-info-item">
            <div class="job-info-label">เบอร์ติดต่อ</div>
            <div class="job-info-value">
              <a href="tel:0891234567" style="color: #0284c7; text-decoration: none; font-weight: 700;">📞 โทรหาลูกค้า</a>
            </div>
          </div>
        </div>

        <div class="job-location-box">
          <div style="max-width: 75%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            📍 สถานที่: อ.เมือง จ.เชียงใหม่
          </div>
          <a href="https://maps.google.com" target="_blank" class="btn-map-link">🗺️ นำทาง</a>
        </div>

        <!-- Stepper Action Area -->
        <div class="job-actions">
          ${isAssigned ? `
            <!-- ขั้นตอนที่ 5: ปุ่มยอมรับงาน & เริ่มเดินทาง -->
            <button class="btn-tech-action btn-accept-job" id="btn-accept-${job.id}">
              <span>🚀</span> [ ยอมรับงาน & เริ่มเดินทาง ] (ขั้นตอนที่ 5)
            </button>
          ` : ''}

          ${isTraveling ? `
            <!-- ขั้นตอนที่ 6-7: ถึงหน้างาน & เริ่มซ่อม -->
            <button class="btn-tech-action btn-arrive-job" id="btn-arrive-${job.id}">
              <span>📍</span> [ ถึงหน้างานแล้ว & เริ่มลงมือซ่อม ] (ขั้นตอนที่ 7)
            </button>
          ` : ''}

          ${(isInProgress && !isSubmitted) ? `
            <!-- ขั้นตอนที่ 8: แบบฟอร์มส่งรูป Before / After & ส่งงานให้ Ops ตรวจ -->
            <div class="submit-form-card">
              <div class="submit-form-title">
                <span>📸 ส่งมอบงาน & รูปภาพ (ขั้นตอนที่ 8)</span>
                <span style="font-size: 11px; color: #15803d; font-weight: normal;">Before & After QC</span>
              </div>

              <div class="photo-upload-grid">
                <!-- Before Photo Box -->
                <div class="photo-upload-box ${beforePhoto ? 'has-photo' : ''}" id="box-before-${job.id}">
                  <span class="photo-upload-label">📷 รูปก่อนทำ (Before)</span>
                  ${beforePhoto ? `
                    <img src="${beforePhoto}" class="photo-preview-img" alt="Before" />
                  ` : `
                    <div style="font-size: 24px; color: #94a3b8; margin: 4px 0;">📸</div>
                    <span style="font-size: 10px; color: #64748b;">แตะเพื่อถ่ายรูป</span>
                  `}
                  <input type="file" accept="image/*" class="file-input-hidden" id="file-before-${job.id}" />
                  <button type="button" class="btn-mock-photo" id="mock-before-${job.id}">
                    ${beforePhoto ? 'เปลี่ยนรูป' : '✨ ใช้รูปตัวอย่าง'}
                  </button>
                </div>

                <!-- After Photo Box -->
                <div class="photo-upload-box ${afterPhoto ? 'has-photo' : ''}" id="box-after-${job.id}">
                  <span class="photo-upload-label">📷 รูปหลังเสร็จ (After)</span>
                  ${afterPhoto ? `
                    <img src="${afterPhoto}" class="photo-preview-img" alt="After" />
                  ` : `
                    <div style="font-size: 24px; color: #94a3b8; margin: 4px 0;">📸</div>
                    <span style="font-size: 10px; color: #64748b;">แตะเพื่อถ่ายรูป</span>
                  `}
                  <input type="file" accept="image/*" class="file-input-hidden" id="file-after-${job.id}" />
                  <button type="button" class="btn-mock-photo" id="mock-after-${job.id}">
                    ${afterPhoto ? 'เปลี่ยนรูป' : '✨ ใช้รูปตัวอย่าง'}
                  </button>
                </div>
              </div>

              <textarea class="tech-notes-input" id="notes-${job.id}" placeholder="📝 ระบุรายละเอียดงานที่ทำ, อะไหล่ที่เปลี่ยน, หรือผลการทดสอบระบบ...">${escapeHtml(currentNotes)}</textarea>

              <button class="btn-send-to-ops" id="btn-submit-ops-${job.id}">
                <span>📤</span> [ ส่งงานให้ Ops ตรวจ ] (ขั้นตอนที่ 8)
              </button>
            </div>
          ` : ''}

          ${isSubmitted ? `
            <div style="background: #fefce8; border: 1px solid #fef08a; padding: 12px; border-radius: 8px; font-size: 12px; color: #854d0e; text-align: center;">
              <div style="font-weight: 700; margin-bottom: 4px;">⏳ ส่งงานเรียบร้อยแล้ว — อยู่ระหว่างรอ Ops ตรวจสอบ</div>
              <p style="margin: 0; font-size: 11px;">ทีมงาน Ops จะตรวจสอบภาพ Before/After และอนุมัติปิดงานต่อไปค่ะ</p>
            </div>
          ` : ''}

          ${isCompleted ? `
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 8px; font-size: 12px; color: #166534; text-align: center;">
              <div style="font-weight: 700; margin-bottom: 2px;">🎉 งานเสร็จสมบูรณ์เรียบร้อยแล้ว</div>
              <span style="font-size: 11px; color: #15803d;">บันทึกยอดเงินเข้ากระเป๋าช่างเรียบร้อยแล้ว</span>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function attachJobCardEvents(job) {
  // Step 5: Accept & Start Travel
  const btnAccept = document.getElementById(`btn-accept-${job.id}`);
  if (btnAccept) {
    btnAccept.onclick = async () => {
      btnAccept.disabled = true;
      btnAccept.textContent = 'กำลังบันทึก...';
      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'traveling', // Safe 1-of-5 status
          workflowStep: 5,
          workflowStatus: 'traveling',
          travelStartedAt: new Date().toISOString(),
        });
        showToast('🚀 ยอมรับงานแล้ว! กำลังเดินทางไปหน้างาน', 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
        btnAccept.disabled = false;
      }
    };
  }

  // Step 6-7: Arrive & In Progress
  const btnArrive = document.getElementById(`btn-arrive-${job.id}`);
  if (btnArrive) {
    btnArrive.onclick = async () => {
      btnArrive.disabled = true;
      btnArrive.textContent = 'กำลังบันทึก...';
      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress', // Safe 1-of-5 status
          workflowStep: 7,
          workflowStatus: 'in_progress',
          workStartedAt: new Date().toISOString(),
        });
        showToast('📍 ถึงหน้างานแล้ว! เริ่มต้นลงมือซ่อมบำรุง', 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
        btnArrive.disabled = false;
      }
    };
  }

  // Photo handlers
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

  // File Before Change
  if (fileBefore) {
    fileBefore.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          updateDraft('beforePhoto', event.target.result);
          renderJobsFeed();
          showToast('แนบรูป Before สำเร็จ', 'success');
        };
        reader.readAsDataURL(file);
      }
    };
  }

  // File After Change
  if (fileAfter) {
    fileAfter.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          updateDraft('afterPhoto', event.target.result);
          renderJobsFeed();
          showToast('แนบรูป After สำเร็จ', 'success');
        };
        reader.readAsDataURL(file);
      }
    };
  }

  // Mock Photo buttons for rapid testing
  if (mockBefore) {
    mockBefore.onclick = (e) => {
      e.stopPropagation();
      const sample = SAMPLE_PHOTOS[`${currentTech.trade}_before`] || SAMPLE_PHOTOS.air_before;
      updateDraft('beforePhoto', sample);
      renderJobsFeed();
      showToast('ใช้รูปตัวอย่าง Before สำเร็จ', 'success');
    };
  }

  if (mockAfter) {
    mockAfter.onclick = (e) => {
      e.stopPropagation();
      const sample = SAMPLE_PHOTOS[`${currentTech.trade}_after`] || SAMPLE_PHOTOS.air_after;
      updateDraft('afterPhoto', sample);
      renderJobsFeed();
      showToast('ใช้รูปตัวอย่าง After สำเร็จ', 'success');
    };
  }

  // Step 8: Submit to Ops
  const btnSubmitOps = document.getElementById(`btn-submit-ops-${job.id}`);
  if (btnSubmitOps) {
    btnSubmitOps.onclick = async () => {
      const draft = photoDrafts.get(job.id) || { beforePhoto: '', afterPhoto: '', notes: '' };
      const beforeImg = draft.beforePhoto || (job.beforePhotos && job.beforePhotos[0]);
      const afterImg = draft.afterPhoto || (job.afterPhotos && job.afterPhotos[0]);
      const notes = (notesElem ? notesElem.value : draft.notes) || 'ช่างปฏิบัติงานเรียบร้อยตามมาตรฐาน ทดสอบระบบทำงานได้ปกติ';

      if (!beforeImg || !afterImg) {
        alert('กรุณาแนบรูปทั้ง Before และ After ให้ครบถ้วนก่อนส่งงานให้ Ops ตรวจนะคะ (สามารถกดปุ่ม "✨ ใช้รูปตัวอย่าง" เพื่อทดสอบได้ค่ะ)');
        return;
      }

      btnSubmitOps.disabled = true;
      btnSubmitOps.textContent = 'กำลังส่งข้อมูลให้ Ops...';

      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress', // Keep 1 of 5 safe core statuses to prevent mobile crash
          workflowStep: 8,
          workflowStatus: 'tech_submitted',
          beforePhotos: [beforeImg],
          afterPhotos: [afterImg],
          techNotes: notes,
          techSubmittedAt: new Date().toISOString(),
          qcData: {
            beforePhoto: beforeImg,
            afterPhoto: afterImg,
            techNotes: notes,
            techId: currentTech.id,
            techName: currentTech.name,
            submittedAt: new Date().toISOString(),
          }
        });

        photoDrafts.delete(job.id);
        showToast('🎉 ส่งงานให้ฝ่าย Ops ตรวจสอบเรียบร้อยแล้ว!', 'success');
        // Switch to submitted tab
        currentTab = 'submitted';
        const tabs = document.querySelectorAll('.tech-tab');
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="submitted"]')?.classList.add('active');
      } catch (err) {
        alert(`เกิดข้อผิดพลาดในการส่งงาน: ${err.message}`);
        btnSubmitOps.disabled = false;
        btnSubmitOps.textContent = 'ส่งงานให้ Ops ตรวจ (ขั้นตอนที่ 8)';
      }
    };
  }
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
