// ─────────────────────────────────────────────────────────────
// js/util.js — เครื่องมือช่วยเหลือสำหรับ รักบ้าน@CNX Web Portal
// ─────────────────────────────────────────────────────────────

// รายการหมวดหมู่งานซ่อม 9 หมวดตามสเปกของ รักบ้าน@CNX
window.RAKBAAN_CATEGORIES = {
  electrical:             { name: "ระบบไฟฟ้า", icon: "⚡" },
  plumbing:               { name: "ระบบประปา", icon: "🚰" },
  air_con:                { name: "ล้างและซ่อมแอร์", icon: "❄️" },
  roof_structure:         { name: "หลังคาและโครงสร้าง", icon: "🏠" },
  wall_paint:             { name: "งานผนังและทาสี", icon: "🎨" },
  floor_tile:             { name: "งานพื้นและกระเบื้อง", icon: "🧱" },
  door_window:            { name: "ประตูและหน้าต่าง", icon: "🚪" },
  appliance_ventilation:  { name: "เครื่องใช้ไฟฟ้า", icon: "🔌" },
  emergency_safety:       { name: "ความปลอดภัยฉุกเฉิน", icon: "🚨" }
};

// แปลงข้อความให้ปลอดภัยจาก XSS
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ป้ายสถานะงานซ่อมพร้อมภาษาไทยและสีประจำสถานะ
function ป้ายสถานะ(status) {
  var labels = {
    pending_review: "รอรับเรื่อง",
    assigned:       "มอบหมายช่างแล้ว",
    traveling:      "กำลังเดินทาง",
    in_progress:    "กำลังซ่อม",
    completed:      "เสร็จสิ้น",
    cancelled:      "ยกเลิก"
  };
  var label = labels[status] || status || "ไม่ระบุ";
  return '<span class="badge badge-' + esc(status) + '">' + esc(label) + '</span>';
}

// ป้ายชื่อหมวดหมู่งานซ่อม
function ป้ายหมวดหมู่(catKey) {
  var cat = window.RAKBAAN_CATEGORIES[catKey];
  if (cat) {
    return esc(cat.icon + " " + cat.name);
  }
  return esc(catKey || "ทั่วไป");
}

// เวลาปัจจุบันในรูปแบบ YYYY-MM-DD HH:mm
function เวลาตอนนี้() {
  var d = new Date();
  var pad = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
         " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// อ่านค่า Query Parameter จาก URL
function ค่าจากURL(name) {
  return new URLSearchParams(location.search).get(name) || "";
}
