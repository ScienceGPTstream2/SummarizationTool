#!/usr/bin/env python3
"""
generate_comparison_charts.py

Generates 6 comparison charts from the processor comparison CSV.

Usage:
    python generate_comparison_charts.py \
        [--csv Docling-Azure-test/output/comparison_YYYYMMDD_HHMMSS.csv]  # auto-picks latest
        [--output-dir Docling-Azure-test/output/charts]
"""

import argparse
import csv
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_CSV_DIR = REPO_ROOT / "Docling-Azure-test" / "output"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "Docling-Azure-test" / "output" / "charts"

AZURE_COLOR = "#0072C6"
DOCLING_COLOR = "#2E8B57"
EPI_COLOR = "#4472C4"
TOX_COLOR = "#ED7D31"

plt.style.use("seaborn-v0_8-whitegrid")


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_latest_csv(csv_dir: Path) -> Path:
    candidates = sorted(csv_dir.glob("comparison_*.csv"))
    if not candidates:
        print(f"ERROR: no comparison CSV found in {csv_dir}", file=sys.stderr)
        sys.exit(1)
    return candidates[-1]


def load_data(csv_path: Path) -> list[dict]:
    with open(csv_path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    # Sort: Epi first then Tox, alphabetically within each
    rows.sort(key=lambda r: (r["category"], r["document_title"]))
    return rows


def assign_labels(rows: list[dict]) -> tuple[list[str], dict]:
    """Assign short labels (Epi-1…Epi-N, Tox-1…Tox-N) and return label map."""
    counters: dict[str, int] = {}
    labels = []
    label_map = {}  # label → full title
    for r in rows:
        cat = r["category"]
        counters[cat] = counters.get(cat, 0) + 1
        label = f"{cat}-{counters[cat]}"
        labels.append(label)
        label_map[label] = r["document_title"]
    return labels, label_map


def fval(row: dict, key: str, default: float = 0.0) -> float:
    v = row.get(key, "")
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


def ival(row: dict, key: str, default: int = 0) -> int:
    return int(fval(row, key, default))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def epi_tox_split(rows: list[dict]) -> int:
    """Return index of first Tox row (= number of Epi rows)."""
    return sum(1 for r in rows if r["category"] == "Epi")


def add_category_divider(ax, n_epi: int, n_total: int, y_top_frac: float = 1.05):
    """Add vertical dashed separator and category labels between Epi and Tox."""
    if 0 < n_epi < n_total:
        ax.axvline(x=n_epi - 0.5, color="gray", linestyle="--", linewidth=1, alpha=0.6)
        ylim = ax.get_ylim()
        y = ylim[1] * y_top_frac
        ax.text(n_epi / 2 - 0.5, y, "Epi", ha="center", va="bottom",
                fontsize=9, color="gray", fontstyle="italic")
        ax.text(n_epi + (n_total - n_epi) / 2 - 0.5, y, "Tox", ha="center", va="bottom",
                fontsize=9, color="gray", fontstyle="italic")


def save(fig, path: Path, name: str):
    path.mkdir(parents=True, exist_ok=True)
    out = path / name
    fig.savefig(out, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out.name}")


# ---------------------------------------------------------------------------
# Chart 1 — Character count
# ---------------------------------------------------------------------------

def chart_char_count(rows, labels, n_epi, output_dir):
    azure_vals = [ival(r, "azure_char_count") for r in rows]
    docling_vals = [ival(r, "docling_char_count") for r in rows]

    x = np.arange(len(rows))
    width = 0.38

    fig, ax = plt.subplots(figsize=(15, 6))
    ax.bar(x - width / 2, azure_vals, width, label="Azure DI", color=AZURE_COLOR, alpha=0.85)
    ax.bar(x + width / 2, docling_vals, width, label="Docling", color=DOCLING_COLOR, alpha=0.85)

    ax.set_title("Content Size — Characters Extracted per Document", fontsize=14, fontweight="bold", pad=12)
    ax.set_ylabel("Character Count", fontsize=11)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=9)
    ax.legend(fontsize=10)
    add_category_divider(ax, n_epi, len(rows))
    fig.tight_layout()
    save(fig, output_dir, "chart1_char_count.png")


# ---------------------------------------------------------------------------
# Chart 2 — Tables detected
# ---------------------------------------------------------------------------

def chart_tables(rows, labels, n_epi, output_dir):
    azure_vals = [ival(r, "azure_html_tables") + ival(r, "azure_markdown_tables") for r in rows]
    docling_detected = [ival(r, "docling_html_tables") + ival(r, "docling_markdown_tables") for r in rows]
    docling_meta = [ival(r, "docling_tables_found") for r in rows]

    x = np.arange(len(rows))
    width = 0.28

    fig, ax = plt.subplots(figsize=(15, 6))
    ax.bar(x - width, azure_vals, width, label="Azure DI (detected)", color=AZURE_COLOR, alpha=0.85)
    ax.bar(x, docling_detected, width, label="Docling (detected)", color=DOCLING_COLOR, alpha=0.85)
    ax.bar(x + width, docling_meta, width, label="Docling (metadata)", color=DOCLING_COLOR, alpha=0.4,
           hatch="//", edgecolor=DOCLING_COLOR)

    ax.set_title("Tables Detected per Document", fontsize=14, fontweight="bold", pad=12)
    ax.set_ylabel("Table Count", fontsize=11)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=9)
    ax.legend(fontsize=10)
    add_category_divider(ax, n_epi, len(rows))
    fig.tight_layout()
    save(fig, output_dir, "chart2_tables.png")


# ---------------------------------------------------------------------------
# Chart 3 — Parse cost
# ---------------------------------------------------------------------------

def chart_cost(rows, labels, n_epi, output_dir):
    azure_vals = [fval(r, "azure_parse_cost_usd") for r in rows]
    docling_vals = [fval(r, "docling_parse_cost_usd") for r in rows]

    x = np.arange(len(rows))
    width = 0.38

    fig, ax = plt.subplots(figsize=(15, 6))
    bars_a = ax.bar(x - width / 2, azure_vals, width, label="Azure DI", color=AZURE_COLOR, alpha=0.85)
    bars_d = ax.bar(x + width / 2, docling_vals, width, label="Docling", color=DOCLING_COLOR, alpha=0.85)

    # Annotate total cost difference above each group
    for i, (av, dv) in enumerate(zip(azure_vals, docling_vals)):
        if av > 0 and dv > 0:
            ratio = av / dv
            ax.text(i, max(av, dv) * 1.04, f"{ratio:.1f}×", ha="center", va="bottom",
                    fontsize=7, color="dimgray")

    # Summary totals in subtitle
    total_a = sum(azure_vals)
    total_d = sum(docling_vals)
    ax.set_title(
        f"Parse Cost per Document — Azure DI vs Docling",
        fontsize=14, fontweight="bold", pad=10
    )
    ax.set_xlabel(
        f"Total across all documents:   Azure DI ${total_a:.4f}   |   Docling ${total_d:.4f}   "
        f"(Azure is {total_a/total_d:.1f}× more expensive)",
        fontsize=10, labelpad=10
    )
    ax.set_ylabel("Cost (USD)", fontsize=11)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=9)
    ax.legend(fontsize=10)
    add_category_divider(ax, n_epi, len(rows))
    fig.tight_layout()
    save(fig, output_dir, "chart3_cost.png")


# ---------------------------------------------------------------------------
# Chart 4 — Parse duration (Docling only)
# ---------------------------------------------------------------------------

def chart_duration(rows, labels, n_epi, output_dir):
    vals = [fval(r, "docling_parse_duration_s") for r in rows]
    colors = [EPI_COLOR if r["category"] == "Epi" else TOX_COLOR for r in rows]

    x = np.arange(len(rows))

    fig, ax = plt.subplots(figsize=(15, 6))
    ax.bar(x, vals, color=colors, alpha=0.85)

    ax.set_title(
        "Docling Parse Duration per Document (seconds)\n"
        "Azure DI duration not recorded (remote API — no client-side timing)",
        fontsize=13, fontweight="bold", pad=12
    )
    ax.set_ylabel("Duration (seconds)", fontsize=11)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=9)

    epi_patch = mpatches.Patch(color=EPI_COLOR, alpha=0.85, label="Epi")
    tox_patch = mpatches.Patch(color=TOX_COLOR, alpha=0.85, label="Tox")
    ax.legend(handles=[epi_patch, tox_patch], fontsize=10)
    add_category_divider(ax, n_epi, len(rows))
    fig.tight_layout()
    save(fig, output_dir, "chart4_duration.png")


# ---------------------------------------------------------------------------
# Chart 5 — Azure DI artifacts (stacked)
# ---------------------------------------------------------------------------

def chart_artifacts(rows, labels, n_epi, output_dir):
    comments = np.array([ival(r, "azure_html_comments") for r in rows])
    figure_tags = np.array([ival(r, "azure_figure_tags") for r in rows])
    hyph = np.array([ival(r, "azure_hyphenated_breaks") for r in rows])

    x = np.arange(len(rows))

    fig, ax = plt.subplots(figsize=(15, 6))
    ax.bar(x, comments, label="HTML comments (<!-- -->)", color="#C00000", alpha=0.85)
    ax.bar(x, figure_tags, bottom=comments, label="<figure> tags", color="#FF6600", alpha=0.85)
    ax.bar(x, hyph, bottom=comments + figure_tags, label="Hyphenated line-breaks", color="#FFC000", alpha=0.85)

    ax.set_title(
        "Azure DI Output Noise per Document\n"
        "HTML comments + <figure> tags + hyphenated OCR line-breaks  |  Docling = 0 for all",
        fontsize=13, fontweight="bold", pad=12
    )
    ax.set_ylabel("Artifact Count", fontsize=11)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=9)
    ax.legend(fontsize=10)
    add_category_divider(ax, n_epi, len(rows))
    fig.tight_layout()
    save(fig, output_dir, "chart5_artifacts.png")


# ---------------------------------------------------------------------------
# Chart 6 — Text similarity (horizontal, sorted)
# ---------------------------------------------------------------------------

def chart_similarity(rows, labels, output_dir):
    data = sorted(
        [(fval(r, "overall_similarity_pct"), lbl, r["category"])
         for r, lbl in zip(rows, labels)],
        key=lambda x: x[0]
    )
    sims, sorted_labels, cats = zip(*data)
    colors = [EPI_COLOR if c == "Epi" else TOX_COLOR for c in cats]

    fig, ax = plt.subplots(figsize=(10, 9))
    y = np.arange(len(sorted_labels))
    ax.barh(y, sims, color=colors, alpha=0.85)
    ax.axvline(x=80, color="gray", linestyle="--", linewidth=1.2, alpha=0.7, label="80% threshold")

    ax.set_title(
        "Overall Text Similarity — Azure DI vs Docling\n"
        "(after cleaning HTML artifacts and normalizing whitespace)",
        fontsize=13, fontweight="bold", pad=12
    )
    ax.set_xlabel("Similarity (%)", fontsize=11)
    ax.set_yticks(y)
    ax.set_yticklabels(sorted_labels, fontsize=9)
    ax.set_xlim(0, 105)

    # Value labels
    for i, v in enumerate(sims):
        ax.text(v + 1, i, f"{v:.1f}%", va="center", fontsize=8, color="dimgray")

    epi_patch = mpatches.Patch(color=EPI_COLOR, alpha=0.85, label="Epi")
    tox_patch = mpatches.Patch(color=TOX_COLOR, alpha=0.85, label="Tox")
    ax.legend(handles=[epi_patch, tox_patch,
                        mpatches.Patch(color="gray", alpha=0.5, label="80% threshold")],
              fontsize=10)
    fig.tight_layout()
    save(fig, output_dir, "chart6_similarity.png")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate comparison charts from processor CSV")
    parser.add_argument("--csv", help="Path to comparison CSV (default: latest in output dir)")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    args = parser.parse_args()

    csv_path = Path(args.csv).resolve() if args.csv else load_latest_csv(DEFAULT_CSV_DIR)
    output_dir = Path(args.output_dir).resolve()

    print(f"Reading: {csv_path.name}")
    rows = load_data(csv_path)
    labels, label_map = assign_labels(rows)
    n_epi = epi_tox_split(rows)

    # Save study label key
    output_dir.mkdir(parents=True, exist_ok=True)
    label_file = output_dir / "study_labels.txt"
    with open(label_file, "w") as f:
        for lbl, title in label_map.items():
            f.write(f"{lbl:8s}  {title}\n")
            print(f"  {lbl:8s}  {title}")
    print()

    print("Generating charts...")
    chart_char_count(rows, labels, n_epi, output_dir)
    chart_tables(rows, labels, n_epi, output_dir)
    chart_cost(rows, labels, n_epi, output_dir)
    chart_duration(rows, labels, n_epi, output_dir)
    chart_artifacts(rows, labels, n_epi, output_dir)
    chart_similarity(rows, labels, output_dir)

    print(f"\nDone — 6 charts in: {output_dir}")


if __name__ == "__main__":
    main()
