import { useState } from "react";
import Header from "../../components/header";
import Sidebar from "../../components/sidebar";
import DeleteFilesView from "../../components/delete/DeletedFilesView";
import SideIcons from "../../components/sideIcons";

export default function Drive({ user }) {
  const [searchTerm, setSearchTerm] = useState("");

  return (
    <>
      <Header onSearch={setSearchTerm} userPhoto={user.photoURL} />
      <div className="app__main">
        <Sidebar />
        <DeleteFilesView searchTerm={searchTerm} />
        <SideIcons />
      </div>
    </>
  );
}
