import React from 'react'
import '../../styles/Header.css'

import GDriveLogo from '../../media/goo.png'
import SearchIcon from '@material-ui/icons/Search';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';
import SettingsIcon from '@material-ui/icons/Settings';
import AppsIcon from '@material-ui/icons/Apps';
import Usermenu from './logout'; 

const geminiLogo = 'https://www.gstatic.com/marketing-cms/assets/images/7e/a4/253561a944f4a8f5e6dec4f5f26f/gemini.webp=s96-fcrop64=1,00000000ffffffff-rw'

const index = ({ userPhoto, onSearch }) => {
    const handleSearchChange = (e) => {
        onSearch(e.target.value);
    }

    return (
        <div className='header'>
            <div className="header__logo">
                <img src={GDriveLogo} alt="Goo Drive" />
                <span>Goo Drive</span>
            </div>
            <div className="header__searchContainer">
                <div className="header__searchBar">
                    <SearchIcon />
                    <input 
                        type="text" 
                        placeholder='Search in Drive'
                        onChange={handleSearchChange} 
                    />
                    <ExpandMoreIcon />
                </div>
            </div>
            <div className="header__icons">
                <HelpOutlineIcon />
                <SettingsIcon />
                <a href="https://gemini.google.com/" target="_blank" rel="noopener noreferrer">
                    <img src={geminiLogo} alt='geminilogo' className='geminilogo'/>
                </a>
                <AppsIcon />
                <Usermenu userPhoto={userPhoto} />
            </div>
        </div>
    )
}

export default index
