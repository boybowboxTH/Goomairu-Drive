import GDriveLogo from "../../media/goo.png";

export default function Login({ handleLogin }) {
  return (
    <div className="app__login">
      <img src={GDriveLogo} alt="Goo Drive" />
      <button onClick={handleLogin}>Log in to Goomairu Drive</button>
    </div>
  );
}
