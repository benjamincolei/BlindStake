import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-mark">BS</div>
        <div>
          <h1>BlindStake</h1>
          <p>Encrypted ETH staking with cStakePoint</p>
        </div>
      </div>
      <ConnectButton />
    </header>
  );
}
