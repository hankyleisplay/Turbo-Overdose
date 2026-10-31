// Firebase 主控台「專案設定 → 一般 → 你的應用程式 → SDK 設定」裡的 firebaseConfig。
// 這組設定本來就會公開在網頁上，安全性靠 FIREBASE_SETUP.md 裡的資料庫規則把關。
// 設成 null 代表線上功能停用。
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCCc1_1hSvB9vyOwswPwY8hAx_w1EWkufU',
  authDomain: 'turbo-overdose.firebaseapp.com',
  databaseURL: 'https://turbo-overdose-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'turbo-overdose',
  storageBucket: 'turbo-overdose.firebasestorage.app',
  messagingSenderId: '640743927091',
  appId: '1:640743927091:web:c1130f0b2fcf0691af2246',
};
