// ─────────────────────────────────────────────────────────────
// js/nav.js — แถบเมนูนำทางและระบบควบคุมสิทธิ์ผู้ใช้ (ACL)
// ─────────────────────────────────────────────────────────────

(function () {
  var เมนู = [
    { href: "index.html",    ชื่อ: "หน้าแรก" },
    { href: "jobs.html",     ชื่อ: "รายการแจ้งซ่อม" },
    { href: "new-job.html",  ชื่อ: "+ แจ้งซ่อมใหม่" }
  ];

  var หน้าปัจจุบัน = location.pathname.split("/").pop() || "index.html";
  var หน้าสาธารณะ = ["index.html", "login.html", "register.html", ""];

  function วาดเมนู(role) {
    var html = '<div class="navbar"><a href="index.html" class="brand">🏠 รักบ้าน@CNX</a>';

    เมนู.forEach(function (m) {
      var active = m.href === หน้าปัจจุบัน ? ' class="nav-link active"' : ' class="nav-link"';
      html += '<a href="' + m.href + '"' + active + ">" + m.ชื่อ + "</a>";
    });

    html += '<button type="button" id="btnConfigKey" style="background:transparent; border:1px dashed rgba(255,255,255,0.4); color:#fff; border-radius:4px; padding:3px 8px; font-size:12px; cursor:pointer; margin-left:8px;" title="ตั้งค่า OpenRouter AI Key">🔑 AI Key</button>';

    html += '<div class="nav-user" id="navUser">กำลังตรวจสอบสถานะ…</div></div>';

    var navEl = document.getElementById("nav");
    if (navEl) navEl.innerHTML = html;

    var btnConfigKey = document.getElementById("btnConfigKey");
    if (btnConfigKey) {
      btnConfigKey.addEventListener("click", function () {
        var current = localStorage.getItem("rakbaan_ai_key") || "";
        var val = prompt("กรุณากรอก OpenRouter API Key สำหรับทดสอบระบบ AI:\n(คีย์จะถูกบันทึกในเบราว์เซอร์เครื่องนี้เท่านั้น ไม่ส่งขึ้น GitHub หรือเซิร์ฟเวอร์)", current);
        if (val !== null) {
          localStorage.setItem("rakbaan_ai_key", val.trim());
          if (val.trim()) {
            alert("✅ บันทึก API Key เรียบร้อยแล้ว! ระบบพร้อมเชื่อมต่อ google/gemini-2.5-flash-lite");
          } else {
            alert("ℹ️ ลบคีย์ออกจากเบราว์เซอร์แล้ว (ระบบจะใช้ Smart Fallback Engine สำรอง)");
          }
        }
      });
    }
  }

  // วาดโครงเริ่มต้น
  วาดเมนู(null);


  // ตรวจสอบ Firebase Authentication
  if (typeof firebase !== "undefined" && firebase.auth) {
    firebase.auth().onAuthStateChanged(async function (user) {
      var navUser = document.getElementById("navUser");

      if (user) {
        var role = "customer";
        var displayName = user.displayName || user.email;

        // ดึงข้อมูลบทบาทจากคอลเลกชัน users
        try {
          if (window.db) {
            var docSnap = await window.db.collection("users").doc(user.uid).get();
            if (docSnap.exists) {
              var udata = docSnap.data();
              if (udata.role) role = udata.role;
              if (udata.fullName) displayName = udata.fullName;
            }
          }
        } catch (e) {
          console.warn("ไม่สามารถอ่านข้อมูลผู้ใช้:", e);
        }

        window.currentUserRole = role;
        window.currentUserName = displayName;

        // แสดงข้อมูลผู้ใช้และปุ่มออกจากระบบ
        navUser = document.getElementById("navUser");
        if (navUser) {
          var roleText = role === "staff" ? "ช่าง/ทีมงาน" : (role === "admin" ? "ผู้ดูแล" : "เจ้าของบ้าน");
          var badgeClass = "badge badge-role-" + role;

          navUser.innerHTML =
            '<span>👤 <strong>' + esc(displayName) + '</strong> ' +
            '<span class="' + badgeClass + '" style="font-size:12px; padding:2px 8px; border-radius:999px;">' + esc(roleText) + '</span></span>' +
            '<button type="button" class="btn-ghost" id="ปุ่มออกจากระบบ" style="font-size:13px; padding:4px 10px; color:#fff; border-color:rgba(255,255,255,0.4); background:transparent;">ออกจากระบบ</button>';

          var btnLogout = document.getElementById("ปุ่มออกจากระบบ");
          if (btnLogout) {
            btnLogout.addEventListener("click", async function () {
              try {
                await firebase.auth().signOut();
                location.href = "login.html";
              } catch (err) {
                alert("ออกจากระบบไม่สำเร็จ: " + err.message);
              }
            });
          }
        }

        // ส่ง Custom Event ให้หน้าที่รอ Auth ทำงานต่อ
        window.dispatchEvent(new CustomEvent("rakbaan-auth-ready", {
          detail: { user: user, role: role, name: displayName }
        }));

      } else {
        // ยังไม่ได้ล็อกอิน
        window.currentUserRole = null;
        window.currentUserName = null;

        navUser = document.getElementById("navUser");
        if (navUser) {
          navUser.innerHTML =
            '<a href="login.html" class="btn btn-ghost" style="font-size:14px; padding:5px 12px; color:#fff; border-color:rgba(255,255,255,0.5); background:transparent;">เข้าสู่ระบบ</a>' +
            '<a href="register.html" class="btn" style="font-size:14px; padding:5px 12px; background:#ff9800; border-color:#ff9800;">สมัครสมาชิก</a>';
        }

        // ตรวจสอบว่าหน้านี้เป็นหน้าที่ต้องล็อกอินหรือไม่
        var isPublic = หน้าสาธารณะ.some(function (p) {
          return p && หน้าปัจจุบัน === p;
        });

        if (!isPublic && หน้าปัจจุบัน !== "") {
          location.href = "login.html";
        }
      }
    });
  }
})();
