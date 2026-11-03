import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAddress, repoOf } from '../lib/format';
import './search.css';

/** One field for everything: a contract address or a GitHub repository. */
const EXAMPLES = ['github.com/Junedkhan121/portalswap', '0x5432e6b89dc3042d47f2be98e971cad9dabab685', 'github.com/Rohitamalraj/DotProof'];

/** Types example inputs into the placeholder while the field is empty and idle. */
function useTypedPlaceholder(active: boolean) {
  const [text, setText] = useState('0x… or github.com/owner/repo');
  useEffect(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let n = 0, i = 0, back = false, t = 0;
    const step = () => {
      const ex = EXAMPLES[n % EXAMPLES.length]!;
      if (!back) {
        i++;
        setText(ex.slice(0, i));
        if (i >= ex.length) (back = true), (t = window.setTimeout(step, 1600));
        else t = window.setTimeout(step, 38 + Math.random() * 40);
      } else {
        i -= 3;
        setText(ex.slice(0, Math.max(0, i)) || ' ');
        if (i <= 0) (back = false), (i = 0), n++, (t = window.setTimeout(step, 400));
        else t = window.setTimeout(step, 14);
      }
    };
    t = window.setTimeout(step, 1400);
    return () => clearTimeout(t);
  }, [active]);
  return text;
}

export function Omnibox({ autoFocus = false, typing = false }: { autoFocus?: boolean; typing?: boolean }) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const placeholder = useTypedPlaceholder(typing && !focused && !value);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (isAddress(v)) return navigate(`/address/${v.toLowerCase()}`);
    const repo = repoOf(v);
    if (repo) return navigate(`/repo/${repo}`);
    setError('That is neither a 0x address nor a GitHub repository.');
  };

  return (
    <form className="search" onSubmit={submit} role="search">
      <label htmlFor="omnibox" className="visually-hidden">
        Contract address or GitHub repository
      </label>
      <input
        id="omnibox"
        className="mono"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
        }}
        placeholder={typing ? placeholder : '0x… or github.com/owner/repo'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoFocus={autoFocus}
        aria-invalid={!!error}
        aria-describedby={error ? 'omnibox-error' : undefined}
      />
      <button className="btn btn-primary" type="submit">
        Check
      </button>
      {error && (
        <p id="omnibox-error" className="search-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
