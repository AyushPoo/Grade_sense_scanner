import DocumentScanner from 'react-native-document-scanner-plugin';

export const testScannerAvailability = async () => {
  try {
    console.log('[Audit] Testing DocumentScanner availability...');
    console.log('[Audit] DocumentScanner:', DocumentScanner);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Audit] DocumentScanner not available:', msg);
    return false;
  }
};
