/**
 * networkUtils.ts
 * Shared NetInfo utilities for network-adaptive behaviour throughout the app.
 * Uses @react-native-community/netinfo (already installed, v11.4.1).
 */
import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export type NetworkQuality = 'wifi_4g' | '3g' | '2g' | 'offline';

/**
 * Maps a NetInfoState to a coarse quality bucket.
 * Cellular 2G/3G → slow tiers. WiFi, 4G, ethernet → fast tier.
 */
function stateToQuality(state: NetInfoState): NetworkQuality {
  if (!state.isConnected) return 'offline';

  if (state.type === 'wifi' || state.type === 'ethernet' || state.type === 'bluetooth') {
    return 'wifi_4g';
  }

  if (state.type === 'cellular') {
    const gen = state.details?.cellularGeneration;
    if (gen === '2g') return '2g';
    if (gen === '3g') return '3g';
    // 4g / 5g / unknown cellular — treat as fast
    return 'wifi_4g';
  }

  // vpn, wimax, other — optimistically treat as fast
  return 'wifi_4g';
}

/**
 * One-shot async check of current network quality.
 * Use this inside async functions (e.g. inside docQuadDetector, commitCapture).
 */
export async function getNetworkQuality(): Promise<NetworkQuality> {
  try {
    const state = await NetInfo.fetch();
    return stateToQuality(state);
  } catch {
    return 'wifi_4g'; // fail-open: assume good network
  }
}

/**
 * React hook that subscribes to network changes and returns current quality.
 * Defaults to 'wifi_4g' until the first NetInfo event resolves.
 */
export function useNetworkQuality(): NetworkQuality {
  const [quality, setQuality] = useState<NetworkQuality>('wifi_4g');

  useEffect(() => {
    // Fetch immediately on mount
    getNetworkQuality().then(setQuality);

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener(state => {
      setQuality(stateToQuality(state));
    });

    return unsubscribe;
  }, []);

  return quality;
}

/**
 * Returns whether the connection is considered slow (2G or 3G cellular).
 */
export function isSlowQuality(quality: NetworkQuality): boolean {
  return quality === '2g' || quality === '3g';
}
