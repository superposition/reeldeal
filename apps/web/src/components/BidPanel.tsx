import { createSignal, createUniqueId, Show } from 'solid-js';
import { BID_TYPES, bidDomain } from '@reeldeal/domain';
import './BidPanel.css';

type Listing = {
  id: string;
  status: string;
  price_jpy: number;
};

type Bid = {
  id: string;
  amount_jpy: number;
  bidder: string;
};

type SignedBid = {
  listing_id: string;
  amount_jpy: number;
  bidder: string;
  nonce: string;
  signature: string;
};

type WalletProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type Phase = 'idle' | 'loading' | 'connecting' | 'signing' | 'submitting' | 'success';

function provider(): WalletProvider | null {
  return (window as Window & { ethereum?: WalletProvider }).ethereum ?? null;
}

function firstAddress(value: unknown): string | null {
  if (!Array.isArray(value) || typeof value[0] !== 'string') return null;
  return /^0x[a-fA-F0-9]{40}$/.test(value[0]) ? value[0] : null;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function nonce(): string {
  const bits = crypto.getRandomValues(new Uint32Array(2));
  const value = (BigInt(bits[0]) << 32n) | BigInt(bits[1]);
  return (value === 0n ? 1n : value).toString(10);
}

function amountFrom(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return Number.isSafeInteger(amount) ? amount : null;
}

function messageFor(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001) {
    return 'Cancelled in your wallet. Your offer is still here.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export default function BidPanel(props: { apiOrigin: string; lotId?: string; chainId?: number }) {
  const panelId = createUniqueId();
  const amountId = createUniqueId();
  const api = props.apiOrigin.replace(/\/$/, '');
  const chainId = props.chainId ?? 1;
  const [open, setOpen] = createSignal(false);
  const [phase, setPhase] = createSignal<Phase>('idle');
  const [listing, setListing] = createSignal<Listing | null>(null);
  const [loadError, setLoadError] = createSignal('');
  const [amount, setAmount] = createSignal('');
  const [amountError, setAmountError] = createSignal('');
  const [walletAddress, setWalletAddress] = createSignal('');
  const [walletChain, setWalletChain] = createSignal<number | null>(null);
  const [actionError, setActionError] = createSignal('');
  const [signedBid, setSignedBid] = createSignal<SignedBid | null>(null);
  const [placedBid, setPlacedBid] = createSignal<Bid | null>(null);

  const busy = () => ['loading', 'connecting', 'signing', 'submitting'].includes(phase());
  const currentLotId = () => props.lotId?.trim() || new URLSearchParams(window.location.search).get('id')?.trim() || '';

  async function loadListing() {
    if (busy()) return;
    setPhase('loading');
    setLoadError('');
    setActionError('');
    const lotId = currentLotId();
    if (!api || !lotId) {
      setLoadError(!api ? 'Market connection unavailable. Try again when the market is online.' : 'Choose a lot from the shop first.');
      setPhase('idle');
      return;
    }
    try {
      const response = await fetch(`${api}/v1/lots/${encodeURIComponent(lotId)}`, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(response.status === 404 ? 'This lot could not be found.' : 'Could not check this lot. Try again.');
      const body = await response.json() as { listing?: Listing | null };
      const next = body.listing ?? null;
      setListing(next);
      if (next?.status === 'open' && !amount()) setAmount(String(next.price_jpy));
      if (!next || next.status !== 'open') setLoadError('Bidding is closed for this lot.');
    } catch (error) {
      setListing(null);
      setLoadError(messageFor(error));
    } finally {
      setPhase('idle');
    }
  }

  async function toggle() {
    if (busy()) return;
    if (open()) { setOpen(false); return; }
    setOpen(true);
    // A recorded offer is terminal in this panel. Reopening only shows its
    // receipt; a second offer requires a deliberate separate flow.
    if (!placedBid()) await loadListing();
  }

  async function connectWallet() {
    if (busy()) return;
    setActionError('');
    const wallet = provider();
    if (!wallet) {
      setActionError('Open this page in a wallet browser to sign a demo offer.');
      return;
    }
    setPhase('connecting');
    try {
      const account = firstAddress(await wallet.request({ method: 'eth_requestAccounts' }));
      if (!account) throw new Error('Your wallet did not return an address. Check that it is unlocked.');
      const rawChain = await wallet.request({ method: 'eth_chainId' });
      const connectedChain = typeof rawChain === 'string' ? Number(rawChain) : NaN;
      if (!Number.isSafeInteger(connectedChain)) throw new Error('Could not read the wallet network. Reconnect and try again.');
      setWalletAddress(account);
      setWalletChain(connectedChain);
      if (connectedChain !== chainId) setActionError(`Wallet is on chain ${connectedChain}. Switch to chain ${chainId}, then check wallet again.`);
    } catch (error) {
      setActionError(messageFor(error));
    } finally {
      setPhase('idle');
    }
  }

  async function sendBid(payload: SignedBid) {
    const current = listing();
    if (!current) return;
    setPhase('submitting');
    setActionError('');
    try {
      const response = await fetch(`${api}/v1/listings/${encodeURIComponent(current.id)}/bids`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000),
      });
      const body = await response.json().catch(() => null) as { bid?: Bid; error?: string } | null;
      if (response.status === 201 && body?.bid) {
        setPlacedBid(body.bid);
        setSignedBid(null);
        setPhase('success');
        return;
      }
      setSignedBid(null);
      if (response.status === 401 && body?.error === 'signature_mismatch') {
        setActionError('The signature did not match this offer. Check the wallet and sign again.');
      } else if (response.status === 409 && body?.error === 'nonce_reused') {
        setActionError('This signature was already used. Check with the market operator before signing another offer.');
      } else if (response.status === 409 && body?.error === 'listing_not_open') {
        setListing({ ...current, status: 'closed' });
        setLoadError('Bidding is closed for this lot.');
      } else {
        setActionError('The market did not accept this offer. Check the lot and try again.');
      }
    } catch {
      // A timed-out POST might have committed. Reuse the exact signed payload
      // on retry; never silently make a second signature or nonce.
      setActionError('Could not confirm this offer. Retry sending the same signature. No payment was made.');
    } finally {
      if (phase() !== 'success') setPhase('idle');
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy() || phase() === 'success') return;
    const current = listing();
    if (!current || current.status !== 'open') return;
    if (signedBid()) { await sendBid(signedBid()!); return; }
    setAmountError('');
    setActionError('');
    const offer = amountFrom(amount());
    if (offer === null) {
      setAmountError('Enter a whole-yen offer greater than zero.');
      return;
    }
    const wallet = provider();
    if (!wallet || !walletAddress()) {
      setActionError('Connect a browser wallet before signing.');
      return;
    }
    setPhase('signing');
    try {
      const rawChain = await wallet.request({ method: 'eth_chainId' });
      const activeChain = typeof rawChain === 'string' ? Number(rawChain) : NaN;
      setWalletChain(Number.isSafeInteger(activeChain) ? activeChain : null);
      if (activeChain !== chainId) {
        throw new Error(`Switch your wallet to chain ${chainId}, then check wallet again.`);
      }
      const accounts = await wallet.request({ method: 'eth_accounts' });
      const active = firstAddress(accounts);
      if (!active || active.toLowerCase() !== walletAddress().toLowerCase()) {
        setWalletAddress('');
        throw new Error('Wallet account changed. Check wallet again before signing.');
      }
      // The heavy wallet codec is absent from the initial lot/board bundles.
      const { getAddress, serializeTypedData } = await import('viem');
      const bidder = getAddress(active);
      const listingId = current.id;
      const nextNonce = nonce();
      // The JSON-RPC payload declares chainId as uint256; the shared domain
      // supplies the value, converted to bigint for viem's strict encoder.
      const domain = { ...bidDomain(chainId), chainId: BigInt(chainId) };
      const signature = await wallet.request({
        method: 'eth_signTypedData_v4',
        params: [bidder, serializeTypedData({
          domain,
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
            ] as const,
            ...BID_TYPES,
          },
          primaryType: 'Bid',
          message: { listing_id: listingId, amount_jpy: BigInt(offer), bidder, nonce: BigInt(nextNonce) },
        })],
      });
      if (typeof signature !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
        throw new Error('Wallet returned an invalid signature. Try again.');
      }
      const payload = { listing_id: listingId, amount_jpy: offer, bidder, nonce: nextNonce, signature };
      setSignedBid(payload);
      await sendBid(payload);
    } catch (error) {
      setActionError(messageFor(error));
      setPhase('idle');
    }
  }

  const status = () => {
    if (phase() === 'loading') return 'Checking this lot…';
    if (phase() === 'connecting') return 'Waiting for wallet…';
    if (phase() === 'signing') return 'Check the offer in your wallet…';
    if (phase() === 'submitting') return 'Sending signed offer…';
    return '';
  };

  return <section class="bid-panel" aria-label="Demo bid">
    <button type="button" class="bid-panel__open" aria-expanded={open()} aria-controls={panelId} onClick={toggle} disabled={busy()}>
      {open() ? 'Close bid' : 'Place demo bid'}
    </button>
    <Show when={open()}>
      <div id={panelId} class="bid-panel__body">
        <div class="bid-panel__heading">
          <span class="bid-panel__tag">Demo only</span>
          <h2>Make an offer</h2>
          <p>Sign an offer in your wallet. No payment or gas is sent.</p>
        </div>
        <p class="bid-panel__status" role="status" aria-live="polite">{status()}</p>
        <Show when={loadError()}>
          <p class="bid-panel__error" role="alert">{loadError()}</p>
          <button type="button" class="bid-panel__secondary" onClick={loadListing} disabled={busy()}>Check lot again</button>
        </Show>
        <Show when={listing()?.status === 'open' && phase() !== 'success'}>
          <div class="bid-panel__ask"><span>Asking</span><strong>¥{listing()!.price_jpy.toLocaleString('ja-JP')}</strong></div>
          <form onSubmit={submit} novalidate>
            <label for={amountId}>Your offer · JPY</label>
            <div class="bid-panel__amount"><span aria-hidden="true">¥</span><input id={amountId} type="text" inputmode="numeric" autocomplete="off" value={amount()} onInput={(event) => { setAmount(event.currentTarget.value); setAmountError(''); }} disabled={busy() || !!signedBid()} aria-invalid={!!amountError()} aria-describedby={amountError() ? `${amountId}-error` : undefined} /></div>
            <Show when={amountError()}><p id={`${amountId}-error`} class="bid-panel__error" role="alert">{amountError()}</p></Show>
            <p class="bid-panel__hint">Whole yen. A signature records intent, not a purchase.</p>
            <div class="bid-panel__wallet">
              <span>Wallet</span>
              <strong>{walletAddress() ? shortAddress(walletAddress()) : 'Not connected'}</strong>
            </div>
            <Show when={walletAddress() && walletChain() !== chainId}>
              <p class="bid-panel__error" role="alert">Switch your wallet to chain {chainId}, then check it again.</p>
            </Show>
            <Show when={actionError()}><p class="bid-panel__error" role="alert">{actionError()}</p></Show>
            <Show when={!walletAddress() || walletChain() !== chainId}>
              <button type="button" class="bid-panel__secondary" onClick={connectWallet} disabled={busy()}>{walletAddress() ? 'Check wallet again' : 'Connect wallet'}</button>
            </Show>
            <button type="submit" class="bid-panel__submit" disabled={busy() || !walletAddress() || walletChain() !== chainId}>
              {signedBid() ? 'Retry same signature' : phase() === 'signing' ? 'Waiting for wallet…' : phase() === 'submitting' ? 'Sending offer…' : 'Sign demo offer'}
            </button>
          </form>
        </Show>
        <Show when={placedBid()}>
          <div class="bid-panel__success" role="status">
            <strong>Offer received</strong>
            <p>¥{placedBid()!.amount_jpy.toLocaleString('ja-JP')} from {shortAddress(placedBid()!.bidder)}. The signature is recorded; no payment was made.</p>
          </div>
        </Show>
      </div>
    </Show>
  </section>;
}
