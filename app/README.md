# Boost TVL Dashboard (Vue)

Vue app that tracks USD TVL boost for eligible users across configured WrappedNLP vaults.

## Data sources

- `../config/WrappedNLP.json`: ABI used for `balanceOf`, `getNlpByWnlp`, and `decimals`
- `../config/vaults.json`: vault list and token metadata
- `../config/eligible_users`: one wallet address per line
- `../config/runtime-config.json`: RPC URLs, multicall addresses, batch size, and timing config

## Quick start

```bash
cd app
npm install
npm run dev
```

## Build and local test

```bash
cd app
npm run build
npm run test:local
```

- `test:local` builds then serves the production bundle at `http://127.0.0.1:4173`.

## Notes

- Multicall is mandatory in this app and all `balanceOf` reads are batched with `aggregate3`.
- Vite `server.fs.allow` is configured so the app can read the root-level data files.

## Vercel deployment

- This repo deploys from root using `vercel.json`.
- Build runs from `app/` and publishes `app/dist`.
- For local verification, run:

```bash
cd app
npm run build
```
