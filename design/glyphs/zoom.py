import os,subprocess,sys
from glyphs import G, svg, OUT, HERE
def zoom(names, out="zoom.png"):
    rows=[]
    for n in names:
        cells=[]
        for bg,fg in (("#0d0d0d","#d8d8d8"),("#f4f4f4","#1a1a1a")):
            p=os.path.join(OUT,f"z-{n}-{fg[1:]}.svg"); open(p,"w").write(svg(G[n],fg))
            for px,sc in ((16,8),(26,5),(16,1),(26,1)):
                png=os.path.join(OUT,f"z-{n}-{fg[1:]}-{px}.png")
                subprocess.run(["rsvg-convert","-w",str(px),"-h",str(px),"-b",bg,p,"-o",png],check=True)
                c=png.replace(".png",f"-{sc}.png")
                size=136 if sc>1 else 40
                subprocess.run(["magick","-size",f"{size}x136",f"xc:{bg}","(",png,"-filter","point","-resize",f"{sc*100}%",")","-gravity","center","-composite",c],check=True)
                cells.append(c)
        r=os.path.join(OUT,f"z-{n}-row.png")
        subprocess.run(["magick","-size","70x136","xc:#555","-fill","white","-pointsize","12","-gravity","center","-annotate","+0+0",n,*cells,"+append",r],check=True)
        rows.append(r)
    subprocess.run(["magick",*rows,"-append",os.path.join(HERE,out)],check=True)
if __name__=="__main__":
    import monkeys_defs  # noqa
    zoom(sys.argv[1:])
