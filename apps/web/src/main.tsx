import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import {
  AccountPage, LoginPage, RegisterStudentPage, RegisterTeacherPage, ResetPasswordPage,
} from './pages/AuthPages';
import { Dashboard } from './pages/Dashboard';
import { GroupPage } from './pages/GroupPage';
import { ProjectPage } from './pages/ProjectPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { PublicPortfolioPage } from './pages/PublicPortfolioPage';
import './styles.css';

function Protected({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function Shell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  const isPublic = loc.pathname.startsWith('/p/');
  if (loading && !isPublic) return <p className="card narrow" aria-busy="true">Cargando…</p>;
  return (
    <>
      <a className="skip" href="#main">Saltar al contenido</a>
      <header className="topbar">
        <Link to="/" className="brand">My Linguistic Portfolio</Link>
        {user && !isPublic && (
          <nav className="row">
            <Link to="/cuenta">{user.displayName}</Link>
            <button type="button" className="secondary small" onClick={() => void logout()}>Salir</button>
          </nav>
        )}
      </header>
      <div id="main">
        <Routes>
          <Route path="/p/:slug" element={<PublicPortfolioPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/unirse" element={<RegisterStudentPage />} />
          <Route path="/registro-profesor" element={<RegisterTeacherPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/cuenta" element={<Protected><AccountPage /></Protected>} />
          <Route path="/grupos/:id" element={<Protected><GroupPage /></Protected>} />
          <Route path="/proyectos/:id" element={<Protected><ProjectPage /></Protected>} />
          <Route path="/portfolio/:id" element={<Protected><PortfolioPage /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
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
