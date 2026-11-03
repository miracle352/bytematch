import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAddress, repoOf } from '../lib/format';
import './search.css';

/** One field for everything: a contract address or a GitHub repository. */
export function Omnibox({ autoFocus = false }: { autoFocus?: boolean }) {
  const [value, setValue] = useState('');
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
        placeholder="0x… or github.com/owner/repo"
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
