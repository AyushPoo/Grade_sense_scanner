import os
import asyncio
import dotenv
import asyncpg

dotenv.load_dotenv("backend/.env")

async def main():
    webapp_db_url = os.environ.get("WEBAPP_DB_URL")
    print(f"Connecting to Neon DB: {webapp_db_url[:50]}...")
    
    conn = await asyncpg.connect(webapp_db_url)
    try:
        # Get users
        users = await conn.fetch("SELECT id, email, role FROM users LIMIT 10")
        print("\n=== USERS ===")
        for u in users:
            print(dict(u))
            
        # Find user ID for ayushpoojary1@gmail.com
        teacher_id = None
        for u in users:
            if u["email"] == "ayushpoojary1@gmail.com":
                teacher_id = u["id"]
                break
        
        if not teacher_id:
            # Let's search all users
            all_users = await conn.fetch("SELECT id, email FROM users")
            print("\n=== ALL USERS ===")
            for u in all_users:
                print(dict(u))
                if u["email"] == "ayushpoojary1@gmail.com":
                    teacher_id = u["id"]
            
        print(f"\nTarget Teacher Email: ayushpoojary1@gmail.com, ID: {teacher_id}")
        
        if teacher_id:
            # Check batches
            batches = await conn.fetch("SELECT id, name, status, teacher_id FROM batches WHERE teacher_id = $1", teacher_id)
            print(f"\n=== BATCHES ({len(batches)}) ===")
            for b in batches:
                print(dict(b))
                
            # Check exams
            exams = await conn.fetch("SELECT id, name, status, batch_id, subject_id, teacher_id FROM exams WHERE teacher_id = $1", teacher_id)
            print(f"\n=== EXAMS ({len(exams)}) ===")
            for e in exams:
                print(dict(e))
                
            # Check submissions
            submissions = await conn.fetch(
                """
                SELECT s.id, s.exam_id, s.student_name, s.student_roll_number, s.percentage, s.status
                FROM submissions s
                JOIN exams e ON e.id = s.exam_id
                WHERE e.teacher_id = $1
                """, 
                teacher_id
            )
            print(f"\n=== SUBMISSIONS ({len(submissions)}) ===")
            for s in submissions[:10]:
                print(dict(s))
            if len(submissions) > 10:
                print(f"... and {len(submissions) - 10} more")
                
            # Check subjects
            subjects = await conn.fetch("SELECT id, name FROM subjects")
            print(f"\n=== SUBJECTS ({len(subjects)}) ===")
            for sub in subjects:
                print(dict(sub))
                
            # Run the analytics query to see actual rows
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
            print("\n=== SUBJECT PERFORMANCE ROWS ===")
            for r in subject_rows:
                print(dict(r))
                
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
            print("\n=== TOP STUDENTS ROWS ===")
            for r in top_student_rows:
                print(dict(r))
                
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
