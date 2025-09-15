import { useState } from "react";
import Header from "../../components/header";
import Sidebar from "../../components/sidebar";
import ShareFilesView from "../../components/sharewith/Shareview";
import SideIcons from "../../components/sideIcons";

export default function Drive({ user }) {
  const [searchTerm, setSearchTerm] = useState("");

  return (
    <>
      <Header onSearch={setSearchTerm} userPhoto={user.photoURL} />
      <div className="app__main">
        <Sidebar />
        <ShareFilesView searchTerm={searchTerm} />
        <SideIcons />
      </div>
    </>
  );
}
