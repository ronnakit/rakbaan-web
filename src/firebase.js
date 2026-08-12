import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Web app registered on the same rakbaan-cnx project as the mobile app
// (see rakbaan_page1/lib/firebase_options.dart for the android/ios configs).
const firebaseConfig = {
  apiKey: 'AIzaSyAzQILf3Ib1fARM-UtGycbehUJ1W4-QfU0',
  authDomain: 'rakbaan-cnx.firebaseapp.com',
  projectId: 'rakbaan-cnx',
  storageBucket: 'rakbaan-cnx.firebasestorage.app',
  messagingSenderId: '41492967250',
  appId: '1:41492967250:web:d4b5c6c8f09cb2fb69948b',
  measurementId: 'G-5X4L5X9X2C',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
