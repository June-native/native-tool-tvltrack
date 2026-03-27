# native-tool-tvltrack

Repository layout:

- `app/`: Vue dashboard frontend
- `config/`: all dashboard config and input data
  - `config/WrappedNLP.json`: WrappedNLP ABI
  - `config/vaults.json`: vault metadata (symbol, chain, decimals, token price)
  - `config/eligible_users`: eligible wallet addresses
  - `config/runtime-config.json`: RPC URLs, multicall addresses, batch size, timing config

## Run locally

```bash
cd app
npm install
npm run dev
```

## Production build

```bash
cd app
npm run build
```
