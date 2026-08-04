// Firebase web app config for project salka-38d81.
//
// Every value here is public by design -- it ships in the browser bundle, the
// same way the Supabase anon key does. Firebase security comes from Security
// Rules and App Check, not from hiding these. Follows the same
// `import.meta.env.X || <fallback>` pattern as lib/supabase.ts so the deploy
// workflow needs no new secrets.
//
// NOTE: this apiKey is a *different* key from the one in
// android/app/google-services.json that GitHub flagged. Both are public by
// nature, but both should carry Google Cloud restrictions (this one: HTTP
// referrers limited to gosalka.com and app.gosalka.com) so they cannot be
// used to bill other APIs on the project.
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyA3UH_5TZ2oWDcI6LRTcAl04QI3bKpsslI',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'salka-38d81.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'salka-38d81',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'salka-38d81.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID || '298864964514',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:298864964514:web:ffa48ef7432992fdc538fb',
}

// Firebase Console -> Project Settings -> Cloud Messaging -> Web Push
// certificates -> "Generate key pair". This is the PUBLIC half of the VAPID
// pair and is safe in the bundle; getToken() cannot mint a web push token
// without it. Until it is filled in, web push stays inert -- registerPush()
// and enablePush() both return without prompting, so nothing breaks and no
// customer sees a permission dialog that could never work.
export const VAPID_PUBLIC_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || ''
