# Equipchain Backend API

Express API for Equipchain utility meter monitoring and data access.

## Overview

Provides a REST endpoint for querying Equipchain smart contract data including meter status, contract ID, and project information.

## Getting Started

```bash
npm install
npm start
```

The server runs on `http://localhost:3000`.

## Endpoints

### `GET /`

Returns project metadata:

```json
{
  "project": "Equipchain",
  "status": "Monitoring Meters",
  "contract": "CB7PSJZALNWNX7NLOAM6LOEL4OJZMFPQZJMIYO522ZSACYWXTZIDEDSS"
}
```

## Related

- [Equipchain Contracts](https://github.com/EquipChain/EquipChain-contracts)
- [Equipchain Frontend](https://github.com/EquipChain/EquipChain-frontend)
