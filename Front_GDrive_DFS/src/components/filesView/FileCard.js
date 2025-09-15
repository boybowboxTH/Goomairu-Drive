import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import '../../styles/FileCard.css';
import '../../styles/Sharewith.css';
import InsertDriveFileIcon from '@material-ui/icons/InsertDriveFile';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import firebase from 'firebase/app';
import 'firebase/auth';
import { db } from '../../firebase';
import StarIcon from '@material-ui/icons/Star';


const FileCard = ({ name, fileId, type = 'file', onDownload, onMove, onDelete, folders, highlight = false, onToggleHighlight }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  
  const iconRef = useRef();
  const menuRef = useRef();
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!isMountedRef.current) return;
      if (iconRef.current && !iconRef.current.contains(event.target) &&
          menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
        setMoveOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openMenu = (e) => {
    e.stopPropagation();
    if (!isMountedRef.current) return; 
    const rect = iconRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX });
    setMenuOpen(!menuOpen);
  };

  const safeSetState = (stateSetter, value) => {
    if (isMountedRef.current) stateSetter(value);
  };

  const handleShare = async () => {
    if (!shareEmail) return alert('Please enter an email');
    try {
      const collection = type === 'folder' ? 'folders' : 'files';
      await db.collection(collection).doc(fileId).update({
        shareWith: firebase.firestore.FieldValue.arrayUnion(shareEmail)
      });
      alert('Shared successfully!');
      setShareEmail('');
      safeSetState(setShareOpen, false);
    } catch (err) {
      console.error('Share error:', err);
      alert('Failed to share');
    }
  };

  return (
    <div
      className='fileCard'
      draggable
      onDragStart={(e) => e.dataTransfer.setData('fileId', fileId)}
      style={{ position: 'relative', cursor: 'pointer' }}
    >
      <div
        style={{
          position: 'absolute',
          top: 5,
          right: 5,
          cursor: 'pointer',
          zIndex: 999,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleHighlight && onToggleHighlight(fileId, !highlight);
        }}
      >
        <StarIcon style={{ color: highlight ? 'gold' : '#ccc', fontSize: 28 }} />
      </div>

      <div className="fileCard--top">
        <InsertDriveFileIcon style={{ fontSize: 130 }} />
      </div>

      <div
        className="fileCard--bottom"
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        <p style={{
          margin: 0,
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {name}
        </p>
      </div>

      <div ref={iconRef} style={{ position: 'absolute', bottom: 5, right: 5, zIndex: 10 }}>
        <MoreVertIcon style={{ cursor: 'pointer' }} onClick={openMenu} />
      </div>

      {menuOpen && ReactDOM.createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'absolute',
            top: menuPos.top,
            left: menuPos.left,
            background: '#fff',
            boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
            borderRadius: 4,
            minWidth: 160,
            zIndex: 9999,
          }}
        >
          <div
            style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
            onClick={(e) => { e.stopPropagation(); onDownload(); safeSetState(setMenuOpen, false); }}
          >
            Download file
          </div>

          <div
            style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #eee', position: 'relative' }}
            onMouseEnter={() => folders?.length > 0 && safeSetState(setMoveOpen, true)}
            onMouseLeave={() => safeSetState(setMoveOpen, false)}
          >
            Move file
            {moveOpen && folders?.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '100%',
                  background: '#fff',
                  border: '1px solid #ccc',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                  borderRadius: 4,
                  minWidth: 160,
                  zIndex: 10000,
                }}
              >
                {folders.map(f => (
                  <div
                    key={f.id}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
                    onClick={async () => {
                      await onMove(fileId, f.id);
                      safeSetState(setMenuOpen, false);
                      safeSetState(setMoveOpen, false);
                    }}
                  >
                    {f.name}
                  </div>
                ))}
                <div
                  style={{ padding: '8px 12px', cursor: 'pointer' }}
                  onClick={async () => {
                    await onMove(fileId, null);
                    safeSetState(setMenuOpen, false);
                    safeSetState(setMoveOpen, false);
                  }}
                >
                  Home
                </div>
              </div>
            )}
          </div>

          <div
            style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
            onClick={() => safeSetState(setShareOpen, true)}
          >
            Share file
          </div>

          <div
            style={{ padding: '8px 12px', cursor: 'pointer' }}
            onClick={async () => {
              if (window.confirm('Move this file to deleted folder?')) {
                const collection = type === 'folder' ? 'folders' : 'files';
                await db.collection(collection).doc(fileId).update({
                  deleted: true,
                  deletedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
              }
            }}
          >
            Delete file
          </div>
        </div>,
        document.body
      )}

      {shareOpen && ReactDOM.createPortal(
      <div className="sharewith__overlay">
        <div className="sharewith__popup" onClick={(e) => e.stopPropagation()}>
          <h4>Share {type}</h4>
          <input
            type="email"
            placeholder="Enter email"
            value={shareEmail}
            onChange={(e) => setShareEmail(e.target.value)}
            className="sharewith__input"
          />
          <div className="sharewith__buttons">
            <button className="sharewith__btn" onClick={handleShare}>Share</button>
            <button className="sharewith__btn" onClick={() => safeSetState(setShareOpen, false)}>Cancel</button>
          </div>
        </div>
      </div>,
      document.body
    )}

    </div>
  );
};

export default FileCard;
