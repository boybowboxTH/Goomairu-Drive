import React, { useState } from 'react';
import Header from '../common/Header';
import Sidebar from '../common/Sidebar';
import DeletedFilesView from '../drive/DeletedFilesView';
import '../../styles/Drive.css';

const DeletedFiles = ({ user }) => {
  const [searchTerm, setSearchTerm] = useState('');

  return (
    <div className="drive">
      <Header user={user} searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
      <div className="drive__main">
        <Sidebar />
        <div className="drive__content">
          <div style={{ padding: '1rem', borderBottom: '1px solid #ddd', backgroundColor: '#f8f9fa' }}>
            <h2 style={{ margin: 0, color: '#5f6368', fontSize: '1.2rem' }}>
              🗑️ Deleted Files
            </h2>
            <p style={{ margin: '0.5rem 0 0', color: '#666', fontSize: '0.9rem' }}>
              Files that have been deleted. You can restore or permanently delete them.
            </p>
          </div>
          <DeletedFilesView searchTerm={searchTerm} />
        </div>
      </div>
    </div>
  );
};

export default DeletedFiles;