import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar       from './components/Navbar';
import SearchPage   from './pages/SearchPage';
import LoginPage    from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HistoryPage  from './pages/HistoryPage';
import AuthGuard    from './components/AuthGuard';

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/"         element={<SearchPage />} />
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/history"  element={<AuthGuard><HistoryPage /></AuthGuard>} />
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
