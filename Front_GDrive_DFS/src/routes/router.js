import { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Login from "../components/auth/Login";
import Drive from "../components/page/Drive";
import DeletedFiles from "../components/page/Delete";
import Sharewith from "../components/page/Share"
import Recent from "../components/page/Recent"
import Highlight from "../components/page/Highlight"
import Admin from "../components/page/Admin"
import { auth, provider, db } from "../firebase";
import firebase from "firebase";

export default function AppRouter() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleLogin = () => {
    if (!user) {
      auth.signInWithPopup(provider)
        .then((res) => {
          setUser(res.user);
          db.collection("users").doc(res.user.uid).set({
            name: res.user.displayName,
            email: res.user.email,
            photoURL: res.user.photoURL,
            lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        })
        .catch((err) => {
          if (err.code === 'auth/popup-closed-by-user') {
            console.log("User closed the popup.");
            return;
          }
          alert(err.message);
        });
    }
  };

  if (loading) return null; 

  return (
    <Router>
      <Routes>
        <Route
          path="/login"
          element={!user ? <Login handleLogin={handleLogin} /> : <Navigate to="/drive" />}
        />

        <Route
          path="/drive"
          element={user ? <Drive user={user} /> : <Navigate to="/login" />}
        />

        <Route
          path="/delete"
          element={user ? <DeletedFiles user={user} /> : <Navigate to="/login" />}
        />

         <Route
          path="/share"
          element={user ? <Sharewith user={user} /> : <Navigate to="/login" />}
        />

         <Route
          path="/recent"
          element={user ? <Recent user={user} /> : <Navigate to="/login" />}
        />

        <Route
          path="/highlight"
          element={user ? <Highlight user={user} /> : <Navigate to="/login" />}
        />

        <Route
          path="/admin"
          element={user ? <Admin user={user} /> : <Navigate to="/login" />}
        />

        <Route
          path="*"
          element={<Navigate to={user ? "/drive" : "/login"} />}
        />
      </Routes>
    </Router>
  );
}
