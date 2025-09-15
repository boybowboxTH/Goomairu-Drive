import React, { useState, useEffect } from 'react';
import '../../styles/FileDeleteview.css';
import FileItem from '../filesView/FileItem';
import CircularProgress from '@material-ui/core/CircularProgress';
import firebase from 'firebase/app';
import 'firebase/auth';
import { db } from '../../firebase';
import RestoreIcon from '@material-ui/icons/Restore';
import DeleteForeverIcon from '@material-ui/icons/DeleteForever';
import { DELETE_FILE_URL } from '../../api/api';

const DeletedFilesView = ({ searchTerm = '' }) => {
  const [deletedFiles, setDeletedFiles] = useState([]);
  const [deletedFolders, setDeletedFolders] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = firebase.auth().onAuthStateChanged(user => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);

    const unsubscribeFiles = db.collection('files')
      .where('userId', '==', currentUser.uid)
      .where('deleted', '==', true)
      .orderBy('deletedAt', 'desc')
      .onSnapshot(snapshot => {
        const filesData = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            timestamp: data.timestamp?.toDate(),
            deletedAt: data.deletedAt?.toDate(),
          };
        });
        setDeletedFiles(filesData);
        setLoading(false);
      }, err => {
        console.error('Deleted files listener error:', err);
        setLoading(false);
      });

    const unsubscribeFolders = db.collection('folders')
      .where('userId', '==', currentUser.uid)
      .where('deleted', '==', true)
      .orderBy('deletedAt', 'desc')
      .onSnapshot(snapshot => {
        const foldersData = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            timestamp: data.timestamp?.toDate(),
            deletedAt: data.deletedAt?.toDate(),
          };
        });
        setDeletedFolders(foldersData);
        setLoading(false);
      }, err => {
        console.error('Deleted folders listener error:', err);
        setLoading(false);
      });

    return () => {
      unsubscribeFiles();
      unsubscribeFolders();
    };
  }, [currentUser]);

  const restoreFile = async (fileId) => {
    if (!currentUser || !fileId) return;
    try {
      await db.collection('files').doc(fileId).update({
        deleted: false,
        deletedAt: null
      });
    } catch (err) {
      console.error('Restore file error:', err);
      alert('Failed to restore file');
    }
  };

  const permanentlyDeleteFile = async (fileId, fileName) => {
    if (!currentUser || !fileId) return;
    try {
      if (!window.confirm(`Permanently delete "${fileName}"? This action cannot be undone.`)) return;
      const token = await currentUser.getIdToken(true);
      const res = await fetch(`${DELETE_FILE_URL}/${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const errText = await res.text();
        alert(`Failed to delete file: ${errText}`);
        return;
      }
      await db.collection('files').doc(fileId).delete();
    } catch (err) {
      console.error('Permanent delete error:', err);
      alert('Failed to permanently delete file');
    }
  };

  const restoreFolder = async (folderId) => {
    if (!currentUser || !folderId) return;
    try {
      await db.collection('folders').doc(folderId).update({
        deleted: false,
        deletedAt: null
      });
    } catch (err) {
      console.error('Restore folder error:', err);
      alert('Failed to restore folder');
    }
  };

  const permanentlyDeleteFolder = async (folder) => {
    if (!currentUser || !folder?.id) return;
    try {
      if (!window.confirm(`Permanently delete folder "${folder.name}"? This action cannot be undone.`)) return;
      await db.collection('folders').doc(folder.id).delete();
    } catch (err) {
      console.error('Permanent delete folder error:', err);
      alert('Failed to permanently delete folder');
    }
  };

  const filteredFiles = deletedFiles.filter(file =>
    file.fileName.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredFolders = deletedFolders.filter(folder =>
    folder.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const combinedItems = [
    ...filteredFolders.map(f => ({ ...f, type: 'folder' })),
    ...filteredFiles.map(f => ({ ...f, type: 'file' }))
  ].sort((a, b) => b.deletedAt - a.deletedAt);

  return (
    <div className='fileDelview'>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <CircularProgress />
          <p>Loading deleted items...</p>
        </div>
      ) : (
        <>
          {combinedItems.length > 0 ? (
            <>
            <div className="fileDelview__titles">
                <div className="fileDelview__titles--left"><p>Name</p></div>
            </div>
          
              {combinedItems.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', padding: '10px', borderBottom: '1px solid #eee' }}>
                  <div style={{ flex: 1, marginRight: '20px', color: '#333' }}>
                    {item.type === 'folder' ? `📁 ${item.name}` : <FileItem caption={item.fileName} timestamp={item.deletedAt} size={item.size} noBorder={true} />}
                  </div>
                  <div style={{ display: 'flex', gap: '5px', marginRight: '5px' }}>
                    <button
                      style={{
                        background: '#4285f4',
                        color: 'white',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.85rem'
                      }}
                      onClick={() => item.type === 'folder' ? restoreFolder(item.id) : restoreFile(item.id)}
                      title={`Restore ${item.type}`}
                    >
                      <RestoreIcon style={{ fontSize: 16 }} /> Restore
                    </button>
                    <button
                      style={{
                        background: '#ea4335',
                        color: 'white',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.85rem'
                      }}
                      onClick={() => item.type === 'folder' ? permanentlyDeleteFolder(item) : permanentlyDeleteFile(item.id, item.fileName)}
                      title={`Delete ${item.type} permanently`}
                    >
                      <DeleteForeverIcon style={{ fontSize: 16 }} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🗑️</div>
              <h3>No deleted items</h3>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DeletedFilesView;
