#!/usr/bin/env python3
"""
compare_processor_outputs.py

Compares Azure Doc Intelligence vs Docling markdown outputs for the same PDF.

Modes:
  Single pair  — produces a detailed .md report + single-row CSV
  Batch        — auto-discovers all pairs from Docling-Azure-test/ structure,
                 produces one CSV with one row per document pair

Usage:
    # Single pair
    python compare_processor_outputs.py \
        --azure   "Docling-Azure-test/Azure/Tox/{hash}_base.md" \
        --docling "Docling-Azure-test/Docling/Tox/{hash}_base.md" \
        [--category Tox|Epi] \
        [--output-dir Docling-Azure-test/output]

    # Batch (all 20 pairs)
    python compare_processor_outputs.py \
        --batch \
        [--test-dir Docling-Azure-test] \
        [--output-dir Docling-Azure-test/output]
"""

import argparse
import csv
import difflib
import json
import re
import sys
from datetime import datetime
from pathlib import Path


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GLOBAL_FILES_DIR = REPO_ROOT / "backend" / "files" / "global"
DEFAULT_TEST_DIR = REPO_ROOT / "Docling-Azure-test"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "Docling-Azure-test" / "output"
HASH_RE = re.compile(r"[0-9a-f]{64}")
MAX_DIFF_LINES = 60
AZURE_DI_COST_PER_PAGE = 0.013671  # from backend/config/pricing.json


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

def clean_azure(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    text = re.sub(r"<figure>\s*(.*?)\s*</figure>", lambda m: m.group(1) if len(m.group(1)) > 10 else "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"(\w+)-\n(\w+)", r"\1\2", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def clean_docling(text: str) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [l.rstrip() for l in text.splitlines()]
    return "\n".join(lines).strip()


def normalize_for_similarity(text: str) -> str:
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\|[-| :]+\|$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


# ---------------------------------------------------------------------------
# Section splitting
# ---------------------------------------------------------------------------

def split_sections(text: str) -> list[tuple[str, str]]:
    pattern = re.compile(r"^(#{1,3} .+)$", re.MULTILINE)
    parts = pattern.split(text)
    sections = []
    if parts[0].strip():
        sections.append(("Preamble", parts[0].strip()))
    it = iter(parts[1:])
    for heading in it:
        body = next(it, "").strip()
        sections.append((heading.strip(), body))
    return sections


def strip_heading_markers(heading: str) -> str:
    return re.sub(r"^#+\s+", "", heading).strip()


def extract_headings_list(text: str) -> list[str]:
    return [strip_heading_markers(h) for h in re.findall(r"^#{1,3} .+$", text, re.MULTILINE)]


def match_sections(
    azure_sections: list[tuple[str, str]],
    docling_sections: list[tuple[str, str]],
) -> list[tuple[str | None, str | None, str, str]]:
    azure_headings = [strip_heading_markers(h) for h, _ in azure_sections]
    docling_headings = [strip_heading_markers(h) for h, _ in docling_sections]
    azure_map = {strip_heading_markers(h): b for h, b in azure_sections}
    docling_map = {strip_heading_markers(h): b for h, b in docling_sections}

    matched_azure: set[str] = set()
    matched_docling: set[str] = set()
    pairs = []

    for ah in azure_headings:
        candidates = difflib.get_close_matches(ah, docling_headings, n=1, cutoff=0.5)
        if candidates:
            dh = candidates[0]
            if dh not in matched_docling:
                pairs.append((ah, dh, azure_map[ah], docling_map[dh]))
                matched_azure.add(ah)
                matched_docling.add(dh)

    for ah in azure_headings:
        if ah not in matched_azure:
            pairs.append((ah, None, azure_map[ah], ""))
    for dh in docling_headings:
        if dh not in matched_docling:
            pairs.append((None, dh, "", docling_map[dh]))

    return pairs


# ---------------------------------------------------------------------------
# Metrics helpers
# ---------------------------------------------------------------------------

def count_headings(text: str) -> int:
    return len(re.findall(r"^#{1,3} ", text, re.MULTILINE))


def count_markdown_tables(text: str) -> int:
    return len(re.findall(r"^\|[-| :]+\|$", text, re.MULTILINE))


def count_html_artifacts(raw: str) -> dict:
    return {
        "html_comments": len(re.findall(r"<!--.*?-->", raw, re.DOTALL)),
        "figure_tags": len(re.findall(r"<figure>", raw, re.IGNORECASE)),
        "html_tables": len(re.findall(r"<table[\s>]", raw, re.IGNORECASE)),
        "other_tags": len(re.findall(
            r"<(?!figure|/figure|table|/table|tbody|/tbody|tr|/tr|td|/td|th|/th|caption|/caption)[^>]+>",
            raw, re.IGNORECASE
        )),
    }


def count_hyphenated_breaks(raw: str) -> int:
    return len(re.findall(r"\w+-\n\w+", raw))


def count_figure_refs(text: str) -> int:
    return len(re.findall(r"!\[", text))


def similarity_ratio(a: str, b: str) -> float:
    na, nb = normalize_for_similarity(a), normalize_for_similarity(b)
    return difflib.SequenceMatcher(None, na, nb).ratio()


_GENERIC_HEADINGS = {"original article", "abstract", "introduction", "preamble", "review", "research section"}

def extract_title(text: str) -> str:
    for line in text.splitlines():
        m = re.match(r"^#{1,3}\s+(.+)", line.strip())
        if m:
            candidate = m.group(1).strip()
            if len(candidate) > 10 and candidate.lower() not in _GENERIC_HEADINGS:
                return candidate
    return "Unknown Document"


def extract_hash_from_path(path: Path) -> str | None:
    m = HASH_RE.search(path.name)
    return m.group(0) if m else None


def load_metadata(path: Path | None) -> dict:
    if path and path.exists():
        with open(path) as f:
            return json.load(f)
    return {}


def auto_discover_metadata(file_hash: str | None, processor: str) -> dict:
    if not file_hash:
        return {}
    meta_path = GLOBAL_FILES_DIR / file_hash / "processed" / processor / "metadata.json"
    return load_metadata(meta_path)


# ---------------------------------------------------------------------------
# Heading comparison
# ---------------------------------------------------------------------------

def compute_heading_comparison(azure_raw: str, docling_raw: str) -> dict:
    """Fuzzy-match heading lists between both docs, return match stats."""
    azure_heads = extract_headings_list(azure_raw)
    docling_heads = extract_headings_list(docling_raw)

    matched_azure: set[str] = set()
    matched_docling: set[str] = set()

    for ah in azure_heads:
        candidates = difflib.get_close_matches(ah, docling_heads, n=1, cutoff=0.5)
        if candidates:
            dh = candidates[0]
            if dh not in matched_docling:
                matched_azure.add(ah)
                matched_docling.add(dh)

    total = max(len(azure_heads), len(docling_heads), 1)
    return {
        "headings_in_common": len(matched_azure),
        "headings_azure_only": len(azure_heads) - len(matched_azure),
        "headings_docling_only": len(docling_heads) - len(matched_docling),
        "headings_similarity_pct": round(len(matched_azure) / total * 100, 1),
        "azure_headings_list": "; ".join(azure_heads),
        "docling_headings_list": "; ".join(docling_heads),
    }


# ---------------------------------------------------------------------------
# CSV row builder
# ---------------------------------------------------------------------------

def build_csv_row(
    azure_path: Path,
    docling_path: Path,
    azure_meta: dict,
    docling_meta: dict,
    file_hash: str | None,
    category: str,
) -> dict:
    azure_raw = azure_path.read_text(encoding="utf-8")
    docling_raw = docling_path.read_text(encoding="utf-8")

    azure_clean = clean_azure(azure_raw)
    docling_clean = clean_docling(docling_raw)

    title = extract_title(docling_clean) or extract_title(azure_clean) or "Unknown Document"

    azure_struct = {
        "line_count": len(azure_raw.splitlines()),
        "heading_count": count_headings(azure_raw),
        "table_count": count_markdown_tables(azure_raw),
        "figure_refs": count_figure_refs(azure_raw),
        "char_count": len(azure_raw),
        **count_html_artifacts(azure_raw),
        "hyphenated_breaks": count_hyphenated_breaks(azure_raw),
    }
    docling_struct = {
        "line_count": len(docling_raw.splitlines()),
        "heading_count": count_headings(docling_raw),
        "table_count": count_markdown_tables(docling_raw),
        "figure_refs": count_figure_refs(docling_raw),
        "char_count": len(docling_raw),
        **count_html_artifacts(docling_raw),
        "hyphenated_breaks": count_hyphenated_breaks(docling_raw),
    }

    overall_sim = similarity_ratio(azure_clean, docling_clean)

    azure_sections = split_sections(azure_clean)
    docling_sections = split_sections(docling_clean)
    pairs = match_sections(azure_sections, docling_sections)

    section_sims = []
    for ah, dh, ab, db in pairs:
        if ah and dh:
            section_sims.append(similarity_ratio(ab, db))

    low_sim_sections = [
        ah for ah, dh, ab, db in [(p[0], p[1], p[2], p[3]) for p in pairs]
        if ah and dh and similarity_ratio(
            next((b for h, b in azure_sections if strip_heading_markers(h) == ah), ""),
            next((b for h, b in docling_sections if strip_heading_markers(h) == dh), "")
        ) < 0.7
    ]

    sections_matched = sum(1 for ah, dh, _, _ in pairs if ah and dh)
    sections_azure_only = sum(1 for ah, dh, _, _ in pairs if ah and not dh)
    sections_docling_only = sum(1 for ah, dh, _, _ in pairs if dh and not ah)

    heading_cmp = compute_heading_comparison(azure_raw, docling_raw)

    hash_short = file_hash[:16] if file_hash else "unknown"

    return {
        "hash": hash_short,
        "category": category,
        "document_title": title,
        "azure_file": azure_path.name,
        "docling_file": docling_path.name,
        # Similarity
        "overall_similarity_pct": round(overall_sim * 100, 1),
        # Volume
        "azure_line_count": azure_struct["line_count"],
        "docling_line_count": docling_struct["line_count"],
        "azure_char_count": azure_struct["char_count"],
        "docling_char_count": docling_struct["char_count"],
        # Headings
        "azure_heading_count": azure_struct["heading_count"],
        "docling_heading_count": docling_struct["heading_count"],
        "headings_similarity_pct": heading_cmp["headings_similarity_pct"],
        "headings_in_common": heading_cmp["headings_in_common"],
        "headings_azure_only": heading_cmp["headings_azure_only"],
        "headings_docling_only": heading_cmp["headings_docling_only"],
        # Azure artifacts
        "azure_html_comments": azure_struct["html_comments"],
        "azure_figure_tags": azure_struct["figure_tags"],
        "azure_hyphenated_breaks": azure_struct["hyphenated_breaks"],
        "azure_html_tables": azure_struct["html_tables"],
        "azure_markdown_tables": azure_struct["table_count"],
        "azure_figure_refs": azure_struct["figure_refs"],
        # Docling structure
        "docling_html_tables": docling_struct["html_tables"],
        "docling_markdown_tables": docling_struct["table_count"],
        "docling_figure_refs": docling_struct["figure_refs"],
        # Metadata (Docling)
        "docling_page_count": docling_meta.get("page_count", ""),
        "docling_figures_found": docling_meta.get("figures_found", ""),
        "docling_tables_found": docling_meta.get("tables_found", ""),
        "docling_parse_cost_usd": docling_meta.get("parse_cost", ""),
        "docling_parse_duration_s": docling_meta.get("parse_duration_seconds", ""),
        # Section stats
        "sections_matched": sections_matched,
        "sections_azure_only": sections_azure_only,
        "sections_docling_only": sections_docling_only,
        "avg_section_similarity_pct": round(sum(section_sims) / len(section_sims) * 100, 1) if section_sims else "",
        "min_section_similarity_pct": round(min(section_sims) * 100, 1) if section_sims else "",
        "max_section_similarity_pct": round(max(section_sims) * 100, 1) if section_sims else "",
        "low_similarity_sections": "; ".join(low_sim_sections),
        # Full heading lists
        "azure_headings_list": heading_cmp["azure_headings_list"],
        "docling_headings_list": heading_cmp["docling_headings_list"],
        # Azure DI cost (computed from page count × per-page price)
        "azure_parse_cost_usd": round(int(docling_meta.get("page_count", 0)) * AZURE_DI_COST_PER_PAGE, 6),
    }


# ---------------------------------------------------------------------------
# .md report builder (single-pair, unchanged from original)
# ---------------------------------------------------------------------------

def fmt_val(v) -> str:
    if v is None or v == "":
        return "—"
    if isinstance(v, float):
        return f"${v:.6f}" if v < 0.01 else f"{v:.2f}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def winner(azure_val, docling_val, lower_is_better=False) -> str:
    if azure_val is None or docling_val is None:
        return "—"
    try:
        a, d = float(azure_val), float(docling_val)
    except (TypeError, ValueError):
        return "—"
    if a == d:
        return "Tie"
    if lower_is_better:
        return "Azure DI" if a < d else "Docling"
    return "Azure DI" if a > d else "Docling"


def make_unified_diff(a_text: str, b_text: str, a_label: str, b_label: str) -> str:
    a_lines = a_text.splitlines(keepends=True)
    b_lines = b_text.splitlines(keepends=True)
    diff = list(difflib.unified_diff(a_lines, b_lines, fromfile=a_label, tofile=b_label, lineterm=""))
    if not diff:
        return ""
    truncated = len(diff) > MAX_DIFF_LINES
    if truncated:
        diff = diff[:MAX_DIFF_LINES]
    result = "\n".join(diff)
    if truncated:
        result += f"\n... (diff truncated at {MAX_DIFF_LINES} lines)"
    return result


def build_report(
    azure_path: Path,
    docling_path: Path,
    azure_meta: dict,
    docling_meta: dict,
    file_hash: str | None,
    title_override: str | None,
) -> str:
    azure_raw = azure_path.read_text(encoding="utf-8")
    docling_raw = docling_path.read_text(encoding="utf-8")
    azure_clean = clean_azure(azure_raw)
    docling_clean = clean_docling(docling_raw)

    title = title_override or extract_title(docling_clean) or extract_title(azure_clean) or "Unknown Document"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    hash_display = file_hash or "unknown"

    azure_struct = {
        "line_count": len(azure_raw.splitlines()),
        "heading_count": count_headings(azure_raw),
        "table_count": count_markdown_tables(azure_raw),
        "figure_refs": count_figure_refs(azure_raw),
        "char_count": len(azure_raw),
        **count_html_artifacts(azure_raw),
        "hyphenated_breaks": count_hyphenated_breaks(azure_raw),
    }
    docling_struct = {
        "line_count": len(docling_raw.splitlines()),
        "heading_count": count_headings(docling_raw),
        "table_count": count_markdown_tables(docling_raw),
        "figure_refs": count_figure_refs(docling_raw),
        "char_count": len(docling_raw),
        **count_html_artifacts(docling_raw),
        "hyphenated_breaks": count_hyphenated_breaks(docling_raw),
    }

    overall_sim = similarity_ratio(azure_clean, docling_clean)

    azure_sections = split_sections(azure_clean)
    docling_sections = split_sections(docling_clean)
    pairs = match_sections(azure_sections, docling_sections)

    section_sims = []
    for ah, dh, ab, db in pairs:
        if ah and dh:
            sim = similarity_ratio(ab, db)
            section_sims.append((ah, dh, ab, db, sim))

    lines = []
    lines.append("# Processor Comparison Report")
    lines.append(f"**Document**: {title}")
    lines.append(f"**File hash**: `{hash_display[:16]}...`" if len(hash_display) > 16 else f"**File hash**: `{hash_display}`")
    lines.append(f"**Generated**: {timestamp}")
    lines.append(f"**Azure DI file**: `{azure_path.name}`")
    lines.append(f"**Docling file**: `{docling_path.name}`")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Summary metrics
    lines.append("## Summary Metrics")
    lines.append("")
    lines.append("| Metric | Azure DI | Docling | Winner |")
    lines.append("|--------|----------|---------|--------|")
    page_a = azure_meta.get("page_count")
    page_d = docling_meta.get("page_count")
    lines.append(f"| Pages | {fmt_val(page_a)} | {fmt_val(page_d)} | — |")
    fig_a = azure_meta.get("figures_found")
    fig_d = docling_meta.get("figures_found")
    lines.append(f"| Figures detected | {fmt_val(fig_a)} | {fmt_val(fig_d)} | — |")
    tbl_a = azure_meta.get("tables_found")
    tbl_d = docling_meta.get("tables_found")
    lines.append(f"| Tables detected | {fmt_val(tbl_a)} | {fmt_val(tbl_d)} | — |")
    cl_a = azure_meta.get("content_length", len(azure_raw))
    cl_d = docling_meta.get("content_length", len(docling_raw))
    lines.append(f"| Content length (bytes) | {fmt_val(cl_a)} | {fmt_val(cl_d)} | {winner(cl_a, cl_d, lower_is_better=True)} |")
    lines.append(f"| Line count (raw) | {fmt_val(azure_struct['line_count'])} | {fmt_val(docling_struct['line_count'])} | {winner(azure_struct['line_count'], docling_struct['line_count'], lower_is_better=True)} |")
    cost_d = docling_meta.get("parse_cost")
    lines.append(f"| Parse cost | — | {fmt_val(cost_d)} | — |")
    dur_d = docling_meta.get("parse_duration_seconds")
    lines.append(f"| Parse duration (s) | — | {fmt_val(dur_d)} | — |")
    lines.append("")

    # Structural analysis
    lines.append("## Structural Analysis")
    lines.append("")
    lines.append("| Element | Azure DI | Docling | Notes |")
    lines.append("|---------|----------|---------|-------|")
    lines.append(f"| Headings (#/##/###) | {azure_struct['heading_count']} | {docling_struct['heading_count']} | |")
    lines.append(f"| Markdown tables | {azure_struct['table_count']} | {docling_struct['table_count']} | |")
    lines.append(f"| `<table>` (HTML tables) | {azure_struct['html_tables']} | {docling_struct['html_tables']} | Docling uses HTML tables |")
    lines.append(f"| Figure references (`![`) | {azure_struct['figure_refs']} | {docling_struct['figure_refs']} | |")
    lines.append(f"| HTML comments (`<!-- -->`) | {azure_struct['html_comments']} | {docling_struct['html_comments']} | Azure DI artifact |")
    lines.append(f"| `<figure>` tags | {azure_struct['figure_tags']} | {docling_struct['figure_tags']} | Azure DI artifact |")
    lines.append(f"| Hyphenated line-breaks | {azure_struct['hyphenated_breaks']} | {docling_struct['hyphenated_breaks']} | PDF layout OCR artifact |")
    lines.append("")

    # Overall similarity
    lines.append("## Overall Text Similarity")
    lines.append("")
    sim_pct = overall_sim * 100
    if sim_pct >= 85:
        interp = "High similarity — both processors captured most of the same content."
    elif sim_pct >= 60:
        interp = "Moderate similarity — significant structural or content differences present."
    else:
        interp = "Low similarity — processors produced substantially different outputs."
    lines.append(f"**Similarity score: {sim_pct:.1f}%** (after cleaning HTML artifacts and normalizing whitespace)")
    lines.append(f"> {interp}")
    lines.append("")

    # Section-by-section
    lines.append("## Section-by-Section Comparison")
    lines.append("")
    azure_only = [(ah, ab) for ah, dh, ab, db in [(p[0], p[1], p[2], p[3]) for p in pairs] if ah and not dh]
    docling_only = [(dh, db) for ah, dh, ab, db in [(p[0], p[1], p[2], p[3]) for p in pairs] if dh and not ah]

    for ah, dh, ab, db, sim in sorted(section_sims, key=lambda x: x[4]):
        emoji = "✅" if sim >= 0.9 else ("⚠️" if sim >= 0.7 else "❌")
        lines.append(f"### {emoji} {ah}")
        if ah != dh:
            lines.append(f"> Azure heading: **{ah}** | Docling heading: **{dh}**")
        lines.append(f"> Similarity: **{sim * 100:.1f}%**")
        lines.append("")
        if sim < 0.9:
            diff_text = make_unified_diff(ab, db, "Azure DI", "Docling")
            if diff_text:
                lines.append("<details>")
                lines.append("<summary>Show diff</summary>")
                lines.append("")
                lines.append("```diff")
                lines.append(diff_text)
                lines.append("```")
                lines.append("")
                lines.append("</details>")
                lines.append("")

    if azure_only:
        lines.append("### Sections only in Azure DI")
        lines.append("")
        for heading, body in azure_only:
            preview = body[:150].replace("\n", " ").strip()
            lines.append(f"- **{heading}** — {preview}{'...' if len(body) > 150 else ''}")
        lines.append("")

    if docling_only:
        lines.append("### Sections only in Docling")
        lines.append("")
        for heading, body in docling_only:
            preview = body[:150].replace("\n", " ").strip()
            lines.append(f"- **{heading}** — {preview}{'...' if len(body) > 150 else ''}")
        lines.append("")

    # Key observations
    lines.append("## Key Observations")
    lines.append("")
    obs = []
    if azure_struct["html_comments"] > 0 or azure_struct["figure_tags"] > 0:
        obs.append(
            f"**HTML artifacts**: Azure DI introduced {azure_struct['html_comments']} `<!-- -->` "
            f"comments and {azure_struct['figure_tags']} `<figure>` blocks. Docling: 0."
        )
    if azure_struct["hyphenated_breaks"] > 0:
        obs.append(
            f"**OCR line-break artifacts**: Azure DI has {azure_struct['hyphenated_breaks']} "
            f"hyphenated mid-word line-breaks. Docling: 0."
        )
    ratio = azure_struct["line_count"] / max(docling_struct["line_count"], 1)
    obs.append(
        f"**Paragraph flow**: Azure DI produced {azure_struct['line_count']:,} lines vs "
        f"Docling's {docling_struct['line_count']:,} ({ratio:.1f}x more)."
    )
    total_a = azure_struct['table_count'] + azure_struct['html_tables']
    total_d = docling_struct['table_count'] + docling_struct['html_tables']
    obs.append(
        f"**Table capture**: Azure DI {total_a} tables vs Docling {total_d}."
        + (f" Metadata reports {tbl_d} tables for Docling." if tbl_d is not None else "")
    )
    obs.append(
        f"**Overall text similarity**: {overall_sim * 100:.1f}% — "
        + ("content is largely the same despite formatting differences." if overall_sim >= 0.8
           else "notable content differences — review section diffs above.")
    )
    low_sim = [(ah, sim) for ah, dh, ab, db, sim in section_sims if sim < 0.7]
    if low_sim:
        obs.append(
            "**Low-similarity sections** (< 70%): "
            + ", ".join(f"*{ah}* ({s*100:.0f}%)" for ah, s in sorted(low_sim, key=lambda x: x[1]))
        )
    for o in obs:
        lines.append(f"- {o}")
    lines.append("")

    # Recommendation
    lines.append("## Recommendation")
    lines.append("")
    artifact_score = azure_struct["html_comments"] + azure_struct["figure_tags"] + azure_struct["hyphenated_breaks"]
    table_adv = total_d - total_a
    rec = []
    if artifact_score > 5:
        rec.append(f"Docling produces significantly cleaner markdown ({artifact_score} fewer HTML/layout artifacts).")
    if table_adv > 2:
        rec.append(f"Docling captures {table_adv} more tables.")
    elif table_adv < -2:
        rec.append(f"Azure DI captures {-table_adv} more tables.")
    rec.append("Content completeness is comparable." if overall_sim >= 0.8
               else "Content completeness differs — review section diffs.")
    for r in rec:
        lines.append(f"- {r}")
    lines.append("")
    lines.append("---")
    lines.append(f"*Report generated by `compare_processor_outputs.py` on {timestamp}*")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Batch discovery
# ---------------------------------------------------------------------------

def discover_pairs(test_dir: Path) -> list[tuple[Path, Path, str, str]]:
    """
    Walk test_dir/Azure/{category}/ and match each file to its Docling counterpart.
    Returns list of (azure_path, docling_path, file_hash, category).
    """
    pairs = []
    azure_base = test_dir / "Azure"
    docling_base = test_dir / "Docling"

    for category_dir in sorted(azure_base.iterdir()):
        if not category_dir.is_dir():
            continue
        category = category_dir.name
        docling_cat_dir = docling_base / category

        for azure_file in sorted(category_dir.glob("*.md")):
            file_hash = extract_hash_from_path(azure_file)
            if not file_hash:
                print(f"  WARN: no hash in filename, skipping: {azure_file.name}", file=sys.stderr)
                continue

            # Find matching Docling file (same hash anywhere in filename)
            matches = [f for f in docling_cat_dir.glob("*.md") if file_hash in f.name]
            if not matches:
                print(f"  WARN: no Docling counterpart for {azure_file.name}", file=sys.stderr)
                continue
            if len(matches) > 1:
                print(f"  WARN: multiple Docling matches for {azure_file.name}, using first", file=sys.stderr)

            pairs.append((azure_file, matches[0], file_hash, category))

    return pairs


# ---------------------------------------------------------------------------
# CSV write helper
# ---------------------------------------------------------------------------

CSV_COLUMNS = [
    "hash", "category", "document_title", "azure_file", "docling_file",
    "overall_similarity_pct",
    "azure_line_count", "docling_line_count",
    "azure_char_count", "docling_char_count",
    "azure_heading_count", "docling_heading_count",
    "headings_similarity_pct", "headings_in_common", "headings_azure_only", "headings_docling_only",
    "azure_html_comments", "azure_figure_tags", "azure_hyphenated_breaks",
    "azure_html_tables", "azure_markdown_tables", "azure_figure_refs",
    "docling_html_tables", "docling_markdown_tables", "docling_figure_refs",
    "docling_page_count", "docling_figures_found", "docling_tables_found",
    "docling_parse_cost_usd", "docling_parse_duration_s",
    "sections_matched", "sections_azure_only", "sections_docling_only",
    "avg_section_similarity_pct", "min_section_similarity_pct", "max_section_similarity_pct",
    "low_similarity_sections",
    "azure_headings_list", "docling_headings_list",
    "azure_parse_cost_usd",
]


def write_csv(rows: list[dict], output_dir: Path, ts: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    out_file = output_dir / f"comparison_{ts}.csv"
    with open(out_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    return out_file


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Compare Azure DI vs Docling processor outputs")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--batch", action="store_true", help="Batch mode: auto-discover all pairs from test directory")
    mode.add_argument("--azure", help="Path to Azure DI output .md file (single-pair mode)")

    parser.add_argument("--docling", help="Path to Docling output .md file (single-pair mode)")
    parser.add_argument("--azure-meta", help="Path to Azure DI metadata.json (optional)")
    parser.add_argument("--docling-meta", help="Path to Docling metadata.json (optional)")
    parser.add_argument("--test-dir", default=str(DEFAULT_TEST_DIR), help="Root of Docling-Azure-test directory (batch mode)")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for output files")
    parser.add_argument("--category", default="unknown", help="Category label for single-pair mode (e.g. Epi, Tox)")
    parser.add_argument("--title", help="Override document title (single-pair mode only)")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    if args.batch:
        test_dir = Path(args.test_dir).resolve()
        if not test_dir.exists():
            print(f"ERROR: test directory not found: {test_dir}", file=sys.stderr)
            sys.exit(1)

        print(f"Discovering pairs in: {test_dir}")
        pairs = discover_pairs(test_dir)
        print(f"Found {len(pairs)} pairs\n")

        rows = []
        for i, (azure_path, docling_path, file_hash, category) in enumerate(pairs, 1):
            print(f"[{i}/{len(pairs)}] {category}/{azure_path.name[:40]}...")
            docling_meta = auto_discover_metadata(file_hash, "docling")
            azure_meta = auto_discover_metadata(file_hash, "azure_doc_intelligence")
            try:
                row = build_csv_row(azure_path, docling_path, azure_meta, docling_meta, file_hash, category)
                rows.append(row)
            except Exception as e:
                print(f"  ERROR processing pair: {e}", file=sys.stderr)

        csv_file = write_csv(rows, output_dir, ts)
        print(f"\nCSV written to: {csv_file}")
        print(f"Rows: {len(rows)} | Columns: {len(CSV_COLUMNS)}")

    else:
        # Single pair mode
        if not args.docling:
            parser.error("--docling is required in single-pair mode")

        azure_path = Path(args.azure).resolve()
        docling_path = Path(args.docling).resolve()

        if not azure_path.exists():
            print(f"ERROR: Azure file not found: {azure_path}", file=sys.stderr)
            sys.exit(1)
        if not docling_path.exists():
            print(f"ERROR: Docling file not found: {docling_path}", file=sys.stderr)
            sys.exit(1)

        file_hash = extract_hash_from_path(azure_path) or extract_hash_from_path(docling_path)
        azure_meta = load_metadata(Path(args.azure_meta)) if args.azure_meta else auto_discover_metadata(file_hash, "azure_doc_intelligence")
        docling_meta = load_metadata(Path(args.docling_meta)) if args.docling_meta else auto_discover_metadata(file_hash, "docling")

        print(f"Comparing:\n  Azure DI: {azure_path}\n  Docling:  {docling_path}")

        # .md report
        report = build_report(azure_path, docling_path, azure_meta, docling_meta, file_hash, args.title)
        output_dir.mkdir(parents=True, exist_ok=True)
        hash_short = file_hash[:16] if file_hash else "unknown"
        md_file = output_dir / f"{hash_short}_{ts}_comparison.md"
        md_file.write_text(report, encoding="utf-8")
        print(f"Report written to: {md_file}")

        # CSV row
        row = build_csv_row(azure_path, docling_path, azure_meta, docling_meta, file_hash, args.category)
        csv_file = write_csv([row], output_dir, ts)
        print(f"CSV written to:    {csv_file}")


if __name__ == "__main__":
    main()
