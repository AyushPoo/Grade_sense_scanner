import type { ScannedPage } from '../types';
import { File, Paths } from 'expo-file-system';

export interface ImportedDocumentAsset {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

export function isPdfScannedPage(
  page: Pick<ScannedPage, 'content_type' | 'file_path' | 'original_name' | 'source_type'>
): boolean {
  const source = [
    page.content_type,
    page.file_path,
    page.original_name,
    page.source_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return source.includes('application/pdf') || source.includes('.pdf') || source.includes('pdf');
}

export function createImportedPdfPage(
  asset: ImportedDocumentAsset,
  idFactory: () => string,
): ScannedPage {
  const sourceText = `${asset.mimeType || ''} ${asset.name || ''} ${asset.uri || ''}`.toLowerCase();
  const isPdf = sourceText.includes('application/pdf') || sourceText.includes('.pdf');
  return {
    id: idFactory(),
    ui_id: '',
    page_number: 0,
    file_path: asset.uri,
    source_type: isPdf ? 'pdf' : 'image',
    scanner_engine: 'import',
    content_type: asset.mimeType || (isPdf ? 'application/pdf' : 'image/jpeg'),
    original_name: asset.name || (isPdf ? 'paper.pdf' : 'paper.jpg'),
    file_size: asset.size || 0,
    is_blurry: false,
    sharpness_score: 100,
    captured_at: new Date().toISOString(),
  };
}

export async function createNativeScannedImagePage(
  imageUri: string,
  idFactory: () => string,
  index = 0,
): Promise<ScannedPage> {
  const source = new File(imageUri);
  const filename = `native_scan_${Date.now()}_${index}.jpg`;
  const dest = new File(Paths.document, filename);
  source.copy(dest);

  let verified = false;
  for (let i = 0; i < 10; i += 1) {
    if (dest.exists) {
      verified = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  if (!verified) {
    throw new Error('Native scanner image could not be saved.');
  }

  return {
    id: idFactory(),
    ui_id: '',
    page_number: 0,
    file_path: dest.uri,
    source_type: 'image',
    scanner_engine: 'native_document_scanner',
    content_type: 'image/jpeg',
    original_name: filename,
    original_file_path: dest.uri,
    crop_applied: true,
    filter_mode: 'original',
    file_size: dest.size || 0,
    is_blurry: false,
    sharpness_score: 100,
    captured_at: new Date().toISOString(),
  };
}
