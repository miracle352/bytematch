import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAddress } from '../lib/format';
import './search.css';

export function AddressSearch({ autoFocus = false, tone = 'light' }: { autoFocus?: boolean; tone?: 'light' | 'dark' }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!isAddress(v)) {
      setError('Enter a contract address: 0x followed by 40 hex characters.');
      return;
    }
    navigate(`/address/${v.toLowerCase()}`);
  };

  return (
    <form className={`search search-${tone}`} onSubmit={submit} role="search">
      <label htmlFor="address-search" className="visually-hidden">
        Contract address
      </label>
      <input
        id="address-search"
        className="mono"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
        }}
        placeholder="0x… contract address on Portaldot V3"
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        aria-invalid={!!error}
        aria-describedby={error ? 'address-search-error' : undefined}
      />
      <button className="btn btn-primary" type="submit">
        Check address
      </button>
      {error && (
        <p id="address-search-error" className="search-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
