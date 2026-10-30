import { Link } from 'react-router-dom';
import { AddressSearch } from '../components/AddressSearch';
import './page.css';

export function NotFound() {
  return (
    <div className="page wrap" style={{ display: 'grid', gap: '1.5rem', justifyItems: 'start' }}>
      <h1 className="page-title">No page at this path.</h1>
      <p className="lede">Looking for a contract? Paste its address.</p>
      <AddressSearch />
      <Link to="/">Back to the start</Link>
    </div>
  );
}
