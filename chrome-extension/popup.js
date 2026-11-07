// 팝업: GitHub에서 post.json을 불러와 네이버 에디터에 채우거나 클립보드로 복사해요.
const $ = (id) => document.getElementById(id);
const DEFAULTS = { repo: "c7cheu96-crypto/posting", branch: "main", path: "latest" };
let post = null;

function status(msg) { $("status").textContent = msg || ""; }

function rawUrl(path) {
  const repo = $("repo").value.trim() || DEFAULTS.repo;
  const branch = $("branch").value.trim() || DEFAULTS.branch;
  const clean = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${clean}`;
}

async function fetchJson(path) {
  const res = await fetch(rawUrl(path) + `?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} 를 찾을 수 없어요 (HTTP ${res.status})`);
  return res.json();
}

function normalizePath(p) {
  p = (p || "").trim();
  if (!p || p === "latest") return "posts/latest.json";
  if (/^\d{4}$/.test(p)) return `inbox/${p}/post.json`;          // "1026" 처럼 날짜만 입력
  if (!p.endsWith(".json")) return p.replace(/\/+$/, "") + "/post.json";
  return p;
}

async function load() {
  status("불러오는 중…");
  $("card").style.display = "none";
  $("pick").style.display = "none";
  const path = normalizePath($("path").value);
  chrome.storage.local.set({ repo: $("repo").value.trim(), branch: $("branch").value.trim(), path: $("path").value.trim() });
  try {
    const data = await fetchJson(path);
    if (Array.isArray(data.posts)) {
      if (!data.posts.length) throw new Error("latest.json 에 글이 없어요");
      const sel = $("pick");
      sel.innerHTML = "";
      data.posts.forEach((p, i) => {
        const o = document.createElement("option");
        o.value = p.url; o.textContent = `${data.date} · ${p.title || p.name}`;
        sel.appendChild(o);
      });
      sel.style.display = data.posts.length > 1 ? "block" : "none";
      await showPost(await fetchJson(data.posts[0].url));
    } else {
      await showPost(data);
    }
    status("");
  } catch (e) {
    status("⚠️ " + e.message);
  }
}

async function showPost(p) {
  post = p;
  $("title").textContent = p.title || "(제목 없음)";
  const n = (p.images || []).length;
  $("meta").textContent = `${p.date || ""} · ${p.type === "economy" ? "경제 용어" : "맛집"} · 사진 ${n}장 · 태그 ${(p.tags || []).length}개`;
  const box = $("photos");
  box.innerHTML = "";
  (p.images || []).forEach((im, i) => {
    const b = document.createElement("button");
    b.title = `사진${i + 1} 복사: ${im.caption || ""}`;
    b.innerHTML = `<img alt=""><span>${i + 1}</span>`;
    b.querySelector("img").src = im.url;
    b.onclick = () => copyImage(im.url, i + 1);
    box.appendChild(b);
  });
  $("card").style.display = "block";
}

// 본문 HTML → 네이버 에디터용 HTML (사진 자리는 [사진N] 표시)
function naverHtml(p, withImgTags) {
  const doc = new DOMParser().parseFromString(`<div>${p.body?.html || ""}</div>`, "text/html");
  const out = [];
  doc.body.firstChild.childNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase();
    if (tag === "figure" || tag === "img") {
      const img = tag === "img" ? n : n.querySelector("img");
      const idx = img?.getAttribute("data-index") || (p.images || []).findIndex((x) => x.url === img?.src) + 1;
      out.push(withImgTags && img ? `<p><img src="${img.src}" alt="${img.alt || ""}"></p>` : `<p>[사진${idx}]</p>`);
    } else if (/^h[1-6]$/.test(tag)) {
      out.push(`<p><b>${n.innerHTML}</b></p>`);
    } else {
      out.push(`<p>${n.innerHTML}</p>`);
    }
  });
  return out.join("<p><br></p>");
}

async function writeClipboard(html, text) {
  await navigator.clipboard.write([new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([text], { type: "text/plain" }),
  })]);
}

async function copyImage(url, n) {
  try {
    status(`사진${n} 준비 중…`);
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    const png = await new Promise((r) => c.toBlob(r, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    status(`📋 사진${n} 복사됨 — 에디터의 [사진${n}] 자리에 붙여넣기(Ctrl+V) 하세요.`);
  } catch (e) { status("⚠️ 사진 복사 실패: " + e.message); }
}

async function fill() {
  if (!post) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/blog\.naver\.com\//.test(tab.url || "")) {
    status("⚠️ 먼저 네이버 블로그 글쓰기 화면을 열고, 그 탭에서 눌러 주세요.");
    return;
  }
  $("fill").disabled = true;
  status("채워 넣는 중… 에디터를 건드리지 말고 잠시만 기다려 주세요 ⏳");
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: "posting-fill",
      title: post.title,
      html: naverHtml(post, false),
      images: (post.images || []).map((im, i) => ({ n: i + 1, url: im.url, name: (im.file || `photo${i + 1}.jpg`).split("/").pop() })),
    });
    status(res?.msg || "완료");
  } catch (e) {
    status("⚠️ 에디터를 찾지 못했어요. 글쓰기 화면을 새로고침(F5)한 뒤 다시 눌러 주세요.\n(" + e.message + ")");
  } finally {
    $("fill").disabled = false;
  }
}

$("load").onclick = load;
$("path").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
$("pick").onchange = async () => { status("불러오는 중…"); try { await showPost(await fetchJson($("pick").value)); status(""); } catch (e) { status("⚠️ " + e.message); } };
$("fill").onclick = fill;
$("cTitle").onclick = async () => { await navigator.clipboard.writeText(post.title); status("📋 제목 복사됨"); };
$("cBody").onclick = async () => {
  await writeClipboard(naverHtml(post, false), post.body?.plain || "");
  status("📋 본문 복사됨 — 에디터 본문에 Ctrl+V 하고, [사진N] 자리에는 아래 사진을 눌러 복사해 붙여넣으세요.");
};
$("cTags").onclick = async () => {
  await navigator.clipboard.writeText((post.tags || []).join(","));
  status("📋 태그 복사됨 — 발행 창의 태그 칸에 붙여넣으세요.");
};

chrome.storage.local.get(DEFAULTS, (s) => {
  $("repo").value = s.repo || DEFAULTS.repo;
  $("branch").value = s.branch || DEFAULTS.branch;
  $("path").value = s.path || DEFAULTS.path;
  load();
});
