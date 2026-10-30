import { Link } from 'react-router-dom';
import { CodeTabs } from '../components/CodeTabs';
import { REGISTRY_ADDRESS } from '../lib/api';
import { plaque } from '../data/plaque';
import './runit.css';

const ATTESTER = '0x8d375990766be8a0d1e1a93e6f9fa33ac2023ff3';

export function RunIt() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://bytematch.example';
  const tabs = [
    {
      label: 'Hardhat',
      note: 'hardhat-verify talks to Bytematch the way it talks to Etherscan. Add the chain once, then verify as usual.',
      code: `// hardhat.config.js
etherscan: {
  apiKey: { portaldot: 'unused' },
  customChains: [{
    network: 'portaldot',
    chainId: 420420777,
    urls: { apiURL: '${origin}/api', browserURL: '${origin}' },
  }],
},
sourcify: { enabled: false },

// then
npx hardhat verify --network portaldot 0xYourContract`,
    },
    {
      label: 'Foundry',
      note: 'forge uses the same Etherscan-style calls.',
      code: `forge verify-contract 0xYourContract src/Token.sol:Token \\
  --chain 420420777 \\
  --verifier etherscan \\
  --verifier-url ${origin}/api \\
  --etherscan-api-key unused`,
    },
    {
      label: 'In a contract',
      note: 'SourceRegistry is on chain, so a contract can refuse code nobody has matched to source, such as an unknown token.',
      code: `interface ISourceRegistry {
    // 2 = exact, 1 = partial, 0 = not verified
    function check(address target, address attester)
        external view returns (uint8 level, bytes32 sourceDigest);
}

ISourceRegistry constant REGISTRY = ISourceRegistry(${REGISTRY_ADDRESS});
address constant BYTEMATCH = ${ATTESTER};

(uint8 level, ) = REGISTRY.check(token, BYTEMATCH);
require(level == 2, "token source not verified");`,
    },
    {
      label: 'HTTP',
      note: 'Every result is plain JSON, including the bundle you need to reproduce it with stock solc.',
      code: `curl ${origin}/v1/contracts/${plaque.address}

curl ${origin}/v1/contracts/${plaque.address}/bundle`,
    },
  ];

  return (
    <section className="ri">
      <div className="wrap ri-grid">
        <div className="ri-copy">
          <h2 className="h2">Use it from the tools you already have.</h2>
          <p className="lede">
            Nothing new to install and no account. Point the tools you deploy with at Bytematch, or read the registry from Solidity.
          </p>
          <Link to="/verify" className="btn btn-primary">
            Verify a contract
          </Link>
        </div>
        <CodeTabs tabs={tabs} />
      </div>
    </section>
  );
}
