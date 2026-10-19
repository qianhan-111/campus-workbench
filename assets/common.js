/* 「今天」工作台 · 笔记工具（V5：纯 Markdown / Word 导出，本地文件直写已移除，数据全走线上） */
const NOTE_LIB = {
  /* ---------- Markdown ↔ HTML（编辑器用） ---------- */
  esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  inline(s) {
    return this.esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/❓没听懂/g, '<span class="q-mark">❓没听懂</span>');
  },
  mdToHtml(md) {
    const lines = String(md || "").replace(/\r/g, "").split("\n");
    let html = "", inCode = false, buf = [];
    const flush = () => { if (buf.length) { html += "<pre><code>" + buf.map(l => this.esc(l)).join("\n") + "</code></pre>"; buf = []; } };
    lines.forEach(line => {
      const t = line.trim();
      if (t.startsWith("```")) { if (inCode) { flush(); inCode = false; } else { flush(); inCode = true; } return; }
      if (inCode) { buf.push(line); return; }
      if (!t) html += "<div><br></div>";
      else if (t.startsWith("### ")) html += "<h3>" + this.inline(t.slice(4)) + "</h3>";
      else if (t.startsWith("## ")) html += "<h2>" + this.inline(t.slice(3)) + "</h2>";
      else if (t.startsWith("# ")) html += "<h1>" + this.inline(t.slice(2)) + "</h1>";
      else if (/^- \[x\]/i.test(t)) html += '<div class="todo done"><span class="box"></span><span>' + this.inline(t.replace(/^- \[x\]/i, "")) + "</span></div>";
      else if (/^- \[ \]/.test(t)) html += '<div class="todo"><span class="box"></span><span>' + this.inline(t.replace(/^- \[ \]/, "")) + "</span></div>";
      else if (t.startsWith("- ")) html += "<ul><li>" + this.inline(t.slice(2)) + "</li></ul>";
      else if (/^\d+\.\s/.test(t)) html += "<ol><li>" + this.inline(t.replace(/^\d+\.\s/, "")) + "</li></ol>";
      else if (t.startsWith("> ")) html += "<blockquote>" + this.inline(t.slice(2)) + "</blockquote>";
      else html += "<div>" + this.inline(line) + "</div>";
    });
    flush();
    return html || "<div><br></div>";
  },
  mdFromNode(node) {
    const md = [];
    const walk = (el) => {
      el.childNodes.forEach(cn => {
        if (cn.nodeType === 3) { md.push(cn.nodeValue); return; }
        if (cn.nodeType !== 1) return;
        const tag = cn.tagName;
        const inner = () => { walk(cn); };
        if (tag === "H1") { md.push("\n# "); inner(); md.push("\n"); }
        else if (tag === "H2") { md.push("\n## "); inner(); md.push("\n"); }
        else if (tag === "H3") { md.push("\n### "); inner(); md.push("\n"); }
        else if (tag === "LI") { md.push("- "); inner(); md.push("\n"); }
        else if (tag === "BLOCKQUOTE") { md.push("\n> "); inner(); md.push("\n"); }
        else if (tag === "PRE") { md.push("\n```\n"); inner(); md.push("\n```\n"); }
        else if (tag === "STRONG") { md.push("**"); inner(); md.push("**"); }
        else if (tag === "CODE") { md.push("`"); inner(); md.push("`"); }
        else if (tag === "BR") { md.push("\n"); }
        else if (tag === "SPAN" && cn.classList && cn.classList.contains("box")) { /* 待办框不输出 */ }
        else if (tag === "DIV" && cn.classList && cn.classList.contains("todo")) {
          md.push((cn.classList.contains("done") ? "- [x] " : "- [ ] "));
          walk(cn);
        }
        else if (tag === "UL" || tag === "OL" || tag === "P" || tag === "DIV") { walk(cn); if (md.length && md[md.length-1] !== "\n") md.push("\n"); }
        else { inner(); }
      });
    };
    walk(node);
    return md.join("").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  },
  htmlToMd(root) { return this.mdFromNode(root); },

  /* ---------- 导出 Word（单条） ---------- */
  async ensureDocx() {
    if (window.docx) return true;
    return new Promise(res => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/docx@8.5.0/build/index.umd.js";
      s.onload = () => res(!!window.docx);
      s.onerror = () => res(false);
      document.head.appendChild(s);
    });
  },
  mdToDocxChildren(md) {
    const lines = String(md || "").replace(/\r/g, "").split("\n");
    const children = [];
    const runs = (t, base = {}) => {
      const parts = t.split(/(\*\*.+?\*\*|`[^`]+`)/g).filter(Boolean);
      return parts.map(p => {
        if (p.startsWith("**") && p.endsWith("**")) return new docx.TextRun({ ...base, text: p.slice(2, -2), bold: true });
        if (p.startsWith("`") && p.endsWith("`")) return new docx.TextRun({ ...base, text: p.slice(1, -1), font: "Consolas" });
        return new docx.TextRun({ ...base, text: p });
      });
    };
    const P = (t, o = {}) => new docx.Paragraph({ ...o, children: runs(t, o) });
    let inCode = false, codeBuf = [];
    lines.forEach(line => {
      const t = line.trim();
      if (t.startsWith("```")) { if (inCode) { children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: codeBuf.join("\n"), font: "Consolas" })], spacing: { after: 120 } })); codeBuf = []; inCode = false; } else inCode = true; return; }
      if (inCode) { codeBuf.push(line); return; }
      if (!t) return;
      if (t.startsWith("### ")) children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_3, children: runs(t.slice(4)) }));
      else if (t.startsWith("## ")) children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: runs(t.slice(3)) }));
      else if (t.startsWith("# ")) children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: runs(t.slice(2)) }));
      else if (/^- \[x\]/i.test(t)) children.push(P("☑ " + t.replace(/^- \[x\]/i, "").trim()));
      else if (/^- \[ \]/.test(t)) children.push(P("☐ " + t.replace(/^- \[ \]/, "").trim()));
      else if (t.startsWith("- ")) children.push(new docx.Paragraph({ bullet: { level: 0 }, children: runs(t.slice(2)) }));
      else if (/^\d+\.\s/.test(t)) children.push(new docx.Paragraph({ numbering: { reference: "num", level: 0 }, children: runs(t.replace(/^\d+\.\s/, "")) }));
      else if (t.startsWith("> ")) children.push(new docx.Paragraph({ indent: { left: 480 }, children: runs(t.slice(2)) }));
      else children.push(P(line));
    });
    return children;
  },
  download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  async exportDocx(filename, md) {
    const ok = await this.ensureDocx();
    if (ok) {
      const children = this.mdToDocxChildren(md);
      const doc = new docx.Document({
        numbering: { config: [{ reference: "num", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: docx.AlignmentType.LEFT }] }] },
        sections: [{ children }]
      });
      const blob = await docx.Packer.toBlob(doc);
      this.download(blob, filename + ".docx");
      return "docx";
    }
    // 降级：Word 兼容 HTML（.doc）
    const body = this.mdToHtml(md).replace(/<div><br><\/div>/g, "<p></p>")
      .replace(/<div>/g, "<p>").replace(/<\/div>/g, "</p>")
      .replace(/<ul><li>/g, "<p>• ").replace(/<\/li><\/ul>/g, "</p>")
      .replace(/<ol><li>/g, "<p>1. ").replace(/<\/li><\/ol>/g, "</p>");
    const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>' + this.esc(filename) + '</title></head><body>' + body + "</body></html>";
    this.download(new Blob(["\ufeff", html], { type: "application/msword" }), filename + ".doc");
    return "doc";
  }
};
