import React from 'react';
import '../../styles/FileItem.css';
import InsertDriveFileIcon from '@material-ui/icons/InsertDriveFile';

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const FileItem = ({ caption, timestamp, size, onDownload, noBorder = false }) => {
  const d = new Date(timestamp);
  const fileDate = `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;

  const getReadableFileSizeString = (fileSizeInBytes) => {
    let i = -1;
    const byteUnits = [' kB', ' MB', ' GB', ' TB','PB','EB','ZB','YB'];
    do {
      fileSizeInBytes = fileSizeInBytes / 1024;
      i++;
    } while (fileSizeInBytes > 1024);
    return Math.max(fileSizeInBytes, 0.1).toFixed(1) + byteUnits[i];
  };

  const containerStyle = noBorder
    ? { cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 'none', padding: 0, margin: 0 }
    : { cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };

  return (
    <div
      className={noBorder ? '' : 'fileItem'}
      onClick={onDownload}
      style={containerStyle}
    >
      <div
        className={noBorder ? '' : 'fileItem--left'}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
      >
        <InsertDriveFileIcon />
        <p style={{ margin: 0 }}>{caption}</p>
      </div>
      <div
        className={noBorder ? '' : 'fileItem--right'}
        style={{ display: 'flex', gap: '0.5rem', marginRight: '5px', fontSize: '0.9rem', color: '#555' }}
      >
        <p style={{ margin: 0 }}>{fileDate}</p>
        <p style={{ margin: 0 }}>{getReadableFileSizeString(size)}</p>
      </div>
    </div>
  );
}

export default FileItem;
