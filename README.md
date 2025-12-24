# BlindStake

BlindStake is a confidential ETH staking prototype built on Zama FHEVM. It locks ETH, mints an encrypted stake token
(cStakePoint), and releases ETH only after a proof-backed unstake flow. The staked balance is stored as ciphertext on-chain
so observers cannot read the stake amount directly from contract state.

## Table of contents

- Overview
- Problem statement
- Solution and scope
- Advantages
- How it works
- Architecture
- Contract details
- Privacy and transparency model
- Tech stack
- Repository structure
- Setup and usage
- Smart contract workflow
- Frontend workflow
- Troubleshooting
- Future roadmap
- License

## Overview

BlindStake provides a minimal, verifiable staking vault where balances are encrypted using Fully Homomorphic Encryption (FHE).
Users receive cStakePoint (cSP) on a 1:1 basis with staked ETH and can later burn the confidential balance to withdraw ETH
after submitting a valid decryption proof.

This project focuses on confidential accounting rather than rewards, delegation, or validator management. It is designed to
show how encrypted balances, proof-driven withdrawals, and user-controlled decryption can be combined into a simple staking
experience on Sepolia.

## Problem statement

Public staking contracts expose user balances and transaction history, which enables:
- On-chain profiling of individual wallets.
- Correlation of deposits and withdrawals over time.
- Targeting of large holders or strategy inference.

BlindStake addresses these issues by encrypting the recorded stake balance while keeping the contract verifiable and fully
on-chain.

## Solution and scope

BlindStake uses Zama FHEVM primitives and the ERC7984 confidential token standard to:
- Store staking balances as encrypted euint64 values.
- Mint a confidential token representing the stake 1:1 with ETH.
- Support a two-step withdraw flow that validates decryption proofs before releasing ETH.

Out of scope for this prototype:
- Rewards or yield distribution.
- Validator participation or delegation.
- Slashing, lockups, or governance.
- Mainnet deployment and security audit.

## Advantages

- Confidential balances: encrypted stake balances are stored on-chain and cannot be read directly.
- Verifiable withdrawals: ETH is released only after a valid decryption proof is checked.
- Simple accounting: 1 cSP represents 1 ETH, with a deterministic stake scale.
- Self-sovereign decryption: users can decrypt their own balance locally without a backend.
- Minimal surface area: a single core contract and a focused UI for staking and unstaking.

## How it works

Stake flow:
1. User sends ETH to `stake()`.
2. Contract validates the amount is aligned to `STAKE_SCALE`.
3. Contract mints an encrypted cSP balance to the user.

Balance decryption flow:
1. User requests local decryption in the UI.
2. Wallet signs an EIP-712 message.
3. Zama relayer returns the cleartext balance for that handle.

Unstake flow:
1. User encrypts the unstake amount locally and calls `requestUnstake`.
2. Contract burns the encrypted amount and marks it publicly decryptable.
3. Zama relayer provides a public decryption proof and clear amount.
4. User submits `finalizeUnstake` with the proof to release ETH.

## Architecture

Components:
- On-chain: `ConfidentialStakePoint` contract stores encrypted balances and manages stake/unstake.
- Off-chain: Zama relayer SDK handles encrypted inputs, public decryption, and user decryption.
- Frontend: React app for wallet connection, staking, decrypting, and withdrawals.

Data flow summary:
- Encryption happens client-side using `@zama-fhe/relayer-sdk`.
- The contract never sees plaintext staking balances.
- Proofs are verified on-chain before ETH is released.

## Contract details

Contract: `contracts/ConfidentialStakePoint.sol`
- Token name: cStakePoint
- Symbol: cSP
- Standard: ERC7984 confidential token
- `STAKE_SCALE`: 1e12 wei
- Minimum stake: 0.000001 ETH (1e12 wei)
- Minting: 1 cSP == 1 ETH (token uses 6 decimals)

Key functions:
- `stake()` (payable): validates amount and mints encrypted balance.
- `requestUnstake(externalEuint64, bytes)` or `requestUnstake(euint64)`: burns encrypted amount and creates a pending
  request handle.
- `finalizeUnstake(euint64 burntAmount, uint64 clear, bytes proof)`: verifies the proof and releases ETH.
- `confidentialBalanceOf(address)`: returns an encrypted handle to the balance.

Events:
- `Staked`, `UnstakeRequested`, `UnstakeFinalized` for UI and monitoring.

Error conditions:
- Invalid stake amount (not aligned to scale or too large for euint64).
- Duplicate or unknown unstake request.
- Failed ETH transfer.

Notes:
- Unstake requests are keyed by the encrypted handle to prevent replay.
- ETH transfer is performed after state cleanup to limit reentrancy risk.

## Privacy and transparency model

- Encrypted: staking balances and token transfers (cSP) are stored as ciphertext.
- Public: deposit and withdrawal ETH amounts are visible in transaction value and calldata.
- Proof-based: clear amounts become public at finalize time because the proof and clear value are submitted on-chain.

This model hides balance state between actions while keeping withdrawals verifiable.

## Tech stack

Smart contracts and tooling:
- Solidity 0.8.x
- Hardhat + hardhat-deploy
- Zama FHEVM (`@fhevm/solidity`, `@fhevm/hardhat-plugin`)
- OpenZeppelin confidential contracts (ERC7984)
- TypeChain, Ethers v6

Frontend:
- React + Vite
- wagmi + RainbowKit
- viem for reads, ethers for writes
- Zama relayer SDK for encryption and decryption

## Repository structure

- `contracts/`: Solidity contracts
- `deploy/`: Deployment scripts
- `tasks/`: Hardhat tasks (example tasks include FHECounter)
- `test/`: Unit and Sepolia tests for ConfidentialStakePoint
- `docs/`: Zama protocol and relayer references
- `ui/`: React frontend

Note: `contracts/FHECounter.sol` and related tasks/tests are examples from the template and not part of BlindStake's core
flow.

## Setup and usage

Prerequisites:
- Node.js 20+
- npm
- A wallet with Sepolia ETH for testing

Install dependencies:
- Root (contracts): `npm install`
- Frontend: `cd ui && npm install`

Environment configuration (contracts only):
- Create a `.env` file at the repo root.
- Required keys:
  - `INFURA_API_KEY`
  - `PRIVATE_KEY` (use a raw private key, not a mnemonic)
  - `ETHERSCAN_API_KEY` (optional, for verification)

Frontend configuration:
- No environment variables are used in the frontend.
- Set the deployed contract address in `ui/src/config/contracts.ts` or enter it in the UI.
- Copy the ABI from `deployments/sepolia/ConfidentialStakePoint.json` into `ui/src/config/contracts.ts`.
  The frontend must use the deployed ABI and does not load ABI JSON files at runtime.

## Smart contract workflow

Compile:
- `npm run compile`

Run tests (local FHEVM mock):
- `npm run test`

Deploy to a local node (optional for contract-only debugging):
- `npx hardhat node`
- `npx hardhat deploy --network localhost`

Deploy to Sepolia:
- `npx hardhat deploy --network sepolia`

Run Sepolia test suite (after deployment):
- `npm run test:sepolia`

Verify on Sepolia (optional):
- `npx hardhat verify --network sepolia <CONTRACT_ADDRESS>`

## Frontend workflow

Start the UI:
- `cd ui && npm run dev`

Usage:
1. Connect a wallet (Sepolia only).
2. Enter a stake amount aligned to the scale (multiples of 0.000001 ETH).
3. Stake ETH to mint encrypted cSP.
4. Decrypt balance locally when needed.
5. Request unstake with an encrypted amount.
6. Finalize once the public proof is available.

The UI does not use local storage; the decrypted balance is shown only after user decryption and is not persisted.

## Troubleshooting

- "Amount must align with the stake scale": the value is not a multiple of 1e12 wei.
- "Encryption service error": relayer unavailable or network mismatch.
- "Handle pending": wait for the transaction to confirm before decrypting.
- "Unstake requested but handle not found": event parsing failed; retry and confirm the transaction receipt.

## Future roadmap

- Add a UI for confidential transfers of cSP.
- Integrate a rewards model with encrypted accounting.
- Add a withdrawal queue and configurable delay.
- Support additional networks and L2s.
- Improve UX around proof status and retries.
- Formalize audits and threat modeling.
- Add advanced analytics dashboards using only encrypted aggregates.

## License

BSD-3-Clause-Clear. See `LICENSE`.
