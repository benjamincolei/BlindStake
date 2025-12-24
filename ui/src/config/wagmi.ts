import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'BlindStake',
  projectId: 'd0c7b16b9f6f4d5fbcd0a7d2e63d5f3e',
  chains: [sepolia],
  ssr: false,
});
