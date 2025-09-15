import React, { useState, useEffect } from "react";
import firebase from "firebase/app";
import "firebase/auth";
import "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { Menu, MenuItem, Divider, Typography, Button } from "@material-ui/core";

import "../../styles/logout.css";

const UserMenu = ({ userPhoto }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [userData, setUserData] = useState(null);

  const auth = firebase.auth();
  const db = firebase.firestore();
  const navigate = useNavigate();
  const user = auth.currentUser;

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        const userRef = db.collection("users").doc(user.uid);
        const docSnap = await userRef.get();
        if (docSnap.exists) {
          setUserData(docSnap.data());
        }
      }
    };
    fetchUserData();
  }, [user, db]);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
        auth.signOut().then(() => {
            navigate("/", { replace: true });
        }).catch((error) => {
            console.error("Logout error:", error);
        });
    };

  return (
    <div>
      <img
        src={userPhoto || "/default-avatar.png"}
        alt="User"
        className="user-avatar"
        onClick={handleClick}
      />

      <Menu
        anchorEl={anchorEl}
        keepMounted
        open={Boolean(anchorEl)}
        onClose={handleClose}
        getContentAnchorEl={null}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        PaperProps={{
            style: {
            marginTop: 20,
            minWidth: 250, 
            },
        }}
      >
        <div className="user-menu-content" style={{ textAlign: "center" }}>
        <Typography variant="body2" className="user-email">
            {userData?.email || user?.email}
        </Typography>
        
        <img
            src={userData?.photoURL || user?.photoURL || "/default-avatar.png"}
            alt="User"
            style={{
            width: "60px",
            height: "60px",
            borderRadius: "50%",
            margin: "8px",
            }}
        />

        <Typography variant="subtitle1" className="user-name">
            Hello, {userData?.name || user?.displayName || "User"}
        </Typography>

        </div>

        <Divider />

        <MenuItem>
          <Button
            onClick={handleLogout}
            color="secondary"
            variant="contained"
            fullWidth
          >
            log out
          </Button>
        </MenuItem>
      </Menu>
    </div>
  );
};

export default UserMenu;
