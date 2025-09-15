import firebase from 'firebase'

const firebaseConfig = {
  apiKey: "AIzaSyBJEAK5DSi1BTwl11r5fItm9aKrECFLBfo",
  authDomain: "goomairu-drive-01.firebaseapp.com",
  projectId: "goomairu-drive-01",
  storageBucket: "goomairu-drive-01.appspot.com",
  messagingSenderId: "214537564792",
  appId: "1:214537564792:web:1d6d19714bd9cb6d30b38d"
};

const firebaseApp = firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();
const storage = firebase.storage();
const db = firebaseApp.firestore();

export { auth, provider, db, storage };
