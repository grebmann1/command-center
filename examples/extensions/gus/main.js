const w = [
  { key: "new", title: "New", status: "New", droppable: !0 },
  { key: "in-progress", title: "In Progress", status: "In Progress", droppable: !0 },
  { key: "review", title: "Ready for Review", status: "Ready for Review", droppable: !0 },
  { key: "fixed", title: "Fixed", status: "Fixed", droppable: !0 },
  { key: "qa", title: "QA In Progress", status: "QA In Progress", droppable: !0 },
  { key: "completed", title: "Completed", status: "Completed", droppable: !0 },
  { key: "closed", title: "Closed", status: "Closed", droppable: !1 }
];
new Map(
  w.filter((t) => t.status).map((t) => [t.status.toLowerCase(), t.key])
);
function f(t) {
  const r = t.trim().toLowerCase();
  return r === "closed" || r.startsWith("closed -") || r === "rejected" || r === "never" || r === "duplicate" || r === "not a bug" || r === "not reproducible" || r === "inactive" || r === "deferred";
}
const C = "gus", I = 3e4;
async function E(t, r, o) {
  try {
    return await t({ bin: "sf", args: r, timeoutMs: I });
  } catch (e) {
    const n = e instanceof Error ? e.message : String(e);
    throw o(`sf exec failed: ${n}`), new Error('sf CLI unavailable — check that the Salesforce CLI is installed and authed (target-org "gus").');
  }
}
async function l(t, r, o) {
  var i;
  const { stdout: e, stderr: n } = await E(
    t,
    ["data", "query", "--target-org", C, "--json", "-q", r],
    o
  );
  let s;
  if (e)
    try {
      s = JSON.parse(e);
    } catch {
    }
  if (s && s.status === 0)
    return ((i = s.result) == null ? void 0 : i.records) ?? [];
  const a = (s == null ? void 0 : s.message) || n || "sf data query failed";
  throw o(`query failed: ${a}`), new Error(a);
}
async function N(t, r, o, e, n) {
  const { stdout: s, stderr: a } = await E(
    t,
    [
      "data",
      "update",
      "record",
      "--target-org",
      C,
      "--sobject",
      "ADM_Work__c",
      "--record-id",
      r,
      "--values",
      `${o}=${e}`,
      "--json"
    ],
    n
  );
  let i;
  if (s)
    try {
      i = JSON.parse(s);
    } catch {
    }
  if (i && i.status === 0)
    return;
  const c = (i == null ? void 0 : i.message) || a || "sf data update failed";
  throw n(`update failed (${r} ${o}): ${c}`), new Error(c);
}
let S = null;
async function y(t, r) {
  if (S) return S;
  const { stdout: o } = await E(
    t,
    ["org", "display", "user", "--target-org", C, "--json"],
    r
  );
  let e;
  if (o)
    try {
      e = JSON.parse(o);
    } catch {
    }
  const n = e == null ? void 0 : e.result;
  if ((e == null ? void 0 : e.status) === 0 && (n != null && n.id) && n.username)
    return S = {
      username: n.username,
      userId: n.id,
      instanceUrl: n.instanceUrl || "https://gus.my.salesforce.com"
    }, S;
  const s = (e == null ? void 0 : e.message) || "sf org display user failed";
  throw r(`identity failed: ${s}`), new Error(s);
}
function d(t) {
  return t.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function p(t) {
  var o, e, n, s, a, i, c;
  const r = t.Status__c ?? "New";
  return {
    id: t.Id,
    name: t.Name,
    subject: t.Subject__c ?? "(no subject)",
    status: r,
    priority: t.Priority__c ?? void 0,
    type: ((o = t.RecordType) == null ? void 0 : o.Name) ?? void 0,
    storyPoints: typeof t.Story_Points__c == "number" ? t.Story_Points__c : void 0,
    sprintId: t.Sprint__c ?? void 0,
    sprintName: ((e = t.Sprint__r) == null ? void 0 : e.Name) ?? void 0,
    teamId: t.Scrum_Team__c ?? void 0,
    teamName: ((n = t.Scrum_Team__r) == null ? void 0 : n.Name) ?? void 0,
    assigneeId: t.Assignee__c ?? void 0,
    assignee: ((s = t.Assignee__r) == null ? void 0 : s.Name) ?? void 0,
    author: ((a = t.CreatedBy) == null ? void 0 : a.Name) ?? void 0,
    productTag: ((i = t.Product_Tag__r) == null ? void 0 : i.Name) ?? void 0,
    epicName: ((c = t.Epic__r) == null ? void 0 : c.Name) ?? void 0,
    lastModified: t.LastModifiedDate
  };
}
const g = "Id, Name, Subject__c, Status__c, Priority__c, RecordType.Name, Story_Points__c, Sprint__c, Sprint__r.Name, Scrum_Team__c, Scrum_Team__r.Name, Assignee__c, Assignee__r.Name, CreatedBy.Name, Product_Tag__r.Name, Epic__r.Name, LastModifiedDate", T = g + ", Details__c, QA_Engineer__r.Name, Scheduled_Build__r.Name, Found_in_Build__r.Name, CreatedDate";
function M(t) {
  var r, o, e;
  return {
    ...p(t),
    detailsHtml: t.Details__c ?? void 0,
    qaEngineer: ((r = t.QA_Engineer__r) == null ? void 0 : r.Name) ?? void 0,
    scheduledBuild: ((o = t.Scheduled_Build__r) == null ? void 0 : o.Name) ?? void 0,
    foundInBuild: ((e = t.Found_in_Build__r) == null ? void 0 : e.Name) ?? void 0,
    createdDate: t.CreatedDate
  };
}
const R = {
  id: "gus",
  setup(t) {
    const { log: r } = t, o = t.exec;
    if (!o)
      throw new Error("gus: ctx.exec capability is unavailable; cannot run the sf CLI.");
    return {
      async whoami() {
        return y(o, r);
      },
      /**
       * Work items assigned to the current user.
       * opts.includeClosed — include terminal statuses (default false).
       * opts.sprintId       — restrict to one sprint.
       */
      async listWork(e) {
        const { userId: n } = await y(o, r), s = [`Assignee__r.Id = '${d(n)}'`];
        e != null && e.sprintId && s.push(`Sprint__c = '${d(e.sprintId)}'`);
        const a = `SELECT ${g} FROM ADM_Work__c WHERE ${s.join(" AND ")} ORDER BY LastModifiedDate DESC LIMIT 500`, c = (await l(o, a, r)).map(p);
        return e != null && e.includeClosed ? c : c.filter((u) => !f(u.status));
      },
      /** Sprints the user has open work in, most recent first. */
      async listSprints() {
        var i, c, u;
        const { userId: e } = await y(o, r), n = `SELECT Status__c, Sprint__c, Sprint__r.Name, Sprint__r.Start_Date__c, Sprint__r.End_Date__c FROM ADM_Work__c WHERE Assignee__r.Id = '${d(e)}' AND Sprint__c != null LIMIT 2000`, s = await l(
          o,
          n,
          r
        ), a = /* @__PURE__ */ new Map();
        for (const _ of s) {
          if (!_.Sprint__c || f(_.Status__c ?? "")) continue;
          const m = a.get(_.Sprint__c);
          m ? m.openCount += 1 : a.set(_.Sprint__c, {
            id: _.Sprint__c,
            name: ((i = _.Sprint__r) == null ? void 0 : i.Name) ?? "(unnamed sprint)",
            startDate: ((c = _.Sprint__r) == null ? void 0 : c.Start_Date__c) ?? void 0,
            endDate: ((u = _.Sprint__r) == null ? void 0 : u.End_Date__c) ?? void 0,
            openCount: 1
          });
        }
        return Array.from(a.values()).sort(
          (_, m) => (m.startDate ?? "").localeCompare(_.startDate ?? "")
        );
      },
      /**
       * Scrum teams the current user has open work on — the candidate set for
       * the backlog team picker. `openCount` is the user's open work on each
       * team (a relevance signal), not the team's full backlog size.
       */
      async listTeams() {
        var i;
        const { userId: e } = await y(o, r), n = `SELECT Status__c, Scrum_Team__c, Scrum_Team__r.Name FROM ADM_Work__c WHERE Assignee__r.Id = '${d(e)}' AND Scrum_Team__c != null LIMIT 2000`, s = await l(o, n, r), a = /* @__PURE__ */ new Map();
        for (const c of s) {
          if (!c.Scrum_Team__c || f(c.Status__c ?? "")) continue;
          const u = a.get(c.Scrum_Team__c);
          u ? u.openCount += 1 : a.set(c.Scrum_Team__c, {
            id: c.Scrum_Team__c,
            name: ((i = c.Scrum_Team__r) == null ? void 0 : i.Name) ?? "(unnamed team)",
            openCount: 1
          });
        }
        return Array.from(a.values()).sort((c, u) => u.openCount - c.openCount);
      },
      /**
       * A team's backlog: open work on the team that isn't scheduled into any
       * sprint (`Sprint__c = null`). Team-wide (not assignee-scoped) and
       * read-only in the UI. Ordered by Sprint_Rank__c (the team's manual
       * triage order) so the most-ready items surface first.
       */
      async listBacklog(e) {
        const n = e == null ? void 0 : e.teamId;
        if (typeof n != "string" || !n) throw new Error("Missing team id");
        const s = `SELECT ${g} FROM ADM_Work__c WHERE Scrum_Team__c = '${d(n)}' AND Sprint__c = null ORDER BY Sprint_Rank__c NULLS LAST, LastModifiedDate DESC LIMIT 500`, i = (await l(o, s, r)).map(p);
        return e != null && e.includeClosed ? i : i.filter((c) => !f(c.status));
      },
      /** Full detail for one work item, fetched when a card is opened. */
      async getWork(e) {
        if (typeof e != "string" || !e) return null;
        const n = `SELECT ${T} FROM ADM_Work__c WHERE Id = '${d(e)}' LIMIT 1`, s = await l(o, n, r);
        return s.length ? M(s[0]) : null;
      },
      /**
       * Write a new `Status__c` on a work item (drag/drop between columns).
       * Returns the status on success; throws on validation-rule rejection so
       * the renderer can roll back its optimistic move and toast the error.
       */
      async setStatus(e, n) {
        if (typeof e != "string" || !e) throw new Error("Missing work item id");
        if (typeof n != "string" || !n) throw new Error("Missing status");
        return await N(o, e, "Status__c", `'${d(n)}'`, r), { ok: !0, status: n };
      },
      /** Recent comments/chatter on a work item (ADM_Comment__c). */
      async getChatter(e) {
        if (typeof e != "string" || !e) return [];
        const n = `SELECT Id, Body__c, CreatedDate, CreatedBy.Name FROM ADM_Comment__c WHERE Work__c = '${d(e)}' ORDER BY CreatedDate DESC LIMIT 50`;
        return (await l(o, n, r)).filter((a) => (a.Body__c ?? "").trim()).map((a) => {
          var i;
          return {
            id: a.Id,
            body: a.Body__c ?? "",
            author: ((i = a.CreatedBy) == null ? void 0 : i.Name) ?? "Unknown",
            createdDate: a.CreatedDate ?? ""
          };
        });
      },
      /** Files attached to a work item (ContentDocument via ContentDocumentLink). */
      async getFiles(e) {
        if (typeof e != "string" || !e) return [];
        const n = `SELECT ContentDocumentId, ContentDocument.Title, ContentDocument.FileExtension, ContentDocument.ContentSize, ContentDocument.CreatedDate, ContentDocument.CreatedBy.Name FROM ContentDocumentLink WHERE LinkedEntityId = '${d(e)}' LIMIT 100`;
        return (await l(o, n, r)).map((a) => {
          var i, c, u, _, m, D;
          return {
            id: a.ContentDocumentId,
            title: ((i = a.ContentDocument) == null ? void 0 : i.Title) ?? "(untitled)",
            ext: ((c = a.ContentDocument) == null ? void 0 : c.FileExtension) ?? void 0,
            size: typeof ((u = a.ContentDocument) == null ? void 0 : u.ContentSize) == "number" ? a.ContentDocument.ContentSize : void 0,
            author: ((m = (_ = a.ContentDocument) == null ? void 0 : _.CreatedBy) == null ? void 0 : m.Name) ?? void 0,
            createdDate: ((D = a.ContentDocument) == null ? void 0 : D.CreatedDate) ?? void 0
          };
        });
      }
    };
  }
};
export {
  R as default
};
