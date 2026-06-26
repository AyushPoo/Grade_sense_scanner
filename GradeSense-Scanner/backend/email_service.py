import logging
import smtplib
import asyncio
from pathlib import Path
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

def send_smtp_email_sync(
    smtp_host: str,
    smtp_port: int,
    username: str,
    password: str,
    to_email: str,
    subject: str,
    body: str,
    pdf_path: Path,
    pdf_filename: str
) -> None:
    """Synchronous sending helper called within a threadpool"""
    msg = MIMEMultipart()
    msg['From'] = username
    msg['To'] = to_email
    msg['Subject'] = subject
    
    # We automatically add the sender in the BCC header for their own record
    msg['Bcc'] = username
    
    msg.attach(MIMEText(body, 'html'))
    
    # Attach PDF report
    with open(pdf_path, 'rb') as f:
        attachment = MIMEApplication(f.read(), _subtype="pdf")
        attachment.add_header('Content-Disposition', 'attachment', filename=pdf_filename)
        msg.attach(attachment)
        
    recipients = [to_email, username] # Sending to both the student and the teacher (for BCC)
    
    # Determine SSL/TLS vs STARTTLS based on port
    if smtp_port == 465:
        # SSL
        server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15)
    else:
        # STARTTLS
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=15)
        server.ehlo()
        server.starttls()
        server.ehlo()
        
    try:
        server.login(username, password)
        server.sendmail(username, recipients, msg.as_string())
        logger.info(f"Successfully sent report email to {to_email} and BCC to {username}")
    finally:
        server.quit()

async def send_smtp_email_async(
    smtp_host: str,
    smtp_port: int,
    username: str,
    password: str,
    to_email: str,
    subject: str,
    body: str,
    pdf_path: Path,
    pdf_filename: str
) -> None:
    """Asynchronous wrapper for SMTP sending"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        send_smtp_email_sync,
        smtp_host,
        smtp_port,
        username,
        password,
        to_email,
        subject,
        body,
        pdf_path,
        pdf_filename
    )
