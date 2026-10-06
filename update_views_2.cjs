const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, 'src', 'main.js');
let content = fs.readFileSync(filepath, 'utf8');

const replacementJobs = `function renderJobsView(container) {
  container.innerHTML = \`
    <div class="catalog-header">
      <div>
        <h2 class="catalog-title">📋 คิวงานซ่อม</h2>
        <p class="catalog-subtitle">ระบบบริหารจัดการและติดตามสถานะงานซ่อม</p>
      </div>
    </div>
    
    <!-- 5 State Tabs -->
    <div class="nav-tabs" style="margin-bottom: 20px; display: flex; gap: 8px; overflow-x: auto; padding: 4px;">
      <button class="nav-tab \${currentJobTab === 'active' ? 'active' : ''}" data-tab="active">🟡 กำลังดำเนินการ</button>
      <button class="nav-tab \${currentJobTab === 'pending' ? 'active' : ''}" data-tab="pending">🔵 งานรอคิว</button>
      <button class="nav-tab \${currentJobTab === 'special' ? 'active' : ''}" data-tab="special">⭐ งานนอกเมนู</button>
      <button class="nav-tab \${currentJobTab === 'completed' ? 'active' : ''}" data-tab="completed">🟢 งานเสร็จสิ้น</button>
      <button class="nav-tab \${currentJobTab === 'all' ? 'active' : ''}" data-tab="all">⚪ งานทั้งหมด</button>
    </div>

    <!-- Date Filters -->
    <div style="display: flex; gap: 12px; margin-bottom: 20px; align-items: center;">
      <span style="font-size: 14px; font-weight: 600; color: var(--gray-700);">ตัวกรอง:</span>
      <select id="filter-month" class="form-input select-input" style="width: 150px; margin-bottom: 0;">
        <option value="all" \${filterMonth === 'all' ? 'selected' : ''}>ทุกเดือน</option>
        <option value="1" \${filterMonth === '1' ? 'selected' : ''}>ม.ค.</option>
        <option value="2" \${filterMonth === '2' ? 'selected' : ''}>ก.พ.</option>
        <option value="3" \${filterMonth === '3' ? 'selected' : ''}>มี.ค.</option>
        <option value="4" \${filterMonth === '4' ? 'selected' : ''}>เม.ย.</option>
        <option value="5" \${filterMonth === '5' ? 'selected' : ''}>พ.ค.</option>
        <option value="6" \${filterMonth === '6' ? 'selected' : ''}>มิ.ย.</option>
        <option value="7" \${filterMonth === '7' ? 'selected' : ''}>ก.ค.</option>
        <option value="8" \${filterMonth === '8' ? 'selected' : ''}>ส.ค.</option>
        <option value="9" \${filterMonth === '9' ? 'selected' : ''}>ก.ย.</option>
        <option value="10" \${filterMonth === '10' ? 'selected' : ''}>ต.ค.</option>
        <option value="11" \${filterMonth === '11' ? 'selected' : ''}>พ.ย.</option>
        <option value="12" \${filterMonth === '12' ? 'selected' : ''}>ธ.ค.</option>
      </select>
      <select id="filter-year" class="form-input select-input" style="width: 120px; margin-bottom: 0;">
        <option value="all" \${filterYear === 'all' ? 'selected' : ''}>ทุกปี</option>
        <option value="2569" \${filterYear === '2569' ? 'selected' : ''}>2569 (2026)</option>
        <option value="2568" \${filterYear === '2568' ? 'selected' : ''}>2568 (2025)</option>
      </select>
    </div>

    <!-- Table View -->
    <div class="table-responsive card" style="padding: 0; overflow: hidden; margin-bottom: 20px;" id="jobs-table-container">
      กำลังโหลด...
    </div>
    
    <div id="job-modal-container"></div>
  \`;

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
    if (tcontainer) tcontainer.innerHTML = \`<div class="error" style="padding:20px;">โหลดงานไม่สำเร็จ: \${err.message}</div>\`;
  });
}

async function refreshJobsTable() {
  const container = document.getElementById('jobs-table-container');
  if (!container || !window._allJobs) return;
  
  if (currentJobTab === 'special') {
    container.innerHTML = \`
      <div style="text-align: center; padding: 40px;">
        <span class="badge" style="background: #eab308; color: #fff; font-size: 14px;">Exclusive Admin Level 1-2 PPT</span>
        <p class="meta" style="margin-top: 10px;">งานราคาสูง/เสี่ยงสูง เช่น ทาสีโรยตัวตึกสูง รีโนเวทใหญ่</p>
        <p class="meta">กำลังสร้างระบบจัดการงานโครงการพิเศษ...</p>
      </div>
    \`;
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

  let tableHtml = \`
    <table class="catalog-table">
      <thead>
        <tr>
          <th style="width: 100px;"># รหัสงาน</th>
          <th style="width: 140px;">วัน/เวลานัดหมาย</th>
          <th>รายการงานซ่อม</th>
          \${showStatusCol ? '<th style="width: 130px; text-align:center;">สถานะงาน</th>' : ''}
          <th style="width: 160px;">ลูกค้า</th>
          <th style="width: 160px;">สถานที่ / โซน</th>
          <th style="width: 140px;">ช่างผู้รับผิดชอบ</th>
          <th style="width: 110px;">ราคาประเมิน</th>
          <th style="width: 70px; text-align: center;">จัดการ</th>
        </tr>
      </thead>
      <tbody>
  \`;

  if (filtered.length === 0) {
    tableHtml += \`<tr><td colspan="\${showStatusCol ? 9 : 8}" class="meta" style="text-align: center;">ไม่พบข้อมูลคิวงานซ่อม</td></tr>\`;
  } else {
    for (const j of filtered) {
      const category = CATEGORIES[j.category] || { name: j.category, icon: '🔧' };
      const dateObj = new Date(j.scheduledDate || j.createdAt);
      const dateStr = dateObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const address = j.addressId ? await resolveAddress(j.addressId) : '(ไม่มีที่อยู่)';
      const step = STATUS_STEPS.find((s) => s.value === j.status) || STATUS_STEPS[0];
      
      tableHtml += \`
        <tr class="service-row" id="job-row-\${j.id}">
          <td style="font-family: monospace; font-weight: 700; color: var(--navy); font-size: 12px;">\${j.id.slice(0, 8).toUpperCase()}</td>
          <td style="font-size: 12px; color: var(--gray-700);">\${dateStr}</td>
          <td>
            <div style="font-weight: 600; color: var(--gray-900);">\${category.icon} \${category.name}</div>
            <div style="font-size: 11px; color: var(--gray-600);">\${escapeHtml(j.title || '-')}</div>
          </td>
          \${showStatusCol ? \`<td style="text-align:center;"><span class="badge \${step.badge}" style="font-size: 11px;">\${step.label}</span></td>\` : ''}
          <td style="font-size: 12px;">\${escapeHtml(j.customerId?.slice(0, 15) || '-')}</td>
          <td style="font-size: 12px; color: var(--gray-600); max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="\${escapeHtml(address)}">\${escapeHtml(address)}</td>
          <td style="font-size: 12px; font-weight: 600; color: \${j.assignedTeamId ? 'var(--mint-600)' : 'var(--amber)'};">\${escapeHtml(j.assignedTeamId || 'รอการยืนยัน')}</td>
          <td style="font-weight: 600; color: var(--navy);">฿\${(j.price || 0).toLocaleString()}</td>
          <td style="text-align: center;">
            <button class="secondary btn-sm btn-job-detail" data-id="\${j.id}" title="ดูข้อมูล/แก้ไข" style="font-size: 14px; padding: 4px 8px;">👁️</button>
          </td>
        </tr>
      \`;
    }
  }
  
  tableHtml += \`</tbody></table>\`;
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

  modalContainer.innerHTML = \`
    <div class="modal-backdrop" id="job-modal-backdrop" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;">
      <div class="modal-dialog card" style="width: 650px; max-width: 90%; max-height: 90vh; overflow-y: auto; padding: 24px; position: relative;">
        <button class="modal-close-btn" id="job-modal-close" style="position: absolute; right: 16px; top: 16px; background: none; border: none; font-size: 18px; cursor: pointer;">✕</button>
        
        <div style="margin-bottom: 20px; border-bottom: 1px solid var(--gray-200); padding-bottom: 16px;">
          <div style="font-size: 12px; color: var(--gray-600); font-family: monospace;">รหัสงาน: \${job.id}</div>
          <h2 style="margin: 4px 0 8px 0;">\${category.icon} \${category.name}</h2>
          <span class="badge \${step.badge}" style="font-size: 13px;">สถานะ: \${step.label}</span>
        </div>

        <div style="margin-bottom: 16px;">
          <h4 style="margin: 0 0 8px 0; color: var(--navy);">รายละเอียดอาการเสีย / หมายเหตุ</h4>
          <p style="margin: 0; font-size: 14px; color: var(--gray-700); background: var(--gray-50); padding: 12px; border-radius: var(--radius-sm);">\${escapeHtml(job.title || 'ไม่มีรายละเอียด')}</p>
        </div>

        <div style="margin-bottom: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <h4 style="margin: 0 0 8px 0; color: var(--navy);">ข้อมูลการนัดหมาย</h4>
            <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: var(--gray-700);">
              <li><strong>เวลานัดหมาย:</strong> \${dateStr}</li>
              <li><strong>ลูกค้า:</strong> \${escapeHtml(job.customerId || '-')}</li>
            </ul>
          </div>
          <div>
            <h4 style="margin: 0 0 8px 0; color: var(--navy);">สถานที่ & โซน</h4>
            <div style="font-size: 14px; color: var(--gray-700);">\${escapeHtml(address)}</div>
          </div>
        </div>

        <div style="margin-bottom: 24px; background: var(--gray-50); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200);">
          <h4 style="margin: 0 0 12px 0; color: var(--navy);">ข้อมูลความประสงค์เรื่องช่าง</h4>
          
          <div style="display: flex; flex-direction: column; gap: 12px; font-size: 14px;">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--gray-300); padding-bottom: 8px;">
              <span style="font-weight: 600; color: var(--gray-700);">🎯 ความประสงค์ของลูกค้า:</span>
              <span style="color: var(--navy);">\${job.technicianPreference === 'ai' ? '[🤖 ให้ระบบ AI จัดหาช่างให้อัตโนมัติ]' : '[👤 ลูกค้าประสงค์เลือกช่างเอง]'}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--gray-300); padding-bottom: 8px;">
              <span style="font-weight: 600; color: var(--gray-700);">👤 ช่างที่ลูกค้าเลือก:</span>
              <span style="color: var(--gray-900);">\${job.technicianPreference === 'ai' ? '<span style="color: var(--gray-500); font-style: italic;">ลูกค้าให้ระบบจัดให้</span>' : escapeHtml(job.customerSelectedTech || 'ไม่ได้ระบุ')}</span>
            </div>

            <div style="display: flex; justify-content: space-between; padding-bottom: 4px;">
              <span style="font-weight: 600; color: var(--gray-700);">🤖 ช่างที่ AI จับคู่:</span>
              <span style="color: var(--mint-600); font-weight: 600;">\${job.aiRecommendedTech ? \`\${escapeHtml(job.aiRecommendedTech)} (Match: \${job.aiMatchScore || 95}%)\` : '<span style="color: var(--gray-500); font-style: italic; font-weight: normal;">กำลังประมวลผล...</span>'}</span>
            </div>
          </div>
          
          <div style="margin-top: 16px;">
            <label class="form-label">ช่างผู้รับผิดชอบงานนี้ (Assigned Technician)</label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="modal-assign-tech" class="form-input" placeholder="พิมพ์ชื่อช่างที่ต้องการมอบหมาย..." value="\${escapeHtml(job.assignedTeamId || '')}" style="margin-bottom: 0; flex: 1;">
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--gray-200); padding-top: 16px;">
          <button class="secondary" id="btn-save-assign">💾 บันทึกผู้รับผิดชอบ</button>
          \${step.action ? \`<button class="btn-mint" id="btn-advance-status">\${step.action} (ขั้นถัดไป)</button>\` : ''}
        </div>
      </div>
    </div>
  \`;

  document.getElementById('job-modal-close').onclick = () => {
    modalContainer.innerHTML = '';
  };
  document.getElementById('job-modal-backdrop').onclick = (e) => {
    if (e.target.id === 'job-modal-backdrop') modalContainer.innerHTML = '';
  };

  document.getElementById('btn-save-assign').onclick = async () => {
    const val = document.getElementById('modal-assign-tech').value.trim();
    if (!val) return;
    try {
      await updateDoc(doc(db, 'jobs', job.id), { assignedTeamId: val });
      modalContainer.innerHTML = '';
      showToast('บันทึกผู้รับผิดชอบเรียบร้อย', 'success');
    } catch (e) {
      alert(\`อัปเดตไม่สำเร็จ: \${e.message}\`);
    }
  };

  const advanceBtn = document.getElementById('btn-advance-status');
  if (advanceBtn) {
    advanceBtn.onclick = async () => {
      if (step.value === 'pending_review') {
        const val = document.getElementById('modal-assign-tech').value.trim();
        if (!val) {
          alert('กรุณาระบุชื่อช่างก่อนมอบหมายงาน');
          return;
        }
        try {
          await updateDoc(doc(db, 'jobs', job.id), { assignedTeamId: val, status: 'assigned' });
          modalContainer.innerHTML = '';
          showToast('มอบหมายงานและเปลี่ยนสถานะเรียบร้อย', 'success');
        } catch (e) {
          alert(\`อัปเดตไม่สำเร็จ: \${e.message}\`);
        }
      } else {
        const nextStepVal = STATUS_STEPS[STATUS_STEPS.findIndex((s) => s.value === step.value) + 1].value;
        try {
          await updateDoc(doc(db, 'jobs', job.id), { status: nextStepVal });
          modalContainer.innerHTML = '';
          showToast('เปลี่ยนสถานะงานเรียบร้อย', 'success');
        } catch (e) {
          alert(\`อัปเดตไม่สำเร็จ: \${e.message}\`);
        }
      }
    };
  }
}
`;

const replacementTech = `
function renderTechniciansView(container) {
  const all = mockTechnicians.length;
  const available = mockTechnicians.filter(t => t.status === 'available').length;
  const busy = mockTechnicians.filter(t => t.status === 'busy').length;
  const inactive = mockTechnicians.filter(t => t.status === 'inactive').length;

  container.innerHTML = \`
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
      <div class="kpi-tile"><div class="kpi-value">\${all}</div><div class="kpi-label">ช่างทั้งหมด</div></div>
      <div class="kpi-tile" style="border-color: var(--mint);"><div class="kpi-value text-mint">\${available}</div><div class="kpi-label">พร้อมรับงาน</div></div>
      <div class="kpi-tile" style="border-color: var(--amber);"><div class="kpi-value text-amber">\${busy}</div><div class="kpi-label">ติดงาน</div></div>
      <div class="kpi-tile" style="border-color: var(--gray-400);"><div class="kpi-value" style="color: var(--gray-500);">\${inactive}</div><div class="kpi-label">พักงาน</div></div>
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
          \${mockTechnicians.map(t => \`
            <tr class="service-row">
              <td style="font-family: monospace; font-weight: 700; color: var(--navy);">\${t.id}</td>
              <td style="font-weight: 600; color: var(--gray-900);">\${t.name}</td>
              <td style="text-align: center;">
                <span class="badge \${t.status === 'available' ? '' : (t.status === 'busy' ? 'jobtype-large' : 'pending')}" 
                      style="\${t.status === 'available' ? 'background: var(--mint-100); color: var(--mint-600);' : (t.status === 'busy' ? 'background: var(--amber-100); color: var(--amber);' : 'background: var(--gray-200); color: var(--gray-600);')}">
                  \${t.status === 'available' ? 'พร้อมรับงาน' : (t.status === 'busy' ? 'กำลังทำงาน' : 'พักงาน')}
                </span>
              </td>
              <td style="color: var(--gray-600);">\${t.gender} \${t.age}</td>
              <td>\${t.phone}</td>
              <td>
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  \${t.skills.map(s => \`<span class="badge" style="background: var(--gray-100); color: var(--gray-700); font-size: 11px;">\${s}</span>\`).join('')}
                </div>
              </td>
              <td>
                <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
                  <span>🏅 PPT QC: \${t.qcScore}</span>
                  <span>⭐ รีวิว: \${t.reviewScore}</span>
                </div>
              </td>
              <td style="color: var(--gray-700);">\${t.paymentModel}</td>
              <td style="text-align: center;">
                <button class="secondary btn-sm" onclick="alert('ฟังก์ชันแก้ไขช่าง')">✏️</button>
                <button class="secondary btn-sm" onclick="alert('ฟังก์ชันดูประวัติ')">🔍</button>
              </td>
            </tr>
          \`).join('')}
        </tbody>
      </table>
    </div>
    
    <!-- Tech Modal Container -->
    <div id="tech-modal-container"></div>
  \`;

  document.getElementById('btn-add-tech').onclick = () => {
    const m = document.getElementById('tech-modal-container');
    m.innerHTML = \`
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
    \`;
    document.getElementById('tech-modal-close').onclick = () => m.innerHTML = '';
    document.getElementById('tech-modal-backdrop').onclick = (e) => { if(e.target.id === 'tech-modal-backdrop') m.innerHTML = ''; };
    document.getElementById('btn-save-tech').onclick = () => { m.innerHTML = ''; showToast('บันทึกข้อมูลช่างเรียบร้อย'); };
  };
}
`;

const jobsRegex = /function renderJobsView[\s\S]*?async function openJobModal[\s\S]*?^}/m;
content = content.replace(jobsRegex, replacementJobs);

const techRegex = /function renderTechniciansView[\s\S]*?^\}/m;
content = content.replace(techRegex, replacementTech);

fs.writeFileSync(filepath, content, 'utf8');
console.log("Updated main.js with modified jobs and technicians views.");
