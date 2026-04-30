import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/'); };

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        🌐 DomainPulse
      </Link>

      <div className="navbar-links">
        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Search
        </NavLink>

        {user && (
          <NavLink to="/history" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            History
          </NavLink>
        )}

        {user ? (
          <div className="navbar-user">
            <span className="user-email">{user.email}</span>
            <button className="btn btn-ghost" onClick={handleLogout}>Logout</button>
          </div>
        ) : (
          <div className="navbar-auth">
            <Link to="/login"    className="btn btn-ghost">Login</Link>
            <Link to="/register" className="btn btn-primary">Sign up</Link>
          </div>
        )}
      </div>
    </nav>
  );
}
