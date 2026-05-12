import DocumentScanner from 'react-native-document-scanner-plugin';

export const testScannerAvailability = async () => {
  try {
    console.log('[Audit] Testing DocumentScanner availability...');
    console.log('[Audit] DocumentScanner:', DocumentScanner);
    return true;
  } catch (e) {
    console.error('[Audit] DocumentScanner not available:', e.message);
    return false;
  }
};
