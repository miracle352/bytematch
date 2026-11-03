import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Logo } from './Logo';
import './nav.css';

export function Nav() {
  const [floating, setFloating] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const on = () => setFloating(window.scrollY > 32);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className={`nav ${floating || pathname !== '/' ? 'nav-floating' : ''} ${open ? 'nav-open' : ''}`}>
      <div className="nav-bar">
        <Link to="/" className="nav-brand" aria-label="Bytematch home">
          <Logo />
          <span>bytematch</span>
        </Link>
        <nav className="nav-links" aria-label="Main">
          <NavLink to="/repos">Repositories</NavLink>
          <NavLink to="/network">Network</NavLink>
          <NavLink to="/verify">Verify</NavLink>
        </nav>
        <button className="nav-toggle" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
