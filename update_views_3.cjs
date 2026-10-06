const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, 'src', 'main.js');
let content = fs.readFileSync(filepath, 'utf8');

// 1. Update STATUS_STEPS
const statusRegex = /const STATUS_STEPS = \[\s*\{ value: 'pending_review'[\s\S]*?\];/;
const newStatusSteps = `const STATUS_STEPS = [
  { value: 'pending_review', label: 'รอการยืนยัน', badge: 'pending' },
  { value: 'assigned', label: 'มอบหมายช่างแล้ว', badge: 'active' },
  { value: 'traveling', label: 'กำลังเดินทาง', badge: 'active' },
  { value: 'in_progress', label: 'กำลังซ่อมหน้างาน', badge: 'active' },
  { value: 'completed', label: 'งานเสร็จสิ้น', badge: 'done' },
  { value: 'cancelled', label: 'ยกเลิกงาน', badge: 'inactive' },
];`;
content = content.replace(statusRegex, newStatusSteps);

// 2. Update Mock Customers
const mockCustRegex = /let mockCustomers = \[\s*\{ id: 'CUST-01'[\s\S]*?\];/;
const newMockCustomers = `let mockCustomers = [
  { id: 'CUST-01', name: 'คุณนารี สวยเสมอ', phone: '091-111-1111', zone: 'นิมมาน, เชียงใหม่', currentStatus: 'normal', jobCount: 5, totalSpend: 15500, history: [{ date: '2026-09-10', code: 'AC-CLN-001', service: 'ล้างแอร์ติดผนัง', tech: 'สมชาย ใจดี', price: 550, review: 'ดีมาก ช่างตรงต่อเวลา ⭐⭐⭐⭐⭐' }] },
  { id: 'CUST-02', name: 'บจก. คาเฟ่ เชียงใหม่', phone: '092-222-2222', zone: 'แม่เหียะ, เชียงใหม่', currentStatus: 'in_progress', jobCount: 12, totalSpend: 45000, history: [{ date: '2026-09-08', code: 'EL-REP-005', service: 'ซ่อมไฟช็อต', tech: 'อำนาจ ทรงพลัง', price: 1200, review: 'แก้ไขได้รวดเร็ว ⭐⭐⭐⭐' }] },
  { id: 'CUST-03', name: 'ดร. วิชาญ เรียนดี', phone: '093-333-3333', zone: 'สันผีเสื้อ, เชียงใหม่', currentStatus: 'pending', jobCount: 2, totalSpend: 2800, history: [{ date: '2026-09-01', code: 'PL-LEK-002', service: 'ซ่อมท่อประปารั่ว', tech: 'วิชัย รักงาน', price: 800, review: 'งานเรียบร้อยดี ⭐⭐⭐⭐⭐' }] },
  { id: 'CUST-04', name: 'ร้านอาหาร ไทยล้านนา', phone: '094-444-4444', zone: 'ช้างคลาน, เชียงใหม่', currentStatus: 'normal', jobCount: 8, totalSpend: 23400, history: [{ date: '2026-08-25', code: 'AC-REP-009', service: 'ซ่อมแอร์ไม่เย็น', tech: 'นพดล เก่งมาก', price: 3500, review: 'แอร์เย็นฉ่ำเหมือนใหม่ ⭐⭐⭐⭐⭐' }] },
  { id: 'CUST-05', name: 'คุณสมศักดิ์ มั่งมี', phone: '095-555-5555', zone: 'สันทราย, เชียงใหม่', currentStatus: 'normal', jobCount: 1, totalSpend: 550, history: [{ date: '2026-08-20', code: 'AC-CLN-010', service: 'ล้างแอร์ติดผนัง', tech: 'สุดา ช่างแอร์', price: 550, review: 'ช่างอัธยาศัยดี ⭐⭐⭐⭐⭐' }] },
];`;
content = content.replace(mockCustRegex, newMockCustomers);

// 3. Update Job Button in table
content = content.replace(
  /<button class="secondary btn-sm btn-job-detail" data-id="\$\{j.id\}" title="ดูข้อมูล\/แก้ไข" style="font-size: 14px; padding: 4px 8px;">👁️<\/button>/g,
  '<button class="secondary btn-sm btn-job-detail" data-id="${j.id}" title="[📋 ใบงาน] ตรวจสอบ/แก้ไข" style="font-size: 14px; padding: 4px 8px;">📋</button>'
);

// 4. Update Job Modal logic to use a select for Status instead of action buttons
// Locate openJobModal
const modalSearchRegex = /<div style="margin-top: 16px;">\s*<label class="form-label">ช่างผู้รับผิดชอบงานนี้ \(Assigned Technician\)<\/label>[\s\S]*?<\/div>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*`;/m;

// Replace from assigned technician div up to end of modal HTML
const modalReplacement = `<div style="margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div>
              <label class="form-label">ช่างผู้รับผิดชอบงานนี้ (Assigned Technician)</label>
              <input type="text" id="modal-assign-tech" class="form-input" placeholder="พิมพ์ชื่อช่าง..." value="\${escapeHtml(job.assignedTeamId || '')}" style="margin-bottom: 0;">
            </div>
            <div>
              <label class="form-label">อัปเดตสถานะงาน (Job Status)</label>
              <select id="modal-update-status" class="form-input select-input" style="margin-bottom: 0;">
                \${STATUS_STEPS.map(s => \`<option value="\${s.value}" \${s.value === job.status ? 'selected' : ''}>\${s.label}</option>\`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--gray-200); padding-top: 16px;">
          <button class="btn-mint" id="btn-save-job-modal">💾 บันทึกข้อมูลและสถานะ</button>
        </div>
      </div>
    </div>
  \`;`;
content = content.replace(modalSearchRegex, modalReplacement);

// Remove the old button events and insert the new save event
const eventsSearchRegex = /document\.getElementById\('btn-save-assign'\)\.onclick = async \(\) => \{[\s\S]*?}\;\s*}\n/m;
const eventsReplacement = `document.getElementById('btn-save-job-modal').onclick = async () => {
    const val = document.getElementById('modal-assign-tech').value.trim();
    const newStatus = document.getElementById('modal-update-status').value;
    try {
      await updateDoc(doc(db, 'jobs', job.id), { assignedTeamId: val, status: newStatus });
      modalContainer.innerHTML = '';
      showToast('บันทึกข้อมูลและอัปเดตสถานะเรียบร้อย', 'success');
    } catch (e) {
      alert(\`อัปเดตไม่สำเร็จ: \${e.message}\`);
    }
  };
`;
content = content.replace(eventsSearchRegex, eventsReplacement);

// 5. Update renderCustomersView
const renderCustomersRegex = /<th style="width: 130px; text-align: center;">จำนวนงานซ่อม<\/th>[\s\S]*?<tbody>[\s\S]*?<\/tbody>/m;

const getStatusBadge = (status) => {
  if (status === 'normal') return '<span class="badge" style="background: var(--mint-100); color: var(--mint-600);">🟢 ปกติ</span>';
  if (status === 'in_progress') return '<span class="badge" style="background: var(--amber-100); color: var(--amber);">🟡 กำลังซ่อม</span>';
  if (status === 'pending') return '<span class="badge" style="background: var(--navy-100); color: var(--navy);">🔵 รอนัดหมาย</span>';
  return '';
};

// I will just use string replacement for the headers and body of customer table
let customerHtmlChunk = `<th style="width: 130px; text-align: center;">สถานะงานซ่อม</th>
            <th style="width: 130px; text-align: center;">จำนวนงานซ่อม</th>
            <th style="width: 130px; text-align: right;">ยอดใช้จ่ายสะสม</th>
            <th style="width: 120px; text-align: center;">ประวัติงาน</th>
          </tr>
        </thead>
        <tbody>
          \${filtered.length === 0 ? \`<tr><td colspan="8" class="meta" style="text-align: center;">ไม่พบข้อมูลลูกค้า</td></tr>\` : filtered.map(c => {
            let badge = '<span class="badge" style="background: var(--mint-100); color: var(--mint-600);">🟢 ปกติ</span>';
            if (c.currentStatus === 'in_progress') badge = '<span class="badge" style="background: var(--amber-100); color: var(--amber);">🟡 กำลังซ่อม</span>';
            else if (c.currentStatus === 'pending') badge = '<span class="badge" style="background: var(--navy-100); color: var(--navy);">🔵 รอนัดหมาย</span>';
            return \`
            <tr class="service-row">
              <td style="font-family: monospace; font-weight: 700; color: var(--navy);">\${c.id}</td>
              <td style="font-weight: 600; color: var(--gray-900);">\${c.name}</td>
              <td>\${c.phone}</td>
              <td style="color: var(--gray-600);">\${c.zone}</td>
              <td style="text-align: center;">\${badge}</td>
              <td style="text-align: center;"><span class="badge" style="background: var(--gray-100); color: var(--gray-700);">\${c.jobCount} งาน</span></td>
              <td style="text-align: right; font-weight: 700; color: var(--mint-600);">฿\${c.totalSpend.toLocaleString()}</td>
              <td style="text-align: center;">
                <button class="secondary btn-sm btn-cust-history" data-id="\${c.id}">🔍 ประวัติงาน</button>
              </td>
            </tr>
          \`}).join('')}
        </tbody>`;
        
content = content.replace(renderCustomersRegex, customerHtmlChunk);

fs.writeFileSync(filepath, content, 'utf8');
console.log("Updated main.js with new requested features.");
