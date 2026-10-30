import { Link } from 'react-router-dom';
import { PunchCard } from '../components/PunchCard';
import { useNetwork } from '../lib/useNetwork';
import { ago } from '../lib/format';
import './network-section.css';

export function NetworkSection() {
  const { data, live } = useNetwork();
  const t = data.totals;
  const covered = t.verified + t.sameCode;

  return (
    <section className="ns">
      <div className="wrap">
        <h2 className="ns-title">
          <span className="ns-num">{covered}</span> of <span className="ns-num">{t.contracts}</span> contracts on
          Portaldot V3 have source anyone can check.
        </h2>
        <p className="ns-sub">
          Each position on this card is a contract deployed on the testnet. The lit ones have been rebuilt from source and
          matched. The rest are bytes nobody has accounted for yet.
        </p>
        <PunchCard rows={data.contracts} caption={`${covered} of ${t.contracts} contracts verified`} />
        <div className="ns-foot">
          <p>
            {t.uniqueCode} distinct programs, {t.pvm} built for PolkaVM.{' '}
            {live ? `Read from the chain ${ago(data.updatedAt)}.` : `Snapshot from ${ago(data.updatedAt)}; the live index is unavailable.`}
          </p>
          <Link to="/network" className="btn btn-ghost">
            See every contract
          </Link>
        </div>
      </div>
    </section>
  );
}
