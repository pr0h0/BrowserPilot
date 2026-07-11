// Local test site for E2E: a form page (with a console error) and a result page.
Bun.serve({
  port: 8899,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/form.html") {
      return new Response(`<!doctype html><title>Test Form</title>
<h1>Search demo</h1>
<form id="search" action="/result.html" method="get">
  <input id="q" name="q" placeholder="query" value="OLD VALUE">
  <button type="submit">Search</button>
</form>
<button id="greet" onclick="document.getElementById('out').textContent='Hello, '+document.getElementById('q').value">Greet</button>
<button id="danger" onclick="document.getElementById('out').textContent='DELETED'">Delete account</button>
<label><input type="checkbox" id="agree" onchange="document.getElementById('out').textContent='agree='+this.checked"> I agree</label>
<select id="color" onchange="document.getElementById('out').textContent+=' color='+this.value"><option value="">pick</option><option value="red">Red</option><option value="blue">Blue</option></select>
<div id="out"></div>
<a href="/result.html?q=link">go</a>
<script>console.error("boom from form page");<\/script>`, { headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/result.html") {
      return new Response(`<!doctype html><title>Result</title>
<div id="done">RESULT PAGE</div><div id="query">${url.searchParams.get("q") ?? ""}</div>`, { headers: { "content-type": "text/html" } });
    }
    // A minesweeper-style 3x3 grid of plain <div> cells wired via addEventListener (no onclick
    // attribute, no <button>) — the kind of board the naive extractor was blind to. Clicking a
    // cell reveals its data-value (changes class + text), like a real game.
    if (url.pathname === "/grid.html") {
      return new Response(`<!doctype html><title>Grid game</title>
<style>#board{display:grid;grid-template-columns:repeat(3,40px);gap:2px}.cell{width:40px;height:40px;background:#ccc;cursor:pointer;display:flex;align-items:center;justify-content:center;font:16px monospace}.cell.revealed{background:#efe}</style>
<div id="board"></div>
<script>
const vals=[["1","2","3"],["4","5","6"],["7","8","9"]];
const board=document.getElementById("board");
for(let r=0;r<3;r++)for(let c=0;c<3;c++){const d=document.createElement("div");d.className="cell";d.dataset.value=vals[r][c];d.dataset.rc=r+","+c;
  d.addEventListener("click",()=>{d.classList.add("revealed");d.textContent=d.dataset.value;});board.appendChild(d);}
<\/script>`, { headers: { "content-type": "text/html" } });
    }
    return new Response("nope", { status: 404 });
  },
});
console.log("test pages on http://127.0.0.1:8899");
