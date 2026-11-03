import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type AbiItem, type ContractLookup } from '../lib/api';
import { isAddress, short } from '../lib/format';
import { Copy } from '../components/Copy';
import { Fingerprint } from '../components/Fingerprint';
import { SolidityView } from '../components/SolidityView';
import { ReadPanel } from '../components/ReadPanel';
import './page.css';
import './address.css';

const LEVEL_TEXT = { exact: 'Exact match', partial: 'Partial match' } as const;
const PROXY_KIND = { eip1967: 'Proxy', beacon: 'Beacon proxy', eip1167: 'Clone' } as const;

function signature(f: AbiItem) {
  return `${f.name ?? f.type}(${(f.inputs ?? []).map((i) => `${i.type}${i.name ? ' ' + i.name : ''}`).join(', ')})`;
}

export function AddressPage() {
  const { address = '' } = useParams();
  const [data, setData] = useState<ContractLookup | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<'source' | 'read' | 'abi'>('source');
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [file, setFile] = useState<string>('');

  useEffect(() => {
    setData(null);
    setError(null);
    setFiles(null);
    if (!isAddress(address)) {
      setError(new ApiError('bad_input', `${address} isn’t a contract address. Addresses are 0x followed by 40 hex characters.`));
      return;
    }
    api.contract(address).then(setData, setError);
  }, [address]);

  const v = data?.verification;
  useEffect(() => {
    if (!v) return;
    api.files(address).then((f) => {
      setFiles(f);
      const main = Object.keys(f).find((p) => p === v.contract.path) ?? Object.keys(f)[0] ?? '';
      setFile(main);
    }, () => setFiles({}));
  }, [v, address]);

  if (error) {
    return (
      <div className="page wrap">
        <h1 className="page-title">Can’t show this address</h1>
        <p className="lede">{error.message}</p>
        <Link className="btn btn-primary" to="/">
          Check another address
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page wrap" aria-busy="true">
        <p className="mono ad-loading">Reading {short(address, 10, 8)} from the chain…</p>
      </div>
    );
  }

  const verified = data.status === 'verified' || data.status === 'same-code';
  const level = v?.match;
  const stateClass = verified ? `state-${level}` : 'state-unverified';

  return (
    <div className="page wrap ad">
      <header className="ad-head">
        <div className="ad-id">
          <p className={`state ${stateClass} ad-state`}>
            {data.status === 'not-a-contract'
              ? 'No contract here'
              : verified
                ? LEVEL_TEXT[level!]
                : 'Not verified'}
          </p>
          <h1 className="page-title">{v ? v.contract.name : data.status === 'not-a-contract' ? 'Empty address' : 'Unknown contract'}</h1>
          <p className="ad-addr">
            <span className="mono">{data.address}</span> <Copy value={data.address} />
          </p>
          {data.status === 'same-code' && v && (
            <p className="ad-twin">
              Not verified at this address itself, but its code is identical to{' '}
              <Link to={`/address/${v.address}`} className="mono">
                {short(v.address)}
              </Link>
              , which is. Same bytes, same source.
            </p>
          )}
          {data.proxy && (
            <p className="ad-proxy">
              <span className="ad-proxy-kind">{PROXY_KIND[data.proxy.kind]}</span> for{' '}
              <Link to={`/address/${data.proxy.implementation}`}>
                {data.proxy.name ?? <span className="mono">{short(data.proxy.implementation)}</span>}
              </Link>
              {data.proxy.status === 'verified' || data.proxy.status === 'same-code' ? '' : ', not verified'}
            </p>
          )}
        </div>
        {data.codeHash && (
          <div className="ad-fp">
            <Fingerprint codeHash={data.codeHash} />
            <span className="mono">{short(data.codeHash, 12, 8)}</span>
          </div>
        )}
      </header>

      {data.status === 'not-a-contract' && (
        <section className="ad-empty">
          <p>No code at this address on Portaldot V3.</p>
        </section>
      )}

      {data.status === 'unverified' && data.proxy?.abi && (
        <section className="ad-section">
          <h2 className="h3 ad-subhead">Read through {data.proxy.name}</h2>
          <ReadPanel address={data.address} abi={data.proxy.abi} via={data.proxy.implementation} />
        </section>
      )}

      {data.status === 'unverified' && (
        <section className="ad-empty">
          <p>
            Nobody has matched this code to source yet.
          </p>
          <Link className="btn btn-primary" to={`/verify?address=${data.address}`}>
            Verify this contract
          </Link>
        </section>
      )}

      {v && (
        <>
          <dl className="ad-facts">
            <div>
              <dt>Compiler</dt>
              <dd className="mono">solc {v.compiler.version}</dd>
            </div>
            <div>
              <dt>Optimizer</dt>
              <dd>{v.compiler.optimizer?.enabled ? `On, ${v.compiler.optimizer.runs} runs` : 'Off'}{v.compiler.viaIR ? ', via IR' : ''}</dd>
            </div>
            <div>
              <dt>EVM version</dt>
              <dd>{v.compiler.evmVersion ?? 'Compiler default'}</dd>
            </div>
            <div>
              <dt>Source file</dt>
              <dd className="mono">{v.contract.path}</dd>
            </div>
            <div>
              <dt>Deployed</dt>
              <dd>
                {v.deployment.block ? (
                  <>
                    Block {v.deployment.block.toLocaleString('en-US')}
                    {v.deployment.deployer && (
                      <>
                        {' '}by <span className="mono">{short(v.deployment.deployer)}</span>
                      </>
                    )}
                  </>
                ) : (
                  'Unknown'
                )}
              </dd>
            </div>
            <div>
              <dt>Deploy transaction</dt>
              <dd>
                {v.deployment.tx ? (
                  <>
                    <span className="mono">{short(v.deployment.tx, 10, 6)}</span> <Copy value={v.deployment.tx} />
                  </>
                ) : (
                  'Created by another contract'
                )}
              </dd>
            </div>
            <div>
              <dt>Recorded on chain</dt>
              <dd>
                {data.onChain && data.onChain.level !== 'none' ? (
                  data.onChain.via === 'roots' ? (
                    <>
                      Yes, in SourceRoots root <span className="mono">{short(data.onChain.root ?? '', 8, 6)}</span>
                      {data.onChain.block ? `, block ${data.onChain.block.toLocaleString('en-US')}` : ''}. Proof{' '}
                      <Copy value={JSON.stringify({ level: data.onChain.level === 'exact' ? 2 : 1, sourceDigest: data.onChain.sourceDigest, proof: data.onChain.proof })} />
                    </>
                  ) : (
                    `Yes, ${data.onChain.level} match in SourceRegistry`
                  )
                ) : v.attestationTx ? (
                  'Yes'
                ) : (
                  'Not yet'
                )}
              </dd>
            </div>
            <div>
              <dt>README badge</dt>
              <dd>
                <img className="ad-badge" src={`/badge/${data.address}.svg`} alt={`${v.match} match`} />{' '}
                <Copy value={`[![source](${location.origin}/badge/${data.address}.svg)](${location.origin}/address/${data.address})`} />
              </dd>
            </div>
            <div>
              <dt>Bundle</dt>
              <dd>
                <a href={`/v1/contracts/${data.address}/bundle`} download>
                  Download to reproduce
                </a>
              </dd>
            </div>
          </dl>

          {v.match === 'partial' && (
            <p className="ad-partial">
              The program matches. The metadata hash does not: comments, formatting or file paths changed since deployment.
            </p>
          )}

          {v.deployment.constructorArgsDecoded && v.deployment.constructorArgsDecoded.length > 0 && (
            <section className="ad-section">
              <h2 className="h3">Constructor arguments</h2>
              <table className="ad-table">
                <tbody>
                  {v.deployment.constructorArgsDecoded.map((a) => (
                    <tr key={a.name}>
                      <th>{a.name || '(unnamed)'}</th>
                      <td className="mono ad-type">{a.type}</td>
                      <td className="mono">{String(a.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="ad-section" id="code">
            <div className="ad-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'source'} onClick={() => setTab('source')}>
                Source {files ? `(${Object.keys(files).length} files)` : ''}
              </button>
              <button role="tab" aria-selected={tab === 'read'} onClick={() => setTab('read')}>
                Read
              </button>
              <button role="tab" aria-selected={tab === 'abi'} onClick={() => setTab('abi')}>
                Functions
              </button>
            </div>

            {tab === 'source' &&
              (files === null ? (
                <p className="mono ad-loading">Loading source…</p>
              ) : (
                <div className="ad-source">
                  <ul className="ad-files">
                    {Object.keys(files).map((p) => (
                      <li key={p}>
                        <button className={p === file ? 'is-on' : ''} onClick={() => setFile(p)}>
                          {p}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {file && files[file] !== undefined && <SolidityView source={files[file]!} />}
                </div>
              ))}

            {tab === 'read' && <ReadPanel address={data.address} abi={data.abi ?? []} />}

            {tab === 'abi' && (
              <ul className="ad-abi">
                {(data.abi ?? [])
                  .filter((f) => f.type === 'function' || f.type === 'event' || f.type === 'error' || f.type === 'fallback' || f.type === 'receive')
                  .map((f, i) => (
                    <li key={i}>
                      <span className={`ad-kind ad-kind-${f.stateMutability ?? f.type}`}>
                        {f.type === 'function' ? f.stateMutability : f.type}
                      </span>
                      <span className="mono">{signature(f)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
