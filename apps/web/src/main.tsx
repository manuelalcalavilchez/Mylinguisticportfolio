import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { LoginPage, RegisterTeacherPage, ResetPasswordPage } from './pages/AuthPages';
import { Dashboard } from './pages/HomePages';
import './styles.css';

function Shell() {
  const { user, loading, logout } = useAuth();
  if (loading) return <p className="card narrow" aria-busy="true">Cargando…</p>;
  return (
    <>
      <header className="topbar">
        <span className="brand">My Linguistic Portfolio</span>
        {user && (
          <button type="button" className="secondary" onClick={() => void logout()}>Cerrar sesión</button>
        )}
      </header>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/registro-profesor" element={<RegisterTeacherPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
