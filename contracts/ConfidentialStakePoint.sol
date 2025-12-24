// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract ConfidentialStakePoint is ERC7984, ZamaEthereumConfig {
    constructor() ERC7984("cStakePoint", "cSP", "") {}

    uint256 public constant STAKE_SCALE = 1e12;

    mapping(euint64 unstakeAmount => address recipient) private _unstakeRequests;

    event Staked(address indexed staker, uint256 weiAmount, uint64 stakeUnits);
    event UnstakeRequested(address indexed staker, euint64 amount);
    event UnstakeFinalized(address indexed staker, uint64 stakeUnits, uint256 weiAmount);

    error InvalidStakeAmount();
    error InvalidUnstakeRequest(euint64 amount);
    error TransferFailed();

    function stake() external payable returns (euint64 mintedAmount) {
        if (msg.value == 0 || msg.value % STAKE_SCALE != 0) {
            revert InvalidStakeAmount();
        }

        uint256 scaled = msg.value / STAKE_SCALE;
        if (scaled > type(uint64).max) {
            revert InvalidStakeAmount();
        }

        uint64 stakeUnits = SafeCast.toUint64(scaled);
        mintedAmount = _mint(msg.sender, FHE.asEuint64(stakeUnits));

        emit Staked(msg.sender, msg.value, stakeUnits);
    }

    function requestUnstake(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint64 burntAmount) {
        burntAmount = _requestUnstake(msg.sender, FHE.fromExternal(encryptedAmount, inputProof));
    }

    function requestUnstake(euint64 amount) external returns (euint64 burntAmount) {
        require(FHE.isAllowed(amount, msg.sender), ERC7984UnauthorizedUseOfEncryptedAmount(amount, msg.sender));
        burntAmount = _requestUnstake(msg.sender, amount);
    }

    function finalizeUnstake(
        euint64 burntAmount,
        uint64 burntAmountCleartext,
        bytes calldata decryptionProof
    ) external {
        address to = _unstakeRequests[burntAmount];
        if (to == address(0)) {
            revert InvalidUnstakeRequest(burntAmount);
        }
        delete _unstakeRequests[burntAmount];

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint64.unwrap(burntAmount);
        bytes memory cleartexts = abi.encode(burntAmountCleartext);

        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        uint256 weiAmount = uint256(burntAmountCleartext) * STAKE_SCALE;
        (bool success, ) = to.call{value: weiAmount}("");
        if (!success) {
            revert TransferFailed();
        }

        emit UnstakeFinalized(to, burntAmountCleartext, weiAmount);
    }

    function _requestUnstake(address from, euint64 amount) internal returns (euint64 burntAmount) {
        burntAmount = _burn(from, amount);
        FHE.makePubliclyDecryptable(burntAmount);

        if (_unstakeRequests[burntAmount] != address(0)) {
            revert InvalidUnstakeRequest(burntAmount);
        }
        _unstakeRequests[burntAmount] = from;

        emit UnstakeRequested(from, burntAmount);
    }
}
