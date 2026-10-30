import { useMemo, type ReactNode } from 'react';

// Enough highlighting to read Solidity comfortably: comments, strings, keywords, types, numbers.
const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\b(pragma|import|contract|interface|library|abstract|function|modifier|event|error|struct|enum|mapping|returns?|if|else|for|while|do|break|continue|emit|revert|require|assembly|external|public|internal|private|view|pure|payable|virtual|override|constant|immutable|memory|storage|calldata|constructor|fallback|receive|is|using|new|delete|unchecked|try|catch|indexed)\b|\b(address|bool|string|bytes\d*|u?int\d*)\b|\b(0x[0-9a-fA-F]+|\d[\d_]*(?:\.\d+)?)\b/g;

function highlight(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index! > last) out.push(src.slice(last, m.index));
    const cls = m[1] ? 'sv-c' : m[2] ? 'sv-s' : m[3] ? 'sv-k' : m[4] ? 'sv-t' : 'sv-n';
    out.push(
      <span key={k++} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  out.push(src.slice(last));
  return out;
}

export function SolidityView({ source }: { source: string }) {
  const lines = useMemo(() => {
    // Highlight per line so line numbers stay aligned; multi-line comments are split first.
    const html = highlight(source);
    const rows: ReactNode[][] = [[]];
    for (const node of html) {
      if (typeof node === 'string') {
        const parts = node.split('\n');
        parts.forEach((p, i) => {
          if (i > 0) rows.push([]);
          if (p) rows.at(-1)!.push(p);
        });
      } else {
        const el = node as { props: { className: string; children: string }; key: string };
        const parts = el.props.children.split('\n');
        parts.forEach((p, i) => {
          if (i > 0) rows.push([]);
          rows.at(-1)!.push(
            <span key={`${el.key}-${i}`} className={el.props.className}>
              {p}
            </span>,
          );
        });
      }
    }
    return rows;
  }, [source]);

  return (
    <div className="sv mono" role="region" aria-label="Source code" tabIndex={0}>
      {lines.map((l, i) => (
        <div key={i} className="sv-row">
          <span className="sv-ln" aria-hidden="true">
            {i + 1}
          </span>
          <span className="sv-code">{l.length ? l : ' '}</span>
        </div>
      ))}
    </div>
  );
}
