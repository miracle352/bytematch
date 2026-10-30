import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, type Verification } from '../lib/api';
import { collect, contractsIn, pickProject, type PickedProject } from '../lib/collect';
import { isAddress } from '../lib/format';
import './page.css';
import './verify.css';

type Mode = 'files' | 'json' | 'metadata';

const EVM_VERSIONS = ['', 'prague', 'cancun', 'shanghai', 'paris', 'london', 'berlin', 'istanbul'];

/** Hardhat build-info files wrap the standard JSON input; plain standard JSON is accepted too. */
function readJsonInput(text: string): { input: any; version?: string } {
  const j = JSON.parse(text);
  if (j.input?.sources && j.solcVersion) return { input: j.input, version: j.solcVersion };
  if (j.sources && j.language) return { input: j };
  throw new Error('This isn’t a standard JSON input or a Hardhat build-info file.');
}

export function Verify() {
  const [params] = useSearchParams();
  const [address, setAddress] = useState(params.get('address') ?? '');
  const [mode, setMode] = useState<Mode>('files');

  const [project, setProject] = useState<PickedProject | null>(null);
  const [entry, setEntry] = useState('');
  const [contractNames, setContractNames] = useState<string[]>([]);
  const [contract, setContract] = useState('');

  const [knowSettings, setKnowSettings] = useState(false);
  const [version, setVersion] = useState('');
  const [optimizer, setOptimizer] = useState(true);
  const [runs, setRuns] = useState(200);
  const [viaIR, setViaIR] = useState(false);
  const [evm, setEvm] = useState('');

  const [jsonText, setJsonText] = useState('');
  const [jsonName, setJsonName] = useState('');
  const [metadataText, setMetadataText] = useState('');

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const started = useRef(0);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (!project || !entry) return;
    project.files.get(entry)?.text().then((src) => {
      const names = contractsIn(src);
      setContractNames(names);
      setContract(names.at(-1) ?? '');
    });
  }, [project, entry]);

  const onPick = async (list: FileList | null) => {
    if (!list?.length) return;
    const p = await pickProject(list);
    setProject(p);
    setEntry(p.own[0] ?? '');
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!isAddress(address)) return setError({ message: 'Enter the contract’s address: 0x followed by 40 hex characters.' });

    let body: Record<string, unknown>;
    try {
      if (mode === 'json') {
        if (!jsonText) return setError({ message: 'Choose a standard JSON input or a Hardhat build-info file.' });
        const { input, version: v } = readJsonInput(jsonText);
        body = { address, standardJsonInput: input, compilerVersion: v || version || undefined, contract: contract || undefined };
      } else {
        if (!project || !entry) return setError({ message: 'Choose your project folder or the .sol files first.' });
        const sources = await collect(project, entry);
        const target = contract ? `${entry}:${contract}` : undefined;
        if (mode === 'metadata') {
          if (!metadataText) return setError({ message: 'Choose the metadata.json for this contract.' });
          body = { address, metadata: metadataText, files: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, s.content])) };
        } else if (knowSettings) {
          body = {
            address,
            contract: target,
            compilerVersion: version || undefined,
            standardJsonInput: {
              language: 'Solidity',
              sources,
              settings: { optimizer: { enabled: optimizer, runs }, viaIR, ...(evm ? { evmVersion: evm } : {}) },
            },
          };
        } else {
          body = {
            address,
            contract: target,
            compilerVersion: version || undefined,
            files: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, s.content])),
          };
        }
      }
    } catch (err) {
      return setError({ message: (err as Error).message });
    }

    setBusy(true);
    setElapsed(0);
    started.current = Date.now();
    try {
      setResult(await api.verify(body));
    } catch (err) {
      const a = err as ApiError;
      setError({ message: a.message, details: Array.isArray(a.details) ? (a.details as string[]) : undefined });
    } finally {
      setBusy(false);
    }
  };

  const fileCount = project ? [...project.files.keys()].filter((p) => p.endsWith('.sol')).length : 0;

  return (
    <div className="page wrap vf">
      <div className="vf-intro">
        <h1 className="page-title">Verify a contract</h1>
        <p className="lede">
          Bytematch compiles your source and compares it with the code at the address. It takes a few seconds, or up to a
          minute when it has to work out your compiler settings.
        </p>
      </div>

      <form className="vf-form" onSubmit={submit}>
        <label className="vf-field">
          <span>Contract address</span>
          <input
            className="mono"
            value={address}
            onChange={(e) => setAddress(e.target.value.trim())}
            placeholder="0x…"
            spellCheck={false}
            required
          />
        </label>

        <fieldset className="vf-modes">
          <legend>What do you have?</legend>
          {(
            [
              ['files', 'Project folder or .sol files'],
              ['json', 'Hardhat build-info or standard JSON'],
              ['metadata', 'metadata.json from Remix'],
            ] as const
          ).map(([m, label]) => (
            <label key={m} className={mode === m ? 'is-on' : ''}>
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
              {label}
            </label>
          ))}
        </fieldset>

        {(mode === 'files' || mode === 'metadata') && (
          <div className="vf-block">
            <div className="vf-pick">
              <label className="btn btn-ghost">
                Choose project folder
                <input
                  type="file"
                  className="visually-hidden"
                  // @ts-expect-error non-standard but supported by every current browser
                  webkitdirectory=""
                  onChange={(e) => onPick(e.target.files)}
                />
              </label>
              <label className="btn btn-ghost">
                Choose .sol files
                <input type="file" className="visually-hidden" accept=".sol" multiple onChange={(e) => onPick(e.target.files)} />
              </label>
              <span className="vf-hint">
                {project
                  ? `${fileCount} Solidity files picked${project.foundry ? ', Foundry project' : ''}.`
                  : 'Pick the whole project so imports like OpenZeppelin can be found. Only the files your contract imports are sent.'}
              </span>
            </div>

            {project && (
              <div className="vf-row">
                <label className="vf-field">
                  <span>Contract file</span>
                  <select value={entry} onChange={(e) => setEntry(e.target.value)}>
                    {(project.own.length ? project.own : [...project.files.keys()].filter((p) => p.endsWith('.sol'))).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="vf-field">
                  <span>Contract</span>
                  <select value={contract} onChange={(e) => setContract(e.target.value)}>
                    {contractNames.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {mode === 'metadata' && (
              <label className="vf-field">
                <span>metadata.json</span>
                <input type="file" accept=".json" onChange={async (e) => setMetadataText((await e.target.files?.[0]?.text()) ?? '')} />
              </label>
            )}

            {mode === 'files' && (
              <div className="vf-settings">
                <label className="vf-check">
                  <input type="checkbox" checked={knowSettings} onChange={(e) => setKnowSettings(e.target.checked)} />
                  I know the compiler settings I deployed with
                </label>
                {!knowSettings && (
                  <p className="vf-hint">
                    Leave this off and Bytematch reads the compiler version from the deployed bytes and tries the common
                    settings.
                  </p>
                )}
                {knowSettings && (
                  <div className="vf-row vf-row-4">
                    <label className="vf-field">
                      <span>Compiler</span>
                      <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Read from bytecode" />
                    </label>
                    <label className="vf-field">
                      <span>Optimizer runs</span>
                      <input
                        type="number"
                        min={0}
                        value={optimizer ? runs : ''}
                        disabled={!optimizer}
                        onChange={(e) => setRuns(Number(e.target.value))}
                        placeholder="Off"
                      />
                    </label>
                    <label className="vf-field">
                      <span>EVM version</span>
                      <select value={evm} onChange={(e) => setEvm(e.target.value)}>
                        {EVM_VERSIONS.map((v) => (
                          <option key={v} value={v}>
                            {v || 'Compiler default'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="vf-checks">
                      <label className="vf-check">
                        <input type="checkbox" checked={optimizer} onChange={(e) => setOptimizer(e.target.checked)} />
                        Optimizer
                      </label>
                      <label className="vf-check">
                        <input type="checkbox" checked={viaIR} onChange={(e) => setViaIR(e.target.checked)} />
                        Via IR
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'json' && (
          <div className="vf-block">
            <div className="vf-pick">
              <label className="btn btn-ghost">
                Choose JSON file
                <input
                  type="file"
                  accept=".json"
                  className="visually-hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setJsonName(f.name);
                    setJsonText(await f.text());
                  }}
                />
              </label>
              <span className="vf-hint">
                {jsonName ||
                  'Hardhat writes these to artifacts/build-info/. They reproduce your build exactly, so they give exact matches.'}
              </span>
            </div>
            <label className="vf-field">
              <span>Contract (optional)</span>
              <input value={contract} onChange={(e) => setContract(e.target.value)} placeholder="contracts/Token.sol:Token" />
            </label>
          </div>
        )}

        <div className="vf-submit">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify contract'}
          </button>
          {busy && (
            <span className="vf-busy mono" role="status">
              Compiling and comparing, {elapsed}s
            </span>
          )}
        </div>
      </form>

      <div className="vf-out" aria-live="polite">
        {error && (
          <div className="vf-error">
            <p className="state state-mismatch">Not verified</p>
            <p>{error.message}</p>
            {error.details && <pre className="mono">{error.details.join('\n\n')}</pre>}
          </div>
        )}
        {result && (
          <div className={`vf-result vf-result-${result.match}`}>
            <p className={`state state-${result.match}`}>{result.match === 'exact' ? 'Exact match' : 'Partial match'}</p>
            <h2 className="h3">{result.contract.name}</h2>
            <p>
              {result.match === 'exact'
                ? 'Every byte of the deployed code, metadata included, comes from this source.'
                : 'The deployed program comes from this source. The metadata differs, so comments, formatting or file paths changed since deployment.'}
            </p>
            <Link className="btn btn-primary" to={`/address/${result.address}`}>
              Open the contract page
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
