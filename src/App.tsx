import { useState, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, usePublicClient, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { Lightning } from '@inco/js/lite';
import { supportedChains, handleTypes } from '@inco/js';
import { Wallet, Coins, ArrowRightLeft, Eye } from 'lucide-react';
import { createWalletClient, custom } from 'viem';

import abiData from './abi.json';

const CONTRACT_ADDRESS = "0xBd74AFaDf5d406ef52892F8FDdd910E953Cc9D17";

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();

  const [zap, setZap] = useState<any>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [encryptedBalance, setEncryptedBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const [mintAmount, setMintAmount] = useState('100');
  const [transferAmount, setTransferAmount] = useState('10');
  const [transferTo, setTransferTo] = useState('');

  useEffect(() => {
    async function initZap() {
      if (isConnected) {
        const zapInstance = await Lightning.latest('testnet', supportedChains.baseSepolia);
        setZap(zapInstance);
        fetchBalanceHandle();
      }
    }
    initZap();
  }, [isConnected]);

  // Read encrypted balance handle
  const fetchBalanceHandle = async () => {
    if (!publicClient || !address) return null;
    try {
      const handle = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: abiData,
        functionName: 'balanceOf',
        args: [address]
      });
      setEncryptedBalance(handle as string);
      return handle as string;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  const handleDecryptBalance = async () => {
    console.log("Starting decryption. Zap:", !!zap, "Address:", address);
    if (!zap || !address) {
      alert("Missing Zap initialization or wallet address");
      return;
    }

    setLoading(true);
    setLoadingMessage("Fetching signatures...");

    try {
      console.log("Fetching balance handle...");
      const handle = await fetchBalanceHandle();
      console.log("Handle:", handle);

      if (handle) {
        let signerClient = walletClient;

        // Fallback to natively creating the client if Wagmi state is desynced
        if (!signerClient) {
          console.log("Wagmi walletClient not found. Creating native Viem client...");
          signerClient = createWalletClient({
            account: address as `0x${string}`,
            chain: supportedChains.baseSepolia as any,
            transport: custom((window as any).ethereum)
          }) as any;
        }

        if (!signerClient) throw new Error("Wallet Client not connected");

        // Ensure the active wallet chain matches the EIP-712 Domain ChainId
        if (switchChainAsync && signerClient.chain?.id !== 84532) {
          console.log("Forcing network switch to Base Sepolia (84532)...");
          try {
            await switchChainAsync({ chainId: 84532 });
          } catch (e) {
            console.log("Switch chain failed, but continuing anyways", e);
          }
        }

        console.log("Requesting attested decrypt from local zap instance...");
        const cleanHandle = String(handle);

        // If the handle is completely 0, it means the balance is uninitialized (0). 
        // We cannot decrypt a 0 handle against the KMS.
        if (cleanHandle === "0x0000000000000000000000000000000000000000000000000000000000000000" || cleanHandle === "0" || cleanHandle === "") {
          console.log("Balance handle is null. Returning 0.");
          setBalance("0");
          setLoading(false);
          return;
        }

        const result = await zap.attestedDecrypt(
          signerClient as any,
          [cleanHandle]
        );

        console.log("Decryption successful:", result);
        setBalance(result[0].plaintext.value);
      } else {
        alert("Failed to fetch encrypted balance handle from blockchain!");
      }
    } catch (e: any) {
      console.error("DECRYPTION ERROR:", e);
      alert(`Error decrypting balance: ${e?.message || e}`);
    }
    setLoading(false);
  }

  const handleMint = async () => {
    if (!zap || !walletClient || !address || !publicClient) return;
    setLoading(true);
    setLoadingMessage("Encrypting & Minting...");
    try {
      const amountBigInt = BigInt(mintAmount);
      const encryptedAmountHex = await zap.encrypt(amountBigInt, {
        accountAddress: address,
        dappAddress: CONTRACT_ADDRESS,
        handleType: handleTypes.euint256
      });

      const { request } = await publicClient.simulateContract({
        account: address as `0x${string}`,
        address: CONTRACT_ADDRESS,
        abi: abiData,
        functionName: 'encryptedMint',
        args: [encryptedAmountHex],
        value: 10000000000000000n // 0.01 INCO - Sufficient for oracle fee without maxing wallet
      });

      const hash = await walletClient.writeContract(request as any);
      setLoadingMessage("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      alert('Mint Successful! You can now decrypt the new balance.');
      await fetchBalanceHandle();
    } catch (e) {
      console.error(e);
      alert("Mint failed.");
    }
    setLoading(false);
  }

  const handleTransfer = async () => {
    if (!zap || !walletClient || !address || !transferTo || !publicClient) return;
    setLoading(true);
    setLoadingMessage("Encrypting & Transferring...");
    try {
      const amountBigInt = BigInt(transferAmount);
      const encryptedAmountHex = await zap.encrypt(amountBigInt, {
        accountAddress: address,
        dappAddress: zap.executorAddress || '0x168FDc3Ae19A5d5b03614578C58974FF30FCBe92',
        handleType: handleTypes.euint256
      });

      const transferAbi = [
        {
          inputs: [
            { internalType: "address", name: "to", type: "address" },
            { internalType: "bytes", name: "encryptedAmount", type: "bytes" }
          ],
          name: "transfer",
          outputs: [{ internalType: "bool", name: "", type: "bool" }],
          stateMutability: "payable",
          type: "function"
        }
      ];

      const cleanToAddress = transferTo.trim() as `0x${string}`;

      const { request } = await publicClient.simulateContract({
        account: address as `0x${string}`,
        address: CONTRACT_ADDRESS,
        abi: transferAbi,
        functionName: 'transfer',
        args: [cleanToAddress, encryptedAmountHex],
        value: 100000000000000n // Fee for gas/Inco
      });

      const hash = await walletClient.writeContract(request as any);
      setLoadingMessage("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      alert('Transfer Successful!');
      await fetchBalanceHandle();
    } catch (e) {
      console.error(e);
      alert("Transfer failed.");
    }
    setLoading(false);
  }

  return (
    <div className="container">
      <div className="bg-orb orb-1"></div>
      <div className="bg-orb orb-2"></div>

      <header>
        <div className="logo-container">
          <div className="logo-icon"><Coins color="white" /></div>
          <div className="logo-text">Inco Confidential Token</div>
        </div>
        {!isConnected ? (
          <button className="btn btn-primary" onClick={() => connect({ connector: injected() })}>
            <Wallet size={18} /> Connect Wallet
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span className="text-muted">{address?.substring(0, 6)}...{address?.substring(address?.length - 4)}</span>
            <button className="btn" onClick={() => disconnect()}>Disconnect</button>
          </div>
        )}
      </header>

      {isConnected && (
        <div className="dashboard-grid">

          <div className="glass-panel">
            <div className="card-header">
              <Eye size={20} className="text-muted" />
              <span className="card-title">My Balance</span>
            </div>
            <div className="card-body">
              {balance !== null ? (
                <div className="balance-display">
                  <span className="balance-amount">{balance}</span>
                  <span className="balance-currency">cUSD</span>
                </div>
              ) : (
                <div className="balance-display">
                  <span className="balance-amount">***</span>
                  <span className="balance-currency">cUSD</span>
                </div>
              )}
              {encryptedBalance && (
                <div className="balance-encrypted">Handle: {String(encryptedBalance).substring(0, 15)}...</div>
              )}

              <button
                className="btn btn-primary mt-4"
                onClick={handleDecryptBalance}
                disabled={loading}
              >
                {loading && loadingMessage.includes("signature") ? loadingMessage : 'Decrypt Balance'}
              </button>
            </div>
          </div>

          <div className="glass-panel">
            <div className="card-header">
              <Coins size={20} className="text-muted" />
              <span className="card-title">Confidential Mint</span>
            </div>
            <div className="card-body">
              <div className="input-group">
                <label className="input-label">Amount</label>
                <input
                  type="number"
                  className="glass-input"
                  value={mintAmount}
                  onChange={e => setMintAmount(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary mt-4"
                onClick={handleMint}
                disabled={loading}
              >
                {loading && loadingMessage.includes("Mint") ? loadingMessage : 'Mint Tokens'}
              </button>
            </div>
          </div>

          <div className="glass-panel">
            <div className="card-header">
              <ArrowRightLeft size={20} className="text-muted" />
              <span className="card-title">Confidential Transfer</span>
            </div>
            <div className="card-body">
              <div className="input-group">
                <label className="input-label">To Address</label>
                <input
                  type="text"
                  className="glass-input"
                  placeholder="0x..."
                  value={transferTo}
                  onChange={e => setTransferTo(e.target.value)}
                />
              </div>
              <div className="input-group mt-4">
                <label className="input-label">Amount</label>
                <input
                  type="number"
                  className="glass-input"
                  value={transferAmount}
                  onChange={e => setTransferAmount(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary mt-4"
                onClick={handleTransfer}
                disabled={loading || !transferTo}
              >
                {loading && loadingMessage.includes("Transfer") ? loadingMessage : 'Transfer Tokens'}
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
