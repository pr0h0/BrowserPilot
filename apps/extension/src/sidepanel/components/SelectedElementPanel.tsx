import type { SelectedElement } from "../../shared/types.js";

export function SelectedElementPanel({ element, onAskAI }: { element: SelectedElement | null; onAskAI: () => void }) {
  return (
    <section>
      <h2>Selected element</h2>
      {!element ? <div className="muted">Use the picker to select an element.</div> : (
        <>
          <div className="muted">Tag: <code>{element.tag}</code> {element.id && <>· id <code>{element.id}</code></>}</div>
          <div className="muted">Selector: <code>{element.selector}</code></div>
          <div className="muted">XPath: <code>{element.xpath}</code></div>
          <div className="muted">Box: {Math.round(element.rect.width)}×{Math.round(element.rect.height)} @ ({Math.round(element.rect.x)},{Math.round(element.rect.y)})</div>
          <pre>{element.innerText.slice(0, 600) || "(no text)"}</pre>
          <div className="row">
            <button className="ghost" onClick={() => navigator.clipboard.writeText(element.selector)}>Copy selector</button>
            <button onClick={onAskAI}>Send to AI</button>
          </div>
        </>
      )}
    </section>
  );
}
