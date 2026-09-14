// ─────────────────────────────────────────────────────────────
// js/jobs.js — จัดการแสดงผลรายการแจ้งซ่อมของ รักบ้าน@CNX
// ควบคุมสิทธิ์การมองเห็นตามบทบาท (ACL):
// - customer: เห็นเฉพาะงานของตนเอง
// - staff/admin: เห็นงานทั้งหมดในเชียงใหม่
// ─────────────────────────────────────────────────────────────

(function () {
  var tableBox = document.getElementById("กล่องตาราง");
  var subtitleText = document.getElementById("subtitleText");

  firebase.auth().onAuthStateChanged(function (user) {
    if (user) {
      โหลดรายการงาน(user);
    }
  });

  async function โหลดรายการงาน(currentUser) {
    try {
      // 1. ตรวจสอบบทบาทผู้ใช้
      var userRole = window.currentUserRole;
      if (!userRole) {
        try {
          var uDoc = await window.db.collection("users").doc(currentUser.uid).get();
          if (uDoc.exists && uDoc.data().role) {
            userRole = uDoc.data().role;
            window.currentUserRole = userRole;
          }
        } catch (e) {
          console.warn("Read user role warning:", e);
        }
      }

      userRole = userRole || "customer";

      // อัปเดต Subtitle ตามสิทธิ์
      if (userRole === "customer") {
        subtitleText.textContent = "กำลังแสดงเฉพาะงานซ่อมบ้านของคุณ · กดที่แถวเพื่อดูรายละเอียด";
      } else {
        subtitleText.textContent = "โหมดทีมช่าง/ผู้ดูแล: แสดงงานแจ้งซ่อมทั้งหมดในพื้นที่เชียงใหม่";
      }

      // 2. ดึงข้อมูลจากคอลเลกชัน jobs
      var snap = await window.db.collection("jobs").get();
      var jobs = [];

      snap.forEach(function (d) {
        jobs.push(Object.assign({ id: d.id }, d.data()));
      });

      // เรียงจากใหม่ไปเก่า
      jobs.sort(function (a, b) {
        return (b.createdAt || "") > (a.createdAt || "") ? 1 : -1;
      });

      // 3. กรองตามบทบาทผู้ใช้ (ACL)
      if (userRole === "customer") {
        jobs = jobs.filter(function (j) {
          return j.customerId === currentUser.uid;
        });
      }

      // 4. กรองตาม URL Query (?status=...)
      var filterStatus = ค่าจากURL("status");
      if (filterStatus) {
        jobs = jobs.filter(function (j) { return j.status === filterStatus; });
        subtitleText.textContent += " (กรองสถานะ: " + filterStatus + ")";
      }

      วาดตาราง(jobs);
    } catch (err) {
      console.error("Load jobs error:", err);
      tableBox.innerHTML = "<p style='padding:20px; color:var(--สีแดง);'>เกิดข้อผิดพลาดในการโหลดข้อมูล: " + esc(err.message) + "</p>";
    }
  }

  function วาดตาราง(jobs) {
    if (jobs.length === 0) {
      tableBox.innerHTML =
        '<div style="padding:32px; text-align:center;">' +
        '<p style="color:var(--สีจาง); font-size:16px;">ยังไม่มีรายการแจ้งซ่อมในระบบ (หรือไม่มีงานตามเงื่อนไขที่เลือก)</p>' +
        '<a href="new-job.html" class="btn" style="margin-top:10px;">+ แจ้งซ่อมบ้านใหม่ตอนนี้</a>' +
        '</div>';
      return;
    }

    var html =
      '<table>' +
      '<thead><tr>' +
      '<th>หัวข้องานซ่อม</th>' +
      '<th>หมวดหมู่</th>' +
      '<th>สถานะ</th>' +
      '<th class="hide-mobile">ผู้แจ้ง</th>' +
      '<th class="hide-mobile">สถานที่</th>' +
      '<th class="hide-mobile">วันที่แจ้ง</th>' +
      '</tr></thead><tbody>';

    jobs.forEach(function (j) {
      html +=
        '<tr class="clickable" data-id="' + esc(j.id) + '">' +
        '<td><strong>' + esc(j.title) + '</strong></td>' +
        '<td>' + ป้ายหมวดหมู่(j.category) + '</td>' +
        '<td>' + ป้ายสถานะ(j.status) + '</td>' +
        '<td class="hide-mobile">' + esc(j.customerName) + '</td>' +
        '<td class="hide-mobile">' + esc(j.address) + '</td>' +
        '<td class="hide-mobile">' + esc(j.createdAt) + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    tableBox.innerHTML = html;

    // กดแถวเพื่อไปหน้ารายละเอียด
    tableBox.querySelectorAll("tr.clickable").forEach(function (row) {
      row.addEventListener("click", function () {
        location.href = "job-detail.html?id=" + encodeURIComponent(row.dataset.id);
      });
    });
  }
})();
