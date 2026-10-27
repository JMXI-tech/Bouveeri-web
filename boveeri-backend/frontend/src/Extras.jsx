import { useEffect, useRef, useState } from "react";
import { api } from "./api";

const err = x => x.message + (x.data?.details ? ": " + x.data.details.join(", ") : "");
const SECTORS = ["Management", "Security", "Housekeeping", "Front Desk", "Kitchen", "Bar & Lounge", "Pool & Leisure", "Maintenance", "Events", "Laundry", "Accounts"];
const hm = t => (t ? String(t).slice(0, 5) : "");

function Form({ title, fields, init, onSubmit, btn = "Save" }) {
  const [v, setV] = useState(init), [m, setM] = useState("");
  const go = async e => { e.preventDefault(); setM(""); try { await onSubmit(v); setM("Saved."); } catch (x) { setM(err(x)); } };
  return <form onSubmit={go}>{title && <h3 style={{ marginTop: 22 }}>{title}</h3>}<div className="f">{fields.map(f => <label key={f.k}>{f.label}
    {f.opts ? <select value={v[f.k]} onChange={e => setV({ ...v, [f.k]: e.target.value })}>{f.opts.map(o => <option key={o}>{o}</option>)}</select>
      : f.area ? <textarea value={v[f.k]} onChange={e => setV({ ...v, [f.k]: e.target.value })} required />
      : <input type={f.type || "text"} value={v[f.k]} onChange={e => setV({ ...v, [f.k]: e.target.value })} required={!f.opt} />}</label>)}</div>
    <button className="sm">{btn}</button> <span className="note">{m}</span></form>;
}


const KINDS = { Housekeeping: "Cleaning task", Maintenance: "Repair ticket", Security: "Incident / visitor log", Kitchen: "Order or stock note", "Bar & Lounge": "Stock note", "Pool & Leisure": "Pool safety log", Events: "Event task", Laundry: "Laundry batch", Accounts: "Daily record", "Front Desk": "Front desk note", Management: "Management note" };
const HK = { clean: "Clean", dirty: "Dirty", cleaning: "Being cleaned", inspect: "Needs inspection", out: "Out of service" };
const NEXT = { open: ["in_progress", "Start"], in_progress: ["done", "Mark done"], done: ["open", "Reopen"] };

export function SectorTools({ me, sector: own }) {
  const mgmt = ["admin", "md"].includes(me.role), [sec, setSec] = useState(own || SECTORS[0]), sector = mgmt ? sec : own;
  const [items, setItems] = useState([]), [rooms, setRooms] = useState([]), [e, setE] = useState("");
  const showRooms = mgmt || ["Housekeeping", "Front Desk", "Maintenance"].includes(own);
  const load = () => { if (!sector) return; api("/sector/items" + (mgmt ? "?sector=" + encodeURIComponent(sector) : "")).then(setItems).catch(x => setE(x.message)); if (showRooms) api("/sector/rooms").then(setRooms).catch(() => {}); };
  useEffect(() => { load(); }, [sector]);
  if (!sector) return <p className="note">No sector is assigned to your account yet. Ask your manager.</p>;
  const hk = async (id, status) => { try { await api(`/sector/rooms/${id}/hk`, { method: "PATCH", body: { status } }); load(); } catch (x) { setE(x.message); } };
  return <div>{mgmt && <label style={{ maxWidth: 260 }}>Sector<select value={sec} onChange={ev => setSec(ev.target.value)}>{SECTORS.map(x => <option key={x}>{x}</option>)}</select></label>}
    {e && <p className="err">{e}</p>}
    {showRooms && (mgmt ? ["Housekeeping", "Front Desk", "Maintenance"].includes(sector) : true) && <><h3 style={{ marginTop: 18 }}>Room status board</h3>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" }}>{rooms.filter(r => r.active).map(r => <div className="card" key={r.id} style={{ padding: 10 }}><b>Room {r.number}</b><div className="note">{r.category}</div>
        <select value={r.hk_status} onChange={ev => hk(r.id, ev.target.value)}>{Object.entries(HK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>)}
        {!rooms.length && <p className="note">No rooms added yet.</p>}</div></>}
    <h3 style={{ marginTop: 22 }}>{sector}: {KINDS[sector] || "Notes"}s</h3>
    <Form key={sector} init={{ title: "", roomNumber: "", details: "" }} btn={"Add " + (KINDS[sector] || "note").toLowerCase()}
      fields={[{ k: "title", label: "Title" }, { k: "roomNumber", label: "Room number (optional)", opt: 1 }, { k: "details", label: "Details", opt: 1 }]}
      onSubmit={async v => { await api("/sector/items", { method: "POST", body: { title: v.title, details: v.details, roomNumber: v.roomNumber || undefined, sector: mgmt ? sector : undefined } }); load(); }} />
    <div style={{ marginTop: 14 }}>{items.map(i => <div className="card" key={i.id} style={{ marginBottom: 8, opacity: i.status === "done" ? .6 : 1 }}>
      <b>{i.title}</b> <span className="note">· {i.status.replace("_", " ")}{i.room_number ? " · Room " + i.room_number : ""} · {i.author || "staff"} · {String(i.created_at).slice(0, 10)}</span>
      {i.details && <div style={{ whiteSpace: "pre-wrap" }}>{i.details}</div>}
      <button className="sm" onClick={async () => { await api("/sector/items/" + i.id, { method: "PATCH", body: { status: NEXT[i.status][0] } }); load(); }}>{NEXT[i.status][1]}</button>{" "}
      <button className="sm alt" onClick={async () => { if (confirm("Delete this entry?")) { await api("/sector/items/" + i.id, { method: "DELETE" }); load(); } }}>Delete</button></div>)}
      {!items.length && <p className="note">Nothing logged yet.</p>}</div></div>;
}

const shrink = file => new Promise((ok, no) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", .82)); }; img.onerror = () => no(new Error("Could not read that image")); img.src = URL.createObjectURL(file); });

function RoomPhotos() {
  const [rooms, setRooms] = useState([]), [m, setM] = useState(""), load = () => api("/rooms").then(setRooms).catch(() => {});
  useEffect(() => { load(); }, []);
  async function pick(id, file) { if (!file) return; setM("Uploading…"); try { await api("/admin/room-photo/" + id, { method: "POST", body: { data: await shrink(file) } }); setM("Photo saved."); load(); } catch (x) { setM(err(x)); } }
  return <div><p className="note">Choose a photo for each room. It is resized automatically and shows on the Rooms section. {m}</p>
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))" }}>{rooms.map(r => <div className="card" key={r.id} style={{ padding: 0 }}>
      <div className="rp" style={r.photo_url ? { backgroundImage: `url(${r.photo_url})` } : null}>Room {r.number}</div>
      <div style={{ padding: 10 }}><div className="note">{r.category}</div><input type="file" accept="image/jpeg,image/png,image/webp" onChange={ev => pick(r.id, ev.target.files[0])} /></div></div>)}
      {!rooms.length && <p className="note">Add rooms first (Front desk page).</p>}</div></div>;
}

export function Chat() {
  const [open, setOpen] = useState(false), [msgs, setMsgs] = useState([]), [text, setText] = useState(""), [busy, setBusy] = useState(false), [leave, setLeave] = useState(false), end = useRef();
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, open, leave]);
  async function send(e) {
    e.preventDefault(); const t = text.trim(); if (!t || busy) return; setText("");
    const next = [...msgs, { role: "user", content: t }]; setMsgs(next); setBusy(true);
    try { const r = await api("/chat", { method: "POST", body: { messages: next.slice(-10) } }); setMsgs([...next, { role: "assistant", content: r.reply }]); }
    catch (x) { setMsgs([...next, { role: "assistant", content: x.message }]); }
    setBusy(false);
  }
  return <>
    <button aria-label="Chat with our assistant" onClick={() => setOpen(!open)} style={{ position: "fixed", right: 18, bottom: 18, zIndex: 30, width: 58, height: 58, padding: 0, fontSize: 24 }}>💬</button>
    {open && <div className="card" role="dialog" aria-label="Assistant" style={{ position: "fixed", right: 14, bottom: 86, zIndex: 30, width: "min(380px,calc(100vw - 28px))", height: "min(540px,72vh)", display: "flex", flexDirection: "column", padding: 0 }}>
      <div style={{ background: "var(--ink)", color: "#fff", padding: "12px 16px", display: "flex", justifyContent: "space-between" }}><b>Boveeri Assistant</b><span><a href="#" style={{ color: "#e9dfd0", fontSize: 13 }} onClick={e => { e.preventDefault(); setLeave(!leave); }}>{leave ? "Back to chat" : "Leave a message"}</a></span></div>
      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {leave ? <Form title="" init={{ name: "", phone: "", email: "", message: "" }} btn="Send to the team" onSubmit={v => api("/enquiries", { method: "POST", body: v })}
          fields={[{ k: "name", label: "Your name" }, { k: "phone", label: "Phone", type: "tel" }, { k: "email", label: "Email (optional)", type: "email", opt: 1 }, { k: "message", label: "Message", area: 1 }]} /> : <>
          <div className="note" style={{ background: "var(--line)", padding: "9px 13px", borderRadius: 14 }}>Hello! Ask me about rooms, prices, the pool, dining, events or directions.</div>
          {msgs.map((m, i) => <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "86%", padding: "9px 13px", borderRadius: 14, whiteSpace: "pre-wrap", fontSize: 14, background: m.role === "user" ? "var(--gold2)" : "var(--line)", color: m.role === "user" ? "#fff" : "var(--fg)" }}>{m.content}</div>)}
          {busy && <div className="note">Typing…</div>}</>}
        <div ref={end} /></div>
      {!leave && <form onSubmit={send} style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--line)" }}><input value={text} onChange={e => setText(e.target.value)} placeholder="Type your question…" maxLength={800} /><button disabled={busy}>Send</button></form>}
    </div>}</>;
}

export function NoticeStrip() {
  const [n, setN] = useState([]);
  useEffect(() => { api("/notices").then(setN).catch(() => {}); }, []);
  return n.length ? <section style={{ paddingTop: "4vh", paddingBottom: 0 }}>{n.slice(0, 3).map(x => <div className="card" key={x.id} style={{ marginBottom: 10 }}><b>{x.title}</b><div className="note">{x.body}</div></div>)}</section> : null;
}

function Notices({ canEdit }) {
  const [n, setN] = useState([]), load = () => api("/notices").then(setN).catch(() => {});
  useEffect(() => { load(); }, []);
  return <div>{n.length ? n.map(x => <div className="card" key={x.id} style={{ marginBottom: 10 }}><b>{x.title}</b> <span className="note">· {x.audience}{x.sector ? " " + x.sector : ""} · {String(x.created_at).slice(0, 10)}</span>
    <div style={{ whiteSpace: "pre-wrap" }}>{x.body}</div>{canEdit && <button className="sm alt" onClick={async () => { await api("/notices/" + x.id, { method: "DELETE" }); load(); }}>Delete</button>}</div>) : <p className="note">No notices yet.</p>}
    {canEdit && <Form title="Post a notice" init={{ title: "", body: "", audience: "staff", sector: SECTORS[0] }} btn="Post"
      fields={[{ k: "title", label: "Title" }, { k: "audience", label: "Who sees it", opts: ["all", "staff", "guests", "sector"] }, { k: "sector", label: "Sector (if sector)", opts: SECTORS }, { k: "body", label: "Message", area: 1 }]}
      onSubmit={async v => { await api("/notices", { method: "POST", body: { ...v, sector: v.audience === "sector" ? v.sector : undefined } }); load(); }} />}</div>;
}

function Inbox() {
  const [team, setTeam] = useState([]), [w, setW] = useState(null), [thread, setThread] = useState([]), [t, setT] = useState("");
  const loadTeam = () => api("/team").then(setTeam).catch(() => {}), loadThread = id => api("/messages?with=" + id).then(setThread).catch(() => {});
  useEffect(() => { loadTeam(); }, []);
  useEffect(() => { if (!w) return; loadThread(w.id); const i = setInterval(() => { loadThread(w.id); loadTeam(); }, 8000); return () => clearInterval(i); }, [w?.id]);
  async function send(e) { e.preventDefault(); if (!t.trim()) return; await api("/messages", { method: "POST", body: { to: w.id, body: t } }); setT(""); loadThread(w.id); }
  return <div className="f" style={{ gridTemplateColumns: "minmax(150px,1fr) 2fr", alignItems: "start" }}>
    <div>{team.map(p => <div key={p.id} className="card" style={{ padding: 10, marginBottom: 6, cursor: "pointer", borderColor: w?.id === p.id ? "var(--gold)" : undefined }} onClick={() => setW(p)}>
      <b>{p.name}</b>{p.unread > 0 && <span className="price"> ({p.unread})</span>}<div className="note">{p.job_title || p.role}{p.sector ? " · " + p.sector : ""}</div></div>)}</div>
    <div>{w ? <><div className="card" style={{ maxHeight: 340, overflow: "auto" }}>{thread.map(m => <div key={m.id} style={{ textAlign: m.from_user === w.id ? "left" : "right", margin: "4px 0" }}><span style={{ background: m.from_user === w.id ? "var(--line)" : "var(--gold2)", color: m.from_user === w.id ? "var(--fg)" : "#fff", padding: "6px 10px", borderRadius: 12, display: "inline-block" }}>{m.body}</span></div>)}{!thread.length && <p className="note">Say hello to {w.name}.</p>}</div>
      <form onSubmit={send} style={{ display: "flex", gap: 8, marginTop: 8 }}><input value={t} onChange={e => setT(e.target.value)} maxLength={1000} placeholder="Message" /><button>Send</button></form>
      <p className="note">Private between you and {w.name}. Managers cannot read other people's messages.</p></> : <p className="note">Choose a colleague to chat with.</p>}</div></div>;
}

export function Portal({ me }) {
  const [tab, setTab] = useState("profile"), [emp, setEmp] = useState(undefined);
  useEffect(() => { api("/me/employee").then(setEmp).catch(() => setEmp(null)); }, []);
  return <section><h2>Staff portal{emp ? " · " + emp.sector : ""}</h2>
    <div className="tabs">{["profile", "sector", "notices", "inbox"].map(t => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    {tab === "profile" && (emp ? <><p><b>{emp.full_name}</b> · {emp.job_title} · {emp.sector}<br />Shift: {emp.shift_days || "not set"} {hm(emp.shift_start)}{emp.shift_end ? "-" + hm(emp.shift_end) : ""}<br /><span className="note">Verification ID {emp.verification_code}</span></p>
      <Form title="Your details" init={{ phone: emp.phone || "", address: emp.address || "", emergencyContact: emp.emergency_contact || "" }}
        fields={[{ k: "phone", label: "Phone", type: "tel" }, { k: "address", label: "Home address" }, { k: "emergencyContact", label: "Emergency contact" }]}
        onSubmit={v => api("/me/employee", { method: "PATCH", body: v })} /><p className="note">Your manager sees these details on their dashboard.</p></>
      : <p className="note">{emp === undefined ? "Loading…" : "No employee record is linked to this account."}</p>)}
    {tab === "sector" && <SectorTools me={me} sector={emp?.sector || ""} />}{tab === "notices" && <Notices canEdit={["admin", "md"].includes(me.role)} />}{tab === "inbox" && <Inbox />}</section>;
}

export function AdminPage({ me }) {
  const [emps, setEmps] = useState([]), [edit, setEdit] = useState(null), [enq, setEnq] = useState([]), [code, setCode] = useState("");
  const load = () => api("/admin/employees").then(setEmps).catch(() => {});
  useEffect(() => { load(); api("/staff/enquiries").then(setEnq).catch(() => {}); }, []);
  const F = [{ k: "fullName", label: "Full name" }, { k: "jobTitle", label: "Job title" }, { k: "sector", label: "Sector", opts: SECTORS },
    { k: "accountRole", label: "Account type", opts: me.role === "admin" ? ["staff", "receptionist", "md"] : ["staff", "receptionist"] },
    { k: "shiftDays", label: "Shift days, e.g. Mon-Fri", opt: 1 }, { k: "shiftStart", label: "Shift start", type: "time", opt: 1 }, { k: "shiftEnd", label: "Shift end", type: "time", opt: 1 }];
  return <section><h2>Management</h2>
    <h3>Employees</h3>{code && <p className="ok">New verification ID: <b>{code}</b>. Give it to the employee; it works once at staff sign-up.</p>}
    <div className="t"><table><thead><tr><th>Name</th><th>Role</th><th>Sector</th><th>Shift</th><th>ID / status</th><th>Details</th><th></th></tr></thead><tbody>
      {emps.map(e => <tr key={e.id}><td>{e.full_name}</td><td>{e.job_title}<br /><span className="note">{e.account_role}</span></td><td>{e.sector}</td><td>{e.shift_days} {hm(e.shift_start)}{e.shift_end ? "-" + hm(e.shift_end) : ""}</td>
        <td>{e.verification_code}<br />{e.user_id ? "Signed up: " + e.email : "Not yet claimed"}</td><td>{e.phone}<br />{e.address}<br />SOS: {e.emergency_contact}</td>
        <td><button className="sm alt" onClick={() => setEdit(e)}>Edit</button>{me.role === "admin" && <> <button className="sm alt" onClick={async () => { if (confirm("Delete " + e.full_name + " and their login?")) { await api("/admin/employees/" + e.id, { method: "DELETE" }); load(); } }}>Delete</button></>}</td></tr>)}
      {!emps.length && <tr><td colSpan="7">No employees yet.</td></tr>}</tbody></table></div>
    {edit ? <Form key={edit.id} title={"Edit " + edit.full_name} btn="Update" init={{ fullName: edit.full_name, jobTitle: edit.job_title, sector: edit.sector, accountRole: edit.account_role, shiftDays: edit.shift_days || "", shiftStart: hm(edit.shift_start), shiftEnd: hm(edit.shift_end) }}
      fields={F} onSubmit={async v => { await api("/admin/employees/" + edit.id, { method: "PATCH", body: v }); load(); }} />
      : <Form title="Add an employee and generate an ID" btn="Generate ID" init={{ fullName: "", jobTitle: "", sector: SECTORS[0], accountRole: "staff", shiftDays: "", shiftStart: "", shiftEnd: "" }}
        fields={F} onSubmit={async v => { const r = await api("/admin/employees", { method: "POST", body: v }); setCode(r.verification_code); load(); }} />}
    {edit && <button className="sm alt" onClick={() => setEdit(null)}>Cancel edit</button>}
    <h3 style={{ marginTop: 30 }}>Notices</h3><Notices canEdit />
    <h3 style={{ marginTop: 30 }}>Room photos</h3><RoomPhotos /><h3 style={{ marginTop: 30 }}>Sector boards</h3><SectorTools me={me} sector="" /><h3 style={{ marginTop: 30 }}>Website enquiries</h3>{enq.length ? enq.map(x => <div className="card" key={x.id} style={{ marginBottom: 8 }}><b>{x.name}</b> · {x.phone} {x.email}<div>{x.message}</div></div>) : <p className="note">No enquiries yet.</p>}</section>;
}
