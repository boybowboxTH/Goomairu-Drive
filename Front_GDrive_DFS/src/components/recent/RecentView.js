import React, { useState, useEffect } from 'react';
import '../../styles/FileDeleteview.css';
import FileItem from '../filesView/FileItem';
import CircularProgress from '@material-ui/core/CircularProgress';
import firebase from 'firebase/app';
import 'firebase/auth';
import { db } from '../../firebase';

const Recentview = ({ searchTerm = '' }) => {
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
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
    const userEmail = currentUser.email;
    setLoading(true);

    const fetchFilesAndFolders = async () => {
      try {
        const ownFilesSnap = await db.collection('files')
          .where('userId', '==', currentUser.uid)
          .get();

        const sharedFilesSnap = await db.collection('files')
          .where('shareWith', 'array-contains', userEmail)
          .get();

        const processFileDoc = (doc) => {
          const data = doc.data();
          let ts = 0;
          if (data.timestamp && data.timestamp.toMillis) {
            ts = data.timestamp.toMillis();
          } else {
            ts = Number(data.timestamp) || 0;
          }
          const fileSize = Number(data.size) || 0;
          return { id: doc.id, ...data, timestamp: ts, size: fileSize };
        };

        const allFilesMap = new Map();
        [...ownFilesSnap.docs, ...sharedFilesSnap.docs].forEach(doc => {
          if (!allFilesMap.has(doc.id)) {
            allFilesMap.set(doc.id, processFileDoc(doc));
          }
        });
        setFiles(Array.from(allFilesMap.values()));

        const ownFoldersSnap = await db.collection('folders')
          .where('userId', '==', currentUser.uid)
          .get();

        const sharedFoldersSnap = await db.collection('folders')
          .where('shareWith', 'array-contains', userEmail)
          .get();

        const processFolderDoc = (doc) => {
          const data = doc.data();
          let ts = 0;
          if (data.timestamp && data.timestamp.toMillis) {
            ts = data.timestamp.toMillis();
          } else {
            ts = Number(data.timestamp) || 0;
          }
          return { id: doc.id, ...data, timestamp: ts };
        };

        const allFoldersMap = new Map();
        [...ownFoldersSnap.docs, ...sharedFoldersSnap.docs].forEach(doc => {
          if (!allFoldersMap.has(doc.id)) {
            allFoldersMap.set(doc.id, processFolderDoc(doc));
          }
        });
        setFolders(Array.from(allFoldersMap.values()));

        setLoading(false);
      } catch (err) {
        console.error('Error fetching files/folders:', err);
        setLoading(false);
      }
    };

    fetchFilesAndFolders();
  }, [currentUser]);


  const filteredFiles = files.filter(file =>
    file.fileName?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredFolders = folders.filter(folder =>
    folder.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const combinedItems = [
    ...filteredFolders.map(f => ({ ...f, type: 'folder' })),
    ...filteredFiles.map(f => ({ ...f, type: 'file' }))
  ].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className='fileDelview'>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <CircularProgress />
          <p>Loading items...</p>
        </div>
      ) : (
        <>
          {combinedItems.length > 0 ? (
            <>
              <div className="fileDelview__titles">
                <div className="fileDelview__titles--left"><p>Name</p></div>
              </div>
              {combinedItems.map(item => (
                <div
                  key={`${item.type}-${item.id}`}
                  style={{ display: 'flex', alignItems: 'center', padding: '10px', borderBottom: '1px solid #eee' }}
                >
                  <div style={{ flex: 1, marginRight: '20px', color: '#333' }}>
                    {item.type === 'folder'
                      ? `📁 ${item.name}`
                      : <FileItem caption={item.fileName} timestamp={item.timestamp} size={item.size} noBorder={true} />}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
              <h3>No items</h3>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Recentview;
