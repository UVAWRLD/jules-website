"""Inline index.html + src/halftone.js + public/img into one self-contained HTML file.

    python tools/build_single.py ../halftone-morph-v2.html
"""
import sys, base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text()
js = (root / "src" / "halftone.js").read_text()
def uri(name, mime):
    return f"data:{mime};base64," + base64.b64encode((root / "public" / "img" / name).read_bytes()).decode()
js = js.replace('"/img/cassis.jpg"', f'"{uri("cassis.jpg","image/jpeg")}"')
js = js.replace('"/img/paris.jpg"', f'"{uri("paris.jpg","image/jpeg")}"')
js = js.replace('"/img/nyc.jpg"', f'"{uri("nyc.jpg","image/jpeg")}"')
js = js.replace('"/img/dot-lut.png"', f'"{uri("dot-lut.png","image/png")}"')
html = html.replace('<script type="module" src="/src/halftone.js"></script>', f"<script>\n{js}</script>")
pathlib.Path(sys.argv[1]).write_text(html)
print("wrote", sys.argv[1], len(html) // 1024, "KB")
