import type { ScannedPage } from '../types';

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
    content_type: asset.mimeType || (isPdf ? 'application/pdf' : 'image/jpeg'),
    original_name: asset.name || (isPdf ? 'paper.pdf' : 'paper.jpg'),
    file_size: asset.size || 0,
    is_blurry: false,
    sharpness_score: 100,
    captured_at: new Date().toISOString(),
  };
}
