import { useEffect, useState } from "react";
import { api } from "./api";
import GAL from "./gallery.json";
import { Chat, Portal, AdminPage, NoticeStrip } from "./Extras.jsx";

const NGN = n => "₦" + Number(n).toLocaleString();
const RATES = [["Classic", 29200, "Studio-style, AC, cable TV, fridge"], ["Standard Room", 39000, "AC, satellite TV, internet, fridge"], ["Deluxe Room", 46920, "LED TV, kettle, fridge, AC"],
  ["Junior Suite", 57960, "King bed, couch, work desk, safety drawer"], ["1 Bedroom Suite", 69480, "Bedroom, sitting room, guest toilet"],
  ["2 Bedroom Suite", 114720, "Two bedrooms, lounge, balcony, AC"], ["Presidential Suite", 167520, "Two king bedrooms, balcony, walk-in shower"]];
const SV = [["🛏️", "Accommodation", "Seven room types with AC, TV, fridge and daily housekeeping. Family and group suites available."],
  ["🍽️", "Restaurant", "Nigerian and international dishes, open 24 hours. Free breakfast 7:00 to 11:30."],
  ["🍸", "Bars & lounge", "Lounge bar, outdoor bar and pool bar, plus a nightclub with resident DJs."],
  ["🌊", "Pool & water slide", "Blue-water pool for learners, kids and adults, with a large red slide."],
  ["🎉", "Events & meetings", "Event Center, Event Planning Center and Conference Room. Price on request."],
  ["💼", "Business & comfort", "Free Wi-Fi, concierge, tour help, laundry and free parking."]];
const STAFF = ["admin", "md", "receptionist"];
const nights = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const err = x => x.message + (x.data?.details ? ": " + x.data.details.join(", ") : "");

function Auth({ onDone, onClose }) {
  const [mode, setMode] = useState("login"), [v, setV] = useState({ email: "", password: "", name: "", code: "" }), [e, setE] = useState("");
  const go = async ev => { ev.preventDefault(); setE(""); const body = mode === "login" ? { email: v.email, password: v.password } : mode === "employee" ? { code: v.code, email: v.email, password: v.password } : { email: v.email, password: v.password, name: v.name };
    try { onDone(await api(mode === "employee" ? "/auth/employee-signup" : "/auth/" + mode, { method: "POST", body })); } catch (x) { setE(err(x)); } };
  const s = k => ev => setV({ ...v, [k]: ev.target.value });
  return <div className="modal" onClick={onClose}><form className="card" onClick={ev => ev.stopPropagation()} onSubmit={go}>
    <h3>{mode === "login" ? "Log in" : mode === "register" ? "Create guest account" : "Staff sign-up"}</h3>
    <div className="f" style={{ gridTemplateColumns: "1fr" }}>
      {mode === "register" && <label>Full name<input value={v.name} onChange={s("name")} required /></label>}
      {mode === "employee" && <label>Verification ID from your manager<input value={v.code} onChange={s("code")} placeholder="BVR-XXXXXX" required /></label>}
      <label>Email<input type="email" value={v.email} onChange={s("email")} required /></label>
      <label>Password<input type="password" value={v.password} onChange={s("password")} minLength={mode === "login" ? 1 : 8} required /></label>
    </div>
    {e && <p className="err">{e}</p>}
    <button>{mode === "login" ? "Log in" : "Sign up"}</button>
    <p className="note">{mode !== "login" && <a href="#" onClick={ev => { ev.preventDefault(); setMode("login"); }}>Have an account? Log in</a>}{mode === "login" && <><a href="#" onClick={ev => { ev.preventDefault(); setMode("register"); }}>New guest? Sign up</a> · <a href="#" onClick={ev => { ev.preventDefault(); setMode("employee"); }}>Staff? Use your verification ID</a></>}</p>
  </form></div>;
}

function Rooms({ q, setQ, onPick }) {
  const [rooms, setRooms] = useState([]), [lb, setLb] = useState(null), ok = q.from && q.to && q.to > q.from;
  useEffect(() => { api("/rooms" + (ok ? `?from=${q.from}&to=${q.to}` : "")).then(setRooms).catch(() => {}); }, [q.from, q.to]);
  const cats = [...new Set([...RATES.map(r => r[0]), ...rooms.map(r => r.category)])];
  return <section id="rooms"><h2 className="rv">Rooms & rates</h2><p className="sub rv">Pick dates to see which individual rooms are free. Prices are per night.</p>
    <div className="f"><label>Check-in<input type="date" min={new Date().toISOString().slice(0, 10)} value={q.from} onChange={e => setQ({ ...q, from: e.target.value })} /></label>
      <label>Check-out<input type="date" min={q.from} value={q.to} onChange={e => setQ({ ...q, to: e.target.value })} /></label></div>
    {cats.map(c => { const list = rooms.filter(r => r.category === c), rate = RATES.find(r => r[0] === c);
      return <div key={c}><h3 style={{ marginTop: 26 }}>{c} <span className="price">{rate ? NGN(rate[1]) : list[0] ? NGN(list[0].price_ngn) : ""}/night</span></h3>
        {list.length ? <div className="grid">{list.map(r => <div className="card" key={r.id} style={{ padding: 0 }}>
          <div className="rp" style={r.photo_url ? { backgroundImage: `url(${r.photo_url})` } : null} onClick={() => r.photo_url && setLb(r)}>Room {r.number}</div>
          <div style={{ padding: 12 }}><div className="note">{r.note || rate?.[2]}</div>
            <div className={r.available === false ? "note" : "price"}>{r.available === null ? NGN(r.price_ngn) : r.available ? "Free for your dates" : "Taken for your dates"}</div>
            <button className="sm" disabled={r.available === false} onClick={() => onPick(r)}>Book this room</button></div></div>)}</div>
          : <p className="note">{rate?.[2]}. Individual room numbers will appear here soon.</p>}</div>; })}
    {lb && <div className="lb" onClick={() => setLb(null)}><img src={lb.photo_url} alt={"Room " + lb.number} /><p>Room {lb.number} · {lb.category}</p></div>}
  </section>;
}

function Mini({ title, fields, path, init }) {
  const [v, setV] = useState(init), [m, setM] = useState("");
  const go = async e => { e.preventDefault(); setM(""); const b = {}; fields.forEach(f => b[f.k] = f.type === "number" ? +v[f.k] : v[f.k]);
    try { await api(path, { method: "POST", body: b }); setM("Saved."); } catch (x) { setM(err(x)); } };
  return <form onSubmit={go}><h3 style={{ marginTop: 22 }}>{title}</h3><div className="f">{fields.map(f => <label key={f.k}>{f.label}
    {f.opts ? <select value={v[f.k]} onChange={e => setV({ ...v, [f.k]: e.target.value })}>{f.opts.map(o => <option key={o}>{o}</option>)}</select>
      : <input type={f.type || "text"} value={v[f.k]} onChange={e => setV({ ...v, [f.k]: e.target.value })} required={f.k !== "note"} />}</label>)}</div>
    <button className="sm">Save</button> <span className="note">{m}</span></form>;
}

function Book({ me, openAuth, q, setQ, pick }) {
  const [tab, setTab] = useState("room"), [rooms, setRooms] = useState([]), [venues, setVenues] = useState([]), [busy, setBusy] = useState(false), [m, setM] = useState(""), [e, setE] = useState("");
  const [f, setF] = useState({ cat: RATES[0][0], roomId: "", guests: 2, phone: "", note: "", venueId: "", date: "", start: "09:00", end: "17:00" });
  const set = (k, v) => setF(x => ({ ...x, [k]: v })), ok = q.from && q.to && q.to > q.from;
  useEffect(() => { api("/rooms" + (ok ? `?from=${q.from}&to=${q.to}` : "")).then(setRooms).catch(() => {}); }, [q.from, q.to]);
  useEffect(() => { api("/venues" + (f.date ? `?date=${f.date}` : "")).then(v => { setVenues(v); if (!f.venueId && v[0]) set("venueId", String(v[0].id)); }).catch(() => {}); }, [f.date]);
  useEffect(() => { if (!pick) return; if (pick.venue) { setTab("event"); set("venueId", String(pick.id)); } else { setTab("room"); setF(x => ({ ...x, cat: pick.category, roomId: String(pick.id) })); } }, [pick]);
  const cats = [...new Set([...RATES.map(r => r[0]), ...rooms.map(r => r.category)])], inCat = rooms.filter(r => r.category === f.cat);
  const price = (inCat.find(r => String(r.id) === f.roomId)?.price_ngn) ?? RATES.find(r => r[0] === f.cat)?.[1] ?? inCat[0]?.price_ngn;
  async function submit(ev) {
    ev.preventDefault(); if (!me) return openAuth(); setBusy(true); setE(""); setM("");
    const body = tab === "room" ? { kind: "room", category: f.cat, roomId: f.roomId ? +f.roomId : undefined, checkIn: q.from, checkOut: q.to, guests: +f.guests, phone: f.phone, note: f.note }
      : { kind: "venue", venueId: +f.venueId, date: f.date, startTime: f.start, endTime: f.end, guests: +f.guests, phone: f.phone, note: f.note };
    try { const r = await api("/bookings", { method: "POST", body }); setM(`Request received. Your reference is ${r.ref}. We will email you when the receptionist confirms.`); } catch (x) { setE(err(x)); }
    setBusy(false);
  }
  return <section id="book"><h2 className="rv">Book your stay or event</h2><p className="sub rv">Send a request. The receptionist confirms in the order received, and nothing is charged online.</p>
    <form className="card" style={{ marginTop: 18 }} onSubmit={submit}>
      <div className="tabs"><button type="button" className={tab === "room" ? "on" : ""} onClick={() => setTab("room")}>Room stay</button><button type="button" className={tab === "event" ? "on" : ""} onClick={() => setTab("event")}>Event or conference space</button></div>
      <div className="f">
        {tab === "room" ? <>
          <label>Room type<select value={f.cat} onChange={e => setF({ ...f, cat: e.target.value, roomId: "" })}>{cats.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Room number<select value={f.roomId} onChange={e => set("roomId", e.target.value)}><option value="">Any available room</option>{inCat.map(r => <option key={r.id} value={r.id} disabled={r.available === false}>Room {r.number}{r.available === false ? " (taken)" : ""}</option>)}</select></label>
          <label>Check-in<input type="date" required min={new Date().toISOString().slice(0, 10)} value={q.from} onChange={e => setQ({ ...q, from: e.target.value })} /></label>
          <label>Check-out<input type="date" required min={q.from} value={q.to} onChange={e => setQ({ ...q, to: e.target.value })} /></label>
        </> : <>
          <label>Space<select value={f.venueId} onChange={e => set("venueId", e.target.value)}>{venues.map(v => <option key={v.id} value={v.id}>{v.name}{v.available === false ? " (booked that day)" : ""}</option>)}</select></label>
          <label>Date<input type="date" required min={new Date().toISOString().slice(0, 10)} value={f.date} onChange={e => set("date", e.target.value)} /></label>
          <label>Start<input type="time" value={f.start} onChange={e => set("start", e.target.value)} /></label>
          <label>End<input type="time" value={f.end} onChange={e => set("end", e.target.value)} /></label>
        </>}
        <label>{tab === "room" ? "Guests" : "Attendees"}<input type="number" min="1" value={f.guests} onChange={e => set("guests", e.target.value)} /></label>
        <label>Phone<input type="tel" required value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="+234..." /></label>
      </div>
      <label>Requests<textarea value={f.note} onChange={e => set("note", e.target.value)} placeholder="Late arrival, pool party, setup needs…" /></label>
      <p className="price">{tab === "room" ? (ok && price ? `${nights(q.from, q.to)} night(s) · estimated ${NGN(nights(q.from, q.to) * price)}` : "Choose dates for an estimate") : "Price on request"}</p>
      <button disabled={busy}>{me ? "Request booking" : "Log in to request"}</button>
      {m && <p className="ok">{m}</p>}{e && <p className="err">{e}</p>}
    </form></section>;
}

function Desk({ me }) {
  const [rows, setRows] = useState([]), [e, setE] = useState("");
  const load = () => api("/staff/bookings").then(setRows).catch(x => setE(x.message));
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);
  const act = async (id, a, body = {}) => { setE(""); try { await api(`/staff/bookings/${id}/${a}`, { method: "POST", body }); load(); } catch (x) { if (x.data?.needsForce && confirm(x.message + ". Approve this one first anyway?")) return act(id, a, { force: true }); setE(x.message); } };
  let n = 0;
  return <section><h2>Front desk</h2><p className="note">Pending requests are listed oldest first. Approve in order, then hand over the keys on arrival.</p>{e && <p className="err">{e}</p>}
    <div className="t"><table><thead><tr><th>#</th><th>Ref</th><th>Guest</th><th>Booking</th><th>Guests</th><th>Status</th><th>Payment</th><th></th></tr></thead><tbody>
      {rows.map(b => <tr key={b.id}><td>{b.status === "pending" ? ++n : ""}</td><td>{b.ref}</td><td>{b.guest_name}<br />{b.phone}<br />{b.guest_email}<br /><span className="note">{b.note}</span></td>
        <td>{b.kind === "venue" ? `${b.venue_name} · ${String(b.check_in).slice(0, 10)} ${b.start_time?.slice(0, 5)}-${b.end_time?.slice(0, 5)}` : `${b.category}${b.room_number ? " · Room " + b.room_number : ""} · ${String(b.check_in).slice(0, 10)} to ${String(b.check_out).slice(0, 10)}`}</td>
        <td>{b.guests}</td><td>{b.status}</td><td>{b.amount_ngn > 0 ? `${NGN(b.paid_ngn)} / ${NGN(b.amount_ngn)}` : "No amount"}<br />{["confirmed", "checked_in"].includes(b.status) && <><button className="sm alt" onClick={() => { const v = prompt("Amount in naira for this booking", b.amount_ngn || ""); if (v) act(b.id, "quote", { amountNgn: Math.round(+v) }); }}>Set amount</button> <button className="sm alt" onClick={() => { const v = prompt("Cash received (naira)"); if (v) act(b.id, "cash", { amountNgn: Math.round(+v) }); }}>Cash</button></>}</td><td>
          {b.status === "pending" && <><button className="sm" onClick={() => act(b.id, "approve")}>Approve</button> <button className="sm alt" onClick={() => act(b.id, "decline")}>Decline</button></>}
          {b.status === "confirmed" && <><button className="sm" onClick={() => act(b.id, "handover")}>Keys handed over</button> <button className="sm alt" onClick={() => act(b.id, "decline")}>Cancel</button></>}</td></tr>)}
      {!rows.length && <tr><td colSpan="8">No booking requests yet.</td></tr>}</tbody></table></div>
    {me.role === "admin" && <>
      <Mini title="Add or update a room" path="/admin/rooms" init={{ number: "", category: RATES[0][0], priceNgn: "", note: "" }}
        fields={[{ k: "number", label: "Room number" }, { k: "category", label: "Category", opts: RATES.map(r => r[0]) }, { k: "priceNgn", label: "Price per night (NGN)", type: "number" }, { k: "note", label: "Description" }]} />
      <Mini title="Add a staff account" path="/admin/users" init={{ email: "", name: "", role: "receptionist", password: "" }}
        fields={[{ k: "email", label: "Email", type: "email" }, { k: "name", label: "Full name" }, { k: "role", label: "Role", opts: ["receptionist", "md", "staff", "admin"] }, { k: "password", label: "Temporary password (10+ chars)", type: "password" }]} />
    </>}</section>;
}

function Mine() {
  const [r, setR] = useState([]), [m, setM] = useState(""), load = () => api("/bookings/mine").then(setR).catch(() => {});
  useEffect(() => {
    const ref = new URLSearchParams(location.search).get("reference");
    if (ref) { api("/payments/verify?reference=" + encodeURIComponent(ref)).then(x => setM(x.status === "success" ? "Payment received. Thank you!" : "We have not received that payment yet. If you were charged, it will update shortly.")).catch(() => {}).finally(() => { history.replaceState(null, "", location.pathname + "#/mine"); load(); }); } else load();
  }, []);
  const pay = async ref => { setM(""); try { location.href = (await api(`/bookings/${ref}/pay`, { method: "POST", body: {} })).url; } catch (x) { setM(x.message); } };
  return <section><h2>My bookings</h2>{m && <p className="ok">{m}</p>}{r.length ? <div className="t"><table><thead><tr><th>Ref</th><th>Booking</th><th>Date</th><th>Status</th><th>Payment</th></tr></thead><tbody>{r.map(b => <tr key={b.ref}><td>{b.ref}</td><td>{b.kind === "venue" ? "Event space" : b.category}</td><td>{String(b.check_in).slice(0, 10)}</td><td>{b.status}</td>
    <td>{b.amount_ngn > 0 ? <>{NGN(b.paid_ngn)} of {NGN(b.amount_ngn)} paid{b.paid_ngn < b.amount_ngn && ["confirmed", "checked_in"].includes(b.status) && <> <button className="sm" onClick={() => pay(b.ref)}>Pay {NGN(b.amount_ngn - b.paid_ngn)}</button></>}</> : <span className="note">{b.status === "pending" ? "After confirmation" : "Amount to be set by the hotel"}</span>}</td></tr>)}</tbody></table></div> : <p className="note">No bookings yet.</p>}</section>;
}

export default function App() {
  const [me, setMe] = useState(null), [auth, setAuth] = useState(false), [route, setRoute] = useState(location.hash), [q, setQ] = useState({ from: "", to: "" }), [pick, setPick] = useState(null), [lb, setLb] = useState(null);
  useEffect(() => { api("/auth/me").then(setMe).catch(() => {}); const f = () => setRoute(location.hash); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  useEffect(() => { const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add("on")), { threshold: .15 }); document.querySelectorAll(".rv").forEach(e => io.observe(e)); return () => io.disconnect(); }, [route]);
  const staff = me && STAFF.includes(me.role), go = p => { setPick(p); setTimeout(() => document.getElementById("book")?.scrollIntoView(), 50); };
  const logout = async () => { await api("/auth/logout", { method: "POST" }); setMe(null); location.hash = ""; };
  const page = route === "#/portal" && me && me.role !== "guest" ? <Portal me={me} /> : route === "#/admin" && me && ["admin", "md"].includes(me.role) ? <AdminPage me={me} /> : route === "#/desk" && staff ? <Desk me={me} /> : route === "#/mine" && me ? <Mine /> : <>
    <div className="hero"><h1>Life is good at Boveeri.</h1><p>Suites, a blue-water pool with a thrilling red slide, a 24-hour restaurant and lounge, and space for your events, in the heart of Eket.</p>
      <div className="row"><a className="btn" href="#book">Book now</a><a className="btn" style={{ background: "var(--gold2)" }} href="#rooms">See rooms & rates</a></div></div>
    <NoticeStrip /><section id="story"><h2 className="rv">Stay. Dine. Splash. Celebrate.</h2><p className="sub rv">One address in Eket for your whole day, from a quiet suite to a lively evening.</p>
      <div className="stats rv"><div><b>4.1★</b>Google rating from 64 reviews</div><div><b>24 hrs</b>Restaurant and lounge</div><div><b>7</b>Room categories</div><div><b>Free</b>Wi-Fi, parking, breakfast</div></div></section>
    <section id="services"><h2 className="rv">Our services</h2><p className="sub rv">Hover or tap a card to reveal more.</p>
      <div className="grid">{SV.map(s => <div className="card" tabIndex="0" key={s[1]}><div style={{ fontSize: 28 }}>{s[0]}</div><h3>{s[1]}</h3><div className="more">{s[2]}</div></div>)}</div></section>
    <Rooms q={q} setQ={setQ} onPick={r => go(r)} />
    <section id="venues"><h2 className="rv">Events & conference spaces</h2><p className="sub rv">Prices are given on request.</p>
      <div className="grid">{[[1, "🎉", "Event Center", "Weddings, receptions, parties and large gatherings"], [2, "📋", "Event Planning Center", "Planning consultations, decor and event coordination"], [3, "🏢", "Conference Room", "Meetings, trainings, seminars and workshops"]].map(v =>
        <div className="card" key={v[0]}><div style={{ fontSize: 28 }}>{v[1]}</div><h3>{v[2]}</h3><p className="note">{v[3]}</p><button className="sm" onClick={() => go({ venue: true, id: v[0] })}>Check date & book</button></div>)}</div></section>
    <Book me={me} openAuth={() => setAuth(true)} q={q} setQ={setQ} pick={pick} />
    <section id="gallery"><h2 className="rv">Gallery</h2><p className="sub rv">Tap a photo to enlarge.</p>
      <div className="gal">{GAL.map(g => <figure className="gt" key={g.u} onClick={() => setLb(g)}><img loading="lazy" src={g.u} alt={g.cap} /><figcaption>{g.cap}</figcaption></figure>)}</div></section>
    <section id="contact"><h2 className="rv">Visit or call us</h2><p>7 Afaha Atai Road, Eket, Akwa Ibom State, Nigeria<br />Phone: <a href="tel:+2349072107699">+234 907 210 7699</a> or <a href="tel:+2348065057644">+234 806 505 7644</a><br />Email: <a href="mailto:boveeris@gmail.com">boveeris@gmail.com</a><br />Check-in from 14:00 · Check-out by 12:00 · Front desk open 24/7</p></section></>;
  return <>
    <header><a className="logo" href="#"><img src="/img/logo.png" alt="Boveeri Pavilion logo" /><span>Boveeri Pavilion</span></a>
      <nav><a href="#rooms">Rooms</a><a href="#venues">Events</a><a href="#gallery">Gallery</a><a href="#book">Book</a><a href="#contact">Contact</a>
        {staff && <a href="#/desk">Front desk</a>}{me && me.role !== "guest" && <a href="#/portal">Staff portal</a>}{me && ["admin", "md"].includes(me.role) && <a href="#/admin">Management</a>}{me && <a href="#/mine">My bookings</a>}
        {me ? <button className="sm" onClick={logout}>Log out ({me.name.split(" ")[0]})</button> : <button className="sm" onClick={() => setAuth(true)}>Log in</button>}</nav></header>
    <main>{page}</main>
    <footer><img src="/img/logo-black.jpg" alt="Boveeri Pavilion" style={{ height: 110, display: "block", marginBottom: 10 }} />© Boveeri Pavilion & Suites · <a href="https://maps.app.goo.gl/BYTfBMmUzdCT4Q7t8">Open in Maps</a> · <a href="https://www.facebook.com/Boveeri/">Facebook</a></footer>
    <Chat />
    {auth && <Auth onClose={() => setAuth(false)} onDone={u => { setMe(u); setAuth(false); }} />}
    {lb && <div className="lb" onClick={() => setLb(null)}><img src={lb.u} alt={lb.cap} /><p>{lb.cap}: {lb.desc} (Source: {lb.src})</p></div>}
  </>;
}
