// ─────────────────────────────────────────────────────────────
// js/ai-config.example.js — แม่แบบไฟล์ตั้งค่า AI Service
// 📌 คัดลอกไฟล์นี้เป็น js/ai-config.js แล้วใส่ API Key ของคุณ
// ⚠️ ไฟล์ js/ai-config.js ถูกกันไว้ใน .gitignore แล้ว ห้าม push คีย์ขึ้น GitHub
// ─────────────────────────────────────────────────────────────

window.RAKBAAN_AI_CONFIG = {
  // กุญแจ OpenRouter API (ดึงจาก localStorage หรือระบุในไฟล์ส่วนตัว js/ai-config.js)
  apiKey: localStorage.getItem("rakbaan_ai_key") || "",

  // โมเดลมาตรฐานตามเกณฑ์การบ้านสัปดาห์ที่ 8
  model: "google/gemini-2.5-flash-lite",

  // Endpoint ของ OpenRouter
  endpoint: "https://openrouter.ai/api/v1/chat/completions",

  // เวลาตัดการเชื่อมต่อเพื่อป้องกันระบบค้าง (15 วินาที)
  timeoutMs: 15000
};
