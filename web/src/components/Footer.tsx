import { Link } from 'react-router-dom';
import { REGISTRY_ADDRESS } from '../lib/api';
import { Logo } from './Logo';
import { Copy } from './Copy';
import './footer.css';

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <div>
          <Link to="/" className="footer-brand">
            <Logo size={26} />
            <span>bytematch</span>
          </Link>
          <p className="footer-note">
            Source verification for contracts on Portaldot V3. Built for the Portaldot Hacker House 2026.
          </p>
        </div>
        <dl className="footer-facts">
          <div>
            <dt>Network</dt>
            <dd>Portaldot V3 testnet, chain 420420777</dd>
          </div>
          <div>
            <dt>SourceRegistry</dt>
            <dd>
              <span className="mono">{REGISTRY_ADDRESS}</span> <Copy value={REGISTRY_ADDRESS} />
            </dd>
          </div>
          <div>
            <dt>Etherscan-compatible API</dt>
            <dd className="mono">{typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api'}</dd>
          </div>
        </dl>
        <nav className="footer-links" aria-label="Footer">
          <Link to="/verify">Verify a contract</Link>
          <Link to="/network">All contracts</Link>
          <Link to="/#how">How it works</Link>
        </nav>
      </div>
      <p className="wrap footer-credit">
        Photograph: keypunch operator, 1950 US Census. U.S. Census Bureau, public domain.
      </p>
    </footer>
  );
}
