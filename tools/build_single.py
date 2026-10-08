"""Inline index.html + src/halftone.js + public/img into one self-contained HTML file.

    python3 tools/build_single.py /tmp/site-standalone.html
"""
import sys, base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / "site"
html = (root / "index.html").read_text()
js = (root / "src" / "halftone.js").read_text()
def uri(name, mime):
    return f"data:{mime};base64," + base64.b64encode((root / "public" / "img" / name).read_bytes()).decode()
for name, mime in [("cassis.jpg", "image/jpeg"), ("paris.jpg", "image/jpeg"),
                   ("nyc.jpg", "image/jpeg"), ("dot-lut.png", "image/png")]:
    js = js.replace(f'"public/img/{name}"', f'"{uri(name, mime)}"')
html = html.replace('<script type="module" src="src/halftone.js"></script>', f"<script>\n{js}</script>")
pathlib.Path(sys.argv[1]).write_text(html)
print("wrote", sys.argv[1], len(html) // 1024, "KB")
