import { useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Contract } from 'ethers';
import { formatEther, formatUnits, isAddress, parseEther } from 'viem';

import { Header } from './Header';
import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../config/contracts';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import '../styles/StakeApp.css';

const FALLBACK_SCALE = 1_000_000_000_000n;
const MAX_UINT64 = (1n << 64n) - 1n;

type StatusTone = 'neutral' | 'success' | 'error' | 'pending';

type StatusState = {
  tone: StatusTone;
  message: string;
};

type PendingUnstake = {
  handle: `0x${string}`;
  clearValue?: bigint;
  decryptionProof?: `0x${string}`;
};

function parseWei(value: string) {
  if (!value) {
    return null;
  }
  try {
    return parseEther(value);
  } catch {
    return null;
  }
}

export function StakeApp() {
  const { address, isConnected } = useAccount();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const signerPromise = useEthersSigner();

  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [contractAddress, setContractAddress] = useState(CONTRACT_ADDRESS);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [isStaking, setIsStaking] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [decryptedBalance, setDecryptedBalance] = useState<bigint | null>(null);
  const [pendingUnstake, setPendingUnstake] = useState<PendingUnstake | null>(null);

  const activeAddress = useMemo(
    () => (isAddress(contractAddress) ? contractAddress : undefined),
    [contractAddress]
  );

  const { data: stakeScaleData } = useReadContract({
    address: activeAddress,
    abi: CONTRACT_ABI,
    functionName: 'STAKE_SCALE',
    query: {
      enabled: !!activeAddress,
    },
  });

  const { data: tokenSymbol } = useReadContract({
    address: activeAddress,
    abi: CONTRACT_ABI,
    functionName: 'symbol',
    query: {
      enabled: !!activeAddress,
    },
  });

  const { data: tokenDecimals } = useReadContract({
    address: activeAddress,
    abi: CONTRACT_ABI,
    functionName: 'decimals',
    query: {
      enabled: !!activeAddress,
    },
  });

  const { data: encryptedBalance } = useReadContract({
    address: activeAddress,
    abi: CONTRACT_ABI,
    functionName: 'confidentialBalanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!activeAddress && !!address,
    },
  });

  const stakeScale = (stakeScaleData as bigint | undefined) ?? FALLBACK_SCALE;
  const resolvedDecimals = typeof tokenDecimals === 'number' ? tokenDecimals : Number(tokenDecimals ?? 6);
  const resolvedSymbol = (tokenSymbol as string | undefined) ?? 'cSP';
  const balanceHandle = encryptedBalance as `0x${string}` | undefined;

  const balanceDisplay = decryptedBalance !== null
    ? formatUnits(decryptedBalance, resolvedDecimals)
    : 'Encrypted';

  const balanceInEth = decryptedBalance !== null
    ? formatEther(decryptedBalance * stakeScale)
    : '';
  const pendingUnstakeEth = pendingUnstake?.clearValue !== undefined
    ? formatEther(pendingUnstake.clearValue * stakeScale)
    : '';

  const handleStake = async () => {
    if (!activeAddress) {
      setStatus({ tone: 'error', message: 'Contract address is not configured.' });
      return;
    }
    if (!address || !signerPromise) {
      setStatus({ tone: 'error', message: 'Connect your wallet to stake.' });
      return;
    }

    const weiValue = parseWei(stakeAmount);
    if (!weiValue || weiValue === 0n) {
      setStatus({ tone: 'error', message: 'Enter a valid stake amount.' });
      return;
    }
    if (weiValue % stakeScale !== 0n) {
      setStatus({ tone: 'error', message: 'Amount must align with the stake scale.' });
      return;
    }

    try {
      setIsStaking(true);
      setStatus({ tone: 'pending', message: 'Sending stake transaction...' });

      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Signer unavailable');
      }

      const contract = new Contract(activeAddress, CONTRACT_ABI, signer);
      const tx = await contract.stake({ value: weiValue });
      await tx.wait();

      setStatus({ tone: 'success', message: 'Stake confirmed on-chain.' });
      setStakeAmount('');
    } catch (error) {
      console.error(error);
      setStatus({ tone: 'error', message: 'Stake failed. Please try again.' });
    } finally {
      setIsStaking(false);
    }
  };

  const handleRequestUnstake = async () => {
    if (!activeAddress) {
      setStatus({ tone: 'error', message: 'Contract address is not configured.' });
      return;
    }
    if (!address || !signerPromise || !instance) {
      setStatus({ tone: 'error', message: 'Connect wallet and wait for encryption to load.' });
      return;
    }

    const weiValue = parseWei(unstakeAmount);
    if (!weiValue || weiValue === 0n) {
      setStatus({ tone: 'error', message: 'Enter a valid unstake amount.' });
      return;
    }
    if (weiValue % stakeScale !== 0n) {
      setStatus({ tone: 'error', message: 'Amount must align with the stake scale.' });
      return;
    }

    const stakeUnits = weiValue / stakeScale;
    if (stakeUnits > MAX_UINT64) {
      setStatus({ tone: 'error', message: 'Amount exceeds the encrypted range.' });
      return;
    }

    try {
      setIsRequesting(true);
      setStatus({ tone: 'pending', message: 'Encrypting and requesting unstake...' });

      const buffer = instance.createEncryptedInput(activeAddress, address);
      buffer.add64(stakeUnits);
      const encryptedInput = await buffer.encrypt();

      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Signer unavailable');
      }
      const contract = new Contract(activeAddress, CONTRACT_ABI, signer);

      const tx = await contract['requestUnstake(bytes32,bytes)'](
        encryptedInput.handles[0],
        encryptedInput.inputProof,
      );
      const receipt = await tx.wait();

      const logs = receipt?.logs ?? [];
      let foundHandle: `0x${string}` | undefined;
      for (const log of logs) {
        if (log.address.toLowerCase() !== activeAddress.toLowerCase()) {
          continue;
        }
        try {
          const parsed = contract.interface.parseLog(log);
          if (parsed?.name === 'UnstakeRequested') {
            foundHandle = parsed.args.amount as `0x${string}`;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!foundHandle) {
        setStatus({ tone: 'error', message: 'Unstake requested but handle was not found.' });
        return;
      }

      setPendingUnstake({ handle: foundHandle });
      setStatus({ tone: 'pending', message: 'Fetching public decryption proof...' });

      const decrypted = await instance.publicDecrypt([foundHandle]);
      const clearValue = decrypted.clearValues[foundHandle] as bigint;

      setPendingUnstake({
        handle: foundHandle,
        clearValue,
        decryptionProof: decrypted.decryptionProof,
      });
      setStatus({ tone: 'success', message: 'Unstake request ready to finalize.' });
      setUnstakeAmount('');
    } catch (error) {
      console.error(error);
      setStatus({ tone: 'error', message: 'Unstake request failed.' });
    } finally {
      setIsRequesting(false);
    }
  };

  const handleFinalizeUnstake = async () => {
    if (!pendingUnstake?.clearValue || !pendingUnstake.decryptionProof) {
      setStatus({ tone: 'error', message: 'No pending unstake proof available.' });
      return;
    }
    if (!activeAddress || !signerPromise) {
      setStatus({ tone: 'error', message: 'Connect your wallet to finalize.' });
      return;
    }

    try {
      setIsFinalizing(true);
      setStatus({ tone: 'pending', message: 'Finalizing unstake on-chain...' });

      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Signer unavailable');
      }

      const contract = new Contract(activeAddress, CONTRACT_ABI, signer);
      const tx = await contract.finalizeUnstake(
        pendingUnstake.handle,
        pendingUnstake.clearValue,
        pendingUnstake.decryptionProof,
      );
      await tx.wait();

      setPendingUnstake(null);
      setStatus({ tone: 'success', message: 'Unstake finalized and ETH released.' });
    } catch (error) {
      console.error(error);
      setStatus({ tone: 'error', message: 'Finalize failed. Please try again.' });
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleDecryptBalance = async () => {
    if (!activeAddress) {
      setStatus({ tone: 'error', message: 'Contract address is not configured.' });
      return;
    }
    if (!balanceHandle || !address || !instance || !signerPromise) {
      setStatus({ tone: 'error', message: 'Connect wallet and load encrypted balance first.' });
      return;
    }

    try {
      setStatus({ tone: 'pending', message: 'Requesting secure decryption...' });
      const keypair = instance.generateKeypair();
      const handleContractPairs = [{ handle: balanceHandle, contractAddress: activeAddress }];
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [activeAddress];

      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);
      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Signer unavailable');
      }

      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message,
      );

      const result = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays,
      );

      const clearValue = result[balanceHandle] as bigint;
      setDecryptedBalance(clearValue);
      setStatus({ tone: 'success', message: 'Balance decrypted locally.' });
    } catch (error) {
      console.error(error);
      setStatus({ tone: 'error', message: 'Unable to decrypt balance.' });
    }
  };

  return (
    <div className="stake-app">
      <Header />

      <section className="hero">
        <div className="hero-copy">
          <p className="hero-kicker">Confidential staking</p>
          <h2 className="hero-title">Lock ETH, mint encrypted cStakePoint, redeem with proofs.</h2>
          <p className="hero-subtitle">
            BlindStake uses Zama FHE to store your staked amount as ciphertext while keeping withdrawals verifiable.
          </p>
          <div className="hero-tags">
            <span>Network: Sepolia</span>
            <span>Token: {resolvedSymbol}</span>
            <span>Scale: 1 {resolvedSymbol} = 1 ETH</span>
          </div>
        </div>
        <div className="hero-card">
          <div className="hero-card-title">Encrypted Balance</div>
          <div className="hero-balance">{balanceDisplay}</div>
          <div className="hero-balance-sub">
            {decryptedBalance !== null ? `${balanceInEth} ETH` : 'Decrypt to reveal'}
          </div>
          <div className="hero-handle">
            {balanceHandle ? `Handle: ${balanceHandle.slice(0, 10)}...${balanceHandle.slice(-6)}` : 'Handle pending'}
          </div>
          <button
            className="btn ghost"
            onClick={handleDecryptBalance}
            disabled={!isConnected || !activeAddress || !balanceHandle || !instance}
          >
            {decryptedBalance !== null ? 'Refresh Decryption' : 'Decrypt Balance'}
          </button>
        </div>
      </section>

      <section className="panel-grid">
        <div className="panel">
          <h3>Stake ETH</h3>
          <p className="panel-subtitle">Send ETH and receive encrypted {resolvedSymbol} 1:1.</p>
          <div className="input-row">
            <input
              type="text"
              value={stakeAmount}
              onChange={(event) => setStakeAmount(event.target.value)}
              placeholder="Amount in ETH"
              className="input"
            />
            <span className="input-suffix">ETH</span>
          </div>
          <button
            className="btn primary"
            onClick={handleStake}
            disabled={!isConnected || !activeAddress || isStaking || !stakeAmount}
          >
            {isStaking ? 'Staking...' : 'Stake ETH'}
          </button>
        </div>

        <div className="panel">
          <h3>Unstake ETH</h3>
          <p className="panel-subtitle">Burn encrypted {resolvedSymbol} and unlock ETH after proof.</p>
          <div className="input-row">
            <input
              type="text"
              value={unstakeAmount}
              onChange={(event) => setUnstakeAmount(event.target.value)}
              placeholder="Amount in ETH"
              className="input"
            />
            <span className="input-suffix">ETH</span>
          </div>
          <button
            className="btn secondary"
            onClick={handleRequestUnstake}
            disabled={!isConnected || !activeAddress || isRequesting || zamaLoading || !unstakeAmount}
          >
            {isRequesting ? 'Requesting...' : 'Request Unstake'}
          </button>

          {pendingUnstake && (
            <div className="pending-card">
              <div className="pending-title">Pending Unstake</div>
              <div className="pending-detail">
                Handle: {pendingUnstake.handle.slice(0, 12)}...{pendingUnstake.handle.slice(-6)}
              </div>
              <div className="pending-detail">
                Clear units: {pendingUnstake.clearValue ? pendingUnstake.clearValue.toString() : 'Loading'}
              </div>
              <div className="pending-detail">
                Estimated ETH: {pendingUnstakeEth || 'Loading'}
              </div>
              <button
                className="btn primary"
                onClick={handleFinalizeUnstake}
                disabled={isFinalizing || !pendingUnstake.clearValue || !pendingUnstake.decryptionProof}
              >
                {isFinalizing ? 'Finalizing...' : 'Finalize Unstake'}
              </button>
            </div>
          )}
        </div>
      </section>

      {status && (
        <div className={`status ${status.tone}`}>
          {status.message}
        </div>
      )}

      {zamaError && (
        <div className="status error">
          Encryption service error: {zamaError}
        </div>
      )}

      {!activeAddress && (
        <div className="panel">
          <h4>Contract Address</h4>
          <p className="panel-subtitle">
            Enter the deployed contract address on Sepolia to enable staking.
          </p>
          <div className="input-row">
            <input
              type="text"
              value={contractAddress}
              onChange={(event) => setContractAddress(event.target.value)}
              placeholder="0x..."
              className="input"
            />
          </div>
        </div>
      )}

      <section className="info-grid">
        <div className="panel info">
          <h4>Stake Flow</h4>
          <ol>
            <li>ETH is locked inside the contract.</li>
            <li>An encrypted {resolvedSymbol} balance is minted to you.</li>
            <li>Only your wallet can decrypt the balance handle.</li>
          </ol>
        </div>
        <div className="panel info">
          <h4>Unstake Flow</h4>
          <ol>
            <li>Submit an encrypted burn request.</li>
            <li>The relayer provides a public decryption proof.</li>
            <li>Finalize to release ETH.</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
