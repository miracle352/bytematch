// Contracts shown in the hero. Status comes from Bytematch runs against their public repos.
export type ShowcaseState = 'exact' | 'partial' | 'mismatch';
export const showcase: Array<{ name: string; project: string; address: string; state: ShowcaseState; codeHash: string; size: number }> = [
  {
    "name": "PortalSwapRouter",
    "project": "PortalSwap DEX",
    "address": "0xc17510df29ae5e4c6c2a46ccb03197edd0963f2b",
    "state": "exact",
    "codeHash": "0xccd4be2a199b09470be94f1e7abb6fa538ff63ac12ba32279d51a2b7d64c26d6",
    "size": 20342
  },
  {
    "name": "Vestry",
    "project": "Vestry milestone grants",
    "address": "0x12d0691c7b756aa5205f24b678d68c74b885cda9",
    "state": "exact",
    "codeHash": "0xdf8a5256e789a7aa9ca7863cf435a279e7404a2bcf63e493c6ddfba83fc46dcc",
    "size": 5253
  },
  {
    "name": "Allowance",
    "project": "Allowance agent wallets",
    "address": "0xdf8567f1fa9f6afbe1c8f99453544c35009ac07f",
    "state": "partial",
    "codeHash": "0x56ffa90f52558eef0d1c4fbad4f301987a8f10e23f1531c1b0fb1fb44767decd",
    "size": 9757
  },
  {
    "name": "LendingMarket",
    "project": "DotProof lending",
    "address": "0x7e3444c1f9dbd53dea5ebc8160522b154857566b",
    "state": "mismatch",
    "codeHash": "0xad8dda315235287e2e210f3d5cdc417f8e20f5d3b9e71aebc819650e438bcbc1",
    "size": 7993
  },
  {
    "name": "WPOT",
    "project": "PortalSwap wrapped POT",
    "address": "0xf67ce92096e4e171060b71bf0cca0da9f9548c03",
    "state": "exact",
    "codeHash": "0x074576b159c6c5001702552b8eec1745e058675a28a94fdef0de034772651b7e",
    "size": 2188
  },
  {
    "name": "Portal USDT",
    "project": "PortalSwap test token",
    "address": "0xe0114adc0a2072b602c645f5a07eefa1eadbdbc2",
    "state": "exact",
    "codeHash": "0x68a66365b3f1bf297f8fe4d7171c0369eb3985e4defab846430c2c66d1cd327c",
    "size": 1839
  }
];
