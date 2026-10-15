import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Evidence, PublicSnapshot, Section } from '../lib/types';
import { Loading, useLoad } from '../lib/ui';
import { PortfolioView } from '../components/PortfolioView';
import { publicOwnerLine } from './PortfolioPage';

/** Página pública: solo muestra el snapshot aprobado y publicado, con el diseño elegido por el alumno. */
export function PublicPortfolioPage() {
  const { slug } = useParams();
  const { data, error, loading } = useLoad(() => api<{ portfolio: PublicSnapshot }>(`/public/portfolios/${slug}`), [slug]);
  if (loading) return <main className="page"><Loading /></main>;
  if (error || !data) {
    return (
      <main className="page narrow panel">
        <h1>Portfolio no disponible</h1>
        <p>{error instanceof ApiError && error.status === 404 ? 'Este portfolio no existe o ya no está publicado.' : 'No se ha podido cargar. Prueba de nuevo en unos minutos.'}</p>
      </main>
    );
  }
  const s = data.portfolio;
  const sections = (['home', 'passport', 'biography', 'dossier'] as Section[]).filter((k) => k in s.sections);
  return (
    <main className="public-page">
      <PortfolioView
        content={s.sections}
        sections={sections}
        evidences={s.evidences as Evidence[]}
        fileUrl={(e) => `/api/public/portfolios/${slug}/files/${e.id}`}
        design={s.design}
        owner={publicOwnerLine(s)}
        fallbackTitle={`${s.publicName}’s Linguistic Portfolio`}
        footer={<>{s.projectTitle}. Portfolio educativo publicado con autorización. La autoevaluación es orientativa y no es una certificación oficial de nivel.</>}
      />
    </main>
  );
}
