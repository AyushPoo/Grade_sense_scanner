import os
import subprocess
import time
import httpx
import logging
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

WHATSAPP_PORT = 8001
WHATSAPP_URL = f"http://127.0.0.1:{WHATSAPP_PORT}"

# Global reference to WhatsApp subprocess
whatsapp_process: Optional[subprocess.Popen] = None

def start_whatsapp_node_service():
    """Spawns the Node.js WhatsApp client process"""
    global whatsapp_process
    if whatsapp_process is not None:
        logger.info("WhatsApp Node service is already running.")
        return

    client_dir = Path(__file__).parent / "whatsapp_client"
    node_index = client_dir / "index.js"

    if not node_index.exists():
        logger.error(f"WhatsApp Node client file not found at: {node_index}")
        return

    logger.info(f"Starting WhatsApp Node service in {client_dir}...")
    try:
        # Start node service in background
        whatsapp_process = subprocess.Popen(
            ["node", "index.js"],
            cwd=str(client_dir),
            env={**os.environ, "WHATSAPP_PORT": str(WHATSAPP_PORT)},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        logger.info(f"WhatsApp Node service started with PID: {whatsapp_process.pid}")
    except Exception as e:
        logger.error(f"Failed to start WhatsApp Node process: {e}")

def stop_whatsapp_node_service():
    """Terminates the WhatsApp Node service"""
    global whatsapp_process
    if whatsapp_process is None:
        return

    logger.info("Stopping WhatsApp Node service...")
    try:
        whatsapp_process.terminate()
        whatsapp_process.wait(timeout=5)
        logger.info("WhatsApp Node service stopped.")
    except Exception as e:
        logger.error(f"Failed to stop WhatsApp Node process cleanly: {e}")
        try:
            whatsapp_process.kill()
            logger.info("WhatsApp Node service killed.")
        except Exception:
            pass
    whatsapp_process = None

async def query_whatsapp_status() -> str:
    """Queries the local Node service for connection status"""
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(f"{WHATSAPP_URL}/status", timeout=2.0)
            if res.status_code == 200:
                return res.json().get("status", "disconnected")
        except httpx.RequestError:
            pass
    return "disconnected"

async def get_whatsapp_qr() -> Dict[str, Any]:
    """Queries the local Node service for QR code"""
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(f"{WHATSAPP_URL}/qr", timeout=3.0)
            if res.status_code == 200:
                return res.json()
        except httpx.RequestError as e:
            logger.error(f"Failed to fetch QR code from WhatsApp service: {e}")
    return {"status": "disconnected", "error": "WhatsApp service offline"}

async def get_whatsapp_pair_code(phone: str) -> Dict[str, Any]:
    """Queries the local Node service to request phone pairing code"""
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(f"{WHATSAPP_URL}/pair-code", params={"phone": phone}, timeout=10.0)
            if res.status_code == 200:
                return res.json()
        except httpx.RequestError as e:
            logger.error(f"Failed to fetch pairing code from WhatsApp service: {e}")
    return {"status": "disconnected", "error": "WhatsApp service offline"}

async def send_whatsapp_message(phone: str, message: str) -> bool:
    """Sends a WhatsApp message via the local Node service"""
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(
                f"{WHATSAPP_URL}/send",
                json={"phone": phone, "message": message},
                timeout=10.0
            )
            if res.status_code == 200 and res.json().get("success"):
                return True
            else:
                logger.error(f"WhatsApp send failed: {res.text}")
        except httpx.RequestError as e:
            logger.error(f"Failed to connect to WhatsApp service for send: {e}")
    return False

async def logout_whatsapp() -> bool:
    """Logs out the WhatsApp session"""
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(f"{WHATSAPP_URL}/logout", timeout=5.0)
            if res.status_code == 200:
                return True
        except httpx.RequestError as e:
            logger.error(f"Failed to request logout: {e}")
    return False
