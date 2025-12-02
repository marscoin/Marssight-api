# Marssight API

**Marssight API** is an open-source Marscoin blockchain REST and WebSocket API. Built with pure JavaScript modules for Node.js 24+, it provides a modern, native-addon-free backend for the Marssight blockchain explorer.

## Features

- **Pure JavaScript** - No native addons required, works on any platform
- **Node.js 24+** - Built for modern JavaScript with ES modules support
- **REST API** - Full blockchain data access via HTTP endpoints
- **WebSocket** - Real-time block and transaction updates
- **LevelDB Storage** - Fast indexed blockchain data using classic-level

## Prerequisites

- **Node.js 24+** - Required for modern JavaScript features
- **Marscoin Core** - Running full node with RPC enabled and `txindex=1`

### Marscoin Node Configuration

Ensure your `~/.marscoin/marscoin.conf` has:

```conf
rpcuser=marscoinrpc
rpcpassword=your_secure_password
rpcport=9981
rpcallowip=127.0.0.1
txindex=1
```

## Quick Start

### Install

```bash
git clone https://github.com/marscoin/Marssight-api.git
cd Marssight-api
npm install
```

### Run

```bash
INSIGHT_NETWORK=livenet \
BITCOIND_PASS=your_rpc_password \
INSIGHT_FORCE_RPC_SYNC=true \
node insight.js
```

The API will be available at `http://localhost:4005`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INSIGHT_NETWORK` | Network mode (`livenet` or `testnet`) | `testnet` |
| `INSIGHT_PORT` | API server port | `4005` (livenet), `4006` (testnet) |
| `BITCOIND_USER` | RPC username | `marscoinrpc` |
| `BITCOIND_PASS` | RPC password | - |
| `BITCOIND_HOST` | RPC host | `127.0.0.1` |
| `BITCOIND_PORT` | RPC port | `9981` (livenet), `18338` (testnet) |
| `INSIGHT_FORCE_RPC_SYNC` | Force RPC sync mode | `false` |

## API Endpoints

### Blocks

```
GET /api/block/:hash          # Get block by hash
GET /api/block-index/:height  # Get block hash by height
GET /api/blocks               # Get blocks list
```

### Transactions

```
GET /api/tx/:txid             # Get transaction by ID
GET /api/txs                  # Get transactions list
GET /api/rawtx/:txid          # Get raw transaction
```

### Addresses

```
GET /api/addr/:address        # Get address info
GET /api/addr/:address/utxo   # Get address UTXOs
GET /api/addr/:address/balance # Get address balance
```

### Status

```
GET /api/sync                 # Get sync status
GET /api/status               # Get node status
GET /api/peer                 # Get peer info
```

## Pure JavaScript Modules

This version replaces native C++ addons with pure JavaScript implementations:

- **lib/base58.js** - Base58/Base58Check encoding (replaces base58-native)
- **lib/leveldb.js** - LevelDB wrapper using classic-level (replaces leveldown)
- **lib/microtime.js** - Microsecond timing (replaces native microtime)
- **lib/bufferUtils.js** - Buffer manipulation utilities

## Testing

Run the pure JavaScript test suite:

```bash
npm run test:pure
```

## Frontend

For the web frontend, see [Marssight](https://github.com/marscoin/Marssight).

## About Marscoin

Marscoin is the cryptocurrency designed for the future settlement of Mars. Learn more at [marscoin.org](https://www.marscoin.org).

## License

MIT License - Based on Bitcore Insight API by BitPay.
