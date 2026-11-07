// 네이버 블로그 스마트에디터 ONE에 제목/본문/사진을 채워 넣는 콘텐츠 스크립트.
// 글쓰기 화면이 iframe(mainFrame) 안에 있을 수 있어서 모든 프레임에서 실행되고,
// 에디터가 있는 프레임만 응답해요.
(() => {
  if (window.__postingFillLoaded) return;
  window.__postingFillLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => Array.from(document.querySelectorAll(sel));

  function titleEl() {
    return q(".se-documentTitle .se-text-paragraph") || q(".se-title-text .se-text-paragraph") || q(".se-documentTitle [contenteditable]");
  }
  function bodyParagraphs() {
    return qa(".se-component.se-text .se-text-paragraph, .se-section-text .se-text-paragraph")
      .filter((p) => !p.closest(".se-documentTitle"));
  }
  function imageCount() {
    return qa(".se-component.se-image, .se-component.se-imageStrip, .se-component.se-imageGroup").length;
  }

  // 실제 클릭처럼 마우스 이벤트를 보내서 에디터 커서를 옮겨요.
  function clickAt(el, atEnd = true) {
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const x = atEnd ? r.right - 2 : r.left + 2;
    const y = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    for (const type of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(type, opts));
    if (el.focus) el.focus();
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(!atEnd ? true : false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function pasteTarget() {
    const a = document.activeElement;
    return a && a !== document.body ? a : (q(".se-content") || document.body);
  }

  function paste({ html, text, files }) {
    const dt = new DataTransfer();
    if (text != null) dt.setData("text/plain", text);
    if (html != null) dt.setData("text/html", html);
    (files || []).forEach((f) => dt.items.add(f));
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    pasteTarget().dispatchEvent(ev);
    return ev.defaultPrevented; // 에디터가 붙여넣기를 처리했으면 true
  }

  function findMarker(n) {
    const mark = `[사진${n}]`;
    for (const p of bodyParagraphs()) {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = walker.nextNode())) {
        const i = t.nodeValue.indexOf(mark);
        if (i >= 0) return { p, node: t, start: i, end: i + mark.length };
      }
    }
    return null;
  }

  async function toFile(img) {
    const res = await fetch(img.url);
    if (!res.ok) throw new Error(`사진${img.n} 다운로드 실패 (HTTP ${res.status})`);
    const blob = await res.blob();
    return new File([blob], img.name || `photo${img.n}.jpg`, { type: blob.type || "image/jpeg" });
  }

  async function waitFor(cond, timeout = 20000, step = 300) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (cond()) return true;
      await sleep(step);
    }
    return false;
  }

  async function fill(msg) {
    const log = [];

    // 1) 제목
    const t = titleEl();
    clickAt(t);
    await sleep(200);
    if (!paste({ text: msg.title })) document.execCommand("insertText", false, msg.title);
    await sleep(400);
    log.push("✅ 제목");

    // 2) 본문 (사진 자리는 [사진N] 표시로 먼저 넣어요)
    const paras = bodyParagraphs();
    if (!paras.length) return { ok: false, msg: "⚠️ 본문 칸을 찾지 못했어요. 본문을 한 번 클릭한 뒤 다시 시도해 주세요." };
    clickAt(paras[paras.length - 1]);
    await sleep(200);
    const plain = msg.html.replace(/<p><br><\/p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
    if (!paste({ html: msg.html, text: plain })) document.execCommand("insertHTML", false, msg.html);
    await sleep(1200);
    log.push("✅ 본문");

    // 3) 사진: [사진N] 표시를 선택하고 그 자리에 사진 파일을 붙여넣어요
    let okCount = 0;
    const missed = [];
    for (const img of msg.images || []) {
      try {
        const m = findMarker(img.n);
        if (!m) { missed.push(img.n); continue; }
        const file = await toFile(img);
        clickAt(m.p);
        const range = document.createRange();
        range.setStart(m.node, m.start);
        range.setEnd(m.node, m.end);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        await sleep(150);
        const before = imageCount();
        paste({ files: [file] });
        const added = await waitFor(() => imageCount() > before, 20000);
        if (added) okCount++; else missed.push(img.n);
        await sleep(600);
      } catch (e) {
        missed.push(img.n);
      }
    }
    // 남은 [사진N] 표시 지우기 (사진이 들어간 것만)
    const leftovers = (msg.images || []).filter((im) => !missed.includes(im.n) && findMarker(im.n));
    if (msg.images?.length) {
      log.push(`🖼️ 사진 ${okCount}/${msg.images.length}장`);
    }
    let tail = "";
    if (missed.length) tail += `\n사진 ${missed.join(", ")}번은 자동으로 못 넣었어요. 팝업의 사진 버튼으로 복사해서 [사진N] 자리에 붙여넣어 주세요.`;
    if (leftovers.length) tail += `\n본문에 남은 [사진${leftovers.map((x) => x.n).join("], [사진")}] 표시는 지워 주세요.`;
    tail += "\n태그는 '태그 복사'로 발행 창에 넣고, 확인 후 [발행]을 눌러 주세요.";
    return { ok: true, msg: log.join("  ") + tail };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "posting-fill") return false;
    if (!titleEl()) return false; // 에디터가 없는 프레임은 응답하지 않아요
    fill(msg).then(sendResponse, (e) => sendResponse({ ok: false, msg: "⚠️ " + e.message }));
    return true;
  });
})();
