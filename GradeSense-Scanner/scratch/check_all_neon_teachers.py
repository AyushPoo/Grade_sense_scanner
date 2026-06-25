import os
import asyncio
import dotenv
import asyncpg

dotenv.load_dotenv("backend/.env")

async def main():
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    conn = await asyncpg.connect(webapp_db_url)
    try:
        rows = await conn.fetch(
            """
            SELECT u.id, u.email,
                   COUNT(DISTINCT e.id) as exams_count,
                   COUNT(DISTINCT s.id) as submissions_count,
                   COUNT(DISTINCT CASE WHEN s.status IN ('ai_graded', 'graded', 'reviewed', 'published') THEN s.id END) as reviewed_count,
                   AVG(s.percentage) as avg_pct
            FROM users u
            LEFT JOIN exams e ON e.teacher_id = u.id AND COALESCE(e.status, '') <> 'deleted'
            LEFT JOIN submissions s ON s.exam_id = e.id AND COALESCE(s.status, '') <> 'deleted'
            GROUP BY u.id, u.email
            HAVING COUNT(DISTINCT e.id) > 0 OR COUNT(DISTINCT s.id) > 0
            """
        )
        print("=== NEON DB TEACHERS WITH EXAMS/SUBMISSIONS ===")
        for r in rows:
            print(dict(r))
            
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
