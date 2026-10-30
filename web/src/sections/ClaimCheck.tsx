import { Link } from 'react-router-dom';
import './claimcheck.css';

const LENDING = '0x7e3444c1f9dbd53dea5ebc8160522b154857566b';

export function ClaimCheck() {
  return (
    <section className="cc">
      <div className="wrap">
        <h2 className="h2 cc-title">A README is a claim. A match is a check.</h2>
        <div className="cc-pair">
          <article className="cc-claim">
            <p className="cc-where">In the repository</p>
            <div className="cc-readme mono" aria-label="An excerpt of a project README">
              <p className="cc-md-h">## Deployed contracts</p>
              <p>| Contract&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;| Address&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|</p>
              <p>| LendingMarket | 0x7e34…566b |</p>
              <p className="cc-md-dim">Source: contracts/LendingMarket.sol</p>
            </div>
            <p className="cc-note">Written once, on deploy day. Nothing keeps it true afterwards.</p>
          </article>

          <article className="cc-check">
            <p className="cc-where">On chain, checked by Bytematch</p>
            <p className="state state-mismatch cc-verdict">No match</p>
            <p>
              The code at <span className="mono">0x7e34…566b</span> is not what{' '}
              <span className="mono">contracts/LendingMarket.sol</span> compiles to today.
            </p>
            <p className="cc-note">
              The project’s own security notes say these contracts were deployed before later fixes. The repository moved
              on and the chain didn’t. Both are honest; now you can tell which one you are reading.
            </p>
            <Link to={`/address/${LENDING}`} className="cc-link">
              See what is deployed
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}
