import { db } from './firebase.js';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { MASTER_CATEGORIES, INITIAL_SERVICES } from './services-data.js';

const STORAGE_KEY = 'rakbaan_service_catalog_v1';

// Global state for catalog
let currentServices = [];
let activeCategoryFilter = 'all';
let activeStatusFilter = 'all';
let searchKeyword = '';
let editingServiceId = null;

/**
 * Initialize services data from Firestore or LocalStorage or Master Blueprint
 */
export async function loadServices() {
  // 1. Try LocalStorage first for instant rendering
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) {
    try {
      currentServices = JSON.parse(cached);
    } catch {
      currentServices = [...INITIAL_SERVICES];
    }
  } else {
    currentServices = [...INITIAL_SERVICES];
    saveToStorage(currentServices);
  }

  // 2. Try background sync with Firestore if collection exists
  try {
    const snap = await getDocs(collection(db, 'service_catalog'));
    if (!snap.empty) {
      const remoteItems = {};
      snap.forEach((doc) => {
        remoteItems[doc.id] = doc.data();
      });
      // Merge remote items with current
      currentServices = currentServices.map((svc) => {
        return remoteItems[svc.id] ? { ...svc, ...remoteItems[svc.id] } : svc;
      });
      // Also add any remote items not in currentServices
      snap.forEach((doc) => {
        if (!currentServices.some(s => s.id === doc.id)) {
          currentServices.push(doc.data());
        }
      });
      saveToStorage(currentServices);
    }
  } catch (err) {
    console.warn('Firestore service_catalog fetch skipped (using local cache):', err.message);
  }

  return currentServices;
}

function saveToStorage(services) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(services));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }
}

async function syncItemToFirestore(service) {
  try {
    const docRef = doc(db, 'service_catalog', service.id);
    await setDoc(docRef, {
      ...service,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (err) {
    console.warn('Could not sync to Firestore service_catalog (saved locally):', err.message);
  }
}

/**
 * Show a toast notification on the screen
 */
export function showToast(message, type = 'success') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : 'ℹ️'}</span>
    <span class="toast-msg">${message}</span>
  `;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/**
 * Get all available categories (Master + dynamic categories from currentServices)
 */
function getAllCategories() {
  const cats = [...MASTER_CATEGORIES];
  const seenIds = new Set(cats.map(c => c.id));
  currentServices.forEach(s => {
    if (s.categoryId && !seenIds.has(s.categoryId)) {
      seenIds.add(s.categoryId);
      cats.push({
        id: s.categoryId,
        name: s.categoryName || s.categoryId,
        fullName: `${s.categoryName || s.categoryId}`,
        icon: s.categoryIcon || '🔧',
        color: '#64748b',
        prefix: (s.categoryId.slice(0, 2) || 'OT').toUpperCase()
      });
    }
  });
  return cats;
}

/**
 * Get existing subcategories for a given category
 */
function getSubcategoriesForCategory(categoryId) {
  const subs = new Set();
  currentServices
    .filter(s => s.categoryId === categoryId)
    .forEach(s => {
      if (s.subCategory) subs.add(s.subCategory);
    });
  return Array.from(subs);
}

/**
 * Auto-generate recommended sequential job code according to category prefix
 */
function generateSuggestedCode(categoryId) {
  const cats = getAllCategories();
  const cat = cats.find(c => c.id === categoryId);
  const prefix = cat?.prefix || (categoryId ? categoryId.slice(0, 2).toUpperCase() : 'SRV');
  
  const existingCodes = new Set(currentServices.map(s => s.code.toUpperCase()));
  for (let i = 1; i <= 99; i++) {
    const num = String(i).padStart(2, '0');
    const candidate = `${prefix}-NEW-${num}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }
  return `${prefix}-NEW-${Date.now().toString().slice(-4)}`;
}

/**
 * Renders the entire Service Catalog view inside the given container
 */
export function renderCatalogView(container) {
  const totalCount = currentServices.length;
  const activeCount = currentServices.filter((s) => s.status === 'active').length;
  const pausedCount = totalCount - activeCount;
  const allCategories = getAllCategories();

  // Category counts
  const catCounts = { all: totalCount };
  allCategories.forEach(cat => {
    catCounts[cat.id] = currentServices.filter((s) => s.categoryId === cat.id).length;
  });

  container.innerHTML = `
    <div class="catalog-header">
      <div>
        <h2 class="catalog-title">จัดการรายการงานบริการ (Service Catalog & Pricing)</h2>
        <p class="catalog-subtitle">ระบบตั้งราคา มาตรฐานเวลาหน้างาน และเปิด/หยุดบริการ (No Hard-Delete Policy)</p>
      </div>
      <div class="catalog-header-actions" style="display: flex; gap: 10px; align-items: center;">
        <button class="secondary btn-sm" id="btn-header-print-report" title="พิมพ์รายงานหรือบันทึกเป็น PDF">
          🖨️ ออกรายงาน (PDF)
        </button>
        <button class="btn-mint" id="btn-header-create-service">
          ➕ เพิ่มงานบริการใหม่
        </button>
        <button class="secondary btn-sm" id="btn-reset-blueprint" title="รีเซ็ตค่ามาตรฐานกลับเป็น Master Blueprint">
          ↺ ค่ามาตรฐาน Blueprint
        </button>
      </div>
    </div>

    <!-- KPI Summary Row -->
    <div class="kpi-row">
      <div class="kpi-tile">
        <div class="kpi-value">${totalCount}</div>
        <div class="kpi-label">เนื้องานบริการทั้งหมด</div>
      </div>
      <div class="kpi-tile kpi-tile-active">
        <div class="kpi-value text-mint">${activeCount}</div>
        <div class="kpi-label">เปิดให้บริการ (Active)</div>
      </div>
      <div class="kpi-tile kpi-tile-paused">
        <div class="kpi-value text-amber">${pausedCount}</div>
        <div class="kpi-label">หยุดบริการชั่วคราว (Paused)</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-value">${allCategories.length}</div>
        <div class="kpi-label">หมวดหมู่หลัก</div>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div class="catalog-toolbar card">
      <div class="toolbar-search-row">
        <div class="search-input-wrapper">
          <span class="search-icon">🔍</span>
          <input 
            type="text" 
            id="catalog-search" 
            placeholder="ค้นหาชื่อเนื้องาน, รหัสงาน (เช่น AC-CLN-01), หรือขอบเขตงาน..." 
            value="${escapeHtml(searchKeyword)}"
            class="catalog-search-input"
          />
          ${searchKeyword ? `<button class="search-clear-btn" id="search-clear">✕</button>` : ''}
        </div>
        <div class="status-filter-group">
          <label class="status-filter-label">สถานะ:</label>
          <select id="status-filter-select" class="select-input">
            <option value="all" ${activeStatusFilter === 'all' ? 'selected' : ''}>ทั้งหมด (${totalCount})</option>
            <option value="active" ${activeStatusFilter === 'active' ? 'selected' : ''}>เปิดบริการ (${activeCount})</option>
            <option value="paused" ${activeStatusFilter === 'paused' ? 'selected' : ''}>หยุดบริการ (${pausedCount})</option>
          </select>
        </div>
        <button class="secondary" id="btn-toolbar-print-report" title="พิมพ์รายงานหรือบันทึกเป็น PDF">
          🖨️ ออกรายงาน
        </button>
        <button class="btn-mint" id="btn-toolbar-create-service">
          ➕ เพิ่มงานบริการใหม่
        </button>
      </div>

      <!-- Category Filter Pills -->
      <div class="category-pills">
        <button 
          class="cat-pill ${activeCategoryFilter === 'all' ? 'active' : ''}" 
          data-cat="all"
        >
          ทั้งหมด <span class="pill-count">${catCounts.all}</span>
        </button>
        ${allCategories.map((cat) => `
          <button 
            class="cat-pill ${activeCategoryFilter === cat.id ? 'active' : ''}" 
            data-cat="${cat.id}"
          >
            <span class="cat-pill-icon">${cat.icon}</span> ${cat.name}
            <span class="pill-count">${catCounts[cat.id] || 0}</span>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Services Table Section -->
    <div id="catalog-content"></div>

    <!-- Modal Container (For Edit and Create) -->
    <div id="modal-container"></div>
  `;

  attachCatalogEvents(container);
  renderCatalogItems();
}

/**
 * Filter items according to current filters & search query
 */
function getFilteredServices() {
  const query = searchKeyword.trim().toLowerCase();

  return currentServices.filter((svc) => {
    // Category filter
    if (activeCategoryFilter !== 'all' && svc.categoryId !== activeCategoryFilter) {
      return false;
    }

    // Status filter
    if (activeStatusFilter !== 'all' && svc.status !== activeStatusFilter) {
      return false;
    }

    // Search query filter
    if (query) {
      const matchCode = svc.code.toLowerCase().includes(query);
      const matchName = svc.name.toLowerCase().includes(query);
      const matchScope = (svc.scope || '').toLowerCase().includes(query);
      const matchSub = (svc.subCategory || '').toLowerCase().includes(query);
      if (!matchCode && !matchName && !matchScope && !matchSub) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Render items grouped by subcategory
 */
function renderCatalogItems() {
  const contentEl = document.getElementById('catalog-content');
  if (!contentEl) return;

  const filtered = getFilteredServices();

  if (filtered.length === 0) {
    contentEl.innerHTML = `
      <div class="card empty-state">
        <div class="empty-icon">🔎</div>
        <h3>ไม่พบรายการงานบริการที่ตรงกับเงื่อนไข</h3>
        <p class="meta">ลองเปลี่ยนคำค้นหา หรือเลือกหมวดหมู่อื่น หรือกดปุ่มเพื่อเพิ่มงานบริการใหม่</p>
        <div style="display: flex; gap: 10px; justify-content: center; margin-top: 14px;">
          <button class="btn-mint btn-sm" id="empty-create-btn">➕ เพิ่มงานบริการใหม่</button>
          <button class="secondary btn-sm" id="btn-clear-filters">ล้างตัวกรองทั้งหมด</button>
        </div>
      </div>
    `;
    const clearBtn = document.getElementById('btn-clear-filters');
    if (clearBtn) {
      clearBtn.onclick = () => {
        activeCategoryFilter = 'all';
        activeStatusFilter = 'all';
        searchKeyword = '';
        const container = document.getElementById('view-content');
        if (container) renderCatalogView(container);
      };
    }
    const emptyCreate = document.getElementById('empty-create-btn');
    if (emptyCreate) {
      emptyCreate.onclick = openCreateModal;
    }
    return;
  }

  // Group by Category -> SubCategory
  const groups = {};
  filtered.forEach((item) => {
    const key = `${item.categoryId}:::${item.subCategory}`;
    if (!groups[key]) {
      groups[key] = {
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        categoryIcon: item.categoryIcon,
        subCategory: item.subCategory,
        items: [],
      };
    }
    groups[key].items.push(item);
  });

  let html = '';
  for (const key of Object.keys(groups)) {
    const group = groups[key];
    html += `
      <div class="service-group-section">
        <div class="group-header">
          <span class="group-icon">${group.categoryIcon || '🔧'}</span>
          <span class="group-title">${escapeHtml(group.subCategory || 'ทั่วไป')}</span>
          <span class="badge" style="background:#f1f5f9; color:#475569;">${group.items.length} รายการ</span>
        </div>
        <div class="table-responsive card" style="padding: 0; overflow: hidden; margin-bottom: 20px;">
          <table class="catalog-table">
            <thead>
              <tr>
                <th style="width: 110px;">รหัสงาน</th>
                <th>รายการเนื้องาน / ขอบเขตงาน</th>
                <th style="width: 130px;">ราคาปกติ (บาท)</th>
                <th style="width: 120px;">เวลาหน้างาน</th>
                <th style="width: 100px; text-align: center;">การรับประกัน</th>
                <th style="width: 100px; text-align: center;">เปิด/หยุดบริการ</th>
                <th style="width: 80px; text-align: center;">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              ${group.items.map((item) => renderServiceRow(item)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  contentEl.innerHTML = html;
  attachRowEvents();
}

/**
 * Render single table row
 */
function renderServiceRow(item) {
  const isActive = item.status === 'active';
  const statusBadge = isActive
    ? `<span class="badge" style="background:#D8F5E9; color:#047857;">เปิดบริการ</span>`
    : `<span class="badge pending">หยุดบริการ</span>`;
  
  const warrantyBadge = (item.warranty_days || item.warranty_text)
    ? `<span class="badge" style="background:#D8F5E9; color:#047857;">🛡️ ${escapeHtml(item.warranty_text || item.warranty_days + ' วัน')}</span>`
    : `<span class="badge" style="background:#F3F4F6; color:#9CA3AF;">-</span>`;

  return `
    <tr class="service-row ${isActive ? '' : 'row-paused'}" id="row-${item.id}">
      <td class="col-code">
        <span class="code-badge">${escapeHtml(item.code)}</span>
      </td>
      <td class="col-name">
        <div class="service-name-text">${escapeHtml(item.name)}</div>
        <div class="service-scope-text" title="${escapeHtml(item.scope || '')}">${escapeHtml(item.scope || '-')}</div>
      </td>
      <td class="col-price">
        <div class="price-main">฿${(item.basePrice || 0).toLocaleString()}</div>
        <div class="price-meta">${escapeHtml(item.priceDisplay || '')}</div>
      </td>
      <td class="col-duration">
        <div class="duration-badge">⏱️ ${escapeHtml(item.durationDisplay || `${item.durationMinutes || 60} นาที`)}</div>
      </td>
      <td class="col-warranty" style="text-align: center;">
        ${warrantyBadge}
      </td>
      <td class="col-toggle" style="text-align: center;">
        <label class="toggle-switch" title="${isActive ? 'คลิกเพื่อหยุดบริการชั่วคราว' : 'คลิกเพื่อเปิดให้บริการ'}">
          <input 
            type="checkbox" 
            class="toggle-status-input" 
            data-id="${item.id}" 
            ${isActive ? 'checked' : ''}
          />
          <span class="toggle-slider"></span>
        </label>
        <div class="toggle-label-text">${statusBadge}</div>
      </td>
      <td class="col-action" style="text-align: center;">
        <button 
          class="btn-edit-service" 
          data-id="${item.id}"
          title="แก้ไขราคาและเวลา"
        >
          ✏️ แก้ไข
        </button>
      </td>
    </tr>
  `;
}

/**
 * Attach events to buttons, inputs, filters
 */
function attachCatalogEvents(container) {
  // Search input
  const searchInput = document.getElementById('catalog-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      searchKeyword = e.target.value;
      renderCatalogItems();
      const clearBtn = document.getElementById('search-clear');
      if (clearBtn) clearBtn.style.display = searchKeyword ? 'inline' : 'none';
    };
  }

  // Clear search
  const clearSearchBtn = document.getElementById('search-clear');
  if (clearSearchBtn) {
    clearSearchBtn.onclick = () => {
      searchKeyword = '';
      if (searchInput) searchInput.value = '';
      renderCatalogItems();
      clearSearchBtn.style.display = 'none';
    };
  }

  // Category pills
  const catPills = container.querySelectorAll('.cat-pill');
  catPills.forEach((pill) => {
    pill.onclick = () => {
      catPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      activeCategoryFilter = pill.getAttribute('data-cat');
      renderCatalogItems();
    };
  });

  // Status select filter
  const statusSelect = document.getElementById('status-filter-select');
  if (statusSelect) {
    statusSelect.onchange = (e) => {
      activeStatusFilter = e.target.value;
      renderCatalogItems();
    };
  }

  // Create service buttons (header & toolbar)
  const headerCreateBtn = document.getElementById('btn-header-create-service');
  if (headerCreateBtn) headerCreateBtn.onclick = openCreateModal;

  const toolbarCreateBtn = document.getElementById('btn-toolbar-create-service');
  if (toolbarCreateBtn) toolbarCreateBtn.onclick = openCreateModal;

  // Print report buttons (header & toolbar)
  const headerPrintBtn = document.getElementById('btn-header-print-report');
  if (headerPrintBtn) headerPrintBtn.onclick = openReportModal;

  const toolbarPrintBtn = document.getElementById('btn-toolbar-print-report');
  if (toolbarPrintBtn) toolbarPrintBtn.onclick = openReportModal;

  // Reset to Master Blueprint button
  const resetBtn = document.getElementById('btn-reset-blueprint');
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (window.confirm('คุณต้องการรีเซ็ตรายการบริการทั้งหมดกลับเป็นค่าตั้งต้นตาม Master Blueprint หรือไม่?')) {
        currentServices = JSON.parse(JSON.stringify(INITIAL_SERVICES));
        saveToStorage(currentServices);
        showToast('รีเซ็ตข้อมูลตาม Master Blueprint เรียบร้อยแล้ว', 'success');
        renderCatalogView(container);
      }
    };
  }
}

/**
 * Attach events to dynamic rows (toggles, edit buttons)
 */
function attachRowEvents() {
  // Status Toggles
  const toggles = document.querySelectorAll('.toggle-status-input');
  toggles.forEach((chk) => {
    chk.onchange = async (e) => {
      const id = e.target.getAttribute('data-id');
      const newStatus = e.target.checked ? 'active' : 'paused';
      
      const item = currentServices.find((s) => s.id === id);
      if (!item) return;

      item.status = newStatus;
      item.updatedAt = new Date().toISOString();

      saveToStorage(currentServices);
      syncItemToFirestore(item);

      showToast(
        `${item.code}: ${newStatus === 'active' ? 'เปิดให้บริการแล้ว' : 'หยุดให้บริการชั่วคราวแล้ว'}`,
        newStatus === 'active' ? 'success' : 'info'
      );

      // Refresh view to update KPI counters & row styles
      const container = document.getElementById('view-content');
      if (container) renderCatalogView(container);
    };
  });

  // Edit buttons
  const editBtns = document.querySelectorAll('.btn-edit-service');
  editBtns.forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      openEditModal(id);
    };
  });
}

/**
 * ============================================================
 * Modal 1: Edit Existing Service Modal
 * ============================================================
 */
function openEditModal(serviceId) {
  const item = currentServices.find((s) => s.id === serviceId);
  if (!item) return;

  editingServiceId = serviceId;
  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;

  modalContainer.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-dialog card">
        <div class="modal-header">
          <div>
            <div class="modal-category-tag">${item.categoryIcon || '🔧'} ${item.categoryName} · ${item.subCategory}</div>
            <h3 class="modal-title">${escapeHtml(item.name)}</h3>
            <span class="code-badge">${escapeHtml(item.code)}</span>
          </div>
          <button class="modal-close-btn" id="modal-close-btn">✕</button>
        </div>

        <form id="edit-service-form" class="modal-form">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="edit-base-price">ราคาปกติเริ่มต้น (บาท) *</label>
              <input 
                type="number" 
                id="edit-base-price" 
                name="basePrice" 
                value="${item.basePrice}" 
                min="0" 
                step="10" 
                required 
                class="form-input"
              />
              <span class="form-hint">ตัวเลขราคาเริ่มต้นสำหรับการคำนวณเบื้องต้น</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="edit-unit">หน่วยนับ</label>
              <input 
                type="text" 
                id="edit-unit" 
                name="unit" 
                value="${escapeHtml(item.unit || 'จุด')}" 
                class="form-input"
              />
              <span class="form-hint">เช่น เครื่อง, จุด, ชุด, ตัว, ถัง, ห้อง, บาน</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="edit-price-display">ข้อความแสดงราคา (Price Display)</label>
            <input 
              type="text" 
              id="edit-price-display" 
              name="priceDisplay" 
              value="${escapeHtml(item.priceDisplay || '')}" 
              placeholder="เช่น 550 - 650 / เครื่อง" 
              class="form-input"
            />
            <span class="form-hint">ข้อความรูปแบบราคาที่จะแสดงให้ลูกค้าและแอดมินเห็น</span>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="edit-duration-minutes">เวลาหน้างานโดยประมาณ (นาที) *</label>
              <input 
                type="number" 
                id="edit-duration-minutes" 
                name="durationMinutes" 
                value="${item.durationMinutes || 60}" 
                min="15" 
                step="15" 
                required 
                class="form-input"
              />
              <span class="form-hint">เช่น 45, 60, 90, 120, 180 นาที</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="edit-duration-display">ข้อความเวลาหน้างาน</label>
              <input 
                type="text" 
                id="edit-duration-display" 
                name="durationDisplay" 
                value="${escapeHtml(item.durationDisplay || '')}" 
                placeholder="เช่น 60 นาที (1 ชม.)" 
                class="form-input"
              />
              <span class="form-hint">เช่น 60 นาที (1 ชม.) หรือ 2 ชม.</span>
            </div>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="edit-advance-notice">เวลาจองล่วงหน้า (Advance Notice)</label>
              <input 
                type="text" 
                id="edit-advance-notice" 
                name="advanceNotice" 
                value="${escapeHtml(item.advanceNotice || '2 ชม.')}" 
                placeholder="เช่น 2 ชม. หรือ 24 ชม." 
                class="form-input"
              />
              <span class="form-hint">เวลาขั้นต่ำที่ลูกค้าต้องแจ้งล่วงหน้า</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="edit-status">สถานะการให้บริการ (ห้ามลบ)</label>
              <select id="edit-status" name="status" class="form-input select-input">
                <option value="active" ${item.status === 'active' ? 'selected' : ''}>🟢 เปิดให้บริการ (Active)</option>
                <option value="paused" ${item.status === 'paused' ? 'selected' : ''}>⏸️ หยุดให้บริการชั่วคราว (Paused)</option>
              </select>
              <span class="form-hint">หากคิวเต็มหรือขาดอะไหล่ให้เลือก "หยุดให้บริการชั่วคราว"</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="edit-scope">ขอบเขตงานโดยย่อ (Scope of Work)</label>
            <textarea 
              id="edit-scope" 
              name="scope" 
              rows="2" 
              class="form-input textarea-input"
            >${escapeHtml(item.scope || '')}</textarea>
            <span class="form-hint">รายละเอียดขอบเขตงานที่ช่างต้องปฏิบัติ</span>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                id="edit-after-hours" 
                name="afterHoursAllowed" 
                ${item.afterHoursAllowed ? 'checked' : ''}
              />
              <span>อนุญาตให้รับงานนอกเวลาทำการได้ (After-Hours / Night Slot)</span>
            </label>
          </div>

          <div class="modal-actions">
            <button type="button" class="secondary" id="btn-cancel-modal">ยกเลิก</button>
            <button type="submit" class="primary" id="btn-save-service">💾 บันทึกการเปลี่ยนแปลง</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Attach modal close & save events
  document.getElementById('modal-close-btn').onclick = closeModal;
  document.getElementById('btn-cancel-modal').onclick = closeModal;
  document.getElementById('modal-backdrop').onclick = (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  };

  const form = document.getElementById('edit-service-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    await saveEditedService(item);
  };
}

/**
 * ============================================================
 * Modal 2: Create New Service Modal ("➕ เพิ่มงานบริการใหม่")
 * ============================================================
 */
export function openCreateModal() {
  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;

  const allCategories = getAllCategories();
  const initialCategory = allCategories[0]?.id || 'air_con';
  const initialSubcategories = getSubcategoriesForCategory(initialCategory);
  const initialCode = generateSuggestedCode(initialCategory);

  modalContainer.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-dialog card">
        <div class="modal-header">
          <div>
            <div class="modal-category-tag">➕ บริหารจัดการบริการ</div>
            <h3 class="modal-title">เพิ่มรายการงานบริการใหม่</h3>
            <span class="badge" style="background:#D8F5E9; color:#047857;">New Service Catalog Item</span>
          </div>
          <button class="modal-close-btn" id="modal-close-btn">✕</button>
        </div>

        <form id="create-service-form" class="modal-form">
          
          <!-- Category Selection -->
          <div class="form-group">
            <label class="form-label" for="create-category">1. หมวดงานบริการ (Category) *</label>
            <select id="create-category" class="form-input select-input" required>
              ${allCategories.map(c => `
                <option value="${c.id}" ${c.id === initialCategory ? 'selected' : ''}>
                  ${c.icon} ${c.name} (${c.prefix || c.id})
                </option>
              `).join('')}
              <option value="_new_">➕ เพิ่มหมวดใหม่...</option>
            </select>
          </div>

          <!-- Sub-panel for New Category -->
          <div id="panel-new-category" class="sub-panel" style="display: none;">
            <div class="sub-panel-title">🏷️ กรอกรายละเอียดหมวดใหม่</div>
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label" for="new-cat-name">ชื่อหมวดใหม่ *</label>
                <input type="text" id="new-cat-name" placeholder="เช่น ทำความสะอาด, งานสวน" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label" for="new-cat-prefix">รหัสย่อหมวด (2-4 ตัวอักษร) *</label>
                <input type="text" id="new-cat-prefix" placeholder="เช่น CLN, GRD" style="text-transform:uppercase;" class="form-input" maxlength="4" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="new-cat-icon">ไอคอนหมวด</label>
              <div class="input-with-action">
                <input type="text" id="new-cat-icon" value="🧹" style="width: 80px;" class="form-input" />
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button type="button" class="icon-quick-btn" data-icon="🧹">🧹</button>
                  <button type="button" class="icon-quick-btn" data-icon="🎨">🎨</button>
                  <button type="button" class="icon-quick-btn" data-icon="🚪">🚪</button>
                  <button type="button" class="icon-quick-btn" data-icon="🏠">🏠</button>
                  <button type="button" class="icon-quick-btn" data-icon="🐜">🐜</button>
                  <button type="button" class="icon-quick-btn" data-icon="📦">📦</button>
                  <button type="button" class="icon-quick-btn" data-icon="💡">💡</button>
                  <button type="button" class="icon-quick-btn" data-icon="🔧">🔧</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Subcategory Selection -->
          <div class="form-group">
            <label class="form-label" for="create-subcategory">2. หมู่ย่อยของงาน (Subcategory / Group) *</label>
            <select id="create-subcategory" class="form-input select-input" required>
              ${initialSubcategories.map(sub => `
                <option value="${escapeHtml(sub)}">${escapeHtml(sub)}</option>
              `).join('')}
              <option value="_new_">➕ เพิ่มหมู่ใหม่...</option>
            </select>
          </div>

          <!-- Sub-panel for New Subcategory -->
          <div id="panel-new-subcategory" class="sub-panel" style="${initialSubcategories.length === 0 ? '' : 'display: none;'}">
            <div class="sub-panel-title">📂 กรอกชื่อหมู่ย่อยใหม่</div>
            <input 
              type="text" 
              id="new-sub-name" 
              placeholder="เช่น 1.4 งานล้างระบบท่อพิเศษ หรือ 4.3 งานซ่อมเฟอร์นิเจอร์" 
              class="form-input"
            />
            <span class="form-hint">ระบุลำดับและชื่อประเภทของงาน</span>
          </div>

          <!-- Job Code with Auto-suggestion -->
          <div class="form-group">
            <label class="form-label" for="create-code">3. รหัสงานบริการ (Job Code) *</label>
            <div class="input-with-action">
              <input 
                type="text" 
                id="create-code" 
                value="${initialCode}" 
                required 
                placeholder="เช่น AC-NEW-01" 
                class="form-input" 
                style="font-family: ui-monospace, monospace; font-weight: 700;"
              />
              <button type="button" class="secondary" id="btn-suggest-code" title="สร้างรหัสใหม่อัตโนมัติ">
                ↻ สร้างรหัสใหม่
              </button>
            </div>
            <span class="form-hint">ระบบสร้างรหัสแนะนำอัตโนมัติ และคุณสามารถแก้ไขเองได้อิสระ</span>
          </div>

          <!-- Service Name -->
          <div class="form-group">
            <label class="form-label" for="create-name">4. ชื่อรายการเนื้องาน (Service Name) *</label>
            <input 
              type="text" 
              id="create-name" 
              placeholder="เช่น ล้างแอร์ติดผนังระบบอินเวอร์เตอร์ 24,000 BTU" 
              required 
              class="form-input"
            />
          </div>

          <!-- Scope of Work -->
          <div class="form-group">
            <label class="form-label" for="create-scope">5. ขอบเขตงานโดยย่อ (Scope of Work)</label>
            <textarea 
              id="create-scope" 
              rows="2" 
              placeholder="ระบุขั้นตอนการทำงานโดยสรุป เช่น ตรวจเช็คแรงดัน ถอดล้างชิ้นส่วน..." 
              class="form-input textarea-input"
            ></textarea>
          </div>

          <!-- Pricing & Price Type -->
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="create-base-price">ราคาเริ่มต้น (บาท) *</label>
              <input 
                type="number" 
                id="create-base-price" 
                value="500" 
                min="0" 
                step="50" 
                required 
                class="form-input"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="create-unit">หน่วยนับ</label>
              <input 
                type="text" 
                id="create-unit" 
                value="เครื่อง" 
                placeholder="เช่น เครื่อง, จุด, งาน, ชุด" 
                class="form-input"
              />
            </div>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="create-price-type">รูปแบบราคา (Price Type)</label>
              <select id="create-price-type" class="form-input select-input">
                <option value="lump_sum">ราคาเหมาจ่าย (Lump-sum)</option>
                <option value="diagnostic">ค่าบริการตรวจเช็คเริ่มต้น</option>
                <option value="custom">กำหนดเองตามข้อความ</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="create-price-display">ข้อความแสดงราคา (Display Text)</label>
              <input 
                type="text" 
                id="create-price-display" 
                value="ราคาเหมา: 500 / เครื่อง" 
                class="form-input"
              />
            </div>
          </div>

          <!-- Duration & Advance Notice -->
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="create-duration-minutes">เวลาหน้างาน (นาที) *</label>
              <input 
                type="number" 
                id="create-duration-minutes" 
                value="60" 
                min="15" 
                step="15" 
                required 
                class="form-input"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="create-advance-notice">เวลาจองล่วงหน้า</label>
              <select id="create-advance-notice" class="form-input select-input">
                <option value="2 ชม. (ด่วน)">2 ชม. (ด่วน)</option>
                <option value="1 ชม. (ด่วนพิเศษ)">1 ชม. (ด่วนพิเศษ)</option>
                <option value="4 ชม.">4 ชม.</option>
                <option value="1 วัน (24 ชม.)" selected>1 วัน (24 ชม.)</option>
                <option value="2 วัน">2 วัน</option>
              </select>
            </div>
          </div>

          <!-- Initial Status -->
          <div class="form-group">
            <label class="form-label" for="create-status">สถานะเริ่มต้น</label>
            <select id="create-status" class="form-input select-input">
              <option value="active" selected>🟢 เปิดให้บริการทันที (Active)</option>
              <option value="paused">⏸️ หยุดให้บริการชั่วคราว (Paused)</option>
            </select>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" id="create-after-hours" checked />
              <span>อนุญาตให้รับงานนอกเวลาทำการได้ (After-Hours / Night Slot)</span>
            </label>
          </div>

          <div class="modal-actions">
            <button type="button" class="secondary" id="btn-cancel-modal">ยกเลิก</button>
            <button type="submit" class="btn-mint" id="btn-submit-new-service">➕ บันทึกงานบริการใหม่</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Attach modal close
  document.getElementById('modal-close-btn').onclick = closeModal;
  document.getElementById('btn-cancel-modal').onclick = closeModal;
  document.getElementById('modal-backdrop').onclick = (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  };

  // Quick icon buttons
  modalContainer.querySelectorAll('.icon-quick-btn').forEach(btn => {
    btn.onclick = () => {
      const iconInput = document.getElementById('new-cat-icon');
      if (iconInput) iconInput.value = btn.getAttribute('data-icon');
    };
  });

  const catSelect = document.getElementById('create-category');
  const subSelect = document.getElementById('create-subcategory');
  const codeInput = document.getElementById('create-code');
  const suggestBtn = document.getElementById('btn-suggest-code');
  const panelNewCat = document.getElementById('panel-new-category');
  const panelNewSub = document.getElementById('panel-new-subcategory');
  const priceTypeSelect = document.getElementById('create-price-type');
  const basePriceInput = document.getElementById('create-base-price');
  const unitInput = document.getElementById('create-unit');
  const priceDisplayInput = document.getElementById('create-price-display');
  const newCatNameInput = document.getElementById('new-cat-name');
  const newCatPrefixInput = document.getElementById('new-cat-prefix');

  // Auto update price display helper
  const updatePriceDisplay = () => {
    const type = priceTypeSelect.value;
    const price = Number(basePriceInput.value) || 0;
    const unit = unitInput.value.trim() || 'จุด';
    if (type === 'lump_sum') {
      priceDisplayInput.value = `ราคาเหมา: ${price.toLocaleString()} / ${unit}`;
    } else if (type === 'diagnostic') {
      priceDisplayInput.value = `ค่าบริการตรวจเช็คเริ่มต้น: ${price.toLocaleString()} + อะไหล่`;
    }
  };

  priceTypeSelect.onchange = updatePriceDisplay;
  basePriceInput.oninput = updatePriceDisplay;
  unitInput.oninput = updatePriceDisplay;

  // Function to refresh subcategory options
  const refreshSubcategories = (catId) => {
    if (catId === '_new_') {
      panelNewCat.style.display = 'block';
      subSelect.innerHTML = '<option value="_new_" selected>➕ เพิ่มหมู่ใหม่...</option>';
      panelNewSub.style.display = 'block';
      codeInput.value = generateSuggestedCode(newCatPrefixInput.value.trim() || 'NEW');
      return;
    }

    panelNewCat.style.display = 'none';
    const existingSubs = getSubcategoriesForCategory(catId);
    let options = existingSubs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    options += '<option value="_new_">➕ เพิ่มหมู่ใหม่...</option>';
    subSelect.innerHTML = options;

    if (existingSubs.length === 0) {
      subSelect.value = '_new_';
      panelNewSub.style.display = 'block';
    } else {
      subSelect.value = existingSubs[0];
      panelNewSub.style.display = 'none';
    }

    codeInput.value = generateSuggestedCode(catId);
  };

  catSelect.onchange = () => {
    refreshSubcategories(catSelect.value);
  };

  subSelect.onchange = () => {
    panelNewSub.style.display = subSelect.value === '_new_' ? 'block' : 'none';
  };

  newCatPrefixInput.oninput = () => {
    const prefix = newCatPrefixInput.value.trim().toUpperCase();
    if (prefix) {
      codeInput.value = `${prefix}-NEW-01`;
    }
  };

  suggestBtn.onclick = () => {
    let catId = catSelect.value;
    if (catId === '_new_') {
      catId = newCatPrefixInput.value.trim().toUpperCase() || 'NEW';
    }
    codeInput.value = generateSuggestedCode(catId);
  };

  // Form submission handler
  const form = document.getElementById('create-service-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    await handleCreateServiceSubmit();
  };
}

/**
 * Handle submission of new service item
 */
async function handleCreateServiceSubmit() {
  const catSelect = document.getElementById('create-category');
  const subSelect = document.getElementById('create-subcategory');
  const codeInput = document.getElementById('create-code');
  const nameInput = document.getElementById('create-name');
  const scopeInput = document.getElementById('create-scope');
  const basePriceInput = document.getElementById('create-base-price');
  const unitInput = document.getElementById('create-unit');
  const priceDisplayInput = document.getElementById('create-price-display');
  const durationInput = document.getElementById('create-duration-minutes');
  const noticeSelect = document.getElementById('create-advance-notice');
  const statusSelect = document.getElementById('create-status');
  const afterHoursInput = document.getElementById('create-after-hours');

  const code = codeInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  const basePrice = Number(basePriceInput.value) || 0;
  const durationMinutes = Number(durationInput.value) || 60;
  const unit = unitInput.value.trim() || 'จุด';

  // Validation
  if (!code) {
    alert('กรุณาระบุรหัสงานบริการ');
    codeInput.focus();
    return;
  }

  // Check code uniqueness
  if (currentServices.some(s => s.code.toUpperCase() === code)) {
    alert(`รหัสงาน "${code}" มีอยู่ในระบบแล้ว กรุณาเปลี่ยนรหัสใหม่`);
    codeInput.focus();
    return;
  }

  if (!name) {
    alert('กรุณาระบุชื่อเนื้องาน');
    nameInput.focus();
    return;
  }

  // Resolve Category
  let categoryId = catSelect.value;
  let categoryName = '';
  let categoryIcon = '🔧';

  if (categoryId === '_new_') {
    const newCatName = document.getElementById('new-cat-name').value.trim();
    const newCatPrefix = document.getElementById('new-cat-prefix').value.trim().toUpperCase();
    const newCatIcon = document.getElementById('new-cat-icon').value.trim() || '🔧';

    if (!newCatName) {
      alert('กรุณาระบุชื่อหมวดใหม่');
      document.getElementById('new-cat-name').focus();
      return;
    }

    categoryId = (newCatPrefix || newCatName).toLowerCase().replace(/\s+/g, '_');
    categoryName = newCatName;
    categoryIcon = newCatIcon;
  } else {
    const cats = getAllCategories();
    const matched = cats.find(c => c.id === categoryId);
    categoryName = matched ? matched.name : categoryId;
    categoryIcon = matched ? matched.icon : '🔧';
  }

  // Resolve Subcategory
  let subCategory = subSelect.value;
  if (subCategory === '_new_') {
    const newSubName = document.getElementById('new-sub-name').value.trim();
    if (!newSubName) {
      alert('กรุณาระบุชื่อหมู่ย่อยใหม่');
      document.getElementById('new-sub-name').focus();
      return;
    }
    subCategory = newSubName;
  }

  // Duration display calculation
  let durationDisplay = '';
  if (durationMinutes < 60) {
    durationDisplay = `${durationMinutes} นาที`;
  } else {
    const hrs = (durationMinutes / 60).toFixed(1).replace('.0', '');
    durationDisplay = `${durationMinutes} นาที (${hrs} ชม.)`;
  }

  const newService = {
    id: code,
    code: code,
    categoryId: categoryId,
    categoryName: categoryName,
    categoryIcon: categoryIcon,
    subCategory: subCategory,
    name: name,
    scope: scopeInput.value.trim(),
    basePrice: basePrice,
    priceDisplay: priceDisplayInput.value.trim() || `฿${basePrice.toLocaleString()} / ${unit}`,
    unit: unit,
    durationMinutes: durationMinutes,
    durationDisplay: durationDisplay,
    advanceNotice: noticeSelect.value,
    status: statusSelect.value,
    afterHoursAllowed: afterHoursInput.checked,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 1. Add to in-memory state
  currentServices.unshift(newService);

  // 2. Save to LocalStorage
  saveToStorage(currentServices);

  // 3. Write Document to Firestore Collection `service_catalog`
  await syncItemToFirestore(newService);

  // 4. Close Modal
  closeModal();

  // 5. Success Toast
  showToast(`✅ เพิ่มงานบริการใหม่ "${newService.code}: ${newService.name}" เรียบร้อยแล้ว!`, 'success');

  // 6. Set active category filter to show the new item immediately
  activeCategoryFilter = newService.categoryId;

  // 7. Re-render View
  const container = document.getElementById('view-content');
  if (container) renderCatalogView(container);
}

function closeModal() {
  const modalContainer = document.getElementById('modal-container');
  if (modalContainer) modalContainer.innerHTML = '';
  editingServiceId = null;
}

async function saveEditedService(originalItem) {
  const basePriceInput = document.getElementById('edit-base-price');
  const unitInput = document.getElementById('edit-unit');
  const priceDisplayInput = document.getElementById('edit-price-display');
  const durationMinutesInput = document.getElementById('edit-duration-minutes');
  const durationDisplayInput = document.getElementById('edit-duration-display');
  const advanceNoticeInput = document.getElementById('edit-advance-notice');
  const statusInput = document.getElementById('edit-status');
  const scopeInput = document.getElementById('edit-scope');
  const afterHoursInput = document.getElementById('edit-after-hours');

  const basePrice = Number(basePriceInput.value) || 0;
  const durationMinutes = Number(durationMinutesInput.value) || 60;
  let durationDisplay = durationDisplayInput.value.trim();
  if (!durationDisplay) {
    durationDisplay = `${durationMinutes} นาที`;
  }

  // Update item in state
  originalItem.basePrice = basePrice;
  originalItem.unit = unitInput.value.trim();
  originalItem.priceDisplay = priceDisplayInput.value.trim() || `฿${basePrice.toLocaleString()} / ${originalItem.unit}`;
  originalItem.durationMinutes = durationMinutes;
  originalItem.durationDisplay = durationDisplay;
  originalItem.advanceNotice = advanceNoticeInput.value.trim() || '2 ชม.';
  originalItem.status = statusInput.value;
  originalItem.scope = scopeInput.value.trim();
  originalItem.afterHoursAllowed = afterHoursInput.checked;
  originalItem.updatedAt = new Date().toISOString();

  // Persist
  saveToStorage(currentServices);
  await syncItemToFirestore(originalItem);

  closeModal();
  showToast(`บันทึกข้อมูล "${originalItem.code}: ${originalItem.name}" เรียบร้อยแล้ว`, 'success');

  // Re-render view
  const container = document.getElementById('view-content');
  if (container) renderCatalogView(container);
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

/**
 * ============================================================
 * Modal 3: Official Print & PDF Export Modal ("🖨️ ออกรายงาน (PDF)")
 * ============================================================
 */
export function openReportModal() {
  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;

  const totalCount = currentServices.length;
  const activeCount = currentServices.filter((s) => s.status === 'active').length;
  const pausedCount = totalCount - activeCount;

  // Format today's date in Thai (พ.ศ. 2569)
  const now = new Date();
  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  const thaiYear = now.getFullYear() < 2500 ? now.getFullYear() + 543 : now.getFullYear();
  const thaiDateStr = `${now.getDate()} ${thaiMonths[now.getMonth()]} ${thaiYear}`;

  // Group services by Category -> SubCategory
  const groups = {};
  currentServices.forEach((item) => {
    const key = `${item.categoryId}:::${item.subCategory}`;
    if (!groups[key]) {
      groups[key] = {
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        categoryIcon: item.categoryIcon,
        subCategory: item.subCategory,
        items: [],
      };
    }
    groups[key].items.push(item);
  });

  let tablesHtml = '';
  for (const key of Object.keys(groups)) {
    const group = groups[key];
    tablesHtml += `
      <div class="report-group-section">
        <div class="report-group-title">
          <span>${group.categoryIcon || '🔧'} หมวด ${escapeHtml(group.categoryName || '')} — ${escapeHtml(group.subCategory || '')}</span>
          <span style="font-size: 11px; font-weight: normal; color: #64748b;">${group.items.length} รายการ</span>
        </div>
        <table class="report-table">
          <thead>
            <tr>
              <th style="width: 90px;">รหัสงาน</th>
              <th>รายการเนื้องาน / ขอบเขตงาน</th>
              <th style="width: 140px;">ราคาปกติ (บาท)</th>
              <th style="width: 110px;">เวลาหน้างาน</th>
              <th style="width: 100px;">การรับประกัน</th>
              <th style="width: 110px;">จองล่วงหน้า</th>
              <th style="width: 80px; text-align: center;">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            ${group.items.map(item => `
              <tr>
                <td style="font-family: monospace; font-weight: 700; color: #0a1f3d;">${escapeHtml(item.code)}</td>
                <td>
                  <div style="font-weight: 600; color: #111827;">${escapeHtml(item.name)}</div>
                  ${item.scope ? `<div style="font-size: 11px; color: #4b5563; margin-top: 2px;">${escapeHtml(item.scope)}</div>` : ''}
                </td>
                <td>
                  <div style="font-weight: 700; color: #0a1f3d;">฿${(item.basePrice || 0).toLocaleString()}</div>
                  <div style="font-size: 11px; color: #6b7280;">${escapeHtml(item.priceDisplay || '')}</div>
                </td>
                <td>⏱️ ${escapeHtml(item.durationDisplay || `${item.durationMinutes || 60} นาที`)}</td>
                <td>🛡️ ${escapeHtml(item.warranty_text || (item.warranty_days ? item.warranty_days + ' วัน' : '-'))}</td>
                <td>📅 ${escapeHtml(item.advanceNotice || '2 ชม.')}</td>
                <td style="text-align: center;">
                  <span class="report-status-tag ${item.status === 'active' ? 'report-status-active' : 'report-status-paused'}">
                    ${item.status === 'active' ? 'เปิดบริการ' : 'หยุดบริการ'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  modalContainer.innerHTML = `
    <div class="modal-backdrop report-backdrop" id="modal-backdrop">
      <div class="report-preview-dialog">
        <div class="report-preview-toolbar">
          <div class="report-preview-title">
            <span>🖨️ แสดงตัวอย่างเอกสารก่อนพิมพ์ (Report Preview)</span>
          </div>
          <div class="report-preview-actions">
            <button class="btn-mint btn-sm" id="btn-do-print">
              🖨️ พิมพ์เอกสาร / บันทึกเป็น PDF
            </button>
            <button class="secondary btn-sm" id="modal-close-btn" style="background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.3);">
              ✕ ปิดหน้าต่าง
            </button>
          </div>
        </div>

        <div class="report-printable-area" id="report-printable-area">
          <!-- Document Header -->
          <div class="report-doc-header">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div class="report-company-name">RakBaan In-House Operations / RPS Group</div>
                <h1 class="report-main-title">บัญชีราคากลางและรายการงานบริการมาตรฐาน</h1>
                <div class="report-sub-title">Service Catalog & Master Price List — รักบ้าน@CNX</div>
              </div>
              <div style="text-align: right; font-size: 11px; color: #64748b; line-height: 1.6;">
                <div><strong>เอกสารควบคุมภายใน</strong></div>
                <div>รหัส: RPB-CATALOG-MASTER</div>
                <div>เวอร์ชัน: 2569.1</div>
              </div>
            </div>
          </div>

          <!-- Metadata Grid -->
          <div class="report-meta-grid">
            <div class="report-meta-item">
              <strong>วันที่ออกรายงาน:</strong> ${thaiDateStr}
            </div>
            <div class="report-meta-item">
              <strong>จุดศูนย์กลางให้บริการ:</strong> อนุสาวรีย์สามกษัตริย์ เชียงใหม่ (โซน 1: 0–10 กม. ฟรีค่าเดินทาง)
            </div>
            <div class="report-meta-item">
              <strong>เวลาทำการปกติ:</strong> 08:00 – 17:00 น. (ไม่มีพักเที่ยง) / ระบบรองรับงานนอกเวลา (After-Hours OT)
            </div>
            <div class="report-meta-item">
              <strong>นโยบายข้อมูลระบบ:</strong> No Hard-Delete Policy (ระบบมีเฉพาะสถานะ เปิดบริการ / หยุดชั่วคราว)
            </div>
          </div>

          <!-- KPI Summary Boxes -->
          <div class="report-kpi-summary">
            <div class="report-kpi-box">
              <div class="report-kpi-num">${totalCount}</div>
              <div class="report-kpi-text">รายการบริการทั้งหมด</div>
            </div>
            <div class="report-kpi-box" style="border-color: #86efac;">
              <div class="report-kpi-num" style="color: #166534;">${activeCount}</div>
              <div class="report-kpi-text">เปิดให้บริการ (Active)</div>
            </div>
            <div class="report-kpi-box" style="border-color: #fde68a;">
              <div class="report-kpi-num" style="color: #92400e;">${pausedCount}</div>
              <div class="report-kpi-text">หยุดบริการชั่วคราว (Paused)</div>
            </div>
            <div class="report-kpi-box">
              <div class="report-kpi-num">${Object.keys(groups).length}</div>
              <div class="report-kpi-text">กลุ่มหมู่ย่อยของงาน</div>
            </div>
          </div>

          <!-- Service Tables -->
          ${tablesHtml}

          <!-- Signature Sign-off -->
          <div class="report-footer-sign">
            <div class="sign-box">
              <div class="sign-line"></div>
              <div class="sign-name">( เจ้าหน้าที่ฝ่ายปฏิบัติการและบริการลูกค้า )</div>
              <div class="sign-role">ผู้จัดทำและตรวจสอบข้อมูล</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">วันที่: ...... / ...... / ..........</div>
            </div>
            <div class="sign-box">
              <div class="sign-line"></div>
              <div class="sign-name">( คุณรณกฤต ตันสว่างกุล )</div>
              <div class="sign-role">กรรมการผู้จัดการ / ผู้อนุมัติบัญชีราคากลาง</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">วันที่: ...... / ...... / ..........</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-close-btn').onclick = closeModal;
  document.getElementById('modal-backdrop').onclick = (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  };

  document.getElementById('btn-do-print').onclick = () => {
    window.print();
  };
}
