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

  const icon = currentTech.trade === 'air' ? '❄️' : (currentTech.trade === 'electrical' ? '⚡' : (currentTech.trade === 'plumbing' ? '🚰' : '🛠️'));

  slot.innerHTML = `
    <div class="tech-profile-info">
      <div class="tech-avatar">
        ${icon}
      </div>
      <div>
        <div class="tech-name">${currentTech.name} ${currentTech.nickname ? `(${currentTech.nickname})` : ''}</div>
        <div class="tech-meta">
          <span>รหัส ${currentTech.id}</span> · <span>${getTradeLabel(currentTech.trade)}</span>
        </div>
      </div>
    </div>
    <div class="tech-actions-box">
      <div class="tech-rating-pill">
        ⭐ ${currentTech.customerRating}
      </div>
      <button class="btn-switch-tech" id="btn-open-tech-picker">
        สลับช่าง ▾
      </button>
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
        <div class="tech-modal-header">
          <h3 class="tech-modal-title">👷‍♂️ สลับชื่อช่าง</h3>
          <button id="btn-close-modal" style="background: none; border: none; font-size: 22px; cursor: pointer; color: #64748b;">✕</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${all.map(t => {
            const icon = t.trade === 'air' ? '❄️' : (t.trade === 'electrical' ? '⚡' : (t.trade === 'plumbing' ? '🚰' : '🛠️'));
            const isSelected = t.id === currentTech.id;
            return `
              <div class="tech-select-item ${isSelected ? 'selected' : ''}" data-id="${t.id}">
                <div style="width: 44px; height: 44px; border-radius: 50%; background: #ffedd5; color: #c2410c; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">
                  ${icon}
                </div>
                <div style="flex: 1;">
                  <div class="tech-select-name">
                    ${t.name} ${t.nickname ? `(${t.nickname})` : ''}
                  </div>
                  <div class="tech-select-sub">
                    <span style="font-family: monospace; font-weight: 700; color: #ea580c;">${t.id}</span> · ${getTradeLabel(t.trade)}
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 13px; font-weight: 800; color: #b45309;">⭐ ${t.customerRating}</div>
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
    let emptyIcon = '☕';
    let emptyTitle = 'ไม่มีงานที่ต้องทำในขณะนี้';
    if (currentTab === 'submitted') {
      emptyIcon = '📋';
      emptyTitle = 'ไม่มีงานที่รอตรวจในขณะนี้';
    } else if (currentTab === 'completed') {
      emptyIcon = '🏁';
      emptyTitle = 'ไม่มีประวัติงานที่เสร็จสิ้น';
    }

    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${emptyIcon}</div>
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
    statusText = '🚗 กำลังเดินทาง';
  } else if (isSubmitted) {
    statusBadgeClass = 'status-submitted';
    statusText = '⏳ ส่งงานแล้ว รอตรวจงาน';
  } else if (isInProgress) {
    statusBadgeClass = 'status-in-progress';
    statusText = '🔧 กำลังทำงานหน้างาน';
  } else if (isCompleted) {
    statusBadgeClass = 'status-completed';
    statusText = '✓ งานเสร็จสิ้น';
  }

  const draft = photoDrafts.get(job.id) || { beforePhoto: '', afterPhoto: '', notes: '' };
  const beforePhoto = draft.beforePhoto || (job.beforePhotos && job.beforePhotos[0]) || '';
  const afterPhoto = draft.afterPhoto || (job.afterPhotos && job.afterPhotos[0]) || '';
  const currentNotes = draft.notes || job.techNotes || '';

  const customerName = job.customerName || (job.customerId ? job.customerId.slice(0, 16) : 'คุณเชิดศักดิ์ (เจ้าของบ้าน)');
  const customerPhone = job.customerPhone || '081-882-9988';
  const addressText = job.addressDetail || '88/12 ถ.สุเทพ ต.สุเทพ อ.เมือง จ.เชียงใหม่';

  return `
    <div class="tech-job-card" id="card-${job.id}">
      <div class="job-header">
        <div class="job-code">#${job.id.slice(0, 8).toUpperCase()}</div>
        <div class="job-status-badge ${statusBadgeClass}">${statusText}</div>
      </div>

      <div class="job-body">
        <!-- ชื่องานชัดเจน จบในตัว ไร้คำอธิบายซ้ำซาก -->
        <div class="job-title">
          🛠️ ${escapeHtml(job.title || 'งานบริการช่าง')}
        </div>

        <!-- ข้อมูลสำคัญตรงกับจอลูกค้า 100% -->
        <div class="job-info-grid">
          <div class="job-info-item">
            <div class="job-info-label">เวลานัดหมาย</div>
            <div class="job-info-value">📅 ${dateStr}</div>
          </div>
          <div class="job-info-item">
            <div class="job-info-label">ราคารวมสุทธิ</div>
            <div class="job-info-value job-price-value">฿${(job.price || 0).toLocaleString()}</div>
          </div>
          <div class="job-info-item">
            <div class="job-info-label">ชื่อลูกค้า</div>
            <div class="job-info-value">${escapeHtml(customerName)}</div>
          </div>
          <div class="job-info-item">
            <div class="job-info-label">เบอร์ติดต่อ</div>
            <div class="job-info-value">
              <a href="tel:${escapeHtml(customerPhone)}" class="btn-tech-call">📞 โทรหาลูกค้า</a>
            </div>
          </div>
        </div>

        <!-- ที่อยู่หน้างาน + ปุ่มนำทาง -->
        <div class="job-location-box">
          <div class="job-location-text">
            📍 ที่อยู่หน้างาน: ${escapeHtml(addressText)}
          </div>
          <a href="https://maps.google.com" target="_blank" class="btn-tech-nav">🗺️ นำทาง</a>
        </div>

        <!-- ปุ่มและแบบฟอร์มการทำงาน (Senior-First Tap Targets) -->
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
            <div class="submit-form-card">
              <div class="submit-form-title">
                📷 ถ่ายรูปส่งงาน
              </div>

              <div class="photo-upload-grid">
                <!-- รูปก่อนทำ -->
                <div class="photo-upload-box ${beforePhoto ? 'has-photo' : ''}" id="box-before-${job.id}">
                  <div class="photo-upload-label">รูปก่อนทำ</div>
                  ${beforePhoto ? `
                    <img src="${beforePhoto}" class="photo-preview-img" alt="รูปก่อนทำ" />
                  ` : `
                    <div style="font-size: 28px; margin: 4px 0;">📸</div>
                    <span style="font-size: 14px; font-weight: 700; color: #64748b;">แตะถ่ายรูป</span>
                  `}
                  <input type="file" accept="image/*" class="file-input-hidden" id="file-before-${job.id}" />
                  <button type="button" class="btn-mock-photo" id="mock-before-${job.id}">
                    ${beforePhoto ? 'เปลี่ยนรูป' : '✨ ใช้รูปตัวอย่าง'}
                  </button>
                </div>

                <!-- รูปหลังทำ -->
                <div class="photo-upload-box ${afterPhoto ? 'has-photo' : ''}" id="box-after-${job.id}">
                  <div class="photo-upload-label">รูปหลังทำ</div>
                  ${afterPhoto ? `
                    <img src="${afterPhoto}" class="photo-preview-img" alt="รูปหลังทำ" />
                  ` : `
                    <div style="font-size: 28px; margin: 4px 0;">📸</div>
                    <span style="font-size: 14px; font-weight: 700; color: #64748b;">แตะถ่ายรูป</span>
                  `}
                  <input type="file" accept="image/*" class="file-input-hidden" id="file-after-${job.id}" />
                  <button type="button" class="btn-mock-photo" id="mock-after-${job.id}">
                    ${afterPhoto ? 'เปลี่ยนรูป' : '✨ ใช้รูปตัวอย่าง'}
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
              ⏳ ส่งงานเรียบร้อยแล้ว รอฝ่ายตรวจงานตรวจสอบ
            </div>
          ` : ''}

          ${isCompleted ? `
            <div class="tech-alert-card success">
              ✓ งานเสร็จสิ้นเรียบร้อยแล้ว
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
          agentName: `Agent-2: ช่าง [${currentTech.id}] ${currentTech.name} 🔧`,
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

  // ปุ่มถึงหน้างาน & เริ่มทำงาน
  const btnArrive = document.getElementById(`btn-arrive-${job.id}`);
  if (btnArrive) {
    btnArrive.onclick = async () => {
      btnArrive.disabled = true;
      btnArrive.textContent = 'กำลังบันทึก...';
      try {
        await updateDoc(doc(db, 'jobs', job.id), {
          status: 'in_progress',
          workflowStep: 7,
          workflowStatus: 'in_progress',
          workStartedAt: new Date().toISOString(),
        });

        await logAgentActivity({
          agentId: 'agent-2-tech',
          agentName: `Agent-2: ช่าง [${currentTech.id}] ${currentTech.name} 🔧`,
          step: 7,
          stepName: '7. ช่างถึงหน้างาน & เริ่มซ่อม',
          action: 'TECH_ARRIVED_ON_SITE',
          jobId: job.id,
          status: 'success',
          details: {
            techId: currentTech.id,
          },
        });

        showToast('ถึงหน้างานแล้ว เริ่มต้นลงมือทำงาน', 'success');
      } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
        btnArrive.disabled = false;
        btnArrive.textContent = 'ถึงหน้างาน เริ่มทำงาน';
      }
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
          agentName: `Agent-2: ช่าง [${currentTech.id}] ${currentTech.name} 🔧`,
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
  toast.innerHTML = `<span style="font-size: 20px;">✓</span><span>${message}</span>`;
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
