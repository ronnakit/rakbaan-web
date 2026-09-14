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

  // ควบคุมการเลือกหมวดหมู่ผ่านการกดการ์ด
  catCards.forEach(function (card) {
    card.addEventListener("click", function () {
      catCards.forEach(function (c) { c.classList.remove("selected"); });
      card.classList.add("selected");
      categoryInput.value = card.dataset.cat;
    });
  });

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
