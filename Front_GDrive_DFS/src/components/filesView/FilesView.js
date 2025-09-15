import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import '../../styles/FilesView.css';
import FileItem from './FileItem';
import FileCard from './FileCard';
import CircularProgress from '@material-ui/core/CircularProgress';
import firebase from 'firebase/app';
import 'firebase/auth';
import { db } from '../../firebase';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import StarIcon from '@material-ui/icons/Star';

const FilesView = ({ searchTerm = '' }) => {
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [menuOpenFolderId, setMenuOpenFolderId] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  const [shareOpen, setShareOpen] = useState(false);
  const [shareId, setShareId] = useState(null); 
  const [shareType, setShareType] = useState('file'); 
  const [shareEmail, setShareEmail] = useState('');

  const fileRowRef = useRef();
  const folderRowRef = useRef();
  const menuRef = useRef();
  const [overflowFolder, setOverflowFolder] = useState(false);
  const [overflowFile, setOverflowFile] = useState(false);

  const openSharePopup = (id, type) => {
    setShareId(id);
    setShareType(type);
    setShareOpen(true);
  };

  useEffect(() => {
    const unsubscribe = firebase.auth().onAuthStateChanged(user => setCurrentUser(user));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let isMounted = true;
    setLoading(true);
    const unsubscribe = db.collection('files')
      .where('userId', '==', currentUser.uid)
      .where('deleted', '!=', true)
      .orderBy('deleted')
      .orderBy('timestamp', 'desc')
      .onSnapshot(snapshot => {
        if (!isMounted) return;
        const filesData = snapshot.docs.map(doc => {
          const data = doc.data();
          return { id: doc.id, ...data, timestamp: data.timestamp?.toDate() };
        });
        setFiles(filesData);
        setLoading(false);
      }, err => { console.error(err); setLoading(false); });
    return () => { isMounted = false; unsubscribe(); };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    let isMounted = true;
    const unsubscribe = db.collection('folders')
      .where('userId', '==', currentUser.uid)
      .orderBy('timestamp', 'desc')
      .onSnapshot(snapshot => {
        if (!isMounted) return;
        setFolders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    return () => { isMounted = false; unsubscribe(); };
  }, [currentUser]);

  useEffect(() => {
    const checkOverflowFolder = () => {
      const el = folderRowRef.current;
      if (!el) return;
      setOverflowFolder(el.scrollWidth > el.clientWidth);
    };
    const checkOverflowFile = () => {
      const el = fileRowRef.current;
      if (!el) return;
      setOverflowFile(el.scrollWidth > el.clientWidth);
    };
    checkOverflowFolder();
    checkOverflowFile();
    window.addEventListener('resize', checkOverflowFolder);
    window.addEventListener('resize', checkOverflowFile);
    return () => {
      window.removeEventListener('resize', checkOverflowFolder);
      window.removeEventListener('resize', checkOverflowFile);
    };
  }, [folders, files, currentFolderId]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        !e.target.closest('.folderCard')
      ) {
        setMenuOpenFolderId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuRef]);

  const downloadFile = async (fileName) => {
    if (!currentUser) return;
    try {
      const token = await currentUser.getIdToken(true);
      const res = await fetch(`/api/files/${encodeURIComponent(fileName)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) { alert('Download error'); return; }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName.replace(/[/\\?%*:|"<>]/g, "_");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) { console.error(err); alert('Download failed'); }
  };

  const scrollRow = (ref, distance) => {
    if (ref.current) ref.current.scrollBy({ left: distance, behavior: 'smooth' });
  };

  const handleDrop = async (e, folderId) => {
    const fileId = e.dataTransfer.getData('fileId');
    if (!fileId) return;
    await db.collection('files').doc(fileId).update({ folderId });
  };

  const moveFile = async (fileId, newFolderId) => {
    if (!fileId) return;
    try { await db.collection('files').doc(fileId).update({ folderId: newFolderId }); }
    catch (err) { console.error(err); }
  };

  const handleFolderDelete = async (folder) => {
    if (!currentUser) return;
    if (!window.confirm(`Delete folder "${folder.name}" with all files?`)) return;
    try {
      const now = firebase.firestore.FieldValue.serverTimestamp();
      const filesInFolder = files.filter(f => f.folderId === folder.id && !f.deleted);
      for (const file of filesInFolder) {
        await db.collection('files').doc(file.id).update({ deleted: true, deletedAt: now });
      }
      await db.collection('folders').doc(folder.id).update({ deleted: true, deletedAt: now });
      setFolders(folders.filter(f => f.id !== folder.id));
      setMenuOpenFolderId(null);
    } catch (err) { console.error(err); alert('Error deleting folder'); }
  };

  const filteredFolders = folders.filter(f => !f.deleted && f.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredFiles = files
    .filter(f => currentFolderId ? f.folderId === currentFolderId : !f.folderId)
    .filter(f => f.fileName.toLowerCase().includes(searchTerm.toLowerCase()));

  const openFolderMenu = (e, folderId) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX });
    setMenuOpenFolderId(folderId);
  };

  return (
    <div className="fileView">
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <CircularProgress /> <p>Loading files...</p>
        </div>
      ) : (
        <>
          <div className="fileView__carousel">
            {currentFolderId && (
              <button className="folder-back-button" onClick={() => setCurrentFolderId(null)}>←</button>
            )}
            {overflowFolder && (
              <button className="folder-scroll-button" onClick={() => scrollRow(folderRowRef, -250)}>{"<"}</button>
            )}
            <div className="fileView__row" ref={folderRowRef}>
              {filteredFolders.map(folder => (
                <div
                  key={folder.id}
                  className="folderCard"
                  onClick={() => setCurrentFolderId(folder.id)}
                  onDrop={(e) => handleDrop(e, folder.id)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ position: 'relative' }}
                >
                  <div className="folderIcon">📁</div>
                  <p>{folder.name}</p>
                  <div
                    style={{
                      position: 'absolute',
                      top: 5,
                      right: 5,
                      cursor: 'pointer',
                      zIndex: 999
                    }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await db.collection('folders').doc(folder.id)
                          .update({ highlight: !folder.highlight });
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                  >
                    <StarIcon style={{ color: folder.highlight ? 'gold' : '#ccc', fontSize: 28 }} />
                  </div>

                  <div
                    style={{ position: 'absolute', bottom: 5, right: 5, zIndex: 10, cursor: 'pointer' }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (menuOpenFolderId === folder.id) {
                          setMenuOpenFolderId(null); 
                        } else {
                          openFolderMenu(e, folder.id); 
                        }
                      }}
                    >
                      <MoreVertIcon />
                  </div>
                </div>
              ))}
            </div>
            {overflowFolder && (
              <button className="folder-scroll-button" onClick={() => scrollRow(folderRowRef, 250)}>{">"}</button>
            )}
          </div>

          {shareOpen && shareType === 'folder' && ReactDOM.createPortal(
            <div className="sharewith__overlay" onClick={() => setShareOpen(false)}>
              <div className="sharewith__popup" onClick={(e) => e.stopPropagation()}>
                <h4>Share folder</h4>
                <input
                  type="email"
                  placeholder="Enter email"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  className="sharewith__input"
                />
                <div className="sharewith__buttons">
                  <button
                    className="sharewith__btn"
                    onClick={async () => {
                      if (!shareEmail) return alert('Please enter email');
                      try {
                        await db.collection('folders').doc(shareId).update({
                          shareWith: firebase.firestore.FieldValue.arrayUnion(shareEmail)
                        });

                        const filesInFolder = files.filter(f => f.folderId === shareId);
                        const batch = db.batch();
                        filesInFolder.forEach(file => {
                          const fileRef = db.collection('files').doc(file.id);
                          batch.update(fileRef, {
                            shareWith: firebase.firestore.FieldValue.arrayUnion(shareEmail)
                          });
                        });
                        await batch.commit();

                        alert('Folder and all files shared!');
                        setShareEmail('');
                        setShareOpen(false);
                      } catch (err) {
                        console.error(err);
                        alert('Failed to share folder');
                      }
                    }}
                  >
                    Share
                  </button>
                  <button className="sharewith__btn" onClick={() => setShareOpen(false)}>Cancel</button>
                </div>
              </div>
            </div>,
            document.body
          )}


          {menuOpenFolderId && ReactDOM.createPortal(
            <div
              ref={menuRef}
              style={{
                position: 'absolute',
                top: menuPos.top,
                left: menuPos.left,
                background: '#fff',
                boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                borderRadius: 4,
                minWidth: 140,
                zIndex: 9999,
              }}
            >
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
                onClick={() => openSharePopup(menuOpenFolderId, 'folder')}
              >
                Share folder
              </div>
              <div
                style={{ padding: '8px 12px', cursor: 'pointer' }}
                onClick={async (e) => {
                  e.stopPropagation();
                  const folder = folders.find(f => f.id === menuOpenFolderId);
                  if (folder) await handleFolderDelete(folder);
                }}
              >
                Delete
              </div>
            </div>,
            document.body
          )}

          {filteredFiles.length > 0 && (
            <div className="fileView__carousel">
              {overflowFile && <button onClick={() => scrollRow(fileRowRef, -250)}>{'<'}</button>}
              <div className="fileView__row" ref={fileRowRef}>
                {filteredFiles.slice(0, 5).map(file => (
                  <FileCard
                    key={file.id}
                    name={file.fileName}
                    fileId={file.id}
                    highlight={file.highlight}
                    onDownload={() => downloadFile(file.fileName)}
                    onMove={moveFile}
                    folders={folders}
                    onToggleHighlight={async (id, newVal) => {
                      await db.collection('files').doc(id).update({ highlight: newVal });
                    }}
                  />
                ))}
              </div>
              {overflowFile && <button onClick={() => scrollRow(fileRowRef, 250)}>{'>'}</button>}
            </div>
          )}

          {filteredFiles.length > 0 ? (
            <>
              <div className="fileView__titles">
                <div className="fileView__titles--left"><p>Name</p></div>
                <div className="fileView__titles--right">
                  <p>Last modified</p>
                  <p>File size</p>
                </div>
              </div>

              {filteredFiles.map(file => (
                <FileItem
                  key={file.id}
                  caption={file.fileName}
                  timestamp={file.timestamp}
                  size={file.size}
                  onDownload={() => downloadFile(file.fileName)}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('fileId', file.id)}
                  onContextMenu={async (e) => {
                    e.preventDefault();
                    const folderOptions = folders.map(f => `${f.name} (${f.id})`).join('\n');
                    const newFolderId = prompt(`Move to folder:\n${folderOptions}\nLeave blank for Root`);
                    if (newFolderId !== null) await moveFile(file.id, newFolderId || null);
                  }}
                />
              ))}
            </>
          ) : <p style={{ padding: '1rem', color: '#666', textAlign: 'center' }}>No file</p>}
        </>
      )}
    </div>
  );
};

export default FilesView;
