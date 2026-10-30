import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Nav } from './components/Nav';
import { Footer } from './components/Footer';
import { Home } from './pages/Home';
import { Verify } from './pages/Verify';
import { AddressPage } from './pages/Address';
import { NetworkPage } from './pages/Network';
import { NotFound } from './pages/NotFound';
import { ScrollTrigger, scrollToTop, startSmoothScroll } from './lib/motion';

export function App() {
  const { pathname } = useLocation();

  useEffect(() => startSmoothScroll(), []);

  useEffect(() => {
    scrollToTop();
    const t = setTimeout(() => ScrollTrigger.refresh(), 60);
    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Nav />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/address/:address" element={<AddressPage />} />
          <Route path="/network" element={<NetworkPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
