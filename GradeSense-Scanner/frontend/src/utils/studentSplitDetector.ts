export interface TextBlockDiagnostic {
  text: string;
  boundingBox?: { left: number; top: number; right: number; bottom: number };
  cornerPoints?: Array<{ x: number; y: number }>;
}

/**
 * Heuristically detects if a scanned page represents the first page of a new student booklet.
 * It checks the top 35% of the page for printed template keywords like Name, Roll No, Subject, etc.
 * Requiring at least 2 unique keywords prevents false triggers on handwritten body text.
 */
export function detectStudentHeaderTransition(
  blocks: TextBlockDiagnostic[],
  imageDimensions: { width: number; height: number }
): boolean {
  if (!blocks || blocks.length === 0) return false;

  const topLimit = imageDimensions.height * 0.35; // Top 35% of the page
  const matchedKeywords = new Set<string>();

  for (const block of blocks) {
    if (!block.boundingBox || !block.text) continue;

    // Check if the block is within the top region of the page
    if (block.boundingBox.top > topLimit) continue;

    const cleanText = block.text.toLowerCase();

    // Check for Student Name / Name
    if (cleanText.includes("student's name") || cleanText.includes("student name") || cleanText.includes("name")) {
      matchedKeywords.add("name");
    }
    // Check for Roll No. / Roll Number
    if (cleanText.includes("roll no") || cleanText.includes("rollno") || cleanText.includes("roll number") || cleanText.includes("roll")) {
      matchedKeywords.add("roll");
    }
    // Check for Class
    if (cleanText.includes("class")) {
      matchedKeywords.add("class");
    }
    // Check for Subject
    if (cleanText.includes("subject")) {
      matchedKeywords.add("subject");
    }
    // Check for Date
    if (cleanText.includes("date")) {
      matchedKeywords.add("date");
    }
    // Check for Total Marks
    if (cleanText.includes("total marks") || cleanText.includes("marks obtained")) {
      matchedKeywords.add("marks");
    }
  }

  // Require at least 2 unique template keywords to trigger a student split
  const isMatch = matchedKeywords.size >= 2;
  
  if (isMatch && __DEV__) {
    console.log(`[OCR-AUTO-SPLIT] Student header detected! Matched keywords:`, Array.from(matchedKeywords));
  }

  return isMatch;
}
