// ─────────────────────────────────────────────────────────────
// js/job-detail.js — แสดงรายละเอียด, เปลี่ยนสถานะ และลบงานซ่อม
// สัปดาห์ที่ 7: อัปเดตเฉพาะฟิลด์ status และลบโดยมี confirm()
// ควบคุมสิทธิ์การเปลี่ยนสถานะและการลบตามตาราง ACL
// ─────────────────────────────────────────────────────────────

(async function () {
  var jobId = ค่าจากURL("id");
  var detailBox = document.getElementById("กล่องรายละเอียด");
  var commentCard = document.getElementById("กล่องความเห็น");
  var commentsList = document.getElementById("รายการความเห็น");
  var commentInput = document.getElementById("commentInput");
  var btnSendComment = document.getElementById("ปุ่มส่งความเห็น");
  var alertComment = document.getElementById("เตือนความเห็น");

  // ส่วนประกอบ UI ผู้ช่วย AI ระดับ 2
  var aiCard = document.getElementById("กล่องผู้ช่วยAI");
  var btnAiAnalyze = document.getElementById("btnAiAnalyze");
  var aiAlert = document.getElementById("aiAnalysisAlert");
  var aiResultBox = document.getElementById("aiAnalysisResult");
  var aiContentBox = document.getElementById("aiAnalysisContent");
  var btnSaveAi = document.getElementById("btnSaveAiSuggestion");
  var aiSavedBox = document.getElementById("aiSavedBox");
  var aiSavedContent = document.getElementById("aiSavedContent");
  var aiSavedMeta = document.getElementById("aiSavedMeta");
  var currentAiResult = null;

  if (!jobId) {
    detailBox.innerHTML = "<p style='color:var(--สีแดง);'>ไม่พบรหัสงานซ่อมในลิงก์</p>";
    return;
  }

  var job = null;
  var histories = [];

  await โหลดข้อมูลงาน();

  async function โหลดข้อมูลงาน() {
    try {
      var docSnap = await window.db.collection("jobs").doc(jobId).get();
      if (!docSnap.exists) {
        detailBox.innerHTML = "<p style='color:var(--สีแดง);'>ไม่พบข้อมูลงานแจ้งซ่อมนี้ — อาจถูกลบไปแล้ว</p>";
        return;
      }

      job = Object.assign({ id: docSnap.id }, docSnap.data());

      // ดึงประวัติสถานะงาน / บันทึกหน้างาน
      histories = [];
      try {
        var snapH = await window.db
          .collection("jobs").doc(jobId)
          .collection("status_history")
          .get();

        snapH.forEach(function (d) {
          histories.push(Object.assign({ id: d.id }, d.data()));
        });

        histories.sort(function (a, b) {
          return (a.timestamp || "") < (b.timestamp || "") ? -1 : 1;
        });
      } catch (hErr) {
        console.warn("Load status history warning:", hErr);
      }

      วาดรายละเอียด();
      วาดประวัติ();
      วาดข้อมูลAIที่เคยบันทึก();
      commentCard.classList.remove("hidden");
      if (aiCard) aiCard.classList.remove("hidden");
    } catch (err) {
      console.error("Load job detail error:", err);
      detailBox.innerHTML = "<p style='color:var(--สีแดง);'>เกิดข้อผิดพลาดในการโหลดข้อมูล: " + esc(err.message) + "</p>";
    }
  }

  // ── แสดงผลคำแนะนำจาก AI ที่เคยบันทึกไว้ใน Firestore ──
  function วาดข้อมูลAIที่เคยบันทึก() {
    if (!job || !aiSavedBox) return;

    if (job.aiSuggestion) {
      aiSavedContent.textContent = job.aiSuggestion;
      var metaText = "🕒 บันทึกล่าสุดเมื่อ: " + (job.aiAnalyzedAt ? formatDateTime(job.aiAnalyzedAt) : "ไม่ระบุ") +
        " โดย: " + esc(job.aiAnalyzedBy || "ทีมงาน");
      if (job.aiSource) {
        metaText += " · แหล่งที่มา: " + (job.aiSource === "openrouter" ? "OpenRouter (Gemini 2.5 Flash Lite)" : "ระบบวิเคราะห์อัตโนมัติ");
      }
      aiSavedMeta.innerHTML = metaText;
      aiSavedBox.classList.remove("hidden");
    } else {
      aiSavedBox.classList.add("hidden");
    }
  }


  // ── วาดข้อมูลรายละเอียดงาน ──
  function วาดรายละเอียด() {
    var currentUser = firebase.auth().currentUser;
    var userRole = window.currentUserRole || "customer";

    var rows = [
      ["หัวข้องานซ่อม", esc(job.title)],
      ["หมวดหมู่บริการ", ป้ายหมวดหมู่(job.category)],
      ["รายละเอียดอาการ", esc(job.description)],
      ["สถานที่หน้างาน", esc(job.address)],
      ["เบอร์โทรติดต่อ", esc(job.contactPhone)],
      ["ผู้แจ้งซ่อม", esc(job.customerName)],
      ["สถานะปัจจุบัน", ป้ายสถานะ(job.status)],
      ["วันที่แจ้งเรื่อง", esc(job.createdAt)]
    ];

    var html = rows.map(function (r) {
      return '<div class="field-row"><span class="k">' + r[0] + "</span><span>" + r[1] + "</span></div>";
    }).join("");

    // สิทธิ์การควบคุมปุ่มตาม ACL
    var canChangeStatus = (userRole === "staff" || userRole === "admin");
    var btnRow = '<div class="btn-row" id="actionBtnRow">';

    // ปุ่มเปลี่ยนสถานะ (เฉพาะ Staff / Admin เท่านั้น)
    if (canChangeStatus) {
      if (job.status === "pending_review") {
        btnRow += '<button type="button" class="btn" id="btnAssign" style="background:var(--สีฟ้า); border-color:var(--สีฟ้า);">👤 มอบหมายช่างแล้ว</button>';
      } else if (job.status === "assigned") {
        btnRow += '<button type="button" class="btn" id="btnInProgress" style="background:#f57c00; border-color:#f57c00;">🔨 เริ่มซ่อมหน้างาน</button>';
      } else if (job.status === "in_progress") {
        btnRow += '<button type="button" class="btn-ok" id="btnComplete">✅ ซ่อมเสร็จสิ้นเรียบร้อย</button>';
      } else {
        html += '<p class="hint" style="color:var(--สีเขียว); font-weight:600; margin-top:12px;">✅ งานซ่อมนี้เสร็จสิ้นเรียบร้อยแล้ว</p>';
      }
    } else {
      // สำหรับ Customer
      html += '<p class="hint" style="margin-top:12px;">* สถานะงานซ่อมจะถูกตรวจสอบและปรับเปลี่ยนโดยทีมช่างรักบ้านหลังเข้าตรวจสอบ</p>';
    }

    // ปุ่มลบ/ยกเลิกงาน ตามสิทธิ์ใน ACL:
    // - customer: ลบได้เฉพาะงานของตัวเองที่ยัง "pending_review" (รอรับเรื่อง)
    // - staff: ไม่มีสิทธิ์ลบ
    // - admin: ลบได้
    var canDelete = false;
    if (userRole === "admin") {
      canDelete = true;
    } else if (userRole === "customer" && job.status === "pending_review") {
      if (!currentUser || job.customerId === currentUser.uid) {
        canDelete = true;
      }
    }

    if (canDelete) {
      btnRow += '<button type="button" class="btn-ghost" id="btnDeleteJob" style="color:var(--สีแดง); border-color:var(--สีขอบ);">🗑️ ขอยกเลิก/ลบใบแจ้งซ่อมนี้</button>';
    }

    btnRow += '</div>';
    html += btnRow;
    detailBox.innerHTML = html;

    // ผูก Event ปุ่มเปลี่ยนสถานะ
    var btnAssign = document.getElementById("btnAssign");
    if (btnAssign) btnAssign.addEventListener("click", function () { เปลี่ยนสถานะ("assigned", "ทีมงานรับเรื่องและมอบหมายช่างแล้ว"); });

    var btnInProgress = document.getElementById("btnInProgress");
    if (btnInProgress) btnInProgress.addEventListener("click", function () { เปลี่ยนสถานะ("in_progress", "ช่างเริ่มดำเนินการซ่อมแซมหน้างาน"); });

    var btnComplete = document.getElementById("btnComplete");
    if (btnComplete) btnComplete.addEventListener("click", function () { เปลี่ยนสถานะ("completed", "ช่างปิดงานและตรวจสอบความเรียบร้อยแล้ว"); });

    var btnDelete = document.getElementById("btnDeleteJob");
    if (btnDelete) btnDelete.addEventListener("click", ลบงาน);
  }

  // ── เปลี่ยนสถานะงาน (Update เฉพาะฟิลด์ status) ──
  async function เปลี่ยนสถานะ(สถานะใหม่, หมายเหตุ) {
    try {
      // อัปเดตเฉพาะฟิลด์ status ใน Firestore (ไม่เขียนทับเอกสารทั้งใบ)
      await window.db.collection("jobs").doc(jobId).update({
        status: สถานะใหม่
      });

      // บันทึกลง status_history
      try {
        var currentUser = firebase.auth().currentUser;
        await window.db.collection("jobs").doc(jobId).collection("status_history").add({
          status: สถานะใหม่,
          note: หมายเหตุ || ("เปลี่ยนสถานะเป็น " + สถานะใหม่),
          actorId: currentUser ? currentUser.uid : "staff",
          actorName: window.currentUserName || "ทีมงานรักบ้าน",
          timestamp: typeof เวลาตอนนี้ === "function" ? เวลาตอนนี้() : new Date().toISOString()
        });
      } catch (logErr) {
        console.warn("Log status history warning:", logErr);
      }

      job.status = สถานะใหม่;
      วาดรายละเอียด();
      alert('เปลี่ยนสถานะงานเป็น "' + สถานะใหม่ + '" เรียบร้อยแล้ว');
      await โหลดข้อมูลงาน();
    } catch (err) {
      console.error("Update status error:", err);
      alert("เกิดข้อผิดพลาดในการเปลี่ยนสถานะ: " + err.message);
    }
  }

  // ── ลบงานซ่อม (Delete พร้อมมี confirm() ยืนยัน) ──
  async function ลบงาน() {
    // กฎ: ต้องถามยืนยันก่อนทุกครั้ง ป้องกันการกดพลาด
    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการลบใบแจ้งซ่อมนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้")) {
      return;
    }

    var btn = document.getElementById("btnDeleteJob");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "กำลังลบ…";
    }

    try {
      await window.db.collection("jobs").doc(jobId).delete();
      alert("ลบใบแจ้งซ่อมเรียบร้อยแล้ว");
      location.href = "jobs.html";
    } catch (err) {
      console.error("Delete job error:", err);
      alert("เกิดข้อผิดพลาดในการลบงาน: " + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "🗑️ ขอยกเลิก/ลบใบแจ้งซ่อมนี้";
      }
    }
  }

  // ── วาดประวัติและบันทึกหน้างาน ──
  function วาดประวัติ() {
    if (histories.length === 0) {
      commentsList.innerHTML = "<p style='color:var(--สีจาง);'>ยังไม่มีบันทึกความคืบหน้าเพิ่มเติม</p>";
      return;
    }

    var html = histories.map(function (h) {
      return (
        '<div style="border-left: 3px solid var(--สีหลัก); padding: 6px 12px; margin-bottom: 10px; background:#fafafa; border-radius:0 6px 6px 0;">' +
        '<div style="font-size:13px; color:var(--สีจาง); margin-bottom:2px;">' +
        esc(h.actorName || "ผู้ปฏิบัติงาน") + ' · ' + esc(h.timestamp || "") + ' ' +
        (h.status ? ป้ายสถานะ(h.status) : "") +
        '</div>' +
        '<div style="font-size:15px;">' + esc(h.note || "") + '</div>' +
        '</div>'
      );
    }).join("");

    commentsList.innerHTML = html;
  }

  // ── ส่งบันทึกความคืบหน้าใหม่ ──
  if (btnSendComment) {
    btnSendComment.addEventListener("click", async function () {
      var note = commentInput.value.trim();
      if (!note) {
        alertComment.textContent = "⚠️ กรุณาพิมพ์ข้อความก่อนบันทึก";
        alertComment.classList.remove("hidden");
        return;
      }

      alertComment.classList.add("hidden");
      btnSendComment.disabled = true;

      try {
        var currentUser = firebase.auth().currentUser;
        var newHistory = {
          note: note,
          status: job.status,
          actorId: currentUser ? currentUser.uid : "guest",
          actorName: window.currentUserName || (currentUser ? currentUser.displayName || currentUser.email : "ผู้ใช้"),
          timestamp: typeof เวลาตอนนี้ === "function" ? เวลาตอนนี้() : new Date().toISOString()
        };

        await window.db.collection("jobs").doc(jobId).collection("status_history").add(newHistory);
        histories.push(newHistory);
        commentInput.value = "";
        วาดประวัติ();
      } catch (err) {
        console.error("Save note error:", err);
        alertComment.textContent = "⚠️ ไม่สามารถบันทึกได้: " + err.message;
        alertComment.classList.remove("hidden");
      } finally {
        btnSendComment.disabled = false;
      }
    });
  }

  // ── 5. ฟังก์ชันสำหรับ AI ระดับ 2: ประเมินงานช่างและแนะนำเครื่องมือ ──
  if (btnAiAnalyze) {
    btnAiAnalyze.addEventListener("click", async function () {
      if (!job) return;

      btnAiAnalyze.disabled = true;
      btnAiAnalyze.textContent = "⏳ กำลังประเมินงาน…";
      aiAlert.className = "alert";
      aiAlert.style.background = "#e8f4fd";
      aiAlert.style.color = "#004085";
      aiAlert.innerHTML = "🤖 <em>กำลังรวบรวมข้อมูลงานซ่อมส่งให้ AI (google/gemini-2.5-flash-lite) สรุปประเมินหน้างาน…</em>";
      aiAlert.classList.remove("hidden");

      try {
        if (!window.RakbaanAIService) {
          throw new Error("ระบบ AI ยังไม่พร้อมใช้งาน");
        }

        var recentComments = histories.map(function (h) {
          return (h.actorName || "เจ้าหน้าที่") + ": " + (h.note || "");
        }).join(" | ");

        var jobData = {
          id: jobId,
          title: job.title,
          category: job.category,
          description: job.description,
          address: job.address,
          customerName: job.customerName,
          status: job.status,
          recentComments: recentComments || "ยังไม่มีบันทึกเพิ่มเติม"
        };

        var res = await window.RakbaanAIService.analyzeJob(jobData);
        if (res.success && res.suggestion) {
          currentAiResult = res;
          aiAlert.classList.add("hidden");

          // แปลง markdown ขึ้นบรรทัดใหม่ง่าย ๆ เพื่อแสดงผล
          var formatted = esc(res.suggestion)
            .replace(/###\s*(.*?)(\n|$)/g, "<h3 style='font-size:16px; margin:14px 0 6px 0; color:var(--สีน้ำเงิน);'>$1</h3>")
            .replace(/\n/g, "<br>");

          aiContentBox.innerHTML = formatted;
          aiResultBox.classList.remove("hidden");
          btnSaveAi.disabled = false;
          btnSaveAi.textContent = "💾 บันทึกคำแนะนำนี้ลงระบบ";

          // เลื่อนหน้าจอให้เห็นผลลัพธ์
          aiResultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
          aiAlert.className = "alert alert-error";
          aiAlert.textContent = "⚠️ ไม่สามารถประเมินผลได้: " + (res.message || "เกิดข้อผิดพลาด");
          aiAlert.classList.remove("hidden");
        }
      } catch (err) {
        console.error("AI Analysis Error:", err);
        aiAlert.className = "alert alert-error";
        aiAlert.textContent = "⚠️ การเรียก AI ขัดข้อง (" + esc(err.message) + ") — ระบบเปิดให้ท่านตรวจสอบงานตามปกติค่ะ";
        aiAlert.classList.remove("hidden");
      } finally {
        btnAiAnalyze.disabled = false;
        btnAiAnalyze.textContent = "🤖 ให้ AI ประเมินอาการและจัดเครื่องมือ";
      }
    });
  }

  // บันทึกคำแนะนำของ AI ลง Firestore (aiSuggestion, aiReason, aiLog)
  if (btnSaveAi) {
    btnSaveAi.addEventListener("click", async function () {
      if (!currentAiResult) return;

      btnSaveAi.disabled = true;
      btnSaveAi.textContent = "⏳ กำลังบันทึก…";

      try {
        var currentUser = firebase.auth().currentUser;
        await window.RakbaanAIService.saveJobAnalysis(jobId, currentAiResult, currentUser);

        // อัปเดต state ทันทีในเครื่อง
        job.aiSuggestion = currentAiResult.suggestion;
        job.aiReason = currentAiResult.reason || "";
        job.aiUrgency = currentAiResult.urgency || "normal";
        job.aiSource = currentAiResult.source || "openrouter";
        job.aiAnalyzedAt = typeof เวลาตอนนี้ === "function" ? เวลาตอนนี้() : new Date().toISOString();
        job.aiAnalyzedBy = window.currentUserName || (currentUser ? currentUser.displayName || currentUser.email : "ทีมงานรักบ้าน");

        วาดข้อมูลAIที่เคยบันทึก();

        aiAlert.className = "alert alert-success";
        aiAlert.style.background = "#e8f5e9";
        aiAlert.style.color = "#1b5e20";
        aiAlert.innerHTML = "✅ <strong>บันทึกสำเร็จ!</strong> ระบบได้บันทึกคำแนะนำของ AI ลง Cloud Firestore ในฟิลด์ <code>aiSuggestion</code> และประวัติ <code>aiLog</code> เรียบร้อยแล้วค่ะ";
        aiAlert.classList.remove("hidden");

        btnSaveAi.textContent = "✅ บันทึกแล้ว";
      } catch (err) {
        console.error("Save AI suggestion error:", err);
        alert("เกิดข้อผิดพลาดในการบันทึกคำแนะนำ AI: " + err.message);
        btnSaveAi.disabled = false;
        btnSaveAi.textContent = "💾 บันทึกคำแนะนำนี้ลงระบบ";
      }
    });
  }

  // อัปเดตเมื่อสิทธิ์ Auth พร้อม
  window.addEventListener("rakbaan-auth-ready", function () {
    if (job) วาดรายละเอียด();
  });
})();

