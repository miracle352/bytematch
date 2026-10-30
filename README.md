# Bytematch

Source verification for contracts on Portaldot V3.

Portaldot V3 runs Solidity through pallet-revive and accepts plain EVM bytecode. Of the
126 contract code blobs on the V3 testnet when this project started, 125 were EVM
bytecode compiled with ordinary `solc`; one was PolkaVM. None of them can be checked
against source anywhere: the official explorers index the Substrate side and have no
contract verification, and there is no Etherscan for this chain.

So when a hackathon README says "deployed at 0x…", nobody can tell whether that code is
the code in the repo. Bytematch answers that, and writes the answer on chain where
other contracts can read it.

## What it does

- **Verifies deployed bytecode against Solidity source.** It compiles with the official
  solc builds and compares against `eth_getCode`, reporting an **exact** match (byte for
  byte, metadata included, so the source text is proven) or a **partial** match (same
  executable code; comments, file paths or metadata settings differ).
- **Finds the deploy transaction by itself.** Portaldot has no contract-creation lookup
  and the public indexers start partway through the chain, but the RPC keeps historical
  state. Bytematch searches `eth_getCode` over block heights (8 probes per round, ~3s
  for 250k blocks), then matches the creation input to recover constructor arguments.
- **Works from just the `.sol` file.** If you don't know your settings, it reads the
  compiler version and metadata type from the deployed bytecode and searches the
  settings people actually deploy with. Sources that can't match are rejected in about
  a second by checking function selectors against the deployed code.
- **Speaks the Etherscan API.** `forge verify-contract` and `hardhat verify` work
  against it without a plugin.
- **Attests on chain.** `SourceRegistry` records each result under the contract's
  runtime code hash, read from the live contract at attestation time. Any contract can
  call `check(target, attester)`, for example to accept only tokens with verified source.

## Results on the V3 testnet

Contracts from other Hacker House projects, verified from their public repositories
with the settings recorded in those repositories:

| Project | Contract | Address | Result |
|---|---|---|---|
| Plaque | PlaqueLite | `0x5432e6b89dc3042d47f2be98e971cad9dabab685` | exact (with its original source path), deploy input matched |
| Vestry | Vestry | `0x12d0691c7b756aa5205f24b678d68c74b885cda9` | exact |
| Vestry | Guestbook | `0xc3ee4b657fadae473b22c692544e35223bfe9b42` | exact |
| DotProof | Gateway | `0x619ca0f74bbe92cae32ca72920cba0ff0e5af370` | exact, 4 source files incl. OpenZeppelin |
| DotProof | BPOT | `0xf8191413d53b750ce2f0bfc44722c0ebf0bf95a1` | exact; created by another contract, so no deploy tx |
| DotProof | Backstop | `0xb57969ce443dbdf2f41e67408a77e5311b548187` | exact, constructor args recovered |
| DotProof | AgentRegistry | `0x95cced224908a20d7b4a7d684cbc9acd4b0e2177` | exact, 8 constructor args recovered |
| Allowance | Allowance | `0xdf8567f1fa9f6afbe1c8f99453544c35009ac07f` | partial: same code, metadata differs from the current repo |
| PortalSwap | PortalSwapFactory | `0xc631805c297c4233b33c30af91245058902c1d18` | exact |
| PortalSwap | PortalSwapRouter | `0xc17510df29ae5e4c6c2a46ccb03197edd0963f2b` | exact; constructor args are the factory and WPOT above/below |
| PortalSwap | WPOT | `0xf67ce92096e4e171060b71bf0cca0da9f9548c03` | exact |
| PortalSwap | MockERC20 (pUSDT and three other test tokens) | `0xe0114adc0a2072b602c645f5a07eefa1eadbdbc2` and 3 more | exact, name/symbol/decimals/supply decoded |
| PortalSwap | tPotFaucet, tPotStaking | `0x2a9dfcc2…`, `0xc3a38deb…` | exact |
| PortalSwap | PortalSwapPair | `0x521d8aafeee92e2fa31829faa009fe3698245b93` | exact; the other 9 pools share its code and show as same-code |
| DotProof | BackingMonitor, CircuitBreaker, LendingMarket | | **no match** with current source |

For PortalSwap no contract names were given: Bytematch compiled the whole project and
picked the matching contract for each address.

With these, 27 of the 154 contracts on the V3 testnet have verified source (18 verified
directly, 9 by sharing code with a verified contract). `GET /v1/network` gives the
live figure.

The DotProof "no match" row is the tool working as intended. DotProof's own `SECURITY.md` says those
contracts were deployed before later fixes and are immutable, so the repository no
longer describes the code on chain.

## How matching works

A plain string compare of compiled and deployed bytecode fails in four common cases,
each handled in [`src/bytecode.ts`](src/bytecode.ts):

1. **Metadata.** solc appends a CBOR blob with an IPFS hash of the metadata JSON, which
   covers source text, file paths and settings. If everything including that blob
   matches, it's exact. If only the blob differs (every one in the code, including
   those of child contracts created with `new`), it's partial.
2. **Immutables** are written into runtime code by the constructor. The deployed bytes
   at the compiler's `immutableReferences` are copied in and reported.
3. **Linked libraries** are filled in from the deployed code at `linkReferences` and
   reported.
4. **Libraries themselves** start with `PUSH20 <own address>`, set at deploy time.

Source keys matter for exact matches because they are hashed into the metadata.
[`src/collect.ts`](src/collect.ts) gathers a contract's imports using the same keys
Hardhat and Foundry use, without running any project code.

## API

```
POST /v1/verify
  { "address": "0x…",
    "standardJsonInput": { "language": "Solidity", "sources": {…}, "settings": {…} },
    "contract": "contracts/Vault.sol:Vault",      // optional
    "compilerVersion": "0.8.28" }                 // optional, read from bytecode
  or { "address": "0x…", "files": { "Vault.sol": "…" } }                    // settings searched
  or { "address": "0x…", "metadata": "<metadata.json>", "files": { … } }   // Remix / Hardhat

GET /v1/contracts/:address          status (verified | same-code | unverified), record, ABI, on-chain attestation
GET /v1/contracts/:address/abi
GET /v1/contracts/:address/files
GET /v1/contracts/:address/bundle   everything needed to reproduce the verification
GET /v1/contracts                   recently verified
GET /v1/network                     every contract on the chain with its status (?status=unverified etc.)
GET /v1/stats
GET /health
```

`same-code` means the address isn't verified itself, but its runtime code is identical
to a contract that is.

Errors come back as `{ "error": { "code", "message", "details" } }` with codes
`bad_input`, `not_contract`, `polkavm`, `compile_error`, `version_mismatch`, `no_match`.

Checked end to end with `@nomicfoundation/hardhat-verify` 2.x (submit, poll, "Successfully
verified"). Foundry's `--verifier etherscan` uses the same calls but hasn't been run
against it yet.

### Foundry

```sh
forge verify-contract <address> src/Vault.sol:Vault \
  --chain 420420777 \
  --verifier etherscan \
  --verifier-url https://<bytematch-host>/api \
  --etherscan-api-key unused
```

### Hardhat (`@nomicfoundation/hardhat-verify`)

```js
etherscan: {
  apiKey: { portaldot: 'unused' },
  customChains: [{
    network: 'portaldot',
    chainId: 420420777,
    urls: { apiURL: 'https://<bytematch-host>/api', browserURL: 'https://<bytematch-host>' },
  }],
},
```

then `npx hardhat verify --network portaldot <address> [constructor args]`.

## The bundle and the digest

Every verification produces a bundle: compiler version, contract name and the standard
JSON input (minus `outputSelection`, which never changes bytecode). Its digest is the
keccak256 of the bundle serialised with sorted keys, and that digest is what
`SourceRegistry` stores. Anyone can download the bundle, recompile it with stock solc,
and compare against any contract with the attested code hash. The service doesn't need
to be trusted or even online for that check.

## SourceRegistry

[`contracts/SourceRegistry.sol`](contracts/SourceRegistry.sol)

```solidity
function attest(address sample, bytes32 sourceDigest, Match level) external returns (bytes32 codeHash);
function revoke(bytes32 codeHash) external;
function check(address target, address attester) external view returns (Match level, bytes32 sourceDigest);
```

- Keyed by code hash, so one verification covers every deployment of the same code, and
  an attestation never applies to code it wasn't made for.
- The code hash is read from `sample` inside `attest`, so an attester can't vouch for a
  hash that doesn't exist on chain.
- Anyone can attest. Readers decide whose attestations they trust.

On Portaldot, `EXTCODEHASH` returns keccak256 of the deployed EVM code (checked against
the live chain), so `check` sees the same hash the off-chain verifier computes.

## The site

[`web/`](web) is the frontend: a Vite + React app with a scroll-driven story (GSAP,
Lenis) and the working pages: contract lookup at `/address/:address` (where Hardhat's
`browserURL` points), `/verify` and `/network`. It talks to the API on the same origin.

- The hero cards, the byte-by-byte section and the network punch card all use real
  data: PlaqueLite's deployed bytes and a rebuild under a different path (32 metadata
  bytes differ), and the live contract list from `/v1/network`, with a bundled
  snapshot as a fallback.
- Photograph: keypunch operator, 1950 US Census. U.S. Census Bureau, public domain.

```sh
npm start              # API on :8787
npm run dev:web        # site on :5173, proxying the API
```

## Deploy for free (Vercel + Upstash)

Everything runs on Vercel's free plan: the site is static and the API is one function
(`api/index.ts`). Results are stored in Upstash Redis, which also has a free plan.

1. On vercel.com, **Add New → Project** and import this repository. Leave the build
   settings alone; `vercel.json` sets them.
2. In the project, **Storage → Create → Upstash for Redis** (free) and connect it. This
   adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Add `REGISTRY_ADDRESS` to show on-chain status read-only; add `ATTESTER_KEY` (a funded testnet key) too to attest new results. Both go under
   **Settings → Environment Variables** so new results are attested on chain.
4. Redeploy, then copy existing verifications across:
   `npm run seed:remote -- https://<your-project>.vercel.app`

Verification compiles on the function, so the first request on a cold instance
downloads the solc build it needs (~8 MB) into `/tmp`.

## Running it

Node 22.13 or later.

```sh
npm install
npm test                 # unit tests, offline (bytecode matching, registry in a local EVM)
npm run test:live        # against the V3 testnet
npm start                # API on :8787
```

Environment (all optional):

| Variable | Default |
|---|---|
| `RPC_URL` | `https://test-evm-rpc-v3.portaldot.dev` |
| `CHAIN_ID` | `420420777` |
| `PORT` | `8787` |
| `DATA_DIR` | `./data` (SQLite database and cached solc builds) |
| `REGISTRY_ADDRESS`, `ATTESTER_KEY` | unset: results are stored but not attested on chain |

Deploy the registry with a funded testnet key: `ATTESTER_KEY=0x… npm run deploy:registry`.
It builds, deploys, verifies itself and writes `deployments/portaldot-testnet.json`.

## Limits

- EVM bytecode only. PolkaVM contracts (built with `resolc`) are detected and reported,
  not verified. On V3 today that's one contract in 126.
- Solidity only, no Vyper.
- Contracts created by other contracts or by native extrinsics are verified on runtime
  code; constructor arguments are then unknown.
- Settings search covers common settings (optimizer off/on with 1, 200, 1k, 10k and
  999,999 runs; viaIR on/off; the usual EVM versions). Anything else needs the standard
  JSON input.
- Compilation runs on the API process. Fine for a testnet; a busy deployment should
  move it to worker threads.

## License

MIT

## Deployment (Portaldot V3 testnet)

| | |
|---|---|
| SourceRegistry | `0x6aea3b20e67e8b5b660d0d8eb917c790e190a203` (block 244720), verified by Bytematch itself: exact |
| Attester | `0x8d375990766be8a0d1e1a93e6f9fa33ac2023ff3` |

The 18 verified contracts in the table above are attested in it; the 9 PortalSwap pools
that share the pair's code are covered by the pair's attestation without one of their
own. Details in [`deployments/portaldot-testnet.json`](deployments/portaldot-testnet.json).

Each attestation holds about 7.7 tPOT as a storage deposit (refunded if revoked), which
is the main running cost on this chain.
