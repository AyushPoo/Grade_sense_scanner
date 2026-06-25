import os
import asyncio
import dotenv
import asyncpg

dotenv.load_dotenv("backend/.env")

async def main():
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    conn = await asyncpg.connect(webapp_db_url)
    try:
        teacher_id = 'usr_Yt-1F9g1fyYkH_'
        
        # 1. Print all batches for this teacher
        batches = await conn.fetch("SELECT id, name, status FROM batches WHERE teacher_id = $1", teacher_id)
        print("\n=== BATCHES ===")
        for b in batches:
            print(dict(b))
            
        # 2. Print all exams for this teacher
        exams = await conn.fetch("SELECT id, name, status, batch_id, subject_id FROM exams WHERE teacher_id = $1", teacher_id)
        print("\n=== EXAMS ===")
        for e in exams:
            print(dict(e))
            
        # 3. Check for any submissions for this teacher's exams
        submissions_count = await conn.fetchval(
            "SELECT COUNT(*) FROM submissions s JOIN exams e ON e.id = s.exam_id WHERE e.teacher_id = $1", teacher_id
        )
        print(f"\nSubmissions count: {submissions_count}")
        
        # 4. Check why subject performance query returned nothing or what it returned
        subject_rows = await conn.fetch(
            '''
            SELECT COALESCE(subj.name, 'Unassigned') AS subject_name,
                   COUNT(DISTINCT e.id) AS exams_count,
                   AVG(s.percentage) AS average_percentage
            FROM exams e
            LEFT JOIN batches b ON b.id = e.batch_id
            LEFT JOIN subjects subj ON subj.id = e.subject_id
            LEFT JOIN submissions s ON s.exam_id = e.id
            WHERE e.teacher_id = $1
              AND COALESCE(e.status, '') <> 'deleted'
              AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
            GROUP BY COALESCE(subj.name, 'Unassigned')
            ORDER BY subject_name ASC
            ''',
            teacher_id
        )
        print("\n=== SUBJECT PERFORMANCE QUERY RESULTS ===")
        for r in subject_rows:
            print(dict(r))
            
        # 5. Top students query results
        top_student_rows = await conn.fetch(
            '''
            SELECT s.student_name, s.student_roll_number, e.name AS exam_name,
                   s.total_score, s.total_marks, s.percentage
            FROM submissions s
            JOIN exams e ON e.id = s.exam_id
            LEFT JOIN batches b ON b.id = e.batch_id
            WHERE e.teacher_id = $1
              AND COALESCE(e.status, '') <> 'deleted'
              AND COALESCE(b.status, 'active') NOT IN ('archived', 'deleted')
            ORDER BY s.percentage DESC NULLS LAST
            LIMIT 10
            ''',
            teacher_id
        )
        print("\n=== TOP STUDENTS QUERY RESULTS ===")
        for r in top_student_rows:
            print(dict(r))
            
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
