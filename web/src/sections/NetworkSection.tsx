import { Link } from 'react-router-dom';
import { PunchCard } from '../components/PunchCard';
import { useNetwork } from '../lib/useNetwork';
import './network-section.css';

export function NetworkSection() {
  const { data } = useNetwork();
  const t = data.totals;
  const covered = t.verified + t.sameCode;

  return (
    <section className="ns">
      <div className="wrap">
        <h2 className="ns-title">
          <span className="ns-num">{covered}</span> of <span className="ns-num">{t.contracts}</span> contracts on
          Portaldot V3 can be checked.
        </h2>
        <PunchCard rows={data.contracts} caption={`${covered} of ${t.contracts} contracts verified`} />
        <div className="ns-foot">
          <Link to="/network" className="btn btn-ghost">
            Every contract
          </Link>
        </div>
      </div>
    </section>
  );
}
