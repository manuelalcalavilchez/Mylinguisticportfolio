import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Evidence, PublicSnapshot, Section } from '../lib/types';
import { Loading, useLoad } from '../lib/ui';
import { PortfolioView } from '../components/PortfolioView';
import { PublicHeader } from './PortfolioPage';

/** Página pública: solo muestra el snapshot aprobado y publicado. */
export function PublicPortfolioPage() {
  const { slug } = useParams();
  const { data, error, loading } = useLoad(() => api<{ portfolio: PublicSnapshot }>(`/public/portfolios/${slug}`), [slug]);
  if (loading) return <main className="card"><Loading /></main>;
  if (error || !data) {
    return (
      <main className="card narrow">
        <h1>Portfolio no disponible</h1>
        <p>{error instanceof ApiError && error.status === 404 ? 'Este portfolio no existe o ya no está publicado.' : 'No se ha podido cargar.'}</p>
      </main>
    );
  }
  const s = data.portfolio;
  const sections = (['home', 'passport', 'biography', 'dossier'] as Section[]).filter((k) => k in s.sections);
  return (
    <main className="card wide public">
      <PublicHeader s={s} />
      <PortfolioView
        content={s.sections}
        sections={sections}
        evidences={s.evidences as Evidence[]}
        fileUrl={(e) => `/api/public/portfolios/${slug}/files/${e.id}`}
      />
      <footer className="muted small">
        Portfolio educativo publicado con autorización. La autoevaluación es orientativa y no constituye una certificación oficial de nivel.
      </footer>
    </main>
  );
}
