"""
Azure PostgreSQL Flexible Server — connectivity spike.

Usage:
    AZURE_DATABASE_URL="postgresql://<user>:<password>@<host>:5432/postgres?sslmode=require" \
        python backend/scripts/test_azure_pg_connection.py

The script:
  1. Connects to the Azure PG instance
  2. Creates a temporary test table (idempotent)
  3. Writes a row
  4. Reads it back and asserts correctness
  5. Deletes the row and drops the table
  6. Exits 0 on success, 1 on any failure
"""

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

try:
    import asyncpg
except ImportError:
    print("ERROR: asyncpg not installed. Run: pip install asyncpg")
    sys.exit(1)


async def main() -> None:
    url = os.environ.get("AZURE_DATABASE_URL")
    if not url:
        print("ERROR: AZURE_DATABASE_URL environment variable is not set.")
        print(
            "  Example: postgresql://<user>:<password>@<host>:5432/postgres?sslmode=require"
        )
        sys.exit(1)

    # Print host only — keep credentials out of terminal output
    host_part = url.split("@")[-1] if "@" in url else url
    print(f"→ Connecting to: {host_part}")

    try:
        conn = await asyncpg.connect(url)
    except Exception as exc:
        print(f"✗ Connection failed: {exc}")
        print(
            "\nCommon causes:\n"
            "  • Dev machine IP not added to Azure PG firewall rules\n"
            "  • Wrong username/password\n"
            "  • Wrong database name or host\n"
            "  • SSL required — ensure '?sslmode=require' is in the URL"
        )
        sys.exit(1)

    print("✓ Connected")

    try:
        # ── 1. Create a temporary test table ──────────────────────────────────
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS _connectivity_test (
                id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                message     TEXT        NOT NULL,
                created_at  TIMESTAMPTZ DEFAULT now()
            )
            """
        )
        print("✓ Test table ready (_connectivity_test)")

        # ── 2. Write a row ─────────────────────────────────────────────────────
        test_id = uuid.uuid4()
        test_message = (
            f"Hello from dev machine at {datetime.now(timezone.utc).isoformat()}"
        )
        await conn.execute(
            "INSERT INTO _connectivity_test (id, message) VALUES ($1, $2)",
            test_id,
            test_message,
        )
        print(f"✓ Wrote  row  id={test_id}")

        # ── 3. Read it back ────────────────────────────────────────────────────
        row = await conn.fetchrow(
            "SELECT id, message, created_at FROM _connectivity_test WHERE id = $1",
            test_id,
        )
        if row is None:
            print("✗ Read-back failed: row not found")
            sys.exit(1)
        if row["message"] != test_message:
            print(f"✗ Data mismatch!\n  expected: {test_message}\n  got:      {row['message']}")
            sys.exit(1)
        print(f"✓ Read  back id={row['id']}  created_at={row['created_at']}")

        # ── 4. Cleanup ─────────────────────────────────────────────────────────
        await conn.execute("DELETE FROM _connectivity_test WHERE id = $1", test_id)
        await conn.execute("DROP TABLE IF EXISTS _connectivity_test")
        print("✓ Cleaned up (row deleted, table dropped)")

    finally:
        await conn.close()

    print("\n✅  Azure PostgreSQL connectivity confirmed — write and read-back successful.")


if __name__ == "__main__":
    asyncio.run(main())
