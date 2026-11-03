import { useId, useState } from 'react';
import { Copy } from './Copy';
import './codetabs.css';

export interface CodeTab {
  label: string;
  note?: string;
  code: string;
}

export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const [i, setI] = useState(0);
  const id = useId();
  const t = tabs[i]!;
  return (
    <div className="ct">
      <div className="ct-tabs" role="tablist">
        {tabs.map((tab, n) => (
          <button
            key={tab.label}
            role="tab"
            id={`${id}-t${n}`}
            aria-selected={n === i}
            aria-controls={`${id}-p`}
            className={n === i ? 'is-on' : ''}
            onClick={() => setI(n)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ct-panel" role="tabpanel" id={`${id}-p`} aria-labelledby={`${id}-t${i}`}>
        {t.note && <p className="ct-note">{t.note}</p>}
        <div className="ct-code">
          <pre className="mono">{t.code}</pre>
          <Copy value={t.code} />
        </div>
      </div>
    </div>
  );
}
