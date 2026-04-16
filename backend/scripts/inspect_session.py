import asyncio
import os
import json
from dotenv import load_dotenv
import asyncpg

load_dotenv()

DB_USER = os.getenv("POSTGRES_USER", "postgres.summarization-tool")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "***REMOVED***")
DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_PORT = os.getenv("POSTGRES_PORT", "6543")
DB_NAME = os.getenv("POSTGRES_DB", "postgres")


async def inspect():
    try:
        conn = await asyncpg.connect(
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            statement_cache_size=0,
        )

        # Get most recent session
        row = await conn.fetchrow("""
            SELECT id, name, configuration, created_at 
            FROM public.sessions 
            ORDER BY updated_at DESC 
            LIMIT 1
        """)

        if not row:
            print("No sessions found.")
            return

        session_id = str(row["id"])
        config = json.loads(row["configuration"])
        print(f"Session ID: {session_id}")
        print(f"Name: {row['name']}")
        print(f"Created: {row['created_at']}")

        print("\n--- Configuration Entities ---")
        # Print summary prompt and paragraph system prompt
        print(f"Summary Prompt (User): {config.get('summary_prompt', 'N/A')}")
        print(
            f"Paragraph System Prompt: {config.get('paragraph_system_prompt', 'N/A')}"
        )

        print("\n--- Extraction Results ---")
        rows = await conn.fetch(
            """
            SELECT entity_name, model_id, length(extracted_text) as text_len, status
            FROM public.extraction_results 
            WHERE session_id = $1
            ORDER BY extracted_at DESC
        """,
            session_id,
        )

        summary_found = False
        for r in rows:
            print(
                f"- Entity: '{r['entity_name']}', Model: '{r['model_id']}', Len: {r['text_len']}, Status: {r['status']}"
            )
            if r["entity_name"] == "__paragraph_summary__":
                summary_found = True
                print(f"  >>> FOUND PARAGRAPH SUMMARY! <<<")

        if not summary_found:
            print("\nWARNING: __paragraph_summary__ entity NOT found in this session.")

        await conn.close()

    except Exception as e:
        print(f"Database error: {e}")


if __name__ == "__main__":
    asyncio.run(inspect())
