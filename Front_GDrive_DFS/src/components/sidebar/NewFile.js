import React, { useState, useEffect, useRef } from 'react';
import '../../styles/NewFile.css';
import AddIcon from '@material-ui/icons/Add';
import CreateNewFolderIcon from '@material-ui/icons/CreateNewFolder';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';
import Modal from '@material-ui/core/Modal';
import { makeStyles } from '@material-ui/core/styles';
import CircularProgress from '@material-ui/core/CircularProgress';
import firebase from 'firebase';
import { db } from '../../firebase';
import { UPLOAD_FILE_URL } from '../../api/api';


const useStyles = makeStyles((theme) => ({
  paper: {
    position: 'fixed',
    width: 400,
    backgroundColor: theme.palette.background.paper,
    borderRadius: 10,
    boxShadow: theme.shadows[5],
    padding: theme.spacing(3),
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  },
  section: { display: 'flex', flexDirection: 'column', gap: theme.spacing(1) },
  input: { padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc', width: '90%' },
  input2: { padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc', width: '96%' },
  buttonWrapper: { display: 'flex', justifyContent: 'center', marginTop: theme.spacing(1) },
  button: {
    marginTop: theme.spacing(1),
    padding: '8px 12px',
    borderRadius: 6,
    border: 'none',
    backgroundColor: '#1a73e8',
    color: '#fff',
    width: '50%',
    cursor: 'pointer',
    '&:hover': { backgroundColor: '#155ab6' },
  },
  loadingWrapper: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: theme.spacing(2) },
}));

const NewFile = ({ onUploadDone }) => {
  const classes = useStyles();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const isMountedRef = useRef(true);

  const toggleMenu = () => setMenuOpen(!menuOpen);

  const openModal = (type) => {
    setModalType(type);
    setModalOpen(true);
    setMenuOpen(false);
  };

  const closeModal = () => {
    setModalOpen(false);
    setFolderName('');
    setFile(null);
    setUploading(false);
    setSelectedFolder('');
  };

  useEffect(() => {
    return () => { isMountedRef.current = false; }
  }, []);

  const safeSetState = (setter, value) => {
    if (isMountedRef.current && typeof setter === 'function') {
      setter(value);
    }
  };

  useEffect(() => {
    const fetchFolders = async () => {
      const user = firebase.auth().currentUser;
      if (!user) return;
      const unsubscribe = db.collection('folders')
        .where('userId', '==', user.uid)
        .orderBy('timestamp', 'desc')
        .onSnapshot(snapshot => {
          const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          safeSetState(setFolders, data);
        });
      return () => unsubscribe();
    };
    fetchFolders();
  }, []);

  const handleFolderCreate = async () => {
    if (!folderName) return;
    safeSetState(setUploading(true));
    try {
      const user = firebase.auth().currentUser;
      if (!user) throw new Error("User not logged in");
      await db.collection('folders').add({
        name: folderName,
        userId: user.uid,
        deleted: false,
        deletedAt: null,
        shareWith: null,
        highlight: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });

      if (onUploadDone) onUploadDone(true); 
      closeModal();
    } catch (err) {
      console.error(err);
      alert('Create folder failed!');
    } finally {
      safeSetState(setUploading(false));
    }
  };

  const handleFileUpload = async () => {
    if (!file) return;
    safeSetState(setUploading(true));
    try {
      const user = firebase.auth().currentUser;
      if (!user) throw new Error("User not logged in");
      const token = await user.getIdToken();

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(UPLOAD_FILE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();

      await db.collection('files').add({
        fileName: data.filename,
        filePath: data.filePath || "",
        size: file.size.toString(),
        userId: user.uid,
        nodeId: data.stored_on || [],
        folderId: selectedFolder || null, 
        deleted: false,
        deletedAt: false, 
        shareWith: null,
        highlight: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });

      if (onUploadDone) onUploadDone(true);
      closeModal();
    } catch (err) {
      console.error(err);
      alert('Upload failed!');
    } finally {
      safeSetState(setUploading(false));
    }
  };

  return (
    <div className="newFile">
      <div className="newFile__container" onClick={toggleMenu}>
        <AddIcon fontSize="large" />
        <p>New</p>
      </div>

      {menuOpen && (
        <div className="newFile__menu">
          <div className="menuItem" onClick={() => openModal('folder')}>
            <CreateNewFolderIcon /> <span>Create folder</span>
          </div>
          <div className="menuItem" onClick={() => openModal('file')}>
            <CloudUploadIcon /> <span>Upload file</span>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal}>
        <div className={classes.paper}>
          {modalType === 'folder' && (
            <div className={classes.section}>
              <h4>Create Folder</h4>
              <input
                className={classes.input}
                type="text"
                placeholder="Folder name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
              />
              {uploading ? (
                <div className={classes.loadingWrapper}>
                  <CircularProgress size={24} /> <span>Saving...</span>
                </div>
              ) : (
                <div className={classes.buttonWrapper}>
                  <button className={classes.button} onClick={handleFolderCreate}>
                    Create
                  </button>
                </div>
              )}
            </div>
          )}

          {modalType === 'file' && (
            <div className={classes.section}>
              <h4>Upload File</h4>

              <select
                className={classes.input2}
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
              >
                <option value="">Root</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>

              {uploading ? (
                <div className={classes.loadingWrapper}>
                  <CircularProgress size={24} /> <span>Uploading...</span>
                </div>
              ) : (
                <>
                  <input className={classes.input} type="file" onChange={(e) => setFile(e.target.files[0])} />
                  <div className={classes.buttonWrapper}>
                    <button className={classes.button} onClick={handleFileUpload}>
                      Upload
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default NewFile;
