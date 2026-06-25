import os
import asyncio
import dotenv
from motor.motor_asyncio import AsyncIOMotorClient

dotenv.load_dotenv("backend/.env")

async def main():
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "gradesense_db")
    print(f"Connecting to MongoDB: {mongo_url[:50]}...")
    
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    
    users = [
        {"email": "ayushpoojary1@gmail.com", "id": "usr_c3cmQvUlWCULDT"},
        {"email": "ayush@gradesense.in", "id": "usr_Yt-1F9g1fyYkH_"},
    ]
    
    for u in users:
        print(f"\n=== SCAN SESSIONS FOR {u['email']} ({u['id']}) ===")
        sessions = await db.scan_sessions.find({"user_id": u["id"]}).to_list(100)
        print(f"Total scan sessions: {len(sessions)}")
        for s in sessions[:5]:
            # Print keys and some stats
            print({
                "session_id": s.get("session_id"),
                "status": s.get("status"),
                "session_name": s.get("session_name"),
                "submission_count": s.get("submission_count"),
                "graded_count": s.get("graded_submission_count"),
                "avg_percentage": s.get("average_percentage"),
                "exam_id": s.get("exam_id"),
            })

if __name__ == "__main__":
    asyncio.run(main())
