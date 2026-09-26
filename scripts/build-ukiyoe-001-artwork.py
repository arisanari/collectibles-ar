#!/usr/bin/env python3
"""Builds the tf-ukiyoe-001 display image from the two raw scans.

Each scan (`scan/IMG_6034.JPG` = left sheet, `scan/IMG_6035.JPG` = right
sheet) is a slightly tilted photo of one half-sheet (半丁) taken from
"北斎漫画" 十三編 (attribution and edition unconfirmed, see notes.md). This
script perspective-corrects each sheet using four manually identified
corners of the printed frame (匡郭), then places the two corrected sheets
side by side on a plain white mat sized to the estimated mat outer
dimensions from notes.md (width x height, cm).

This is a display composite for the Twinfold demo card, not an archival
scan. Corner coordinates are visual estimates (see notes.md 3-2) and are
passed as CLI arguments with defaults matching this individual's scans;
re-running against different photos requires re-measuring the corners.

Usage:
  python3 scripts/build-ukiyoe-001-artwork.py \
    --left /path/to/IMG_6034.JPG --right /path/to/IMG_6035.JPG \
    --out fixtures/demo/artworks/ukiyoe-hokusaimanga-13-001.jpg
"""
import argparse
from PIL import Image, ImageOps


def corners_arg(value: str) -> list[tuple[float, float]]:
    parts = [float(p) for p in value.split(",")]
    if len(parts) != 8:
        raise argparse.ArgumentTypeError(
            "expected 8 comma-separated numbers: tl_x,tl_y,tr_x,tr_y,br_x,br_y,bl_x,bl_y"
        )
    return [(parts[0], parts[1]), (parts[2], parts[3]), (parts[4], parts[5]), (parts[6], parts[7])]


def expand_quad(corners: list[tuple[float, float]], factor: float) -> list[tuple[float, float]]:
    """Uniformly scales the quad outward from its centroid by `factor`
    (e.g. 1.06 = +6%) to include a little of the printed frame's border
    line and slight paper margin beyond the exact corner points."""
    cx = sum(p[0] for p in corners) / 4
    cy = sum(p[1] for p in corners) / 4
    return [(cx + (x - cx) * factor, cy + (y - cy) * factor) for x, y in corners]


def perspective_correct(image: Image.Image, corners: list[tuple[float, float]], out_w: int, out_h: int) -> Image.Image:
    """Maps the quad (tl, tr, br, bl) in `image` to a straightened
    out_w x out_h rectangle using PIL's QUAD transform (no cv2 available).
    PIL's QUAD source order is (tl, bl, br, tr)."""
    tl, tr, br, bl = corners
    quad = (*tl, *bl, *br, *tr)
    return image.transform((out_w, out_h), Image.QUAD, quad, resample=Image.BICUBIC)


def load_sheet(path: str, corners: list[tuple[float, float]], expand: float, sheet_w_px: int, sheet_h_px: int) -> Image.Image:
    im = ImageOps.exif_transpose(Image.open(path))
    quad = expand_quad(corners, expand)
    return perspective_correct(im, quad, sheet_w_px, sheet_h_px)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--left", required=True, help="path to left sheet photo (IMG_6034.JPG)")
    parser.add_argument("--right", required=True, help="path to right sheet photo (IMG_6035.JPG)")
    parser.add_argument("--out", required=True, help="output image path (.jpg or .png)")
    parser.add_argument(
        "--left-corners",
        type=corners_arg,
        default="615,695,2485,650,2655,3620,540,3590",
        help="tl_x,tl_y,tr_x,tr_y,br_x,br_y,bl_x,bl_y of the printed frame (匡郭) in the left photo, "
        "after EXIF-orientation is applied (portrait)",
    )
    parser.add_argument(
        "--right-corners",
        type=corners_arg,
        default="628,808,2508,950,2598,3696,495,3655",
        help="same shape for the right photo",
    )
    parser.add_argument("--expand", type=float, default=1.06, help="uniform outward scale of the corner quad")
    parser.add_argument("--mat-width-cm", type=float, default=49.0, help="mat outer width (推定, notes.md 2)")
    parser.add_argument("--mat-height-cm", type=float, default=32.5, help="mat outer height (推定, notes.md 2)")
    parser.add_argument("--sheet-width-cm", type=float, default=14.0, help="single sheet width (推定, notes.md 2)")
    parser.add_argument("--sheet-height-cm", type=float, default=24.0, help="single sheet height (推定, notes.md 2)")
    parser.add_argument("--gap-cm", type=float, default=1.0, help="gap between the two sheets")
    parser.add_argument("--long-side-px", type=int, default=2048, help="long side of the output canvas in px")
    args = parser.parse_args()

    px_per_cm = args.long_side_px / max(args.mat_width_cm, args.mat_height_cm)
    canvas_w = round(args.mat_width_cm * px_per_cm)
    canvas_h = round(args.mat_height_cm * px_per_cm)
    sheet_w_px = round(args.sheet_width_cm * px_per_cm)
    sheet_h_px = round(args.sheet_height_cm * px_per_cm)
    gap_px = round(args.gap_cm * px_per_cm)

    left_sheet = load_sheet(args.left, args.left_corners, args.expand, sheet_w_px, sheet_h_px)
    right_sheet = load_sheet(args.right, args.right_corners, args.expand, sheet_w_px, sheet_h_px)

    canvas = Image.new("RGB", (canvas_w, canvas_h), "white")
    total_content_w = sheet_w_px * 2 + gap_px
    left_margin = (canvas_w - total_content_w) // 2
    top_margin = (canvas_h - sheet_h_px) // 2

    left_x = left_margin
    right_x = left_margin + sheet_w_px + gap_px
    canvas.paste(left_sheet, (left_x, top_margin))
    canvas.paste(right_sheet, (right_x, top_margin))

    canvas.save(args.out, quality=92)
    print(f"canvas: {canvas_w}x{canvas_h}px ({args.mat_width_cm}x{args.mat_height_cm}cm, {px_per_cm:.2f}px/cm)")
    print(f"sheet: {sheet_w_px}x{sheet_h_px}px ({args.sheet_width_cm}x{args.sheet_height_cm}cm)")
    print(f"saved -> {args.out}")


if __name__ == "__main__":
    main()
