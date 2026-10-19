/* 「今天」工作台 · 云端数据层 V5（资料库 database 直连，跨设备同步）
 * 所有读写直接走 WorkBuddy 资料库多维表，不再依赖 data/data.js 静态数据。 */
window.APP = (function () {
  var DBS = {
    courses:    "krVlbHBrfM1JF150rYcIzc",
    ddl:        "wqok9b87n41XuCOAO0fmw2",
    notes:      "yrJ0J8V2PGC9BYL5DRXzPj",
    qa:         "Y5pDUPZmwBZS5A9fyiAQY0",
    courseware: "wmM5yZdgkNm35GAuIDFU1o",
    settings:   "AcFHWXjqQgqEFUEka87Lft"
  };
  /* [数据库字段名, 页面字段名, 类型] */
  var DEF = {
    courses: [
      ["课程ID", "id", "text"], ["课程名", "name", "text"], ["星期", "weekday", "number"],
      ["开始时间", "start", "text"], ["结束时间", "end", "text"], ["教室", "room", "text"],
      ["教师", "teacher", "text"], ["周次", "weeks", "text"], ["类别", "category", "select"],
      ["颜色", "color", "text"], ["备注", "note", "text"], ["单双周", "parity", "select"]
    ],
    ddl: [
      ["编号", "id", "text"], ["任务", "title", "text"], ["课程", "course", "text"],
      ["截止", "due", "text"], ["类型", "type", "select"], ["状态", "status", "select"],
      ["顺延次数", "postponed_count", "number"], ["预计分钟", "estimate_minutes", "number"],
      ["创建日期", "created_at", "text"]
    ],
    notes: [["日期", "date", "text"], ["课程", "course", "text"], ["周", "week", "number"], ["内容", "content", "text"]],
    qa: [["课程", "course", "text"], ["提问时间", "asked_at", "text"], ["问题", "question", "text"], ["答复", "answer_digest", "text"], ["关联课件", "related_files", "text"]],
    courseware: [["课程", "course", "text"], ["文件名", "filename", "text"], ["周", "week", "number"], ["归档日期", "added_at", "text"], ["路径", "path", "text"], ["大小", "size", "text"]],
    settings: [["键", "key", "text"], ["值", "value", "text"]]
  };
  var DB = {
    semester_start: "2026-08-31",
    courses: [], ddl: [], notes: [], qa: [], courseware: [], settings: []
  };

  function sdk() {
    return (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) ? window.__SMART_PAGE__.database : null;
  }
  function rowFrom(table, raw) {
    var o = {}, d = DEF[table];
    d.forEach(function (f) {
      var cn = f[0], key = f[1];
      if (raw[cn] !== undefined && raw[cn] !== null) o[key] = raw[cn];
    });
    o._rid = raw._id;
    return o;
  }
  function toProps(table, obj) {
    var p = {}, d = DEF[table];
    d.forEach(function (f) {
      var cn = f[0], key = f[1], ty = f[2], v = obj[key];
      if (v === undefined || v === null || v === "") return;
      if (ty === "number") p[cn] = { number: Number(v) || 0 };
      else if (ty === "select") p[cn] = { select: String(v) };
      else p[cn] = { text: String(v) };
    });
    return p;
  }
  function all(tableId) {
    var d = sdk(), out = [], cursor = null;
    if (!d) return Promise.reject(new Error("no-sdk"));
    function page() {
      var params = { databaseId: tableId, pageSize: 100 };
      if (cursor) params.startCursor = cursor;
      return d.query(params).then(function (r) {
        (r.results || []).forEach(function (x) { out.push(x); });
        cursor = r.nextCursor || null;
        return r.hasMore ? page() : out;
      });
    }
    return page();
  }
  function refresh(table) {
    return all(DBS[table]).then(function (rows) {
      DB[table] = rows.map(function (r) { return rowFrom(table, r); });
      if (table === "settings") {
        var s = DB.settings.find(function (x) { return x.key === "semester_start"; });
        if (s && s.value) DB.semester_start = s.value;
      }
      return DB[table];
    });
  }
  function seed(table, rows) {
    DB[table] = rows.map(function (r) { return rowFrom(table, r); });
    if (table === "settings") {
      var s = DB.settings.find(function (x) { return x.key === "semester_start"; });
      if (s && s.value) DB.semester_start = s.value;
    }
    return DB[table];
  }
  function load(tables) {
    if (!sdk()) return Promise.reject(new Error("请通过 WorkBuddy 资料库在线打开本页面，才能读写线上数据"));
    var names = tables.concat("settings").filter(function (n, i, a) { return a.indexOf(n) === i; });
    return Promise.all(names.map(refresh)).then(function () { return DB; });
  }
  function noWrite() { return Promise.reject(new Error("当前为分享预览版，仅可浏览；增删改请在资料库在线版打开后操作")); }
  function add(table, obj) {
    var d = sdk();
    if (!d) return noWrite();
    return d.addRecord({ databaseId: DBS[table], properties: toProps(table, obj) }).then(function () { return refresh(table); });
  }
  function upd(table, rid, obj) {
    var d = sdk();
    if (!d) return noWrite();
    return d.updateRecord({ databaseId: DBS[table], recordId: rid, properties: toProps(table, obj) }).then(function () { return refresh(table); });
  }
  function del(table, rid) {
    var d = sdk();
    if (!d) return noWrite();
    return d.deleteRecord({ databaseId: DBS[table], recordId: rid }).then(function () { return refresh(table); });
  }
  return { DBS: DBS, DB: DB, sdk: sdk, load: load, refresh: refresh, all: all, seed: seed, add: add, upd: upd, del: del };
})();
