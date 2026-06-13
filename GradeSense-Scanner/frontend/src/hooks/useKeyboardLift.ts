import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

const FLOATING_GAP = 10;

export function useKeyboardLift(bottomInset = 0): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const showSubscription = Keyboard.addListener('keyboardDidShow', event => {
      const height = event.endCoordinates?.height ?? 0;
      setKeyboardHeight(Math.max(0, height - bottomInset + FLOATING_GAP));
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [bottomInset]);

  return 0;
}
