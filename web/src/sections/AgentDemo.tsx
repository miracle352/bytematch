import { useEffect, useRef, useState } from 'react';
import { api, type ContractLookup } from '../lib/api';
import { reducedMotion, short } from '../lib/format';
import './agentdemo.css';
import { refreshSoon } from '../lib/motion';

const PLAQUE = '0x5432e6b89dc3042d47f2be98e971cad9dabab685';
const ASK = `Before I integrate it: is ${short(PLAQUE, 6, 4)} on Portaldot running the code its repo says?`;

/** An agent asking Bytematch over MCP, with the real answer from the API. */
export function AgentDemo() {
  const root = useRef<HTMLElement>(null);
  const [data, setData] = useState<ContractLookup | null>(null);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState(0); // 0 typing, 1 tool call, 2 result, 3 answer
  const [lines, setLines] = useState(0);

  useEffect(() => {
    api.contract(PLAQUE).then(setData, () => {});
  }, []);

  useEffect(() => refreshSoon(), [data]);

  const v = data?.verification;
  const json = v
    ? [
        `"status": "${data!.status}",`,
        `"match": "${v.match}",`,
        `"contract": "${v.contract.path}:${v.contract.name}",`,
        `"compiler": "solc ${v.compiler.version.split('+')[0]}",`,
        `"onChain": { "level": "${data!.onChain?.level ?? 'none'}" }`,
      ]
    : [];

  useEffect(() => {
    if (!v) return;
    if (reducedMotion()) {
      setTyped(ASK.length), setPhase(3), setLines(json.length);
      return;
    }
    const timers: number[] = [];
    const at = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
    let started = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting || started) return;
        started = true;
        let t = 300;
        for (let i = 1; i <= ASK.length; i++) at((t += 22), () => setTyped(i));
        at((t += 500), () => setPhase(1));
        at((t += 1100), () => setPhase(2));
        json.forEach((_, i) => at((t += 160), () => setLines(i + 1)));
        at((t += 600), () => setPhase(3));
      },
      { threshold: 0.5 },
    );
    io.observe(root.current!.querySelector('.ag-chat')!);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  return (
    <section className="ag" ref={root} id="agents">
      <div className="wrap ag-grid">
        <div className="ag-copy">
          <h2 className="h2">Agents check before they trust.</h2>
          <pre className="mono ag-cmd">claude mcp add --transport http bytematch {location.origin}/mcp</pre>
        </div>
        <div className="ag-chat">
          <div className="ag-msg ag-user">
            {ASK.slice(0, typed)}
            {phase === 0 && <b className="ag-caret" />}
          </div>
          <div className={`ag-tool ${phase >= 1 ? 'is-on' : ''} ${phase === 1 ? 'is-running' : ''}`}>
            <span className="mono">bytematch · check_contract</span>
            <span className="mono ag-arg">{`{ "address": "${short(PLAQUE, 8, 6)}" }`}</span>
            <pre className="mono ag-json">
              {phase >= 2 && '{\n'}
              {json.slice(0, lines).map((l) => `  ${l}\n`)}
              {phase >= 3 && '}'}
            </pre>
          </div>
          <div className={`ag-msg ag-bot ${phase >= 3 ? 'is-on' : ''}`}>
            Yes. Every byte at that address matches <span className="mono">{v?.contract.name}</span> rebuilt from source
            {data?.onChain?.level === 'exact' ? ', and the match is recorded on chain' : ''}.
          </div>
        </div>
      </div>
    </section>
  );
}
