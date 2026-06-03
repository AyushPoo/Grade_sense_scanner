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
  return {
    id: idFactory(),
    ui_id: '',
    page_number: 0,
    file_path: asset.uri,
    source_type: 'pdf',
    content_type: asset.mimeType || 'application/pdf',
    original_name: asset.name || 'paper.pdf',
    file_size: asset.size || 0,
    is_blurry: false,
    sharpness_score: 100,
    captured_at: new Date().toISOString(),
  };
}
