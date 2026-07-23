// =========================================================
// CONFIGURACIÓN DE FIREBASE
// Pega aquí los valores que Firebase te da al crear tu app web.
// Instrucciones completas: sección "Tutorial" del README.md
// =========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

// Import the functions you need from the SDKs you need

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDok8k4LHHc0ynpr4VSufuVyFPzQwk2Ncg",
  authDomain: "oped-chart.firebaseapp.com",
  projectId: "oped-chart",
  storageBucket: "oped-chart.firebasestorage.app",
  messagingSenderId: "187701751051",
  appId: "1:187701751051:web:cb4b570257a3867b6c060e",
  measurementId: "G-B8LCN21S89"
};

// Initialize Firebase

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
