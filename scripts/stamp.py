# -*- coding: utf-8 -*-
"""見た目を変えて公開する前に動かす。index.html の ?v= を中身に合わせて書きかえ、古いキャッシュが使われないようにする"""
import os, re, hashlib

D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")


def read(f):
    with open(os.path.join(D, f), encoding="utf-8", newline="") as fp:
        return fp.read()


html = read("index.html")
plain = re.sub(r"(app\.js|style\.css)(\?v=\w+)?\"", r'\1"', html)
v = hashlib.sha1((plain + read("app.js") + read("style.css")).replace("\r\n", "\n").encode()).hexdigest()[:8]
new = re.sub(r"(app\.js|style\.css)\"", rf'\1?v={v}"', plain)
if new != html:
    with open(os.path.join(D, "index.html"), "w", encoding="utf-8", newline="") as fp:
        fp.write(new)
print(v)
