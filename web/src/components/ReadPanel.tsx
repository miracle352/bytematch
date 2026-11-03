import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type AbiItem, type StateValue } from '../lib/api';
import './readpanel.css';

const show = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

/** Every public value, read live, and a form for each view function that takes arguments. */
export function ReadPanel({ address, abi, via }: { address: string; abi: AbiItem[]; via?: string }) {
  const [values, setValues] = useState<StateValue[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setValues(null);
    api.state(address, via).then((r) => setValues(r.values), (e: ApiError) => setError(e.message));
  }, [address, via]);

  const withArgs = abi.filter(
    (f) => f.type === 'function' && (f.stateMutability === 'view' || f.stateMutability === 'pure') && (f.inputs ?? []).length > 0,
  );

  return (
    <div className="rd">
      {error && <p className="rd-error">{error}</p>}
      {!values && !error && <p className="mono ad-loading">Reading…</p>}
      {values && (
        <dl className="rd-values">
          {values.map((v) => (
            <div key={v.signature}>
              <dt className="mono">{v.name}</dt>
              <dd className={`mono ${v.error ? 'rd-reverted' : ''}`}>{v.error ? 'reverted' : show(v.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {withArgs.length > 0 && (
        <div className="rd-calls">
          {withArgs.map((f, i) => (
            <CallForm key={i} address={address} fn={f} via={via} />
          ))}
        </div>
      )}
    </div>
  );
}

function CallForm({ address, fn, via }: { address: string; fn: AbiItem; via?: string }) {
  const inputs = fn.inputs ?? [];
  const [args, setArgs] = useState<string[]>(inputs.map(() => ''));
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sig = `${fn.name}(${inputs.map((i) => i.type).join(',')})`;

  const run = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const parsed = args.map((a, i) => (/\[\]$|^tuple/.test(inputs[i]!.type) ? JSON.parse(a || '[]') : a.trim()));
    api
      .call(address, sig, parsed, via)
      .then((r) => setOut({ ok: true, text: show(r.result) }), (e: ApiError) => setOut({ ok: false, text: e.message }))
      .finally(() => setBusy(false));
  };

  return (
    <form className="rd-call" onSubmit={run}>
      <p className="mono rd-sig">{fn.name}</p>
      {inputs.map((p, i) => (
        <input
          key={i}
          className="mono"
          placeholder={`${p.name || `arg${i}`} ${p.type}`}
          aria-label={`${p.name || `argument ${i + 1}`} (${p.type})`}
          value={args[i]}
          spellCheck={false}
          onChange={(e) => setArgs((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <button className="btn btn-ghost" disabled={busy}>
        {busy ? '…' : 'Read'}
      </button>
      {out && <p className={`mono rd-out ${out.ok ? '' : 'rd-error'}`}>{out.text}</p>}
    </form>
  );
}
