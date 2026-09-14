// ─────────────────────────────────────────────────────────────
// js/firebase-config.js — การเชื่อมต่อ Firebase ของ รักบ้าน@CNX
// โปรเจกต์: rakbaan-cnx
// ─────────────────────────────────────────────────────────────

var firebaseConfig = {
  apiKey: "AIzaSyAzQILf3Ib1fARM-UtGycbehUJ1W4-QfU0",
  authDomain: "rakbaan-cnx.firebaseapp.com",
  projectId: "rakbaan-cnx",
  storageBucket: "rakbaan-cnx.firebasestorage.app",
  messagingSenderId: "41492967250",
  appId: "1:41492967250:web:d4b5c6c8f09cb2fb69948b",
  measurementId: "G-5X4L5X9X2C"
};

firebase.initializeApp(firebaseConfig);
window.db = firebase.firestore();
window.auth = firebase.auth();
