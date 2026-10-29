/* 「今天」工作台 · 单页应用逻辑 V5.17（2026-10-29 DDL 定位键改 _rid，修"点 A 开 B"）
 * 5 个功能视图合并于一个 document，避免资料库 page 运行时二次导航导致 SDK 失效；
 * 数据读写在 assets/db.js（资料库 database 实时同步）。
 * 版本沿革：V5.1 单页化 → V5.3 非整点课归行修复 → V5.5 同名课同色 → V5.6 可选字段容错
 *          → V5.7 同名课字段继承 → V5.9 首页 DDL 一键完成（含撤销）→ V5.10 单双周 + 周次过滤
 *          → V5.15 DDL 支持编辑与删除（弹窗复用为编辑态 + 乐观删除 5 秒可撤销）
 *          → V5.16 DDL 页编辑改悬停铅笔（与课表一致），首页编辑只留 ✎ 图标
 *          → V5.17 DDL 定位键由业务编号改为资料库行 ID _rid（编号重复导致"点后一条打开前一条"），
 *                  并给 nextDdlId 加防重、撤销删除时避免二次撞号 */
(function () {
  var APP_ = window.APP, DB = APP_.DB;
  var curView = "home", curCourseId = null, editingId = null, editorReady = false;

  /* ---------- 工具 ---------- */
  /* V5.9：toast 支持一个可选的动作按钮（用于「完成 DDL」后的 5 秒撤销） */
  function toast(msg, actionLabel, actionFn) {
    var t = document.getElementById("toast"); if (!t) return;
    t.innerHTML = '<span>' + escapeHtml(msg) + '</span>' +
      (actionLabel ? '<button type="button" class="toast-btn" id="toastAction">' + escapeHtml(actionLabel) + '</button>' : "");
    if (actionLabel && actionFn) {
      document.getElementById("toastAction").onclick = function () { t.classList.remove("show"); actionFn(); };
    }
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("show"); }, actionLabel ? 5200 : 2400);
  }
  /* V5.6：字段缺失（undefined / null）一律渲染为空，避免出现字面量 "undefined" */
  function escapeHtml(s) { return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]); }); }
  /* 把若干可选字段拼成 "A · B"，自动跳过空值，避免出现孤立的 " · " */
  function joinMeta() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v === undefined || v === null || String(v).trim() === "" || String(v) === "undefined") continue;
      out.push(escapeHtml(v));
    }
    return out.join(" · ");
  }
  function copy(text, ok) { navigator.clipboard.writeText(text).then(function () { toast(ok); }).catch(function () { window.prompt("复制失败，请手动复制：", text); }); }
  function nowDate() { return new Date(); }
  function todayStr() { var d = nowDate(); return d.getFullYear() + "-" + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate(); }
  function weekOfYear() { var d = nowDate(); var s = new Date(DB.semester_start); var w = Math.floor((d - s) / 86400000 / 7) + 1; return w < 1 ? 0 : w; }
  function daysLeft(due) { return Math.ceil((new Date(due) - nowDate()) / 86400000); }
  function ddlLevel(d) { return d <= 3 ? "red" : d <= 7 ? "amber" : "green"; }
  function ddlLabel(d) { return d < 0 ? "已逾期 " + (-d) + " 天" : d === 0 ? "今天到期" : "还剩 " + d + " 天"; }
  function courseByRef(ref) { return DB.courses.find(function (c) { return c.id === ref || c.name === ref; }); }
  function courseById(id) { return DB.courses.find(function (c) { return c.id === id; }) || courseByRef(id); }
  /* V5.5：同名课程视为同一门课——颜色按课程名归一，取该名称首条记录的颜色；
     避免"一门课一周上两次"在课表上显示成两种颜色的两门课。 */
  function colorOf(c) {
    if (!c) return "#5B8DEF";
    var first = DB.courses.find(function (x) { return x.name === c.name && x.color; });
    return (first && first.color) || c.color || "#5B8DEF";
  }
  /* V5.7：同名课程视为同一门课——「教室 / 教师 / 周次 / 类别 / 备注」这类非时段字段
     缺省时自动继承同名课程相同字段的值（保留"没单独填 = 跟同名课一致"的语义）。
     星期与起止时间是区分上课时段的字段，不参与继承。 */
  function mergedCourse(c) {
    if (!c) return {};
    var sibs = DB.courses.filter(function (x) { return x.name === c.name; });
    var KEYS = ["room", "teacher", "weeks", "category", "note", "parity"];
    var o = {};
    KEYS.forEach(function (k) {
      var v = c[k];
      if (v === undefined || v === null || String(v).trim() === "") {
        for (var i = 0; i < sibs.length; i++) {
          var w = sibs[i][k];
          if (w !== undefined && w !== null && String(w).trim() !== "") { v = w; o["_from_" + k] = sibs[i]; break; }
        }
      }
      o[k] = v;
    });
    o.color = colorOf(c);
    return o;
  }
  /* V5.10：单双周 + 周次范围过滤
     「周次」存文本（如 1-16 / 3-11），「单双周」存 select（每周 / 单周 / 双周）。
     统一口径：某一周该不该上这门课，只由 courseInWeek() 决定，全站（周课表网格/课表列表/
     首页今日课表/本周复盘）都用它，避免各处算法不一致。 */
  function weekLabelText(wk) {
    if (!wk || wk < 1) return "第 0 周";
    return "第 " + wk + " 周 · " + (wk % 2 === 1 ? "单周" : "双周");
  }
  function weekRangeOf(c) {
    var s = String(mergedCourse(c).weeks || "").replace(/[^\d\-~—]/g, "");
    var m = s.match(/(\d+)\s*[-~—]\s*(\d+)/);
    var a, b;
    if (m) { a = +m[1]; b = +m[2]; } else if (/^\d+$/.test(s)) { a = b = +s; } else { a = 1; b = 16; }
    if (a > b) { var t = a; a = b; b = t; }
    return [a, b];
  }
  function parityOf(c) {
    var p = String(mergedCourse(c).parity || "");
    return (p === "单周" || p === "双周") ? p : "每周";
  }
  function parityLabel(c) { var p = parityOf(c); return p === "每周" ? "" : p; }
  function courseInWeek(c, wk) {
    if (!wk || wk < 1) return true;            /* 未开学（第 0 周）：不过滤，照常展示 */
    var r = weekRangeOf(c);
    if (wk < r[0] || wk > r[1]) return false;
    var p = parityOf(c);
    if (p === "单周") return wk % 2 === 1;
    if (p === "双周") return wk % 2 === 0;
    return true;
  }
  function sharedColorOf(name, excludeId) {
    var hit = DB.courses.find(function (c) { return c.name === name && c.id !== excludeId && c.color; });
    return hit ? hit.color : null;
  }
  function elv(id) { var v = document.getElementById("view-" + curView); return (v && v.querySelector("#" + id)) || document.getElementById(id); }

  /* ---------- 今日视图 ---------- */
  function renderHome() {
    var d = nowDate();
    var today = d.getDay() === 0 ? 7 : d.getDay();
    var wk = weekOfYear();
    var el = function (id) { return document.getElementById(id); };
    el("weekLabel").textContent = weekLabelText(wk);
    elv("dateLine").textContent = d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 · 星期" + ["日", "一", "二", "三", "四", "五", "六"][d.getDay()] + " · " + weekLabelText(wk);
    /* V5.10：今日课表同样按「周次范围 + 单双周」过滤，本周不该上的课不出现在今天 */
    var todays = DB.courses.filter(function (c) { return c.weekday === today && courseInWeek(c, wk); }).sort(function (a, b) { return a.start.localeCompare(b.start); });
    var todos = DB.ddl.filter(function (x) { return x.status === "todo"; }).sort(function (a, b) { return new Date(a.due) - new Date(b.due); });
    var nearest = todos[0] ? daysLeft(todos[0].due) : null;
    var h = d.getHours();
    el("hello").textContent = h < 6 ? "夜深了" : (h < 12 ? "早上好" : (h < 18 ? "下午好" : "晚上好"));
    var nearestChip = nearest === null ? '<span class="hero-chip">DDL <b class="hl-green">暂无</b></span>'
      : '<span class="hero-chip">最近 DDL <b class="hl-red">' + ddlLabel(nearest) + '</b></span>';
    el("heroChips").innerHTML =
      '<span class="hero-chip">今天 <b class="hl-blue">' + todays.length + ' 节课</b></span>' +
      nearestChip +
      '<span class="hero-chip">第 <b>' + wk + '</b> 周</span>' +
      '<span class="hero-chip">待办 <b class="hl-blue">' + todos.length + '</b> 项</span>';
    el("todayCount").textContent = "共 " + todays.length + " 节";
    var tl = el("timeline");
    if (!todays.length) { tl.innerHTML = '<div class="empty">今天没课，去图书馆吧</div>'; }
    else {
      tl.innerHTML = todays.map(function (c) {
        var mc = mergedCourse(c);
        var st = "", s = new Date(), e = new Date(), sh = c.start.split(":")[0], sm = c.start.split(":")[1], eh = c.end.split(":")[0], em = c.end.split(":")[1];
        s.setHours(+sh, +sm, 0, 0); e.setHours(+eh, +em, 0, 0);
        st = d > e ? "past" : (d >= s ? "live" : "");
        return '<div class="tl-item ' + st + '" onclick="gotoCourse(\'' + encodeURIComponent(c.id) + '\')">' +
          '<div class="row"><span class="name">' + escapeHtml(c.name) + '</span><span class="chip gray">' + escapeHtml(c.category) + '</span>' +
          (st === "live" ? '<span class="chip red">进行中</span>' : (st === "past" ? '<span class="chip gray">已结束</span>' : '')) +
          '<span class="goto">进入资料库 →</span></div>' +
          '<div class="row" style="margin-top:6px"><span class="time">' + c.start + ' – ' + c.end + '</span>' +
          '<span class="room">' + joinMeta(mc.room, mc.teacher) + '</span></div></div>';
      }).join("");
    }
    var dlEl = el("ddlList"), top5 = todos.slice(0, 5);
    if (!top5.length) { dlEl.innerHTML = '<div class="empty">没有待办 DDL，干得漂亮</div>'; }
    else {
      dlEl.innerHTML = top5.map(function (x) {
        var dlv = daysLeft(x.due), c = courseByRef(x.course);
        var nav = c ? "gotoCourse('" + encodeURIComponent(c.id) + "')" : "go('ddl')";
        return '<div class="ddl-row" onclick="' + nav + '">' +
          '<div class="bar ' + ddlLevel(dlv) + '"></div>' +
          '<div class="main"><div class="title">' + escapeHtml(x.title) + ' <span class="tag">' + escapeHtml(x.type) + '</span></div>' +
          '<div class="meta">' + escapeHtml(x.course) + ' · ' + x.due.replace("T", " ") + '</div></div>' +
          '<div class="actions"><span class="chip ' + ddlLevel(dlv) + '">' + ddlLabel(dlv) + '</span>' +
          /* V5.9：首页直接点「完成」，不必先跳去 DDL 页；stopPropagation 避免同时触发整行跳转
             V5.15：首页也能直接改；删除收进编辑弹窗，卡片上不放危险按钮 */
          '<button class="btn small" onclick="event.stopPropagation();openDdlModal(\'' + escapeHtml(x._rid) + '\')" title="编辑（删除在里面）" style="padding:0 9px">✎</button>' +
          '<button class="btn small primary" title="标记完成（5 秒内可撤销）" onclick="event.stopPropagation();finish(\'' + escapeHtml(x._rid) + '\')">✓ 完成</button></div></div>';
      }).join("");
    }
  }

  /* ---------- 课表视图 ---------- */
  var SLOTS = [
    { label: "1-2节", t: "08:00", slot: 0 }, { label: "3-4节", t: "10:00", slot: 1 },
    { label: "5-6节", t: "14:00", slot: 2 }, { label: "7-8节", t: "16:00", slot: 3 },
    { label: "9-10节", t: "19:00", slot: 4 }
  ];
  /* V5.3：按"开始时间最接近哪个标准节次"归行，任何时间都能落进某一行，
     修复旧逻辑 hourToSlot[小时] 精确匹配导致的"13:30 / 09:00 等整点外的课被网格吞掉"。
     注意：h 是节次编号（5-6 节），不是小时，勿混。 */
  function toMin(t) { var p = String(t || "").split(":"); return ((+p[0]) || 0) * 60 + ((+p[1]) || 0); }
  function slotIndexOf(start) {
    var m = toMin(start), best = 0, bestDiff = Infinity;
    SLOTS.forEach(function (s, i) {
      var diff = Math.abs(toMin(s.t) - m);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    return best;
  }
  var PALETTE = ["#E6F1FB", "#E1F5EE", "#FAEEDA", "#FBEAF0", "#EAF3DE", "#EEEDFE", "#FCEBEB"];
  var DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  function chipHtml(c, slotT) {
    /* 开始时间与所在行的标准时间不一致时（如 13:30 落在 5-6 节行），显示真实时间避免误读 */
    var mc = mergedCourse(c);
    var sub = joinMeta(mc.room, (slotT && c.start && c.start !== slotT) ? c.start : "", parityLabel(c));
    return '<a class="course-chip" style="background:' + colorOf(c) + ';color:#3A4150" href="#" onclick="return gotoCourse(\'' + encodeURIComponent(c.id) + '\')">' +
      escapeHtml(c.name) + '<div class="r">' + sub + '</div>' +
      '<button class="chip-edit" onclick="event.preventDefault();event.stopPropagation();openModal(\'' + encodeURIComponent(c.id) + '\')">✎</button></a>';
  }
  function renderSchedule() {
    var today = nowDate().getDay() === 0 ? 7 : nowDate().getDay();
    var wk = weekOfYear();
    document.getElementById("weekLabel").textContent = weekLabelText(wk);
    var grid = '<div class="wt"></div>';
    DAYS.forEach(function (d, i) { grid += '<div class="wh">' + (i + 1 === today ? '<span style="color:#185FA5">' + d + '</span>' : d) + '</div>'; });
    SLOTS.forEach(function (sl) {
      grid += '<div class="wt">' + sl.label + '<br>' + sl.t + '</div>';
      for (var day = 1; day <= 7; day++) {
        /* V5.10：本周不上（周次范围外 / 单双周不符）的课程不再画进网格 */
        var cells = DB.courses.filter(function (c) { return c.weekday === day && slotIndexOf(c.start) === sl.slot && courseInWeek(c, wk); })
          .sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
        grid += '<div class="week-cell">' + cells.map(function (c) { return chipHtml(c, sl.t); }).join("") + '</div>';
      }
    });
    document.getElementById("weekGrid").innerHTML = grid;
    var list = "";
    DAYS.forEach(function (d, i) {
      var cs = DB.courses.filter(function (c) { return c.weekday === i + 1 && courseInWeek(c, wk); }).sort(function (a, b) { return a.start.localeCompare(b.start); });
      if (!cs.length) return;
      list += '<div class="note-group"><div class="gh"><span class="dots" style="background:#5B8DEF"></span><span style="font-weight:500">' + d + '</span></div>';
      list += cs.map(function (c) {
        var mc = mergedCourse(c);
        return '<div class="file-row" style="cursor:pointer" onclick="gotoCourse(\'' + encodeURIComponent(c.id) + '\')">' +
          '<div class="ic">课</div><div><div class="fn">' + escapeHtml(c.name) + '</div><div class="fm">' + joinMeta(c.start ? c.start + ' – ' + c.end : "", mc.room, mc.teacher, parityLabel(c)) + '</div></div>' +
          '<button class="btn small" style="margin-left:auto" onclick="event.stopPropagation();openModal(\'' + encodeURIComponent(c.id) + '\')">编辑</button></div>';
      }).join("");
      list += '</div>';
    });
    document.getElementById("weekList").innerHTML = list || '<div class="empty">本周暂无课程，点「添加课程」试试</div>';
  }

  window.openModal = function (id) {
    var c = id ? courseById(decodeURIComponent(id)) : null;
    editingId = c ? c.id : null;
    document.getElementById("modalTitle").textContent = c ? "编辑课程" : "添加课程";
    document.getElementById("f-name").value = c ? c.name : "";
    document.getElementById("f-weekday").value = c ? c.weekday : 1;
    document.getElementById("f-category").value = c ? c.category : "必修";
    document.getElementById("f-start").value = c ? c.start : "08:00";
    document.getElementById("f-end").value = c ? c.end : "09:40";
    /* V5.6：字段可能缺失，缺省填空串——直接赋 undefined 会让输入框显示 "undefined" 并污染数据
       V5.7：留空 = 继续跟同名课程保持一致，用 placeholder 把继承到的值显示出来（不写进数据） */
    var mc = c ? mergedCourse(c) : null;
    var fr = document.getElementById("f-room"), ft = document.getElementById("f-teacher"), fw = document.getElementById("f-weeks"), fp = document.getElementById("f-parity");
    var dayName = function (x) { return x ? "周" + "一二三四五六日"[x.weekday - 1] + " " : ""; };
    fr.value = (c && c.room) || "";
    ft.value = (c && c.teacher) || "";
    fw.value = (c && c.weeks) || "";
    /* V5.10：单双周下拉——自身没填就带出同名课程继承到的值（下拉没有 placeholder，直接预选更直观） */
    fp.value = (c && c.parity) || (mc && mc.parity) || "每周";
    document.getElementById("f-note").value = (c && c.note) || "";
    fr.placeholder = (c && !c.room && mc.room) ? "同「" + c.name + "」" + dayName(mc._from_room) + mc.room : "如：教三 402";
    ft.placeholder = (c && !c.teacher && mc.teacher) ? "同「" + c.name + "」" + dayName(mc._from_teacher) + mc.teacher : "如：张伟";
    fw.placeholder = (c && !c.weeks && mc.weeks) ? "同「" + c.name + "」" + mc.weeks : "如：1-16";
    document.getElementById("delBtn").style.visibility = c ? "visible" : "hidden";
    document.getElementById("mask").classList.add("show");
  };
  window.closeModal = function () { document.getElementById("mask").classList.remove("show"); };
  window.saveCourse = function () {
    var name = document.getElementById("f-name").value.trim();
    if (!name) { toast("课程名不能为空"); return; }
    var old = editingId ? courseById(editingId) : null;
    var rec = {
      id: editingId || name, name: name,
      weekday: +document.getElementById("f-weekday").value,
      category: document.getElementById("f-category").value,
      start: document.getElementById("f-start").value,
      end: document.getElementById("f-end").value,
      room: document.getElementById("f-room").value.trim(),
      teacher: document.getElementById("f-teacher").value.trim(),
      /* 周次留空 → 沿用同名课程的周次；再兜底 1-16 */
      weeks: (document.getElementById("f-weeks").value.trim() || (old && mergedCourse(old).weeks) || "1-16"),
      /* V5.10：单双周（每周 / 单周 / 双周），默认每周 */
      parity: document.getElementById("f-parity").value || "每周",
      note: document.getElementById("f-note").value.trim(),
      /* 同名课程复用已有颜色，保证"同一门课"视觉一致 */
      color: sharedColorOf(name, editingId) || (old ? old.color : PALETTE[(DB.courses.length + 1) % PALETTE.length])
    };
    var job = old && old._rid ? APP_.upd("courses", old._rid, rec) : APP_.add("courses", rec);
    job.then(function () { closeModal(); renderSchedule(); toast("已保存到线上资料库 ✓ 换设备数据都在"); })
       .catch(function (e) { toast("保存失败：" + ((e && e.message) || "请稍后重试")); });
  };
  window.delCourse = function () {
    if (!editingId) return;
    var old = courseById(editingId);
    if (!old || !old._rid) return;
    APP_.del("courses", old._rid).then(function () { closeModal(); renderSchedule(); toast("已删除课程（线上同步）"); })
       .catch(function (e) { toast("删除失败：" + ((e && e.message) || "请稍后重试")); });
  };
  window.refreshAll = function () {
    APP_.load(["courses"]).then(function () { renderSchedule(); toast("已与线上资料库同步 ✓"); })
       .catch(function (e) { toast("刷新失败：" + ((e && e.message) || "请稍后重试")); });
  };

  /* ---------- DDL 视图 ---------- */
  /* V5.17：DDL 的定位键一律用资料库行 ID（_rid），不再用「编号」。
     原因：编号是自增生成的业务字段，出现过重复（ddl21 / ddl22 各两条），
     而所有操作都用 find(r => r.id === id) 取第一条，点后一条会打开前一条——就是"编辑页不是我点的那条"这个 bug。
     _rid 由资料库保证唯一，换成它之后编号撞车也不会互相串。 */
  function ddlByRid(rid) { return DB.ddl.find(function (r) { return r._rid === rid; }); }
  /* V5.16：DDL 页的编辑收成右上角悬停小铅笔（CSS .ddl-edit 默认 display:none，hover 才浮出），
     与课表 chip 的交互保持一致；stopPropagation 防整行跳转 */
  function pencilBtn(rid) {
    return '<button class="ddl-edit" title="编辑（删除在里面）" onclick="event.stopPropagation();openDdlModal(\'' + escapeHtml(rid) + '\')">✎</button>';
  }
  function ddlCard(x) {
    var lv = ddlLevel(daysLeft(x.due)), c = courseByRef(x.course);
    var nav = c ? "gotoCourse('" + encodeURIComponent(c.id) + "')" : "";
    return '<div class="ddl-row" ' + (nav ? 'onclick="' + nav + '"' : '') + '>' +
      '<div class="bar ' + lv + '"></div>' +
      '<div class="main"><div class="title">' + escapeHtml(x.title) + ' <span class="tag">' + escapeHtml(x.type) + '</span></div>' +
      '<div class="meta">' + escapeHtml(x.course) + ' · ' + x.due.replace("T", " ") + (x.postponed_count ? ' · 已延期 ' + x.postponed_count + ' 次' : '') + '</div></div>' +
      /* V5.16：编辑收成右上角悬停铅笔（与课表一致），卡片表面只剩顺延/完成 */
      pencilBtn(x._rid) +
      '<div class="actions"><span class="chip ' + lv + '">' + ddlLabel(daysLeft(x.due)) + '</span>' +
      '<button class="btn small" onclick="event.stopPropagation();postpone(\'' + escapeHtml(x._rid) + '\')">顺延</button>' +
      '<button class="btn small primary" onclick="event.stopPropagation();finish(\'' + escapeHtml(x._rid) + '\')">完成</button></div></div>';
  }
  function renderDdl() {
    var d = nowDate();
    document.getElementById("weekLabel").textContent = weekLabelText(weekOfYear());
    elv("dateLine").textContent = d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
    var items = DB.ddl;
    var todo = items.filter(function (x) { return x.status === "todo"; });
    var done = items.filter(function (x) { return x.status === "done"; });
    var ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay() + 1); ws.setHours(0, 0, 0, 0);
    var weekNew = items.filter(function (x) { return new Date(x.created_at) >= ws; }).length;
    var postponed = items.reduce(function (s, x) { return s + (x.postponed_count || 0); }, 0);
    document.getElementById("statbar").innerHTML =
      '<div class="stat"><div class="num">' + todo.length + '</div><div class="lbl">待办 DDL</div></div>' +
      '<div class="stat"><div class="num">' + weekNew + '</div><div class="lbl">本周新增</div></div>' +
      '<div class="stat"><div class="num">' + done.length + '</div><div class="lbl">已完成</div></div>' +
      '<div class="stat"><div class="num">' + postponed + '</div><div class="lbl">累计延期</div></div>';
    var cols = [
      { key: "red", name: "紧急", hint: "≤ 3 天" },
      { key: "amber", name: "临近", hint: "4-7 天" },
      { key: "green", name: "稍后", hint: "> 7 天" }
    ];
    document.getElementById("board").innerHTML = cols.map(function (col) {
      var list = todo.filter(function (x) { return ddlLevel(daysLeft(x.due)) === col.key; }).sort(function (a, b) { return new Date(a.due) - new Date(b.due); });
      var card = list.map(ddlCard).join("");
      return '<div class="board-col"><h3><span class="dots" style="width:8px;height:8px;border-radius:50%;background:var(--' + col.key + ')"></span>' + col.name + ' <span class="count">' + list.length + ' · ' + col.hint + '</span></h3>' +
        (card || '<div class="empty" style="padding:18px 8px;background:#fff;border:1px dashed var(--line);border-radius:10px">暂无</div>') + '</div>';
    }).join("");
    document.getElementById("doneList").innerHTML = done.length ? done.map(function (x) {
      var c = courseByRef(x.course), nav = c ? "gotoCourse('" + encodeURIComponent(c.id) + "')" : "";
      return '<div class="ddl-row done" ' + (nav ? 'onclick="' + nav + '"' : '') + '>' +
        '<div class="bar gray"></div><div class="main"><div class="title">' + escapeHtml(x.title) + '</div>' +
        '<div class="meta">' + escapeHtml(x.course) + ' · ' + x.due.replace("T", " ") + ' 完成</div></div>' +
        pencilBtn(x._rid) +
        '<div class="actions">' +
        '<button class="btn small" onclick="event.stopPropagation();undoFinish(\'' + escapeHtml(x._rid) + '\')">恢复待办</button></div></div>';
    }).join("") : '<div class="empty">还没有完成的 DDL，点「完成」就会出现在这里</div>';
  }
  /* V5.9：一键完成 = 本地立刻生效 + 线上异步写 + 5 秒内可撤销（防手滑）
     V5.17：入参改为 _rid（见 ddlByRid 注释） */
  window.finish = function (rid) {
    var x = ddlByRid(rid);
    if (!x || !x._rid) return;
    x.status = "done";
    renderDdl(); renderHome();
    toast("「" + x.title + "」已完成 ✓ 已同步线上", "撤销", function () { undoFinish(id); });
    APP_.upd("ddl", x._rid, { status: "done" }).catch(function (e) {
      x.status = "todo"; renderDdl(); renderHome();
      toast("同步失败，已还原：" + ((e && e.message) || "请稍后重试"));
    });
  };
  window.undoFinish = function (rid) {
    var x = ddlByRid(rid);
    if (!x || !x._rid) return;
    x.status = "todo";
    renderDdl(); renderHome();
    APP_.upd("ddl", x._rid, { status: "todo" }).then(function () { toast("已撤销，「" + x.title + "」回到待办"); })
      .catch(function (e) { x.status = "done"; renderDdl(); renderHome(); toast("撤销失败：" + ((e && e.message) || "请稍后重试")); });
  };
  /* ---------- 添加 DDL（V5.4） ---------- */
  function nextDdlId() {
    var max = 0;
    DB.ddl.forEach(function (x) {
      var m = String(x.id || "").match(/(\d+)$/);
      if (m) max = Math.max(max, +m[1]);
    });
    /* V5.17：编号只是展示用的业务字段（定位已改走 _rid），但仍要保证不撞车——
       万一库里已有同号，继续往上找空位，别再制造重复。 */
    var n = max + 1;
    while (DB.ddl.some(function (x) { return x.id === "ddl" + n; })) n++;
    return "ddl" + n;
  }
  function defaultDue() {
    var d = nowDate();
    d.setDate(d.getDate() + 3);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T23:59";
  }
  /* V5.15：线上的 index.html 带平台注入的 data-page-node-id，动一个标签就要重跑 page 编辑 + pnid 重绑，
     所以弹窗标题、删除按钮这些 UI 增量一律由 JS 注入，保持 HTML 与线上零 diff。
     副作用：本机 file:// 打开也照样有这些按钮，不必依赖平台重新解析。 */
  function ddlDelBtn() {
    var foot = document.querySelector("#ddlMask .foot");
    if (!foot) return null;
    var btn = document.getElementById("ddlDelBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "ddlDelBtn";
      btn.className = "btn ghost";
      btn.textContent = "删除";
      btn.onclick = function () { delDdl(); };
      /* 插到「说明文字」和「取消」之间，并把 auto 外边距从说明挪到删除上，保证左删右确认的布局 */
      foot.insertBefore(btn, foot.children[1] || null);
      var tip = foot.querySelector(".muted");
      /* 整段重写而不是改 marginRight：这行 inline 里本来就有 margin-right:auto，逐个属性覆盖不保险 */
      if (tip) tip.setAttribute("style", "font-size:12px;color:#A8AEB8");
      btn.setAttribute("style", "margin-right:auto;color:var(--red)");
    }
    return btn;
  }
  /* V5.17：editingDdlId 存的是 _rid（资料库行 ID），不是业务编号 */
  var editingDdlId = null;
  window.openDdlModal = function (rid) {
    var x = rid ? ddlByRid(rid) : null;
    editingDdlId = x ? x._rid : null;
    var h3 = document.querySelector("#ddlMask h3");
    if (h3) h3.textContent = x ? "编辑 DDL" : "添加 DDL";
    var delB = ddlDelBtn();
    if (delB) delB.style.visibility = x ? "visible" : "hidden";
    /* 编辑态顺手把底部说明换成删除提示——删除只在弹窗里，得让人知道它在这儿 */
    var tip = document.querySelector("#ddlMask .foot .muted");
    if (tip) tip.textContent = x ? "改完保存即同步 · 删除后 5 秒内可撤销" : "保存即写入线上资料库，换设备都在";
    var sel = document.getElementById("d-course");
    var names = [];
    DB.courses.forEach(function (c) { if (c.name && names.indexOf(c.name) < 0) names.push(c.name); });
    /* V5.15：编辑的课程可能已从课表删掉，补进下拉，避免它被静默改成第一门课 */
    if (x && x.course && names.indexOf(x.course) < 0) names.push(x.course);
    if (names.indexOf("—") < 0) names.push("—");
    sel.innerHTML = names.map(function (n) {
      return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n === "—" ? "—（不关联课程）" : n) + '</option>';
    }).join("");
    document.getElementById("d-title").value = x ? (x.title || "") : "";
    /* 截止字段库里可能是 "2026-10-21 23:59" 或带秒，统一成 datetime-local 认的 16 位 */
    document.getElementById("d-due").value = x && x.due ? String(x.due).replace(" ", "T").slice(0, 16) : defaultDue();
    document.getElementById("d-type").value = x && x.type ? x.type : "作业";
    document.getElementById("d-min").value = x ? (x.estimate_minutes || 0) : 60;
    sel.value = x && x.course ? x.course : "—";
    document.getElementById("ddlMask").classList.add("show");
    setTimeout(function () { document.getElementById("d-title").focus(); }, 60);
  };
  window.closeDdlModal = function () { document.getElementById("ddlMask").classList.remove("show"); editingDdlId = null; };
  window.quickAddDdl = function () { go("ddl"); openDdlModal(); return false; };
  window.saveDdl = function () {
    var title = document.getElementById("d-title").value.trim();
    var due = document.getElementById("d-due").value.trim();
    if (!title) { toast("任务名不能为空"); return; }
    if (!due) { toast("选一个截止时间"); return; }
    var patch = {
      title: title,
      course: document.getElementById("d-course").value || "—",
      due: due.slice(0, 16),
      type: document.getElementById("d-type").value,
      estimate_minutes: +document.getElementById("d-min").value || 0
    };
    var done2 = function (word) {
      closeDdlModal();
      if (curView === "ddl") renderDdl(); else renderHome();
      toast(word + " ✓ 已同步线上");
    };
    if (editingDdlId) {
      var oldRec = ddlByRid(editingDdlId);
      if (!oldRec || !oldRec._rid) { toast("找不到这条记录的线上 ID，请刷新后重试"); return; }
      /* 只传改得动的字段：status / 顺延次数 / 创建日期保持不变 */
      APP_.upd("ddl", oldRec._rid, patch).then(function () { done2("「" + title + "」已更新"); })
        .catch(function (e) { toast("保存失败：" + ((e && e.message) || "请稍后重试")); });
    } else {
      var rec = {
        id: nextDdlId(), status: "todo", postponed_count: 0, created_at: todayStr()
      };
      for (var k in patch) rec[k] = patch[k];
      APP_.add("ddl", rec).then(function () { done2("「" + title + "」已加入 DDL"); })
        .catch(function (e) { toast("添加失败：" + ((e && e.message) || "请从资料库在线版打开后再试")); });
    }
  };
  /* V5.15：删除也做成「乐观更新 + 5 秒撤销」，不用 confirm（沙箱里可能被拦截），手滑有救 */
  window.removeDdl = function (rid) {
    var x = ddlByRid(rid);
    if (!x || !x._rid) return;
    var snap = {
      id: x.id, title: x.title, course: x.course, due: x.due, type: x.type,
      status: x.status, postponed_count: x.postponed_count || 0,
      estimate_minutes: x.estimate_minutes || 0, created_at: x.created_at
    };
    var i = DB.ddl.indexOf(x);
    if (i >= 0) DB.ddl.splice(i, 1);
    renderDdl(); renderHome();
    toast("「" + x.title + "」已删除", "撤销", function () { restoreDdl(snap); });
    APP_.del("ddl", x._rid).catch(function (e) {
      DB.ddl.splice(i, 0, x); renderDdl(); renderHome();
      toast("删除失败，已还原：" + ((e && e.message) || "请稍后重试"));
    });
  };
  /* 撤销删除 = 用快照整条重新写回（编号不变，顺延次数等原样保留） */
  window.restoreDdl = function (s) {
    /* V5.17：撤销删除时若编号已被别的记录占着（历史重复编号），换个空号再写回，避免二次撞号 */
    if (DB.ddl.some(function (r) { return r.id === s.id; })) s.id = nextDdlId();
    APP_.add("ddl", s).then(function () { renderDdl(); renderHome(); toast("已恢复「" + s.title + "」"); })
      .catch(function (e) { toast("恢复失败：" + ((e && e.message) || "请稍后重试")); });
  };
  /* 弹窗里那个「删除」按钮 */
  window.delDdl = function () {
    if (!editingDdlId) return;
    var id = editingDdlId; /* V5.17：此处已是 _rid */
    closeDdlModal();
    removeDdl(id);
  };
  window.postpone = function (rid) {
    var x = ddlByRid(rid);
    if (!x || !x._rid) return;
    var due = new Date(x.due); due.setDate(due.getDate() + 1);
    var nd = due.toISOString().slice(0, 16);
    APP_.upd("ddl", x._rid, { due: nd, postponed_count: (x.postponed_count || 0) + 1 }).then(function () { toast("已顺延到 " + nd.replace("T", " ") + " ✓ 已同步线上"); renderDdl(); renderHome(); })
       .catch(function (e) { toast("操作失败：" + ((e && e.message) || "请稍后重试")); });
  };

  /* ---------- 笔记库视图 ---------- */
  function exportNoteFile(n) {
    NOTE_LIB.exportDocx(n.course + "-" + n.date + "-笔记", n.content).then(function (kind) { toast(kind === "docx" ? "Word 已生成（.docx）" : "Word 已生成（.doc 兼容格式）"); });
  }
  window.exportOne = exportNoteFile;
  function renderNotes() {
    document.getElementById("weekLabel").textContent = weekLabelText(weekOfYear());
    var dateEl = elv("dateLine");
    if (dateEl) { var d = nowDate(); dateEl.textContent = d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 · 星期" + "日一二三四五六"[d.getDay()]; }
    var groups = {};
    DB.notes.forEach(function (n) { (groups[n.course] = groups[n.course] || []).push(n); });
    var count = DB.notes.length;
    document.getElementById("countLine").textContent = count + " 条 · 云端同步，换设备都在";
    var ge = document.getElementById("groups");
    if (!count) { ge.innerHTML = '<div class="empty">笔记库还是空的。去课程资料库写笔记，点「存入资料库」就会出现在这里</div>'; }
    else {
      var html = "";
      Object.keys(groups).forEach(function (name) {
        var c = courseByRef(name);
        var notes = groups[name].sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
        html += '<div class="note-group"><div class="gh"><span class="dots" style="background:' + colorOf(c) + '"></span>' +
          '<span style="font-weight:500">' + escapeHtml(name) + '</span><span class="sub" style="color:#A8AEB8;font-size:12px">' + notes.length + ' 条</span>' +
          (c ? '<a href="#" onclick="return gotoCourse(\'' + encodeURIComponent(c.id) + '\')" style="margin-left:auto;font-size:12px;color:#185FA5">进入资料库 →</a>' : '') + '</div>' +
          notes.map(function (n) {
            var e = JSON.stringify(n).replace(/"/g, "&quot;");
            return '<div class="note-card"><div class="nc-head">' +
              '<span class="badge ok">资料库</span><span class="nc-date">' + (n.date || "") + ' · 第 ' + (n.week || "-") + ' 周</span></div>' +
              '<div class="nc-body">' + escapeHtml(n.content) + '</div>' +
              '<div class="nc-tools"><button class="btn small" onclick="exportOne(' + e + ')">导出 Word</button></div></div>';
          }).join("") + '</div>';
      });
      ge.innerHTML = html;
    }
    /* 本周复盘 */
    var wk = weekOfYear(), ddls = DB.ddl.filter(function (x) { return x.status === "todo"; });
    var weekCourses = DB.courses.filter(function (c) { return courseInWeek(c, wk); });
    var postponed = DB.ddl.reduce(function (s, x) { return s + (x.postponed_count || 0); }, 0);
    var notesCount = DB.notes.length, qaCount = DB.qa.length;
    var nearest = ddls.slice().sort(function (a, b) { return new Date(a.due) - new Date(b.due); })[0];
    document.getElementById("reviewStats").innerHTML =
      '<div class="review-item"><div class="num">' + weekCourses.length + '</div><div class="lbl">本周课程</div></div>' +
      '<div class="review-item"><div class="num">' + ddls.length + '</div><div class="lbl">待办 DDL</div></div>' +
      '<div class="review-item"><div class="num">' + postponed + '</div><div class="lbl">累计延期</div></div>' +
      '<div class="review-item"><div class="num">' + notesCount + '</div><div class="lbl">笔记条数</div></div>' +
      '<div class="review-item"><div class="num">' + qaCount + '</div><div class="lbl">问答沉淀</div></div>';
    document.getElementById("reviewText").textContent =
      "第 " + wk + " 周小结：" + weekCourses.length + " 门课正常推进，" +
      (nearest ? "最近 DDL 是「" + nearest.title + "」（还剩 " + Math.max(0, Math.ceil((new Date(nearest.due) - nowDate()) / 86400000)) + " 天），建议本周内处理" : "暂无待办 DDL，状态良好") +
      "。笔记已沉淀 " + notesCount + " 条，问答沉淀 " + qaCount + " 条。下周继续加油！";
  }
  window.refreshLive = function () {
    APP_.load(["courses", "ddl", "notes", "qa"]).then(function () { renderNotes(); toast("已从线上资料库刷新 ✓"); })
       .catch(function (e) { toast("刷新失败：" + ((e && e.message) || "请从资料库在线打开")); });
  };

  /* ---------- 课程资料库视图 ---------- */
  function bootCourse(id) {
    var course = courseById(id);
    if (!course) { go("home"); return; }
    curCourseId = id;
    document.getElementById("weekLabel").textContent = weekLabelText(weekOfYear());
    var mc = mergedCourse(course);
    var cw = DB.courseware.filter(function (f) { return f.course === course.name; });
    var myNotes = DB.notes.filter(function (n) { return n.course === course.name; });
    var qaMine = DB.qa.filter(function (x) { return x.course === course.name; });
    document.getElementById("head").innerHTML =
      '<div><h1 style="color:#3A4150">' + escapeHtml(course.name) + '</h1>' +
      '<div class="meta">' + joinMeta(mc.teacher, mc.room, (mc.weeks ? "第 " + mc.weeks + " 周" : "") + (parityLabel(course) ? (mc.weeks ? " · " : "") + parityLabel(course) : ""), mc.category) +
      (mc.note ? '<br>' + escapeHtml(mc.note) : '') + '</div></div>' +
      '<div class="stats"><span class="chip gray">课件 ' + cw.length + '</span><span class="chip gray">笔记 ' + myNotes.length + '</span><span class="chip gray">问答 ' + qaMine.length + '</span></div>';
    var headEl = document.querySelector("#view-course .course-head");
    if (headEl) headEl.style.setProperty("--strip", colorOf(course) || "#4C82EF");
    var wk = weekOfYear(), box = document.getElementById("hintBox");
    if (wk === 0) { box.innerHTML = '<div class="hint info">本学期还未开始（第 0 周），课件归档后会显示在这里</div>'; }
    else {
      var has = cw.some(function (f) { return f.week === wk; });
      box.innerHTML = has
        ? '<div class="hint ok">第 ' + wk + ' 周的课件已归档 ✓</div>'
        : '<div class="hint warn">第 ' + wk + ' 周的课件还没归档 —— 把 PPT/PDF 拖进对话框即可归档 · <a href="#" onclick="return copyCoursewarePrompt()">复制归档指令</a></div>';
    }
    var fe = document.getElementById("files");
    if (!cw.length) { fe.innerHTML = '<div class="empty">还没有课件 · <a href="#" style="color:var(--primary-deep);text-decoration:underline;text-underline-offset:3px" onclick="return copyCoursewarePrompt()">复制归档指令</a>，把 PPT/PDF 拖给我就归档到这门课</div>'; }
    else {
      var g = {};
      cw.slice().sort(function (a, b) { return a.week - b.week; }).forEach(function (f) { (g["第" + f.week + " 周"] = g["第" + f.week + " 周"] || []).push(f); });
      fe.innerHTML = Object.keys(g).map(function (k) {
        return '<div style="font-size:12.5px;color:#7A8291;font-weight:500;margin:10px 0 8px">' + k + '</div>' +
          g[k].map(function (f) {
            return '<div class="file-row"><div class="ic">档</div>' +
              '<div><div class="fn">' + escapeHtml(f.filename) + '</div><div class="fm">' + f.size + ' · ' + f.added_at + '</div></div>' +
              '<a class="open" href="' + escapeHtml(f.path) + '" target="_blank">打开 →</a></div>';
          }).join("");
      }).join("");
    }
    document.getElementById("noteDate").textContent = "今天 · " + todayStr() + " · 第 " + wk + " 周";
    renderQa(course);
    renderSaved(course);
    fillEditor(course);
  }

  function fillEditor(course) {
    var ed = document.getElementById("note");
    if (!ed) return;
    var key = "course-note-" + course.id;
    var local = JSON.parse(localStorage.getItem(key) || "null");
    var myNotes = DB.notes.filter(function (n) { return n.course === course.name; });
    var seed = myNotes.length ? myNotes[myNotes.length - 1].content : "";
    var md = (local && local.content) || seed || "";
    if (ed.innerHTML !== NOTE_LIB.mdToHtml(md)) ed.innerHTML = NOTE_LIB.mdToHtml(md);
    document.getElementById("saveState").textContent = local && local.updatedAt ? "上次保存 " + local.updatedAt.replace("T", " ").slice(5, 16) : "所见即所得，输入自动保存，不丢稿";
  }
  function renderSaved(course) {
    var el = document.getElementById("savedNotes");
    var list = DB.notes.filter(function (n) { return n.course === course.name; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
    if (!list.length) { el.innerHTML = '<div class="empty">还没有存入资料库的笔记，写点内容点「存入资料库」</div>'; return; }
    el.innerHTML = list.map(function (n) {
      var e = JSON.stringify(n).replace(/"/g, "&quot;");
      return '<div class="note-card"><div class="nc-head"><span class="badge ok">资料库</span><span class="nc-date">' + n.date + ' · 第 ' + n.week + ' 周</span></div>' +
        '<div class="nc-body">' + escapeHtml(n.content.slice(0, 160)) + (n.content.length > 160 ? "…" : "") + '</div>' +
        '<div class="nc-tools"><button class="btn small" onclick="exportNote(' + e + ')">导出 Word</button></div></div>';
    }).join("");
  }
  function renderQa(course) {
    var quick = ["总结这周课件的 5 个重点", "帮我讲讲没听懂的地方", "把本课所有内容整理成复习提纲"];
    var qe = document.getElementById("quickQs");
    if (qe) qe.innerHTML = quick.map(function (q) { return '<button class="btn small" onclick="askWith(\'' + q + '\')">' + q + '</button>'; }).join("");
    var pend = DB.qa.filter(function (x) {
      return x.course === course.name || (x.course === "待问清单" && (x.question || "").indexOf(course.name) >= 0);
    }).filter(function (x) { return !x.answer_digest; });
    document.getElementById("pending").innerHTML = pend.length
      ? pend.map(function (p) { return '<div class="pending-item"><span style="flex:1">' + escapeHtml(p.question) + '</span><button class="btn small" onclick="askWith(\'' + escapeHtml(p.question).replace(/'/g, "\\'") + '\')">现在问</button></div>'; }).join("")
      : '<div class="empty" style="padding:14px">清单是空的。笔记里标记「❓没听懂」，问题会自动出现在这里</div>';
    var his = DB.qa.filter(function (x) { return x.course === course.name; }).slice()
      .sort(function (a, b) { return (b.asked_at || "").localeCompare(a.asked_at || ""); });
    document.getElementById("history").innerHTML = his.length ? his.map(function (q) {
      var files = q.related_files && q.related_files.length ? " · 关联课件 " + q.related_files.length + " 份" : "";
      return '<div class="qa-item"><div class="q">Q：' + escapeHtml(q.question) + '</div>' +
        '<div class="a">' + escapeHtml(q.answer_digest || "（已提问，等 WorkBuddy 回复后沉淀到此处）") + '</div>' +
        '<div class="when">' + (q.asked_at || "") + files + '</div></div>';
    }).join("") : '<div class="empty" style="padding:14px">还没有问答记录，问一个试试</div>';
  }

  function initEditorOnce() {
    if (editorReady) return;
    editorReady = true;
    var ed = document.getElementById("note");
    var h = localStorage.getItem("course-note-h-" + (curCourseId || ""));
    if (h) ed.style.height = h + "px";
    (function () {
      var handle = document.getElementById("resizeHandle"), sy = 0, sh = 0, drag = false;
      handle.addEventListener("mousedown", function (e) { drag = true; sy = e.clientY; sh = ed.offsetHeight; e.preventDefault(); });
      document.addEventListener("mousemove", function (e) { if (!drag) return; ed.style.height = Math.max(320, Math.min(1000, sh + e.clientY - sy)) + "px"; });
      document.addEventListener("mouseup", function () { if (drag) { drag = false; localStorage.setItem("course-note-h-" + curCourseId, ed.offsetHeight); } });
    })();
    ed.addEventListener("click", function (e) {
      if (e.target.classList && e.target.classList.contains("box")) { e.target.parentElement.classList.toggle("done"); ed.dispatchEvent(new Event("input")); }
    });
    var timer = null;
    ed.addEventListener("input", function () {
      var st = document.getElementById("saveState");
      st.textContent = "编辑中…";
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!curCourseId) return;
        localStorage.setItem("course-note-" + curCourseId, JSON.stringify({ content: NOTE_LIB.htmlToMd(ed), updatedAt: new Date().toISOString() }));
        var t = new Date();
        st.textContent = "已自动保存 " + String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
      }, 2000);
    });
  }
  function fmtCmd(cmd) { var ed = document.getElementById("note"); ed.focus(); document.execCommand(cmd, false, null); }
  function fmtBlock(tag) {
    var ed = document.getElementById("note"); ed.focus();
    document.execCommand("formatBlock", false, tag === "blockquote" ? "blockquote" : (tag === "pre" ? "pre" : tag.toLowerCase()));
  }
  function fmtCodeInline() {
    var ed = document.getElementById("note"); ed.focus();
    var sel = window.getSelection();
    if (sel.rangeCount) { var r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode("`")); }
    document.execCommand("insertText", false, "`"); ed.focus();
  }
  function fmtTodo() {
    var ed = document.getElementById("note"); ed.focus();
    document.execCommand("insertHTML", false, '<div class="todo"><span class="box"></span><span>待办事项</span></div>');
  }
  function fmtUnclear() {
    var ed = document.getElementById("note"); ed.focus();
    document.execCommand("insertText", false, "❓没听懂：");
  }
  window.fmtCmd = fmtCmd; window.fmtBlock = fmtBlock; window.fmtCodeInline = fmtCodeInline; window.fmtTodo = fmtTodo; window.fmtUnclear = fmtUnclear;

  window.saveNote = function () {
    var ed = document.getElementById("note");
    var md = NOTE_LIB.htmlToMd(ed).trim();
    if (!md) { toast("先写点内容再保存"); return; }
    var course = courseById(curCourseId);
    if (!course) return;
    APP_.add("notes", { date: todayStr(), course: course.name, week: weekOfYear(), content: md }).then(function () {
      localStorage.removeItem("course-note-" + curCourseId);
      toast("已存入线上资料库 ✓ 换设备数据都在，可导出 Word");
      renderSaved(course); renderNotes();
    }).catch(function (e) { toast("保存失败：" + ((e && e.message) || "请稍后重试")); });
  };
  window.exportCurrent = function () {
    var ed = document.getElementById("note");
    var md = NOTE_LIB.htmlToMd(ed).trim();
    if (!md) { toast("先写点内容再导出"); return; }
    var course = courseById(curCourseId);
    NOTE_LIB.exportDocx((course ? course.name : "课程") + "-" + todayStr() + "-笔记", md).then(function (kind) { toast(kind === "docx" ? "Word 已生成（.docx）" : "Word 已生成（.doc 兼容格式）"); });
  };
  window.exportNote = function (n) { exportNoteFile(n); };
  window.askWith = function (q) { ask(q); };
  window.ask = function (pre) {
    var course = courseById(curCourseId);
    if (!course) return;
    var q = (pre || document.getElementById("qInput").value).trim();
    if (!q) { toast("先输入问题"); return; }
    var prompt = "关于《" + course.name + "》这门课，请结合 docs/" + course.name + "/ 下的课件和我的笔记回答：\n\n" + q;
    copy(prompt, "已复制问题。粘贴给 WorkBuddy，它会读课件回答，并沉淀到线上问答表");
    APP_.add("qa", { course: course.name, asked_at: new Date().toISOString().slice(0, 16).replace("T", " "), question: q, answer_digest: "（已提问，等 WorkBuddy 回复后沉淀到此处）" }).then(function () {
      document.getElementById("qInput").value = "";
      renderQa(course);
    }).catch(function (e) { toast("提交失败：" + ((e && e.message) || "请稍后重试")); });
  };

  /* ---------- 路由 ---------- */
  function setNav(name) {
    var links = document.querySelectorAll(".nav a");
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle("active", links[i].getAttribute("data-go") === name);
    }
  }
  window.go = function (name) {
    curView = name;
    ["home", "schedule", "ddl", "notes", "course"].forEach(function (v) {
      var el = document.getElementById("view-" + v);
      if (el) el.hidden = (v !== name);
    });
    setNav(name);
    window.scrollTo(0, 0);
    if (name === "schedule") renderSchedule();
    else if (name === "ddl") renderDdl();
    else if (name === "notes") renderNotes();
    else if (name === "course") { initEditorOnce(); if (curCourseId) bootCourse(curCourseId); }
    else renderHome();
    return false;
  };
  window.gotoCourse = function (id) {
    curCourseId = decodeURIComponent(id);
    initEditorOnce();
    go("course");
    return false;
  };
  window.copyAddPrompt = function () {
    copy("帮我在「今天」工作台里加一条：\n- 课程：<课程名，周几，第几节，教室，教师>（或 DDL：<任务名> <截止时间> <所属课程>，或课件：<把文件放进 <课程名>>）", "已复制录入模板，粘贴到对话里填上内容即可");
  };
  /* V5.8：课件库「＋ 导入课件」与缺口/空态提示的统一入口——复制一句归档指令
   * 课件文件本体托管在页面发布包里，浏览器端无法直写；所以走「拖文件 + 一句话」通道 */
  window.copyCoursewarePrompt = function () {
    var c = courseById(curCourseId);
    var name = c ? c.name : "<课程名>";
    copy("把这份课件放进 " + name + "：\n<把课件文件拖进来一起发我>", "已复制。把 PPT/PDF 拖进这个对话框，附上这句话发我即可归档");
    return false;
  };
  /* V5.15：把两处操作说明补上「改 / 删」，同样由 JS 注入，HTML 保持原样 */
  function initDdlHints() {
    try {
      var lead = document.querySelector("#view-ddl .lead");
      if (lead) lead.textContent = "红色 ≤3 天 · 琥珀 4-7 天 · 绿色 >7 天；鼠标移到卡片上会浮出 ✎，点它改内容（删除在弹窗里，5 秒内可撤销）· 顺延一天 · 完成销账 · 点卡片进课程资料库";
      var home = document.getElementById("ddlList");
      var sub = home && home.parentNode ? home.parentNode.querySelector(".sub") : null;
      if (sub) sub.textContent = "✓ 销账 · ✎ 改（删除在里面）· 点卡片进课程资料库";
    } catch (e) { /* 说明文案失败不影响功能 */ }
  }
  window.__pageFail = function (e) {
    var box = document.getElementById("heroChips");
    if (box) box.innerHTML = '<span class="hero-chip">数据加载失败：' + escapeHtml((e && e.message) || "请从资料库在线打开") + '</span>';
  };
  window.bootApp = function () { initDdlHints(); renderHome(); };
})();
