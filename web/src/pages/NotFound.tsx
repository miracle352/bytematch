import { Omnibox } from '../components/Omnibox';
import './page.css';

export function NotFound() {
  return (
    <div className="page wrap" style={{ display: 'grid', gap: '2rem', justifyItems: 'start' }}>
      <h1 className="page-title">Nothing here.</h1>
      <Omnibox />
    </div>
  );
}
