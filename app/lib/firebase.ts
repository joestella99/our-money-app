import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import {
  getAuth,
  signInAnonymously,
  type Auth,
  type User,
} from "firebase/auth";

// Firebase project for this private household app.
const firebaseConfig = {
  apiKey: "AIzaSyDBCeMIcmG-DnGZJFKc9W53opPmsTad0Jk",
  authDomain: "our-money-app-1031.firebaseapp.com",
  projectId: "our-money-app-1031",
  storageBucket: "our-money-app-1031.firebasestorage.app",
  messagingSenderId: "161015413352",
  appId: "1:161015413352:web:9f9c16d86fcfc3014f59dd",
  measurementId: "G-L7D0N5FFYY",
};

// The Firebase Console URL supplied for this project points to this named DB.
const FIRESTORE_DATABASE_ID = "budgetdb";

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _auth: Auth | null = null;
let _authPromise: Promise<User | null> | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!_app) _app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return _app;
}

export function isFirebaseConfigured(): boolean {
  return !!(firebaseConfig.apiKey && firebaseConfig.projectId);
}

export function getDb(): Firestore | null {
  if (!isFirebaseConfigured()) return null;
  if (!_db) _db = getFirestore(getFirebaseApp(), FIRESTORE_DATABASE_ID);
  return _db;
}

export function getAuthClient(): Auth | null {
  if (!isFirebaseConfigured()) return null;
  if (!_auth) _auth = getAuth(getFirebaseApp());
  return _auth;
}

/**
 * Silently gives each installed browser/PWA its own Firebase identity.
 * No password or visible login screen is required. Enable Anonymous auth in
 * Firebase Console before deploying the locked-down Firestore rules.
 */
export async function ensureAnonymousAuth(): Promise<User | null> {
  const auth = getAuthClient();
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;
  if (!_authPromise) {
    _authPromise = signInAnonymously(auth)
      .then(result => result.user)
      .catch(error => {
        console.error("Firebase anonymous authentication failed", error);
        return null;
      })
      .finally(() => { _authPromise = null; });
  }
  return _authPromise;
}
