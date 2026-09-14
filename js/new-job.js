// ─────────────────────────────────────────────────────────────
// js/new-job.js — บันทึกใบแจ้งซ่อมใหม่ลง Cloud Firestore (jobs)
// ─────────────────────────────────────────────────────────────

(function () {
  var form = document.getElementById("ฟอร์มแจ้งซ่อม");
  var titleInput = document.getElementById("title");
  var categoryInput = document.getElementById("category");
  var descInput = document.getElementById("description");
  var addressInput = document.getElementById("address");
  var phoneInput = document.getElementById("contactPhone");
  var submitBtn = document.getElementById("ปุ่มบันทึก");
  var alertBox = document.getElementById("ข้อความเตือน");
  var catCards = document.querySelectorAll(".category-card");
  var btnAiClassify = document.getElementById("btnAiClassify");
  var aiClassifyBox = document.getElementById("aiClassifyBox");

  // ควบคุมการเลือกหมวดหมู่ผ่านการกดการ์ด
  catCards.forEach(function (card) {
    card.addEventListener("click", function () {
      catCards.forEach(function (c) { c.classList.remove("selected"); });
      card.classList.add("selected");
      categoryInput.value = card.dataset.cat;
    });
  });

  // ── AI ระดับ 1: วิเคราะห์หมวดหมู่ช่างจากอาการเสีย ──
  if (btnAiClassify) {
    btnAiClassify.addEventListener("click", async function () {
      alertBox.classList.add("hidden");
      var title = titleInput.value.trim();
      var description = descInput.value.trim();

      if (!title && !description) {
        alertBox.textContent = "💡 กรุณากรอกหัวข้อหรือรายละเอียดอาการเสียก่อน เพื่อให้ AI วิเคราะห์หมวดหมู่ได้แม่นยำ";
        alertBox.classList.remove("hidden");
        titleInput.focus();
        return;
      }

      btnAiClassify.disabled = true;
      btnAiClassify.textContent = "⏳ กำลังวิเคราะห์…";
      aiClassifyBox.innerHTML = "<em>🤖 กำลังปรึกษา AI (google/gemini-2.5-flash-lite) เพื่อคัดกรองหมวดหมู่ช่าง…</em>";
      aiClassifyBox.classList.remove("hidden");

      try {
        if (!window.RakbaanAIService) {
          throw new Error("ระบบ AI ยังไม่พร้อมใช้งาน");
        }

        var res = await window.RakbaanAIService.classifyRepairCategory(title, description);
        if (res.success && res.selectedCategory) {
          // ไฮไลต์เลือกการ์ดหมวดหมู่อัตโนมัติ
          catCards.forEach(function (c) {
            if (c.dataset.cat === res.selectedCategory) {
              c.classList.add("selected");
              categoryInput.value = res.selectedCategory;
            } else {
              c.classList.remove("selected");
            }
          });

          var sourceNote = res.source === "openrouter" ? "Gemini 2.5 Flash Lite" : "ระบบวิเคราะห์ความเชี่ยวชาญ";
          aiClassifyBox.innerHTML =
            "<strong>💡 ข้อเสนอแนะจาก AI (" + sourceNote + "):</strong> แนะนำหมวด <strong>" + esc(res.categoryName) + "</strong><br>" +
            "<span style='font-size:13px; color:#222;'>เหตุผล: " + esc(res.reason) + "</span><br>" +
            "<span style='font-size:12px; color:#555;'>👉 คุณสามารถคลิกเลือกเปลี่ยนหมวดหมู่อื่นด้านล่างได้อิสระตามต้องการ ก่อนกดยืนยันการแจ้งซ่อม</span>";
        } else {
          aiClassifyBox.innerHTML = "<strong>ℹ️ ข้อสังเกต:</strong> " + esc(res.message || "ไม่สามารถระบุหมวดหมู่ชัดเจนได้ โปรดเลือกด้วยตนเอง");
        }
      } catch (err) {
        console.error("AI Classify Error:", err);
        aiClassifyBox.innerHTML = "<strong>⚠️ แจ้งเตือน:</strong> ไม่สามารถเชื่อมต่อ AI ได้ในขณะนี้ (" + esc(err.message) + ") คุณสามารถเลือกหมวดหมู่ช่างด้วยตนเองได้ทันทีค่ะ";
      } finally {
        btnAiClassify.disabled = false;
        btnAiClassify.textContent = "🤖 ให้ AI ช่วยวิเคราะห์หมวดหมู่";
      }
    });
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    alertBox.classList.add("hidden");

    var title = titleInput.value.trim();
    var category = categoryInput.value;
    var description = descInput.value.trim();
    var address = addressInput.value.trim();
    var contactPhone = phoneInput.value.trim();

    if (!title || !description || !address || !contactPhone) {
      alertBox.textContent = "⚠️ กรุณากรอกข้อมูลให้ครบถ้วนทุกช่อง";
      alertBox.classList.remove("hidden");
      return;
    }

    var currentUser = firebase.auth().currentUser;
    if (!currentUser) {
      alertBox.textContent = "⚠️ กรุณาเข้าสู่ระบบก่อนทำการแจ้งซ่อม";
      alertBox.classList.remove("hidden");
      return;
    }

    var customerId = currentUser.uid;
    var customerName = window.currentUserName || currentUser.displayName || currentUser.email;

    submitBtn.disabled = true;
    submitBtn.textContent = "กำลังบันทึกข้อมูล…";

    var newJob = {
      title: title,
      category: category,
      description: description,
      address: address,
      contactPhone: contactPhone,
      status: "pending_review", // สถานะแรกเริ่มต้นเสมอ
      customerId: customerId,
      customerName: customerName,
      assignedStaffId: "",
      assignedStaffName: "",
      createdAt: typeof เวลาตอนนี้ === "function" ? เวลาตอนนี้() : new Date().toISOString()
    };

    try {
      var docRef = await window.db.collection("jobs").add(newJob);

      // บันทึกประวัติขั้นตอนแรกใน subcollection status_history
      try {
        await window.db.collection("jobs").doc(docRef.id).collection("status_history").add({
          status: "pending_review",
          note: "ลูกค้าเปิดใบแจ้งซ่อมใหม่",
          actorId: customerId,
          timestamp: typeof เวลาตอนนี้ === "function" ? เวลาตอนนี้() : new Date().toISOString()
        });
      } catch (hErr) {
        console.warn("Save history log warning:", hErr);
      }

      location.href = "jobs.html";
    } catch (err) {
      console.error("Create job error:", err);
      alertBox.textContent = "⚠️ บันทึกใบแจ้งซ่อมไม่สำเร็จ: " + err.message;
      alertBox.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "ยืนยันการแจ้งซ่อม";
    }
  });
})();
