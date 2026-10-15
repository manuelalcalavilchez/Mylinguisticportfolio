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
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/literata';
import '@fontsource-variable/nunito';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/special-elite/400.css';
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
  if (loading && !isPublic) return <main className="page narrow"><p className="muted" aria-busy="true">Cargando…</p></main>;
  const initial = user?.displayName.trim().charAt(0).toUpperCase() ?? '';
  return (
    <>
      <a className="skip" href="#main">Saltar al contenido</a>
      {!isPublic && (
        <header className="topbar">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">MLP</span>
            <span>My Linguistic Portfolio<small>English · 4.º ESO</small></span>
          </Link>
          {user && (
            <nav className="topnav" aria-label="Cuenta">
              <Link to="/cuenta" title="Mi cuenta"><span className="avatar-dot" aria-hidden="true">{initial}</span><span className="who">{user.displayName}</span></Link>
              <button type="button" onClick={() => void logout()}>Salir</button>
            </nav>
          )}
        </header>
      )}
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
