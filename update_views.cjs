const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, 'src', 'main.js');
let content = fs.readFileSync(filepath, 'utf8');

const replacement = `
let mockTechnicians = [
  { id: 'PPT-TC01', name: 'สมชาย ใจดี (ชาย)', gender: 'ชาย', age: 35, phone: '081-111-2222', skills: ['❄️ แอร์', '⚡ ไฟฟ้า'], qcScore: 4.8, reviewScore: 4.9, paymentModel: 'ส่วนแบ่ง %', status: 'available' },
  { id: 'PPT-TC02', name: 'วิชัย รักงาน (ชัย)', gender: 'ชาย', age: 42, phone: '082-222-3333', skills: ['🚰 ประปา', '🏠 ซ่อมบ้าน'], qcScore: 4.5, reviewScore: 4.7, paymentModel: 'เงินเดือน', status: 'busy' },
  { id: 'PPT-TC03', name: 'นพดล เก่งมาก (นพ)', gender: 'ชาย', age: 28, phone: '083-333-4444', skills: ['❄️ แอร์'], qcScore: 4.9, reviewScore: 5.0, paymentModel: 'เหมาต่องาน', status: 'available' },
  { id: 'PPT-TC04', name: 'สุดา ช่างแอร์ (ดา)', gender: 'หญิง', age: 31, phone: '084-444-5555', skills: ['❄️ แอร์', '⚡ ไฟฟ้า'], qcScore: 4.6, reviewScore: 4.8, paymentModel: 'ส่วนแบ่ง %', status: 'inactive' },
  { id: 'PPT-TC05', name: 'อำนาจ ทรงพลัง (อ่ำ)', gender: 'ชาย', age: 45, phone: '085-555-6666', skills: ['🏠 ซ่อมบ้าน', '🚰 ประปา', '⚡ ไฟฟ้า'], qcScore: 4.7, reviewScore: 4.6, paymentModel: 'เหมาต่องาน', status: 'busy' },
];

let mockCustomers = [
  { id: 'CUST-01', name: 'คุณนารี สวยเสมอ', phone: '091-111-1111', zone: 'นิมมาน, เชียงใหม่', jobCount: 5, totalSpend: 15500, history: [{ date: '2026-09-10', code: 'AC-CLN-001', service: 'ล้างแอร์ติดผนัง', tech: 'สมชาย ใจดี', price: 550, review: 'ดีมาก ช่างตรงต่อเวลา ⭐⭐⭐⭐⭐' }, { date: '2026-08-15', code: 'EL-REP-002', service: 'ซ่อมไฟรัดวงจร', tech: 'สมชาย ใจดี', price: 1200, review: 'ดีครับ ⭐⭐⭐⭐' }] },
  { id: 'CUST-02', name: 'บจก. คาเฟ่ เชียงใหม่', phone: '092-222-2222', zone: 'แม่เหียะ, เชียงใหม่', jobCount: 12, totalSpend: 45000, history: [{ date: '2026-09-08', code: 'EL-REP-005', service: 'ซ่อมไฟช็อต', tech: 'อำนาจ ทรงพลัง', price: 1200, review: 'แก้ไขได้รวดเร็ว ⭐⭐⭐⭐' }] },
  { id: 'CUST-03', name: 'ดร. วิชาญ เรียนดี', phone: '093-333-3333', zone: 'สันผีเสื้อ, เชียงใหม่', jobCount: 2, totalSpend: 2800, history: [{ date: '2026-09-01', code: 'PL-LEK-002', service: 'ซ่อมท่อประปารั่ว', tech: 'วิชัย รักงาน', price: 800, review: 'งานเรียบร้อยดี ⭐⭐⭐⭐⭐' }] },
  { id: 'CUST-04', name: 'ร้านอาหาร ไทยล้านนา', phone: '094-444-4444', zone: 'ช้างคลาน, เชียงใหม่', jobCount: 8, totalSpend: 23400, history: [{ date: '2026-08-25', code: 'AC-REP-009', service: 'ซ่อมแอร์ไม่เย็น', tech: 'นพดล เก่งมาก', price: 3500, review: 'แอร์เย็นฉ่ำเหมือนใหม่ ⭐⭐⭐⭐⭐' }] },
  { id: 'CUST-05', name: 'คุณสมศักดิ์ มั่งมี', phone: '095-555-5555', zone: 'สันทราย, เชียงใหม่', jobCount: 1, totalSpend: 550, history: [{ date: '2026-08-20', code: 'AC-CLN-010', service: 'ล้างแอร์ติดผนัง', tech: 'สุดา ช่างแอร์', price: 550, review: 'ช่างอัธยาศัยดี ⭐⭐⭐⭐⭐' }] },
];

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
            <th style="width: 90px;">เพศ/อายุ</th>
            <th style="width: 120px;">เบอร์โทร</th>
            <th>ทักษะความชำนาญ</th>
            <th style="width: 140px;">คะแนน (QC | ลูกค้า)</th>
            <th style="width: 120px;">โมเดลค่าแรง</th>
            <th style="width: 100px; text-align: center;">สถานะ</th>
            <th style="width: 120px; text-align: center;">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          \${mockTechnicians.map(t => \`
            <tr class="service-row">
              <td style="font-family: monospace; font-weight: 700; color: var(--navy);">\${t.id}</td>
              <td style="font-weight: 600; color: var(--gray-900);">\${t.name}</td>
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
                <span class="badge \${t.status === 'available' ? '' : (t.status === 'busy' ? 'jobtype-large' : 'pending')}" 
                      style="\${t.status === 'available' ? 'background: var(--mint-100); color: var(--mint-600);' : (t.status === 'busy' ? 'background: var(--amber-100); color: var(--amber);' : 'background: var(--gray-200); color: var(--gray-600);')}">
                  \${t.status === 'available' ? 'พร้อมรับงาน' : (t.status === 'busy' ? 'กำลังทำงาน' : 'พักงาน')}
                </span>
              </td>
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

let customerSearchKeyword = '';

function renderCustomersView(container) {
  const filtered = mockCustomers.filter(c => {
    if (!customerSearchKeyword) return true;
    const q = customerSearchKeyword.toLowerCase();
    return c.name.toLowerCase().includes(q) || 
           c.phone.includes(q) || 
           c.zone.toLowerCase().includes(q);
  });

  container.innerHTML = \`
    <div class="catalog-header">
      <div>
        <h2 class="catalog-title">👥 ข้อมูลลูกค้า (Customers)</h2>
        <p class="catalog-subtitle">ระบบค้นหาอัจฉริยะ (Universal Smart Search) และประวัติงานซ่อม</p>
      </div>
    </div>
    <div class="card" style="margin-bottom: 20px;">
      <div class="search-input-wrapper" style="margin-bottom: 0;">
        <span class="search-icon">🔍</span>
        <input type="text" id="cust-search" class="catalog-search-input" placeholder="ค้นหา ชื่อ, สกุล, เบอร์โทร, โซนที่อยู่ แบบเรียลไทม์..." value="\${customerSearchKeyword}" />
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
            <th style="width: 130px; text-align: center;">จำนวนงานซ่อม</th>
            <th style="width: 130px; text-align: right;">ยอดใช้จ่ายสะสม</th>
            <th style="width: 120px; text-align: center;">ประวัติงาน</th>
          </tr>
        </thead>
        <tbody>
          \${filtered.length === 0 ? \`<tr><td colspan="7" class="meta" style="text-align: center;">ไม่พบข้อมูลลูกค้า</td></tr>\` : filtered.map(c => \`
            <tr class="service-row">
              <td style="font-family: monospace; font-weight: 700; color: var(--navy);">\${c.id}</td>
              <td style="font-weight: 600; color: var(--gray-900);">\${c.name}</td>
              <td>\${c.phone}</td>
              <td style="color: var(--gray-600);">\${c.zone}</td>
              <td style="text-align: center;"><span class="badge" style="background: var(--navy-100); color: var(--navy);">\${c.jobCount} งาน</span></td>
              <td style="text-align: right; font-weight: 700; color: var(--mint-600);">฿\${c.totalSpend.toLocaleString()}</td>
              <td style="text-align: center;">
                <button class="secondary btn-sm btn-cust-history" data-id="\${c.id}">🔍 ประวัติงาน</button>
              </td>
            </tr>
          \`).join('')}
        </tbody>
      </table>
    </div>

    <div id="cust-modal-container"></div>
  \`;

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
  
  m.innerHTML = \`
    <div class="modal-backdrop" id="cust-modal-backdrop" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;">
      <div class="modal-dialog card" style="width: 800px; max-width: 95%; max-height: 90vh; overflow-y: auto; position: relative; padding: 24px;">
        <button class="modal-close-btn" id="cust-modal-close" style="position: absolute; right: 16px; top: 16px; background: none; border: none; font-size: 18px; cursor: pointer;">✕</button>
        
        <div style="margin-bottom: 20px; border-bottom: 1px solid var(--gray-200); padding-bottom: 16px;">
          <h2 style="margin: 0 0 8px 0; color: var(--navy);">ประวัติงานซ่อม: \${cust.name}</h2>
          <div style="font-size: 13px; color: var(--gray-600);">รหัส: \${cust.id} | โทร: \${cust.phone} | โซน: \${cust.zone}</div>
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
              \${cust.history.map(h => \`
                <tr class="service-row">
                  <td style="font-size: 12px; color: var(--gray-600);">\${h.date}</td>
                  <td style="font-family: monospace; font-weight: 700; color: var(--navy); font-size: 12px;">\${h.code}</td>
                  <td style="font-weight: 600; color: var(--gray-900);">\${h.service}</td>
                  <td style="font-size: 12px; color: var(--gray-700);">\${h.tech}</td>
                  <td style="font-weight: 700; color: var(--navy); text-align: right;">฿\${h.price.toLocaleString()}</td>
                  <td style="font-size: 12px; color: var(--gray-600);">\${h.review}</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top: 16px; text-align: right;">
          <button class="secondary" id="btn-close-hist">ปิดหน้าต่าง</button>
        </div>
      </div>
    </div>
  \`;

  document.getElementById('cust-modal-close').onclick = () => m.innerHTML = '';
  document.getElementById('btn-close-hist').onclick = () => m.innerHTML = '';
  document.getElementById('cust-modal-backdrop').onclick = (e) => { if(e.target.id === 'cust-modal-backdrop') m.innerHTML = ''; };
}
`;

const regex = /function renderTechniciansView\([\s\S]*?function renderFinanceView/m;
content = content.replace(regex, replacement + "\n\nfunction renderFinanceView");
fs.writeFileSync(filepath, content, 'utf8');
console.log("Updated main.js with new Technicians and Customers views.");
