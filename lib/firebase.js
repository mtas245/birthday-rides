import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCLVzDmaYk78zlqTeOCPtmzp7LFNJ72LAM",
  authDomain: "birtday-rides.firebaseapp.com",
  projectId: "birtday-rides",
  storageBucket: "birtday-rides.firebasestorage.app",
  messagingSenderId: "643672962457",
  appId: "1:643672962457:web:5c91a0db01c0a5ad970f08"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);