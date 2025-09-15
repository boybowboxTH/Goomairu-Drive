import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom'; 
import '../../styles/Sidebar.css';
import NewFile from './NewFile';
import SidebarItem from './SidebarItem';

import InsertDriveFileIcon from '@material-ui/icons/InsertDriveFile';
import ImportantDevicesIcon from '@material-ui/icons/ImportantDevices';
import PeopleAltIcon from '@material-ui/icons/PeopleAlt';
import QueryBuilderIcon from '@material-ui/icons/QueryBuilder';
import StarBorderIcon from '@material-ui/icons/StarBorder';
import DeleteOutlineIcon from '@material-ui/icons/DeleteOutline';
import StorageIcon from '@material-ui/icons/Storage';
import SupervisorAccountIcon from '@material-ui/icons/SupervisorAccount';

import { db } from '../../firebase'; 
import 'firebase/firestore';

const Sidebar = () => {
    const [totalSize, setTotalSize] = useState(0);
    const maxSize = 20 * 1024 * 1024 * 1024; // 20 GB

    useEffect(() => {
        const fetchTotalSize = async () => {
            try {
                const snapshot = await db.collection('files').get(); 
                let size = 0;
                snapshot.forEach(doc => {
                    const data = doc.data();
                    size += Number(data.size) || 0;
                });
                setTotalSize(size);
            } catch (err) {
                console.error("Error fetching file sizes from DB:", err);
            }
        };

        fetchTotalSize();
    }, []);

    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024*1024)).toFixed(2) + ' MB';
        else return (bytes / (1024*1024*1024)).toFixed(2) + ' GB';
    }

    const percentage = Math.min((totalSize / maxSize) * 100, 100);

    return (
        <div className='sidebar'>
            <NewFile />

            <div className="sidebar__itemsContainer">
                <Link to="/drive" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <SidebarItem arrow icon={<InsertDriveFileIcon />} label={'My Drive'} />
                </Link>
            
                <SidebarItem arrow icon={<ImportantDevicesIcon />} label={'Computers'} />

                <Link to="/share" style={{ textDecoration: 'none', color: 'inherit' }}>
                     <SidebarItem icon={<PeopleAltIcon />} label={'Shared with me'} />
                </Link>

                <Link to="/recent" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <SidebarItem icon={<QueryBuilderIcon />} label={'Recent'} />
                </Link>

                <Link to="/highlight" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <SidebarItem icon={<StarBorderIcon />} label={'Starred'} />
                </Link>
                
                <Link to="/delete" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <SidebarItem arrow icon={<DeleteOutlineIcon />} label="Bin" />
                </Link>
                
                <hr/>
                 <Link to="/admin" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <SidebarItem arrow icon={<SupervisorAccountIcon />} label="Admin View" />
                </Link>
                <hr/>

                <SidebarItem icon={<StorageIcon />} label={'Storage'} />
                <div style={{ marginTop: '5px', padding: '0 10px' }}>
                    <div style={{ fontSize: '12px', marginBottom: '4px', textAlign: 'center' }}>
                        {formatSize(totalSize)} of 20 GB used
                    </div>
                    <div style={{ background: '#e0e0e0', borderRadius: '4px', height: '8px', width: '100%' }}>
                        <div style={{ width: `${Math.max(percentage)}%`, background: '#1976d2', height: '100%', borderRadius: '4px' }}></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
