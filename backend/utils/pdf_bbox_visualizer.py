"""
PDF Bounding Box Visualizer for Azure Document Intelligence

This utility visualizes bounding boxes from Azure Document Intelligence results
on the original PDF document. It supports visualizing:
- Words and lines
- Paragraphs
- Tables and table cells
- Selection marks
- Figures
- Sections

Usage:
    python pdf_bbox_visualizer.py --pdf input.pdf --json result.json --output annotated.pdf
"""

import json
import argparse
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional
import fitz  # PyMuPDF


class PDFBBoxVisualizer:
    """Visualizes bounding boxes from Azure Document Intelligence on PDFs"""

    # Color scheme for different element types (RGB tuples, 0-1 range)
    COLORS = {
        "word": (0.2, 0.6, 1.0),  # Light blue
        "line": (0.0, 0.5, 0.8),  # Blue
        "paragraph": (0.5, 0.0, 0.5),  # Purple
        "table": (1.0, 0.5, 0.0),  # Orange
        "table_cell": (1.0, 0.7, 0.3),  # Light orange
        "figure": (0.0, 0.8, 0.0),  # Green
        "selection_mark": (1.0, 0.0, 0.0),  # Red
        "title": (0.8, 0.0, 0.0),  # Dark red
        "section_heading": (0.6, 0.0, 0.4),  # Dark purple
    }

    def __init__(self, pdf_path: str, json_path: str):
        """
        Initialize the visualizer

        Args:
            pdf_path: Path to the original PDF file
            json_path: Path to the JSON result from Azure Document Intelligence
        """
        self.pdf_path = Path(pdf_path)
        self.json_path = Path(json_path)

        if not self.pdf_path.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")
        if not self.json_path.exists():
            raise FileNotFoundError(f"JSON file not found: {json_path}")

        # Load the JSON result
        with open(self.json_path, "r", encoding="utf-8") as f:
            self.result = json.load(f)

        # Open the PDF
        self.doc = fitz.open(self.pdf_path)

        # DPI for coordinate conversion (PDF uses 72 DPI by default)
        self.dpi = 72

    def _polygon_to_rect(self, polygon: List[float], page_height: float) -> fitz.Rect:
        """
        Convert polygon coordinates to a rectangle

        Azure Document Intelligence returns polygons as [x1, y1, x2, y2, x3, y3, x4, y4]
        where coordinates are in inches for PDFs.

        Args:
            polygon: List of coordinates
            page_height: Height of the page in points

        Returns:
            fitz.Rect object
        """
        if not polygon or len(polygon) < 8:
            return None

        # Convert polygon points from inches to points (1 inch = 72 points)
        # Azure uses top-left origin, PyMuPDF also uses top-left origin
        x_coords = [polygon[i] * self.dpi for i in range(0, len(polygon), 2)]
        y_coords = [polygon[i] * self.dpi for i in range(1, len(polygon), 2)]

        # Create rectangle from min/max coordinates
        x0, y0 = min(x_coords), min(y_coords)
        x1, y1 = max(x_coords), max(y_coords)

        return fitz.Rect(x0, y0, x1, y1)

    def _draw_bbox(
        self,
        page: fitz.Page,
        polygon: List[float],
        color: Tuple[float, float, float],
        width: float = 1.5,
        label: Optional[str] = None,
    ):
        """
        Draw a bounding box on a page

        Args:
            page: PyMuPDF page object
            polygon: Polygon coordinates
            color: RGB color tuple (0-1 range)
            width: Line width
            label: Optional label to display
        """
        rect = self._polygon_to_rect(polygon, page.rect.height)
        if rect:
            # Draw rectangle
            page.draw_rect(rect, color=color, width=width)

            # Add label if provided
            if label:
                # Draw label background
                label_rect = fitz.Rect(
                    rect.x0, rect.y0 - 15, rect.x0 + len(label) * 6, rect.y0
                )
                page.draw_rect(label_rect, color=color, fill=color)
                # Draw label text
                page.insert_text(
                    (rect.x0 + 2, rect.y0 - 3),
                    label,
                    fontsize=10,
                    color=(1, 1, 1),  # White text
                )

    def visualize_words(self, show_labels: bool = False):
        """Draw bounding boxes for all words"""
        if "pages" not in self.result:
            return

        for page_data in self.result["pages"]:
            page_num = page_data.get("pageNumber", 1) - 1  # 0-indexed
            if page_num >= len(self.doc):
                continue

            page = self.doc[page_num]
            words = page_data.get("words", [])

            for word in words:
                polygon = word.get("polygon", [])
                content = word.get("content", "")
                label = content if show_labels else None
                self._draw_bbox(
                    page, polygon, self.COLORS["word"], width=1, label=label
                )

    def visualize_lines(self, show_labels: bool = False):
        """Draw bounding boxes for all lines"""
        if "pages" not in self.result:
            return

        for page_data in self.result["pages"]:
            page_num = page_data.get("pageNumber", 1) - 1
            if page_num >= len(self.doc):
                continue

            page = self.doc[page_num]
            lines = page_data.get("lines", [])

            for line in lines:
                polygon = line.get("polygon", [])
                content = line.get("content", "")[:30] if show_labels else None
                self._draw_bbox(
                    page, polygon, self.COLORS["line"], width=1.5, label=content
                )

    def visualize_paragraphs(self, show_roles: bool = True):
        """Draw bounding boxes for all paragraphs"""
        if "paragraphs" not in self.result:
            return

        for paragraph in self.result["paragraphs"]:
            bounding_regions = paragraph.get("boundingRegions", [])
            role = paragraph.get("role", None)

            # Use different color for different roles
            color = self.COLORS.get(role, self.COLORS["paragraph"])
            label = role if show_roles and role else None

            for region in bounding_regions:
                page_num = region.get("pageNumber", 1) - 1
                if page_num >= len(self.doc):
                    continue

                page = self.doc[page_num]
                polygon = region.get("polygon", [])
                self._draw_bbox(page, polygon, color, width=2, label=label)

    def visualize_tables(self, show_cells: bool = True):
        """Draw bounding boxes for tables and optionally table cells"""
        if "tables" not in self.result:
            return

        for table_idx, table in enumerate(self.result["tables"]):
            # Draw table boundary
            bounding_regions = table.get("boundingRegions", [])
            for region in bounding_regions:
                page_num = region.get("pageNumber", 1) - 1
                if page_num >= len(self.doc):
                    continue

                page = self.doc[page_num]
                polygon = region.get("polygon", [])
                self._draw_bbox(
                    page,
                    polygon,
                    self.COLORS["table"],
                    width=3,
                    label=f"Table {table_idx + 1}",
                )

            # Draw individual cells
            if show_cells:
                cells = table.get("cells", [])
                for cell in cells:
                    cell_regions = cell.get("boundingRegions", [])
                    for region in cell_regions:
                        page_num = region.get("pageNumber", 1) - 1
                        if page_num >= len(self.doc):
                            continue

                        page = self.doc[page_num]
                        polygon = region.get("polygon", [])
                        self._draw_bbox(
                            page, polygon, self.COLORS["table_cell"], width=1
                        )

    def visualize_figures(self, show_labels: bool = True):
        """Draw bounding boxes for figures"""
        if "figures" not in self.result:
            return

        for fig_idx, figure in enumerate(self.result["figures"]):
            bounding_regions = figure.get("boundingRegions", [])
            figure_id = figure.get("id", f"fig_{fig_idx}")
            caption = figure.get("caption", {})
            caption_text = (
                caption.get("content", "") if isinstance(caption, dict) else ""
            )

            label = f"Fig {figure_id}" if show_labels else None

            for region in bounding_regions:
                page_num = region.get("pageNumber", 1) - 1
                if page_num >= len(self.doc):
                    continue

                page = self.doc[page_num]
                polygon = region.get("polygon", [])
                self._draw_bbox(
                    page, polygon, self.COLORS["figure"], width=3, label=label
                )

    def visualize_selection_marks(self):
        """Draw bounding boxes for selection marks (checkboxes)"""
        if "pages" not in self.result:
            return

        for page_data in self.result["pages"]:
            page_num = page_data.get("pageNumber", 1) - 1
            if page_num >= len(self.doc):
                continue

            page = self.doc[page_num]
            selection_marks = page_data.get("selectionMarks", [])

            for mark in selection_marks:
                polygon = mark.get("polygon", [])
                state = mark.get("state", "unselected")
                label = "☑" if state == "selected" else "☐"
                self._draw_bbox(
                    page, polygon, self.COLORS["selection_mark"], width=2, label=label
                )

    def visualize_all(
        self, elements: Optional[List[str]] = None, show_labels: bool = True
    ):
        """
        Visualize multiple element types

        Args:
            elements: List of element types to visualize.
                     Options: "words", "lines", "paragraphs", "tables", "figures", "selection_marks"
                     If None, visualizes paragraphs, tables, and figures (recommended)
            show_labels: Whether to show labels for elements
        """
        if elements is None:
            elements = ["paragraphs", "tables", "figures"]

        element_map = {
            "words": lambda: self.visualize_words(show_labels),
            "lines": lambda: self.visualize_lines(show_labels),
            "paragraphs": lambda: self.visualize_paragraphs(show_labels),
            "tables": lambda: self.visualize_tables(show_cells=True),
            "figures": lambda: self.visualize_figures(show_labels),
            "selection_marks": lambda: self.visualize_selection_marks(),
        }

        for element in elements:
            if element in element_map:
                element_map[element]()

    def save(self, output_path: str):
        """
        Save the annotated PDF

        Args:
            output_path: Path to save the annotated PDF
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self.doc.save(str(output_path))
        print(f"✅ Saved annotated PDF to: {output_path}")

    def close(self):
        """Close the PDF document"""
        if self.doc:
            self.doc.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


def main():
    """CLI entry point"""
    parser = argparse.ArgumentParser(
        description="Visualize Azure Document Intelligence bounding boxes on PDFs"
    )
    parser.add_argument("--pdf", required=True, help="Path to the original PDF file")
    parser.add_argument(
        "--json",
        required=True,
        help="Path to the Azure Document Intelligence JSON result",
    )
    parser.add_argument(
        "--output", required=True, help="Path to save the annotated PDF"
    )
    parser.add_argument(
        "--elements",
        nargs="+",
        choices=[
            "words",
            "lines",
            "paragraphs",
            "tables",
            "figures",
            "selection_marks",
            "all",
        ],
        default=["paragraphs", "tables", "figures"],
        help="Element types to visualize (default: paragraphs tables figures)",
    )
    parser.add_argument(
        "--no-labels", action="store_true", help="Don't show labels on bounding boxes"
    )

    args = parser.parse_args()

    # Handle "all" option
    if "all" in args.elements:
        elements = [
            "words",
            "lines",
            "paragraphs",
            "tables",
            "figures",
            "selection_marks",
        ]
    else:
        elements = args.elements

    print(f"📄 Processing PDF: {args.pdf}")
    print(f"📋 Using JSON result: {args.json}")
    print(f"🎨 Visualizing elements: {', '.join(elements)}")

    try:
        with PDFBBoxVisualizer(args.pdf, args.json) as visualizer:
            visualizer.visualize_all(elements=elements, show_labels=not args.no_labels)
            visualizer.save(args.output)
            print("✅ Done!")
    except Exception as e:
        print(f"❌ Error: {e}")
        raise


if __name__ == "__main__":
    main()
