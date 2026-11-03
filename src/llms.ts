// /llms.txt: the whole service in one plain-text page, for agents and for people.

export function llmsTxt(origin: string): string {
  return `# Bytematch

> Source verification for smart contracts on Portaldot V3 (chain 420420777). Bytematch
> recompiles Solidity with the original compiler and compares it with the bytecode
> deployed at an address. "exact" means byte for byte, metadata included; "partial"
> means the same executable code with different metadata (comments, file paths).
> Results are attested on chain in SourceRegistry.

All endpoints are JSON over HTTPS at ${origin}. No key or account.

## MCP

- Endpoint: ${origin}/mcp (streamable HTTP, JSON responses)
- Add to Claude Code: claude mcp add --transport http bytematch ${origin}/mcp
- Tools: check_contract, verify_repository, verify_source, read_contract, network_coverage

## Check a contract

- GET ${origin}/v1/contracts/{address}
  status: verified | same-code | unverified | not-a-contract; verification (match,
  contract, compiler, deployment, constructor arguments); abi; onChain; proxy
- GET ${origin}/v1/contracts/{address}/files   source files
- GET ${origin}/v1/contracts/{address}/bundle  everything needed to reproduce the match
- GET ${origin}/v1/contracts/{address}/state   every public value, read live
- POST ${origin}/v1/contracts/{address}/call   {"function": "balanceOf", "args": ["0x…"]}
- GET ${origin}/badge/{address}.svg            README badge

## Verify

- POST ${origin}/v1/repos {"url": "https://github.com/owner/repo"}
  Finds the repository's deployed contracts and verifies each against its source.
- POST ${origin}/v1/verify
  {"address", "standardJsonInput"} or {"address", "files"} (settings are searched)
  or {"address", "metadata", "files"} (Remix / Hardhat metadata.json)
- Etherscan-compatible: ${origin}/api, so hardhat-verify and forge verify-contract work.
  Hardhat: etherscan.customChains [{ network: "portaldot", chainId: 420420777,
  urls: { apiURL: "${origin}/api", browserURL: "${origin}" } }]
  Foundry: forge verify-contract <address> <path>:<Name> --chain 420420777
  --verifier custom --verifier-url ${origin}/api --verifier-api-key unused --watch

## Network

- GET ${origin}/v1/network   every contract on the chain and whether its source is known
- GET ${origin}/v1/repos     every repository checked so far

## On chain

SourceRegistry ${'0x6aea3b20e67e8b5b660d0d8eb917c790e190a203'} on Portaldot V3:
check(address target, address attester) returns (uint8 level, bytes32 sourceDigest),
level 2 = exact, 1 = partial, 0 = none. Attester: 0x8d375990766be8a0d1e1a93e6f9fa33ac2023ff3.

SourceRoots 0x0f9691a6aae5d9b5ed7190551049ced18b8ed086 holds one Merkle root over every
verification, published with the full entry list in its RootPublished event:
check(address target, address attester, uint8 level, bytes32 sourceDigest, bytes32[] proof)
returns (uint8). GET ${origin}/v1/contracts/{address} returns onChain.proof for it.
`;
}
