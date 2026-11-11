import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
// eslint-disable-next-line import/no-unresolved
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

// Rendu en <canvas> plutôt qu'une <iframe> : le support natif des PDF dans une
// <iframe> est connu pour être peu fiable sur mobile (en particulier Safari iOS,
// où ça peut rester silencieusement vide) — pdf.js rend la même chose partout,
// desktop comme mobile, dans une balise que le navigateur sait toujours afficher.
export function PdfPreview({ url }: { url: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [error, setError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(false);
    setPageNum(1);
    // withCredentials : la route /profile/license/:id/file exige la session
    // (cookie httpOnly), pdf.js doit l'envoyer comme n'importe quel fetch de l'app.
    getDocument({ url, withCredentials: true })
      .promise.then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!doc || !canvasRef.current || !containerRef.current) return;
    let cancelled = false;
    doc.getPage(pageNum).then((page) => {
      if (cancelled || !canvasRef.current || !containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const unscaled = page.getViewport({ scale: 1 });
      const scale = containerWidth / unscaled.width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (ctx) page.render({ canvasContext: ctx, viewport });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNum]);

  if (error) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        Aperçu indisponible pour ce fichier — utilise le lien ci-dessous.
      </p>
    );
  }

  return (
    <div>
      <div
        ref={containerRef}
        className="license-frame"
        style={{ overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start" }}
      >
        {/* alignItems ci-dessus (plutôt que le "stretch" par défaut d'un flex row) :
            un <canvas> est un élément remplacé avec un ratio intrinsèque (ici fixé par
            width/height posés en JS) — avec "stretch", le flex étire sa hauteur à celle
            du cadre, et le navigateur recalcule alors sa largeur pour garder ce ratio,
            ce qui le faisait déborder très largement du cadre (visible seulement une
            fois réellement mesuré, pas juste en regardant un rendu qui semblait correct
            au premier coup d'œil). */}
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>
      {doc && doc.numPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          <button type="button" className="ghost" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>
            ←
          </button>
          <span className="hint" style={{ margin: 0 }}>
            Page {pageNum} / {doc.numPages}
          </span>
          <button type="button" className="ghost" disabled={pageNum >= doc.numPages} onClick={() => setPageNum((p) => p + 1)}>
            →
          </button>
        </div>
      )}
    </div>
  );
}
