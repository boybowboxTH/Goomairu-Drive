import React from 'react'
import '../../styles/SideIcons.css'
import AddIcon from '@material-ui/icons/Add';

const index = () => {
    return (
        <div className='sideIcons'>
            <div className="sideIcons__top">
                <img src="https://cdn4.iconfinder.com/data/icons/logos-brands-in-colors/48/google-calendar-512.png" alt="Goo Calendar" />
                <img src="https://www.gstatic.com/marketing-cms/assets/images/81/30/e29e504f4d5db98a7f7c2d4a81a7/google-keep.webp=s96-fcrop64=1,00000000ffffffff-rw" alt="Goo Keep" />
                <img src="https://cdn0.iconfinder.com/data/icons/ui-blue/200/Untitled-5-512.png" alt="Goo contect" />
            </div>

            <hr />

            <div className="sideIcons__plusIcon">
                <AddIcon />
            </div>
        </div>
    )
}

export default index
