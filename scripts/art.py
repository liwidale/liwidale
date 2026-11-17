"""Crops the transparent source art in art/src/ into the WebP cut-outs embedded in the cards."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
CROPS = {
    # name: (source, (left, top, right, bottom) in source pixels, output width)
    "holo-header.webp": ("holo-maid.png", (0, 70, 1350, 1560), 1160),
    "holo-footer.webp": ("holo-new.png", (0, 20, 1350, 1520), 1000),
    "holo-repos.webp": ("holo-sitting.png", (230, 60, 1230, 1060), 660),
}
out_dir = root / "assets" / "art"
out_dir.mkdir(parents=True, exist_ok=True)
for old in out_dir.glob("*.jpg"):
    old.unlink()
for name, (src, box, width) in CROPS.items():
    img = Image.open(root / "art" / "src" / src).convert("RGBA").crop(box)
    img = img.resize((width, round(width * img.height / img.width)), Image.LANCZOS)
    img.save(out_dir / name, quality=90, method=6)
    print(name, img.size, (out_dir / name).stat().st_size // 1024, "KB")
