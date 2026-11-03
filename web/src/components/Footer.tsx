import { Link } from 'react-router-dom';
import { REGISTRY_ADDRESS } from '../lib/api';
import { Logo } from './Logo';
import { Copy } from './Copy';
import './footer.css';

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <Link to="/" className="footer-brand">
          <Logo size={26} />
          <span>bytematch</span>
        </Link>
        <dl className="footer-facts">
          <div>
            <dt>Portaldot V3 testnet</dt>
            <dd className="mono">chain 420420777</dd>
          </div>
          <div>
            <dt>SourceRegistry</dt>
            <dd>
              <span className="mono">{REGISTRY_ADDRESS}</span> <Copy value={REGISTRY_ADDRESS} />
            </dd>
          </div>
        </dl>
        <nav className="footer-links" aria-label="Footer">
          <Link to="/repos">Repositories</Link>
          <Link to="/network">Network</Link>
          <Link to="/verify">Verify</Link>
          <a href="/llms.txt">llms.txt</a>
          <a href="https://github.com/miracle352/bytematch">GitHub</a>
        </nav>
      </div>
      <p className="wrap footer-credit">Photograph: 1950 US Census, U.S. Census Bureau, public domain.</p>
    </footer>
  );
}
