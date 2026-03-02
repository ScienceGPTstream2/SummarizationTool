#!/usr/bin/env python3
"""
Clear SummarizationTool database and filesystem cache for docling benchmarking.

Deletes all sessions, documents, and extraction/evaluation results from the DB,
and removes processed/ subdirectories from files/global/{hash}/ so docling
will re-run fresh conversions on the next upload.

Preserves:
  - prompt_templates where scope = 'global'
  - user_prompt_templates where is_default = true (or NULL)
  - groups, user_groups, login_history, user_preferences
  - original.pdf files (so documents don't need re-uploading)

Usage (from repo root):
    python backend/scripts/clear_for_benchmarking.py --dry-run
    python backend/scripts/clear_for_benchmarking.py --yes
    python backend/scripts/clear_for_benchmarking.py --db-only --yes
    python backend/scripts/clear_for_benchmarking.py --fs-only
    python backend/scripts/clear_for_benchmarking.py --fs-only --processor docling
    python backend/scripts/clear_for_benchmarking.py --include-legacy --yes
"""

import argparse
import os
import shutil
import sys
from pathlib import Path

# ── Bootstrap: add backend to sys.path and load secrets ───────────────────────
ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

_secrets_path = BACKEND / "core" / "secrets.toml"

# ── Path constants ─────────────────────────────────────────────────────────────
FILES_DIR = BACKEND / "files"
GLOBAL_FILES_DIR = FILES_DIR / "global"
USERS_FILES_DIR = FILES_DIR / "users"
OUTPUT_DIR = BACKEND / "output"
UPLOADS_DIR = BACKEND / "uploads"

# A UUID that will never match a real row — used to satisfy PostgREST's
# requirement that DELETE operations must have at least one filter.
NEVER_UUID = "00000000-0000-0000-0000-000000000000"


# ── Helpers ────────────────────────────────────────────────────────────────────


def _dir_size(path: Path) -> int:
    """Recursively sum file sizes under a directory."""
    total = 0
    for f in path.rglob("*"):
        if f.is_file():
            try:
                total += f.stat().st_size
            except OSError:
                pass
    return total


def _human_bytes(n: int) -> str:
    """Format bytes as a human-readable string."""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _load_supabase_secrets() -> tuple[str, str]:
    """
    Read secrets.toml and return (supabase_url, service_role_key).
    Also sets the env vars the way llama_api_benchmark.py does so that
    any imported backend services work if needed.
    """
    try:
        import toml  # type: ignore
    except ImportError:
        print("[ERROR] 'toml' package required. Run:  pip install toml")
        sys.exit(1)

    if not _secrets_path.exists():
        print(f"[ERROR] secrets.toml not found at {_secrets_path}")
        sys.exit(1)

    try:
        cfg = toml.load(_secrets_path)
    except Exception as e:
        print(f"[ERROR] Failed to parse secrets.toml: {e}")
        sys.exit(1)

    # Set all secrets as env vars (mirrors llama_api_benchmark.py)
    for section, kv in cfg.items():
        for k, v in kv.items():
            os.environ.setdefault(f"{section.upper()}_{k.upper()}", str(v))
    print(f"[Setup] Loaded secrets from {_secrets_path}")

    supabase_section = cfg.get("supabase", {})
    url = supabase_section.get("url", "")
    key = supabase_section.get("service_role_key", "")

    if not url or not key:
        print(
            "[ERROR] Missing supabase.url or supabase.service_role_key in secrets.toml"
        )
        sys.exit(1)

    return url, key


# ── Argument parsing ───────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clear DB and filesystem cache for docling benchmarking.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be deleted without making any changes.",
    )
    parser.add_argument(
        "--yes",
        "-y",
        action="store_true",
        help="Skip the interactive confirmation prompt.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--db-only",
        action="store_true",
        help="Clear database only; leave the filesystem untouched.",
    )
    mode.add_argument(
        "--fs-only",
        action="store_true",
        help="Clear filesystem cache only; leave the database untouched.",
    )
    parser.add_argument(
        "--processor",
        choices=["docling", "azure_doc_intelligence"],
        default=None,
        help=(
            "Only clear the cache for one processor. "
            "Default: clears both docling and azure_doc_intelligence."
        ),
    )
    parser.add_argument(
        "--include-legacy",
        action="store_true",
        help="Also clear backend/output/ and backend/uploads/ (legacy directories).",
    )
    return parser.parse_args()


# ── Database operations ────────────────────────────────────────────────────────


def _db_count(client, table: str, extra_filter=None) -> int:
    """Return the number of rows that the delete step would remove."""
    query = client.table(table).select("id", count="exact").neq("id", NEVER_UUID)
    if extra_filter:
        method, col, val = extra_filter
        query = getattr(query, method)(col, val)
    result = query.execute()
    return result.count or 0


def _db_delete(client, table: str, extra_filter=None, errors: list = None) -> int:
    """
    Delete rows from table. extra_filter is (method_name, column, value).
    Returns number of rows deleted (may be 0 if the API doesn't echo counts).
    """
    try:
        query = client.table(table).delete().neq("id", NEVER_UUID)
        if extra_filter:
            method, col, val = extra_filter
            query = getattr(query, method)(col, val)
        result = query.execute()
        return len(result.data) if result.data else 0
    except Exception as e:
        msg = f"[FAIL] {table}: {e}"
        print(f"  {msg}")
        if errors is not None:
            errors.append(msg)
        return 0


def dry_run_db(client) -> dict:
    """Print row counts for all tables that would be affected."""
    print("\n--- DATABASE (dry-run counts) ---")
    stats = {}

    tables = [
        ("evaluation_results", None, "all rows"),
        ("extraction_results", None, "all rows"),
        ("documents", None, "all rows"),
        ("sessions", None, "all rows"),
        ("user_prompt_templates", ("eq", "is_default", False), "is_default = false"),
        (
            "prompt_templates",
            ("in_", "scope", ["user", "group"]),
            "scope in (user, group)",
        ),
    ]

    for table, filt, desc in tables:
        count = _db_count(client, table, filt)
        label = f"  {table}"
        print(f"{label:<40} {count:>6} rows  [{desc}]")
        stats[table] = count

    # Also show what will be preserved in template tables
    kept_upt = _db_count(client, "user_prompt_templates", ("neq", "is_default", False))
    kept_pt = _db_count(client, "prompt_templates", ("eq", "scope", "global"))
    print(f"\n  (preserved) user_prompt_templates (is_default=true/null): {kept_upt}")
    print(f"  (preserved) prompt_templates (scope=global):              {kept_pt}")

    return stats


def execute_db_clear(client, errors: list) -> dict:
    """Execute all database deletions and return counts."""
    print("\n--- DATABASE ---")
    stats = {}

    # Step 1-4: leaf → root (explicit order handles any orphaned rows)
    for table in ["evaluation_results", "extraction_results", "documents", "sessions"]:
        n = _db_delete(client, table, errors=errors)
        print(f"  [OK] {table:<36} {n:>6} rows deleted")
        stats[table] = n

    # Step 5: user_prompt_templates — delete only non-default rows
    n = _db_delete(
        client, "user_prompt_templates", ("eq", "is_default", False), errors=errors
    )
    print(f"  [OK] user_prompt_templates (non-default) {n:>6} rows deleted")
    stats["user_prompt_templates"] = n

    # Step 6: prompt_templates — delete user- and group-scoped, preserve global
    # template_versions and template_permissions cascade automatically
    n = _db_delete(
        client, "prompt_templates", ("in_", "scope", ["user", "group"]), errors=errors
    )
    print(f"  [OK] prompt_templates (user/group scope) {n:>6} rows deleted")
    stats["prompt_templates"] = n

    return stats


# ── Filesystem operations ──────────────────────────────────────────────────────


def clear_global_processed(
    dry_run: bool, processor: str | None, errors: list
) -> tuple[int, int]:
    """
    Delete processed/ subdirs under files/global/{hash}/.

    If processor is None: deletes the entire processed/ directory.
    If processor is 'docling' or 'azure_doc_intelligence': deletes only that subdir.

    original.pdf and metadata.json are always preserved.

    Returns (dirs_deleted, bytes_freed).
    """
    print("\n--- FILESYSTEM: files/global/{hash}/processed/ ---")

    if not GLOBAL_FILES_DIR.exists():
        print(f"  [SKIP] {GLOBAL_FILES_DIR} does not exist")
        return 0, 0

    dirs_deleted = 0
    bytes_freed = 0

    for hash_dir in sorted(GLOBAL_FILES_DIR.iterdir()):
        if not hash_dir.is_dir():
            continue

        target = (
            hash_dir / "processed"
            if processor is None
            else hash_dir / "processed" / processor
        )

        if not target.exists():
            continue

        size = _dir_size(target)

        if dry_run:
            print(
                f"  [DRY-RUN] would delete  {target.relative_to(BACKEND)}  ({_human_bytes(size)})"
            )
            dirs_deleted += 1
            bytes_freed += size
        else:
            try:
                shutil.rmtree(target)
                print(
                    f"  [DELETED]              {target.relative_to(BACKEND)}  ({_human_bytes(size)})"
                )
                dirs_deleted += 1
                bytes_freed += size
            except Exception as e:
                msg = f"[FAIL] {target}: {e}"
                print(f"  {msg}")
                errors.append(msg)

    if dirs_deleted == 0:
        print("  (nothing to delete)")

    return dirs_deleted, bytes_freed


def clear_directory_contents(
    label: str, path: Path, dry_run: bool, errors: list
) -> tuple[int, int]:
    """
    Delete all children of path (keeping the directory itself).
    Returns (items_deleted, bytes_freed).
    """
    print(f"\n--- FILESYSTEM: {label} ---")

    if not path.exists():
        print(f"  [SKIP] {path} does not exist")
        return 0, 0

    items = list(path.iterdir())
    if not items:
        print("  (nothing to delete)")
        return 0, 0

    total_size = _dir_size(path)

    if dry_run:
        print(
            f"  [DRY-RUN] would delete {len(items)} item(s) under {path.relative_to(BACKEND)}  ({_human_bytes(total_size)})"
        )
        return len(items), total_size

    deleted = 0
    freed = 0
    for child in items:
        try:
            size = _dir_size(child) if child.is_dir() else child.stat().st_size
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
            deleted += 1
            freed += size
            print(f"  [DELETED] {child.relative_to(BACKEND)}  ({_human_bytes(size)})")
        except Exception as e:
            msg = f"[FAIL] {child}: {e}"
            print(f"  {msg}")
            errors.append(msg)

    return deleted, freed


# ── Confirmation ───────────────────────────────────────────────────────────────


def confirm_proceed(
    dry_run: bool,
    yes: bool,
    clear_db: bool,
    clear_fs: bool,
    processor: str | None,
    include_legacy: bool,
) -> bool:
    if dry_run:
        print(
            "\n[DRY-RUN MODE] No changes will be made — showing what would be deleted.\n"
        )
        return True

    print("\n" + "=" * 62)
    print("  BENCHMARK CLEAR — WHAT WILL HAPPEN")
    print("=" * 62)
    if clear_db:
        print("  DATABASE:")
        print("    DELETE  evaluation_results  (all rows)")
        print("    DELETE  extraction_results  (all rows)")
        print("    DELETE  documents           (all rows)")
        print("    DELETE  sessions            (all rows)")
        print("    DELETE  user_prompt_templates where is_default=false")
        print("    DELETE  prompt_templates    where scope in (user, group)")
        print("    KEEP    prompt_templates    where scope = global")
        print("    KEEP    groups, user_groups, login_history, user_preferences")
    if clear_fs:
        proc_label = (
            f"only '{processor}'"
            if processor
            else "both docling + azure_doc_intelligence"
        )
        print(f"  FILESYSTEM:")
        print(f"    DELETE  files/global/*/processed/ cache  [{proc_label}]")
        print(f"    KEEP    files/global/*/original.pdf  (originals preserved)")
        print(f"    DELETE  files/users/  (user extraction outputs)")
        if include_legacy:
            print(f"    DELETE  backend/output/  (legacy)")
            print(f"    DELETE  backend/uploads/ (legacy)")
    print("=" * 62)

    if yes:
        print("  [--yes] Skipping confirmation — proceeding.\n")
        return True

    try:
        response = (
            input("\n  Type 'yes' to proceed, anything else to abort: ").strip().lower()
        )
    except (EOFError, KeyboardInterrupt):
        print("\n[ABORTED]")
        return False

    return response == "yes"


# ── Summary ────────────────────────────────────────────────────────────────────


def print_summary(db_stats: dict, fs_stats: dict, errors: list, dry_run: bool) -> None:
    tag = "[DRY-RUN] " if dry_run else ""
    print("\n" + "=" * 62)
    print(f"  {tag}CLEAR SUMMARY")
    print("=" * 62)

    if db_stats:
        print("  DATABASE:")
        for table, n in db_stats.items():
            print(f"    {table:<38} {n:>6} rows")

    if fs_stats:
        print("  FILESYSTEM:")
        for label, (count, freed) in fs_stats.items():
            print(f"    {label:<38} {count:>6} items  {_human_bytes(freed):>10} freed")

    total_freed = sum(freed for _, freed in fs_stats.values()) if fs_stats else 0
    if total_freed:
        print(f"\n  Total space freed: {_human_bytes(total_freed)}")

    if errors:
        print(f"\n  ERRORS ({len(errors)}):")
        for e in errors:
            print(f"    {e}")
    else:
        print(f"\n  ERRORS: 0")
    print("=" * 62)


# ── Main ───────────────────────────────────────────────────────────────────────


def main() -> None:
    args = parse_args()

    clear_db = not args.fs_only
    clear_fs = not args.db_only

    print(f"\n[Setup] dry_run={args.dry_run}  yes={args.yes}")
    print(f"[Setup] clear_db={clear_db}  clear_fs={clear_fs}")
    if args.processor:
        print(f"[Setup] processor filter: {args.processor}")
    if args.include_legacy:
        print("[Setup] --include-legacy: will also clear output/ and uploads/")

    # Connect to Supabase if we need to touch the DB
    client = None
    if clear_db:
        try:
            from supabase import create_client  # type: ignore
        except ImportError:
            print("[ERROR] 'supabase' package required. Run:  pip install supabase")
            sys.exit(1)

        url, key = _load_supabase_secrets()
        client = create_client(url, key)
        print(f"[Setup] Supabase connected: {url}")

    # Confirm before proceeding
    if not confirm_proceed(
        args.dry_run, args.yes, clear_db, clear_fs, args.processor, args.include_legacy
    ):
        print("[ABORTED] No changes made.")
        sys.exit(0)

    errors: list[str] = []
    db_stats: dict = {}
    fs_stats: dict = {}

    # ── Database ───────────────────────────────────────────────────────────────
    if clear_db:
        if args.dry_run:
            db_stats = dry_run_db(client)
        else:
            db_stats = execute_db_clear(client, errors)

    # ── Filesystem ─────────────────────────────────────────────────────────────
    if clear_fs:
        n, freed = clear_global_processed(args.dry_run, args.processor, errors)
        fs_stats["files/global/*/processed/"] = (n, freed)

        n, freed = clear_directory_contents(
            "files/users/", USERS_FILES_DIR, args.dry_run, errors
        )
        fs_stats["files/users/"] = (n, freed)

        if args.include_legacy:
            n, freed = clear_directory_contents(
                "output/ (legacy)", OUTPUT_DIR, args.dry_run, errors
            )
            fs_stats["output/ (legacy)"] = (n, freed)

            n, freed = clear_directory_contents(
                "uploads/ (legacy)", UPLOADS_DIR, args.dry_run, errors
            )
            fs_stats["uploads/ (legacy)"] = (n, freed)

    # ── Final summary ──────────────────────────────────────────────────────────
    print_summary(db_stats, fs_stats, errors, args.dry_run)

    if not args.dry_run and not errors:
        print("\n[DONE] All clear — ready for fresh benchmarking.\n")

    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
