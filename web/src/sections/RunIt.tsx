import { CodeTabs } from '../components/CodeTabs';
import { REGISTRY_ADDRESS } from '../lib/api';
import { plaque } from '../data/plaque';
import './runit.css';

const ATTESTER = '0x8d375990766be8a0d1e1a93e6f9fa33ac2023ff3';

export function RunIt() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://bytematch-portaldot.vercel.app';
  const tabs = [
    {
      label: 'Agents',
      code: `# Claude Code, or any MCP client
claude mcp add --transport http bytematch ${origin}/mcp

# check_contract · verify_repository · verify_source
# read_contract · network_coverage

# Everything else, in one page
curl ${origin}/llms.txt`,
    },
    {
      label: 'Foundry',
      code: `forge verify-contract 0xYourContract src/Token.sol:Token \\
  --chain 420420777 \\
  --verifier custom \\
  --verifier-url ${origin}/api \\
  --verifier-api-key unused \\
  --watch`,
    },
    {
      label: 'Hardhat',
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
      label: 'Solidity',
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
      label: 'README',
      code: `[![source](${origin}/badge/0xYourContract.svg)](${origin}/address/0xYourContract)`,
    },
    {
      label: 'HTTP',
      code: `curl ${origin}/v1/contracts/${plaque.address}

curl -X POST ${origin}/v1/repos \\
  -d '{"url": "https://github.com/owner/repo"}'`,
    },
  ];

  return (
    <section className="ri" id="tools">
      <div className="wrap ri-grid">
        <h2 className="h2 ri-copy">For people, their tools, and their agents.</h2>
        <CodeTabs tabs={tabs} />
      </div>
    </section>
  );
}
