import os
import io
import logging
import tempfile
import asyncio
import shutil
from pathlib import Path
from typing import List, Dict, Any, Optional
from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from pypdf import PdfWriter, PdfReader

logger = logging.getLogger(__name__)

def is_pdf_file(filename: str, content_type: str = "") -> bool:
    source = " ".join((filename or "", content_type or "")).lower()
    return "application/pdf" in source or ".pdf" in source

async def download_file_from_storage(
    storage_service: Any, 
    session_id: str, 
    filename: str, 
    temp_dir: str
) -> Optional[Path]:
    """Downloads a file from storage (Local or GCS) to a local temp folder"""
    local_temp_path = Path(temp_dir) / filename
    
    # Check cache first
    try:
        cache_file = Path(tempfile.gettempdir()) / "gradesense_cache" / session_id / filename
        if cache_file.exists():
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, shutil.copy, str(cache_file), str(local_temp_path))
            return local_temp_path
    except Exception as e:
        logger.warning(f"Error reading cache for PDF download: {e}")

    # Fallback to storage provider
    provider = os.environ.get("STORAGE_PROVIDER", "local").lower()
    if provider == "gcs":
        try:
            blob_path = f"{session_id}/{filename}"
            # GcsStorageService bucket is accessible on storage_service.bucket
            blob = storage_service.bucket.blob(blob_path)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, blob.download_to_filename, str(local_temp_path))
            return local_temp_path
        except Exception as e:
            logger.error(f"Failed to download GCS file {filename}: {e}")
            return None
    else:
        # Local storage
        local_src_path = storage_service.get_file_path(session_id, filename)
        if local_src_path and local_src_path.exists():
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, shutil.copy, local_src_path, local_temp_path)
            return local_temp_path
        return None

def generate_feedback_page(
    student_name: str,
    roll_number: str,
    exam_name: str,
    total_score: float,
    total_marks: float,
    teacher_feedback: str,
    questions: List[Dict[str, Any]],
    output_path: Path
) -> None:
    """Uses ReportLab to draw a beautifully formatted feedback page saved to output_path"""
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=letter,
        rightMargin=54,
        leftMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    styles = getSampleStyleSheet()
    
    story = []
    
    # Header title
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#1A365D'),
        spaceAfter=15
    )
    story.append(Paragraph("GradeSense Graded Report", title_style))
    story.append(Spacer(1, 10))
    
    # Metadata info card layout
    score_pct = (total_score / total_marks * 100) if total_marks > 0 else 0.0
    meta_data = [
        [
            Paragraph(f"<b>Student Name:</b> {student_name}", styles['Normal']), 
            Paragraph(f"<b>Exam:</b> {exam_name}", styles['Normal'])
        ],
        [
            Paragraph(f"<b>Roll Number:</b> {roll_number or 'N/A'}", styles['Normal']), 
            Paragraph(f"<b>Score:</b> {total_score} / {total_marks} ({score_pct:.1f}%)", styles['Normal'])
        ]
    ]
    meta_table = Table(meta_data, colWidths=[250, 250])
    meta_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LINEBELOW', (0,-1), (-1,-1), 1, colors.HexColor('#E2E8F0')),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 15))
    
    # Overall Feedback
    if teacher_feedback:
        story.append(Paragraph("<b>Overall Teacher Feedback:</b>", styles['Heading3']))
        story.append(Paragraph(teacher_feedback, styles['Normal']))
        story.append(Spacer(1, 15))
        
    # Scores breakdown table header
    story.append(Paragraph("<b>Question-by-Question Breakdown:</b>", styles['Heading3']))
    story.append(Spacer(1, 5))
    
    score_table_data = [
        ["Q#", "Obtained", "Max", "Feedback & Corrections"]
    ]
    
    # Format and wrap contents for each question score
    cell_style = ParagraphStyle('CellWrap', parent=styles['Normal'], fontSize=9, leading=11)
    header_style = ParagraphStyle('HeadWrap', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=10, textColor=colors.whitesmoke)
    
    # Sort questions by question_number (parsing integer if possible)
    def q_sort_key(q):
        num_str = str(q.get("question_number", ""))
        try:
            return int(num_str.replace("Q", "").replace("q", "").strip())
        except ValueError:
            return num_str
            
    sorted_qs = sorted(questions, key=q_sort_key)
    
    for q in sorted_qs:
        q_num = str(q.get("question_number", ""))
        ob_m = f"{q.get('obtained_marks', 0.0):.1f}"
        max_m = f"{q.get('max_marks', 0.0):.1f}"
        
        # Combine AI feedback and Teacher corrections if any
        ai_feed = q.get("ai_feedback") or ""
        teach_corr = q.get("teacher_correction") or ""
        feedback_parts = []
        if ai_feed.strip():
            feedback_parts.append(f"<b>AI Comment:</b> {ai_feed.strip()}")
        if teach_corr.strip():
            feedback_parts.append(f"<b>Teacher Correction:</b> {teach_corr.strip()}")
        feedback_text = "<br/><br/>".join(feedback_parts) if feedback_parts else "No feedback recorded."
        
        score_table_data.append([
            Paragraph(q_num, cell_style),
            Paragraph(ob_m, cell_style),
            Paragraph(max_m, cell_style),
            Paragraph(feedback_text, cell_style)
        ])
        
    score_table = Table(score_table_data, colWidths=[40, 60, 50, 350])
    score_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1A365D')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E0')),
    ]))
    
    story.append(score_table)
    doc.build(story)

async def compile_student_report_pdf(
    storage_service: Any,
    session_id: str,
    files_metadata: List[Dict[str, Any]],
    student_name: str,
    roll_number: str,
    exam_name: str,
    total_score: float,
    total_marks: float,
    teacher_feedback: str,
    questions: List[Dict[str, Any]],
    output_path: Path
) -> bool:
    """
    Stitches scanned images/PDFs together and appends a ReportLab feedback page.
    Saves the final PDF to output_path.
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        writer = PdfWriter()
        
        # 1. Download and append student scan pages
        sorted_files = sorted(files_metadata, key=lambda x: x.get("id", ""))
        has_pages = False
        
        for f_meta in sorted_files:
            # Prefer annotation key if available
            gcs_key = f_meta.get("annotation_gcs_key") or f_meta.get("gcs_key")
            if not gcs_key:
                continue
            
            filename = gcs_key.split("/")[-1]
            local_path = await download_file_from_storage(storage_service, session_id, filename, temp_dir)
            if not local_path or not local_path.exists():
                logger.warning(f"Could not load scan file for compile: {filename}")
                continue
                
            content_type = f_meta.get("content_type", "")
            if is_pdf_file(filename, content_type):
                # Append PDF pages directly
                try:
                    reader = PdfReader(local_path)
                    for page in reader.pages:
                        writer.add_page(page)
                    has_pages = True
                except Exception as ex:
                    logger.error(f"Error reading PDF pages from {filename}: {ex}")
            else:
                # Convert image to single-page PDF
                try:
                    img = Image.open(local_path)
                    if img.mode != 'RGB':
                        img = img.convert('RGB')
                        
                    # Resize if extremely large to prevent OOM
                    max_dim = 1600
                    if max(img.width, img.height) > max_dim:
                        ratio = max_dim / max(img.width, img.height)
                        img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.Resampling.LANCZOS)
                        
                    # Save image page to a temp PDF file
                    img_pdf_path = Path(temp_dir) / f"{filename}.pdf"
                    
                    loop = asyncio.get_event_loop()
                    def save_img_as_pdf():
                        img.save(img_pdf_path, "PDF")
                    await loop.run_in_executor(None, save_img_as_pdf)
                    img.close()
                    
                    if img_pdf_path.exists():
                        reader = PdfReader(img_pdf_path)
                        writer.add_page(reader.pages[0])
                        has_pages = True
                except Exception as ex:
                    logger.error(f"Error converting image to PDF page: {ex}")
                    
        # 2. Draw the ReportLab feedback sheet
        feedback_pdf_path = Path(temp_dir) / "feedback_sheet.pdf"
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, 
                generate_feedback_page, 
                student_name, 
                roll_number, 
                exam_name, 
                total_score, 
                total_marks, 
                teacher_feedback, 
                questions, 
                feedback_pdf_path
            )
        except Exception as e:
            logger.error(f"Error drawing ReportLab feedback sheet: {e}")
            # If drawing feedback fails, write standard plain page if we have scanned pages, or return false
            if not has_pages:
                return False
                
        # 3. Append the feedback sheet to the writer
        if feedback_pdf_path.exists():
            try:
                reader = PdfReader(feedback_pdf_path)
                for page in reader.pages:
                    writer.add_page(page)
            except Exception as e:
                logger.error(f"Failed to append feedback sheet: {e}")
                
        # 4. Save final stitched file
        try:
            loop = asyncio.get_event_loop()
            def write_file():
                with open(output_path, "wb") as f:
                    writer.write(f)
            await loop.run_in_executor(None, write_file)
            return True
        except Exception as e:
            logger.error(f"Failed to write final report PDF: {e}")
            return False
