import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { z, ZodError } from "zod";
import { sendMail, mails } from "./mail.js";

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.set("trust proxy", 1);
app.use(helmet());
const jsonSmall = express.json({ limit: "50kb", verify: (q, s, b) => { q.raw = b; } });
app.use((q, s, n) => (q.path.startsWith("/api/admin/room-photo") ? n() : jsonSmall(q, s, n)));
app.use(cookieParser());
// Basic CSRF defence: cookies are SameSite=Lax and writes must be JSON (forms cannot send JSON cross-site).
app.use((q, s, n) => (["GET", "HEAD", "OPTIONS"].includes(q.method) || q.is("application/json") ? n() : s.status(415).json({ error: "JSON only" })));

const wrap = f => (q, s, n) => f(q, s, n).catch(n);
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true });
const need = roles => (q, s, n) => {
  try {
    const u = jwt.verify(q.cookies.t || "", SECRET);
    if (roles && !roles.includes(u.role)) return s.status(403).json({ error: "Not allowed" });
    q.user = u; n();
  } catch { s.status(401).json({ error: "Please log in" }); }
};
const STAFF = ["admin", "md", "receptionist"];
const setLogin = (s, u) => s.cookie("t", jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: "7d" }),
  { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 864e5 });
const pub = u => ({ id: u.id, email: u.email, name: u.name, role: u.role });
const ref = () => "BVR-" + crypto.randomBytes(4).toString("hex").toUpperCase();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);

// ---------- Auth ----------
app.post("/api/auth/register", authLimit, wrap(async (q, s) => {
  const b = z.object({ email: z.string().email().max(120), password: z.string().min(8).max(100), name: z.string().min(2).max(80) }).parse(q.body);
  try {
    const { rows } = await db.query("insert into users(email,password_hash,name,role) values(lower($1),$2,$3,'guest') returning *",
      [b.email, await bcrypt.hash(b.password, 12), b.name]);
    setLogin(s, rows[0]); s.status(201).json(pub(rows[0]));
  } catch (e) { if (e.code === "23505") return s.status(409).json({ error: "Email already registered" }); throw e; }
}));
app.post("/api/auth/login", authLimit, wrap(async (q, s) => {
  const b = z.object({ email: z.string().email(), password: z.string().min(1).max(100) }).parse(q.body);
  const { rows } = await db.query("select * from users where email=lower($1)", [b.email]);
  const ok = await bcrypt.compare(b.password, rows[0]?.password_hash || "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali");
  if (!rows[0] || !ok) return s.status(401).json({ error: "Wrong email or password" });
  setLogin(s, rows[0]); s.json(pub(rows[0]));
}));
app.post("/api/auth/logout", (q, s) => { s.clearCookie("t"); s.json({ ok: true }); });
app.get("/api/auth/me", need(), wrap(async (q, s) => {
  const { rows } = await db.query("select * from users where id=$1", [q.user.id]);
  rows[0] ? s.json(pub(rows[0])) : s.status(401).json({ error: "Please log in" });
}));

// ---------- Public catalogue (never exposes guest data) ----------
app.get("/api/rooms", wrap(async (q, s) => {
  const r = z.object({ from: day, to: day }).safeParse(q.query);
  const sql = r.success
    ? `select r.id,r.number,r.category,r.price_ngn,r.note,r.photo_url,
         not exists(select 1 from bookings b where b.room_id=r.id and b.status in ('confirmed','checked_in')
           and daterange(b.check_in,b.check_out,'[)') && daterange($1::date,$2::date,'[)')) as available
       from rooms r where r.active order by r.number`
    : "select id,number,category,price_ngn,note,photo_url,null as available from rooms where active order by number";
  s.json((await db.query(sql, r.success ? [r.data.from, r.data.to] : [])).rows);
}));
app.get("/api/venues", wrap(async (q, s) => {
  const d = day.safeParse(q.query.date);
  const sql = `select v.id,v.name,v.description,
      ${d.success ? "not exists(select 1 from bookings b where b.venue_id=v.id and b.status in ('confirmed','checked_in') and b.check_in<=$1::date and b.check_out>$1::date)" : "null"} as available
    from venues v order by v.id`;
  s.json((await db.query(sql, d.success ? [d.data] : [])).rows);
}));

// ---------- Guest bookings ----------
const roomReq = z.object({ kind: z.literal("room"), category: z.string().min(1).max(60), roomId: z.number().int().optional(),
  checkIn: day, checkOut: day, guests: z.number().int().min(1).max(20), phone: z.string().min(7).max(25), note: z.string().max(500).default("") });
const venueReq = z.object({ kind: z.literal("venue"), venueId: z.number().int(), date: day, startTime: time, endTime: time,
  guests: z.number().int().min(1).max(2000), phone: z.string().min(7).max(25), note: z.string().max(500).default("") });
app.post("/api/bookings", need(), wrap(async (q, s) => {
  const b = z.discriminatedUnion("kind", [roomReq, venueReq]).parse(q.body);
  const { rows: [u] } = await db.query("select * from users where id=$1", [q.user.id]);
  const today = new Date().toISOString().slice(0, 10);
  let v;
  if (b.kind === "room") {
    if (b.checkIn < today || b.checkOut <= b.checkIn) return s.status(400).json({ error: "Check the dates" });
    if (b.roomId) {
      const { rows } = await db.query(`select 1 from rooms r where r.id=$1 and r.active and r.category=$2 and not exists(
        select 1 from bookings b where b.room_id=r.id and b.status in ('confirmed','checked_in')
        and daterange(b.check_in,b.check_out,'[)') && daterange($3::date,$4::date,'[)'))`, [b.roomId, b.category, b.checkIn, b.checkOut]);
      if (!rows[0]) return s.status(409).json({ error: "That room is not available for those dates" });
    }
    v = ["room", b.category, b.roomId || null, null, b.checkIn, b.checkOut, null, null];
  } else {
    if (b.date < today || b.endTime <= b.startTime) return s.status(400).json({ error: "Check the date and times" });
    const next = new Date(Date.parse(b.date) + 864e5).toISOString().slice(0, 10);
    v = ["venue", null, null, b.venueId, b.date, next, b.startTime, b.endTime];
  }
  const { rows: [bk] } = await db.query(`insert into bookings(ref,user_id,kind,category,room_id,venue_id,check_in,check_out,start_time,end_time,guests,guest_name,guest_email,phone,note)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`, [ref(), u.id, ...v, b.guests, u.name, u.email, b.phone, b.note]);
  sendMail(u.email, ...mails.received(bk));
  if (process.env.HOTEL_INBOX) sendMail(process.env.HOTEL_INBOX, ...mails.alert(bk));
  s.status(201).json({ ref: bk.ref, status: bk.status });
}));
app.get("/api/bookings/mine", need(), wrap(async (q, s) => {
  s.json((await db.query("select ref,kind,category,room_id,venue_id,check_in,check_out,start_time,end_time,guests,status,amount_ngn,paid_ngn,created_at from bookings where user_id=$1 order by created_at desc", [q.user.id])).rows);
}));

// ---------- Reception (receptionist, MD, admin) ----------
const joined = `select b.*, r.number as room_number, v.name as venue_name from bookings b
  left join rooms r on r.id=b.room_id left join venues v on v.id=b.venue_id`;
app.get("/api/staff/bookings", need(STAFF), wrap(async (q, s) => {
  // Pending first, oldest first = first come, first served.
  const { rows } = await db.query(`${joined} order by (b.status='pending') desc,
    case when b.status='pending' then b.created_at end asc, b.created_at desc limit 300`);
  s.json(rows);
}));
app.post("/api/staff/bookings/:id/approve", need(STAFF), wrap(async (q, s) => {
  const force = z.object({ force: z.boolean().default(false), roomId: z.number().int().optional() }).parse(q.body || {});
  const c = await db.connect();
  try {
    await c.query("begin");
    const { rows: [bk] } = await c.query("select * from bookings where id=$1 for update", [q.params.id]);
    if (!bk || bk.status !== "pending") { await c.query("rollback"); return s.status(409).json({ error: "Request is not pending" }); }
    const older = await c.query(`select 1 from bookings o where o.status='pending' and o.id<>$1 and o.created_at<$2
      and o.kind=$3 and o.check_in<$5 and o.check_out>$4 and ((o.kind='room' and o.category=$6) or (o.kind='venue' and o.venue_id=$7)) limit 1`,
      [bk.id, bk.created_at, bk.kind, bk.check_in, bk.check_out, bk.category, bk.venue_id]);
    if (older.rowCount && !force.force) { await c.query("rollback");
      return s.status(409).json({ error: "An earlier request for these dates is still waiting", needsForce: true }); }
    let roomId = bk.room_id || force.roomId || null;
    if (bk.kind === "room" && !roomId) {
      const f = await c.query(`select r.id from rooms r where r.active and r.category=$1 and not exists(
        select 1 from bookings b where b.room_id=r.id and b.status in ('confirmed','checked_in')
        and daterange(b.check_in,b.check_out,'[)') && daterange($2::date,$3::date,'[)')) order by r.number limit 1`, [bk.category, bk.check_in, bk.check_out]);
      if (!f.rowCount) { await c.query("rollback"); return s.status(409).json({ error: "No room of this category is free for those dates" }); }
      roomId = f.rows[0].id;
    }
    await c.query("update bookings set status='confirmed',room_id=$2,handled_by=$3,handled_at=now(),amount_ngn=coalesce((select price_ngn from rooms where id=$2),0)*(check_out-check_in) where id=$1", [bk.id, roomId, q.user.id]);
    await c.query("commit");
    const { rows: [full] } = await db.query(`${joined} where b.id=$1`, [bk.id]);
    sendMail(full.guest_email, ...mails.confirmed(full));
    s.json({ ok: true, roomNumber: full.room_number });
  } catch (e) {
    await c.query("rollback").catch(() => {});
    if (e.code === "23P01") return s.status(409).json({ error: "Already booked for those dates" });
    throw e;
  } finally { c.release(); }
}));
app.post("/api/staff/bookings/:id/decline", need(STAFF), wrap(async (q, s) => {
  const { rows } = await db.query("update bookings set status='declined',handled_by=$2,handled_at=now() where id=$1 and status in ('pending','confirmed') returning id", [q.params.id, q.user.id]);
  if (!rows[0]) return s.status(409).json({ error: "Cannot decline" });
  const { rows: [full] } = await db.query(`${joined} where b.id=$1`, [q.params.id]);
  sendMail(full.guest_email, ...mails.declined(full)); s.json({ ok: true });
}));
app.post("/api/staff/bookings/:id/handover", need(STAFF), wrap(async (q, s) => {
  const { rows } = await db.query("update bookings set status='checked_in',handled_by=$2,handled_at=now() where id=$1 and status='confirmed' returning id", [q.params.id, q.user.id]);
  rows[0] ? s.json({ ok: true }) : s.status(409).json({ error: "Only confirmed bookings can be handed over" });
}));

// ---------- Admin ----------
const ADMIN = need(["admin"]);
app.post("/api/admin/rooms", ADMIN, wrap(async (q, s) => {
  const b = z.object({ number: z.string().min(1).max(10), category: z.string().min(1).max(60), priceNgn: z.number().int().min(0),
    note: z.string().max(300).default(""), photoUrl: z.string().max(500).default("") }).parse(q.body);
  const { rows } = await db.query(`insert into rooms(number,category,price_ngn,note,photo_url) values($1,$2,$3,$4,$5)
    on conflict(number) do update set category=$2,price_ngn=$3,note=$4,photo_url=$5 returning *`, [b.number, b.category, b.priceNgn, b.note, b.photoUrl]);
  s.json(rows[0]);
}));
app.patch("/api/admin/rooms/:id", ADMIN, wrap(async (q, s) => {
  const b = z.object({ active: z.boolean() }).parse(q.body);
  s.json((await db.query("update rooms set active=$2 where id=$1 returning *", [q.params.id, b.active])).rows[0] || {});
}));
app.get("/api/admin/users", ADMIN, wrap(async (q, s) => s.json((await db.query("select id,email,name,role,created_at from users order by id")).rows)));
app.post("/api/admin/users", ADMIN, wrap(async (q, s) => {
  const b = z.object({ email: z.string().email(), name: z.string().min(2).max(80), role: z.enum(["admin", "md", "receptionist", "staff"]),
    password: z.string().min(10).max(100) }).parse(q.body);
  try {
    const { rows } = await db.query("insert into users(email,password_hash,name,role) values(lower($1),$2,$3,$4) returning *", [b.email, await bcrypt.hash(b.password, 12), b.name, b.role]);
    s.status(201).json(pub(rows[0]));
  } catch (e) { if (e.code === "23505") return s.status(409).json({ error: "Email already used" }); throw e; }
}));
app.delete("/api/admin/users/:id", ADMIN, wrap(async (q, s) => {
  if (+q.params.id === q.user.id) return s.status(400).json({ error: "You cannot delete yourself" });
  await db.query("delete from users where id=$1", [q.params.id]); s.json({ ok: true });
}));

// ---------- Chatbot ----------
const chatLimit = rateLimit({ windowMs: 60 * 1000, limit: 15 });
const maybe = q => { try { return jwt.verify(q.cookies.t || "", SECRET); } catch { return null; } };
let factCache = { t: 0, text: "" };
async function facts() {
  if (Date.now() - factCache.t < 60000) return factCache.text;
  const rooms = (await db.query("select number,category,price_ngn from rooms where active order by number")).rows;
  const venues = (await db.query("select name,description from venues order by id")).rows;
  factCache = { t: Date.now(), text: `You are the friendly virtual assistant of Boveeri Pavilion & Suites, 7 Afaha Atai Road, Eket, Akwa Ibom, Nigeria.
Phones +234 907 210 7699 and +234 806 505 7644. Email boveeris@gmail.com. Check-in from 14:00, check-out by 12:00, front desk 24/7. Google rating 4.1 from 64 reviews. About 25 minutes by car to Ibeno Beach.
Published rates per night (NGN): Classic 29,200; Standard Room 39,000; Deluxe Room 46,920; Junior Suite 57,960; 1 Bedroom Suite 69,480; 2 Bedroom Suite 114,720; Presidential Suite 167,520.
${rooms.length ? "Individual rooms: " + rooms.map(r => `Room ${r.number} (${r.category}, NGN ${r.price_ngn.toLocaleString()})`).join("; ") + "." : ""}
Services: rooms and suites with AC, TV and fridge; restaurant (Nigerian and international, open 24 hours); free breakfast 7:00 to 11:30; lounge bar, outdoor bar, pool bar and nightclub; swimming pool with a red water slide; meeting and event space; free Wi-Fi, parking, laundry, concierge and tour help. Bookable spaces (price on request): ${venues.map(v => v.name + " (" + v.description + ")").join("; ")}.
Booking: guests log in on the website and send a request; the receptionist confirms in the order received. No online payment. Cancellation policy, airport transfer, menu prices and event capacities are not known: say so and give the phone number.
Rules: answer only about the hotel using these facts; never invent prices or policies; keep replies short and warm; reply in the guest's language; never ask for passwords or card numbers; for complaints or urgent matters give the phone number; the guest can also leave a message for the team in the chat window.` };
  return factCache.text;
}
app.post("/api/chat", chatLimit, wrap(async (q, s) => {
  const b = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(800) })).min(1).max(12) }).parse(q.body);
  if (b.messages[0].role !== "user" || b.messages.at(-1).role !== "user") return s.status(400).json({ error: "Invalid conversation" });
  if (!process.env.ANTHROPIC_API_KEY) return s.status(503).json({ error: "Chat is not set up yet. Please call +234 907 210 7699." });
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.CHAT_MODEL || "claude-haiku-5-5", max_tokens: 400, system: await facts(), messages: b.messages }) });
  if (!r.ok) { console.error("chat", r.status, (await r.text()).slice(0, 300)); return s.status(502).json({ error: "The assistant is busy. Please call +234 907 210 7699." }); }
  const d = await r.json();
  s.json({ reply: (d.content || []).filter(x => x.type === "text").map(x => x.text).join("") || "Sorry, please call +234 907 210 7699." });
}));
app.post("/api/enquiries", chatLimit, wrap(async (q, s) => {
  const b = z.object({ name: z.string().min(2).max(80), phone: z.string().min(7).max(25), email: z.string().email().max(120).or(z.literal("")).default(""), message: z.string().min(3).max(1000) }).parse(q.body);
  await db.query("insert into enquiries(name,phone,email,message) values($1,$2,$3,$4)", [b.name, b.phone, b.email, b.message]);
  if (process.env.HOTEL_INBOX) sendMail(process.env.HOTEL_INBOX, "New website enquiry", `<p>${b.name.replace(/</g, "&lt;")} (${b.phone.replace(/</g, "&lt;")}): ${b.message.replace(/</g, "&lt;")}</p>`);
  s.status(201).json({ ok: true });
}));
app.get("/api/staff/enquiries", need(STAFF), wrap(async (q, s) => s.json((await db.query("select * from enquiries order by created_at desc limit 100")).rows)));

// ---------- Stage 3: employees, notices, team inbox ----------
const MGMT = ["admin", "md"], TEAM = ["admin", "md", "receptionist", "staff"];
const SECTORS = ["Management", "Security", "Housekeeping", "Front Desk", "Kitchen", "Bar & Lounge", "Pool & Leisure", "Maintenance", "Events", "Laundry", "Accounts"];
const empBody = z.object({ fullName: z.string().min(2).max(80), jobTitle: z.string().min(2).max(80), sector: z.enum(SECTORS),
  accountRole: z.enum(["staff", "receptionist", "md"]).default("staff"), shiftDays: z.string().max(60).default(""),
  shiftStart: time.or(z.literal("")).default(""), shiftEnd: time.or(z.literal("")).default("") });
const vcode = () => "BVR-" + crypto.randomBytes(3).toString("hex").toUpperCase();
app.post("/api/admin/employees", need(MGMT), wrap(async (q, s) => {
  const b = empBody.parse(q.body);
  if (b.accountRole === "md" && q.user.role !== "admin") return s.status(403).json({ error: "Only the admin can create an MD" });
  const { rows } = await db.query(`insert into employees(verification_code,full_name,job_title,sector,account_role,shift_days,shift_start,shift_end,created_by)
    values($1,$2,$3,$4,$5,$6,nullif($7,'')::time,nullif($8,'')::time,$9) returning *`, [vcode(), b.fullName, b.jobTitle, b.sector, b.accountRole, b.shiftDays, b.shiftStart, b.shiftEnd, q.user.id]);
  s.status(201).json(rows[0]);
}));
app.get("/api/admin/employees", need(MGMT), wrap(async (q, s) => s.json((await db.query(
  "select e.*, u.email from employees e left join users u on u.id=e.user_id order by e.sector, e.full_name")).rows)));
app.patch("/api/admin/employees/:id", need(MGMT), wrap(async (q, s) => {
  const b = empBody.partial().parse(q.body);
  if (b.accountRole === "md" && q.user.role !== "admin") return s.status(403).json({ error: "Only the admin can make an MD" });
  const cols = { fullName: "full_name", jobTitle: "job_title", sector: "sector", accountRole: "account_role", shiftDays: "shift_days", shiftStart: "shift_start", shiftEnd: "shift_end" };
  const keys = Object.keys(b); if (!keys.length) return s.status(400).json({ error: "Nothing to update" });
  const vals = keys.map(k => (b[k] === "" && k.startsWith("shiftS") || b[k] === "" && k === "shiftEnd") ? null : b[k]);
  const { rows } = await db.query(`update employees set ${keys.map((k, i) => cols[k] + "=$" + (i + 2)).join(",")} where id=$1 returning *`, [q.params.id, ...vals]);
  if (rows[0]?.user_id) await db.query("update users set role=$2,name=$3 where id=$1 and role<>'admin'", [rows[0].user_id, rows[0].account_role, rows[0].full_name]);
  s.json(rows[0] || {});
}));
app.delete("/api/admin/employees/:id", need(["admin"]), wrap(async (q, s) => {
  const { rows } = await db.query("delete from employees where id=$1 returning user_id", [q.params.id]);
  if (rows[0]?.user_id) await db.query("delete from users where id=$1 and role<>'admin'", [rows[0].user_id]);
  s.json({ ok: true });
}));
app.post("/api/auth/employee-signup", authLimit, wrap(async (q, s) => {
  const b = z.object({ code: z.string().min(4).max(20), email: z.string().email().max(120), password: z.string().min(8).max(100) }).parse(q.body);
  const c = await db.connect();
  try {
    await c.query("begin");
    const { rows: [e] } = await c.query("select * from employees where verification_code=upper($1) and user_id is null for update", [b.code.trim()]);
    if (!e) { await c.query("rollback"); return s.status(400).json({ error: "That verification ID is invalid or already used" }); }
    const { rows: [u] } = await c.query("insert into users(email,password_hash,name,role) values(lower($1),$2,$3,$4) returning *", [b.email, await bcrypt.hash(b.password, 12), e.full_name, e.account_role]);
    await c.query("update employees set user_id=$2, claimed_at=now() where id=$1", [e.id, u.id]);
    await c.query("commit"); setLogin(s, u); s.status(201).json(pub(u));
  } catch (e) { await c.query("rollback").catch(() => {}); if (e.code === "23505") return s.status(409).json({ error: "Email already registered" }); throw e; }
  finally { c.release(); }
}));
app.get("/api/me/employee", need(TEAM), wrap(async (q, s) => s.json((await db.query("select * from employees where user_id=$1", [q.user.id])).rows[0] || null)));
app.patch("/api/me/employee", need(TEAM), wrap(async (q, s) => {
  const b = z.object({ phone: z.string().max(25), address: z.string().max(200), emergencyContact: z.string().max(120) }).parse(q.body);
  const { rows } = await db.query("update employees set phone=$2,address=$3,emergency_contact=$4 where user_id=$1 returning *", [q.user.id, b.phone, b.address, b.emergencyContact]);
  rows[0] ? s.json(rows[0]) : s.status(404).json({ error: "No employee record is linked to this account" });
}));
app.get("/api/notices", wrap(async (q, s) => {
  const u = maybe(q); let sql, args = [];
  if (u && MGMT.includes(u.role)) sql = "select * from notices order by created_at desc limit 100";
  else if (u && TEAM.includes(u.role)) { sql = "select * from notices where audience in ('all','staff') or (audience='sector' and sector=(select sector from employees where user_id=$1)) order by created_at desc limit 100"; args = [u.id]; }
  else sql = "select * from notices where audience in ('all','guests') order by created_at desc limit 20";
  s.json((await db.query(sql, args)).rows);
}));
app.post("/api/notices", need(MGMT), wrap(async (q, s) => {
  const b = z.object({ title: z.string().min(2).max(120), body: z.string().min(2).max(2000), audience: z.enum(["all", "staff", "guests", "sector"]), sector: z.enum(SECTORS).optional() }).parse(q.body);
  if (b.audience === "sector" && !b.sector) return s.status(400).json({ error: "Choose a sector" });
  s.status(201).json((await db.query("insert into notices(author_id,title,body,audience,sector) values($1,$2,$3,$4,$5) returning *", [q.user.id, b.title, b.body, b.audience, b.sector || null])).rows[0]);
}));
app.delete("/api/notices/:id", need(MGMT), wrap(async (q, s) => { await db.query("delete from notices where id=$1", [q.params.id]); s.json({ ok: true }); }));
app.get("/api/team", need(TEAM), wrap(async (q, s) => s.json((await db.query(
  `select u.id,u.name,u.role,e.job_title,e.sector,(select count(*)::int from messages m where m.from_user=u.id and m.to_user=$1 and m.read_at is null) as unread
   from users u left join employees e on e.user_id=u.id where u.role<>'guest' and u.id<>$1 order by u.name`, [q.user.id])).rows)));
app.get("/api/messages", need(TEAM), wrap(async (q, s) => {
  const w = z.coerce.number().int().parse(q.query.with);
  await db.query("update messages set read_at=now() where from_user=$1 and to_user=$2 and read_at is null", [w, q.user.id]);
  s.json((await db.query("select id,from_user,to_user,body,created_at from messages where (from_user=$1 and to_user=$2) or (from_user=$2 and to_user=$1) order by created_at asc limit 200", [q.user.id, w])).rows);
}));
app.post("/api/messages", need(TEAM), wrap(async (q, s) => {
  const b = z.object({ to: z.number().int(), body: z.string().min(1).max(1000) }).parse(q.body);
  const t = await db.query("select 1 from users where id=$1 and role<>'guest' and id<>$2", [b.to, q.user.id]);
  if (!t.rowCount) return s.status(400).json({ error: "Unknown recipient" });
  await db.query("insert into messages(from_user,to_user,body) values($1,$2,$3)", [q.user.id, b.to, b.body]); s.status(201).json({ ok: true });
}));

// ---------- Sector tools ----------
const KINDS = { Housekeeping: "Cleaning task", Maintenance: "Repair ticket", Security: "Incident / visitor log", Kitchen: "Order or stock note", "Bar & Lounge": "Stock note",
  "Pool & Leisure": "Pool safety log", Events: "Event task", Laundry: "Laundry batch", Accounts: "Daily record", "Front Desk": "Front desk note", Management: "Management note" };
const HK = ["clean", "dirty", "cleaning", "inspect", "out"];
async function sectorOf(u) { return MGMT.includes(u.role) ? null : (await db.query("select sector from employees where user_id=$1", [u.id])).rows[0]?.sector || false; }
app.get("/api/sector/items", need(TEAM), wrap(async (q, s) => {
  const own = await sectorOf(q.user);
  if (own === false) return s.status(403).json({ error: "No sector is assigned to your account" });
  const sec = own || (q.query.sector && SECTORS.includes(q.query.sector) ? q.query.sector : null);
  s.json((await db.query(`select i.*, u.name as author from sector_items i left join users u on u.id=i.created_by
    where ($1::text is null or i.sector=$1) order by (i.status='done'), i.created_at desc limit 200`, [sec])).rows);
}));
app.post("/api/sector/items", need(TEAM), wrap(async (q, s) => {
  const b = z.object({ title: z.string().min(2).max(140), details: z.string().max(1500).default(""), roomNumber: z.string().max(10).optional(), sector: z.enum(SECTORS).optional() }).parse(q.body);
  const own = await sectorOf(q.user);
  if (own === false) return s.status(403).json({ error: "No sector is assigned to your account" });
  const sec = own || b.sector; if (!sec) return s.status(400).json({ error: "Choose a sector" });
  s.status(201).json((await db.query("insert into sector_items(sector,kind,title,details,room_number,created_by) values($1,$2,$3,$4,$5,$6) returning *",
    [sec, KINDS[sec] || "Note", b.title, b.details, b.roomNumber || null, q.user.id])).rows[0]);
}));
app.patch("/api/sector/items/:id", need(TEAM), wrap(async (q, s) => {
  const b = z.object({ status: z.enum(["open", "in_progress", "done"]).optional(), details: z.string().max(1500).optional() }).parse(q.body);
  const own = await sectorOf(q.user);
  if (own === false) return s.status(403).json({ error: "No sector" });
  const { rows } = await db.query(`update sector_items set status=coalesce($2,status), details=coalesce($3,details), updated_at=now()
    where id=$1 and ($4::text is null or sector=$4) returning *`, [q.params.id, b.status || null, b.details ?? null, own]);
  rows[0] ? s.json(rows[0]) : s.status(404).json({ error: "Not found in your sector" });
}));
app.delete("/api/sector/items/:id", need(TEAM), wrap(async (q, s) => {
  const own = await sectorOf(q.user);
  if (own === false) return s.status(403).json({ error: "No sector" });
  await db.query("delete from sector_items where id=$1 and ($2::text is null or sector=$2)", [q.params.id, own]); s.json({ ok: true });
}));
app.get("/api/sector/rooms", need(TEAM), wrap(async (q, s) => s.json((await db.query("select id,number,category,hk_status,active from rooms order by number")).rows)));
app.patch("/api/sector/rooms/:id/hk", need(TEAM), wrap(async (q, s) => {
  const b = z.object({ status: z.enum(HK) }).parse(q.body);
  const own = await sectorOf(q.user);
  if (own !== null && !["Housekeeping", "Front Desk", "Maintenance"].includes(own)) return s.status(403).json({ error: "Only housekeeping, front desk and maintenance can change room status" });
  s.json((await db.query("update rooms set hk_status=$2 where id=$1 returning id,number,hk_status", [q.params.id, b.status])).rows[0] || {});
}));

// ---------- Room photo upload (admin / MD) ----------
const UP = process.env.UPLOAD_DIR || "uploads";
fs.mkdirSync(UP, { recursive: true });
app.use("/uploads", express.static(UP, { maxAge: "7d" }));
app.post("/api/admin/room-photo/:id", need(MGMT), express.json({ limit: "8mb" }), wrap(async (q, s) => {
  const b = z.object({ data: z.string().max(8e6) }).parse(q.body);
  const m = b.data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return s.status(400).json({ error: "Upload a JPEG, PNG or WebP image" });
  const buf = Buffer.from(m[2], "base64");
  const sig = buf.subarray(0, 12).toString("latin1");
  const good = buf.length < 5e6 && ((m[1] === "jpeg" && buf[0] === 0xff && buf[1] === 0xd8) || (m[1] === "png" && sig.startsWith("\x89PNG")) || (m[1] === "webp" && sig.startsWith("RIFF") && sig.slice(8, 12) === "WEBP"));
  if (!good) return s.status(400).json({ error: "Image is invalid or larger than 5 MB" });
  const name = crypto.randomUUID() + (m[1] === "jpeg" ? ".jpg" : "." + m[1]);
  const old = (await db.query("select photo_url from rooms where id=$1", [q.params.id])).rows[0]?.photo_url;
  fs.writeFileSync(path.join(UP, name), buf);
  const r = await db.query("update rooms set photo_url=$2 where id=$1 returning id,number,photo_url", [q.params.id, "/uploads/" + name]);
  if (!r.rowCount) { fs.unlink(path.join(UP, name), () => {}); return s.status(404).json({ error: "Room not found" }); }
  if (old?.startsWith("/uploads/")) fs.unlink(path.join(UP, path.basename(old)), () => {});
  s.json(r.rows[0]);
}));

// ---------- Payments (Paystack) ----------
const ps = (p, o = {}) => fetch("https://api.paystack.co" + p, { ...o, headers: { Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY, "content-type": "application/json" } }).then(r => r.json());
async function settle(reference) {
  const { rows: [p] } = await db.query("select * from payments where reference=$1", [reference]);
  if (!p || p.status === "success") return p || null;
  const v = await ps("/transaction/verify/" + encodeURIComponent(reference));
  if (v.status && v.data?.status === "success" && v.data.currency === "NGN" && v.data.amount === p.amount_ngn * 100) {
    const c = await db.connect(); let first = false;
    try {
      await c.query("begin");
      first = (await c.query("update payments set status='success',paid_at=now() where id=$1 and status<>'success'", [p.id])).rowCount > 0;
      if (first) await c.query("update bookings set paid_ngn=paid_ngn+$2 where id=$1", [p.booking_id, p.amount_ngn]);
      await c.query("commit");
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
    if (first) { const { rows: [f] } = await db.query(`${joined} where b.id=$1`, [p.booking_id]); sendMail(f.guest_email, ...mails.paid({ ...f, paid_now: p.amount_ngn })); }
    return { ...p, status: "success" };
  }
  if (["failed", "abandoned"].includes(v.data?.status)) await db.query("update payments set status='failed' where id=$1 and status='pending'", [p.id]);
  return p;
}
app.post("/api/bookings/:ref/pay", need(), wrap(async (q, s) => {
  if (!process.env.PAYSTACK_SECRET_KEY) return s.status(503).json({ error: "Online payment is not set up yet. Please pay at the front desk." });
  const { rows: [b] } = await db.query("select * from bookings where ref=$1 and user_id=$2", [q.params.ref, q.user.id]);
  if (!b) return s.status(404).json({ error: "Booking not found" });
  if (!["confirmed", "checked_in"].includes(b.status)) return s.status(400).json({ error: "Payment opens once the hotel confirms your booking" });
  const due = b.amount_ngn - b.paid_ngn;
  if (due <= 0) return s.status(400).json({ error: b.amount_ngn ? "Already paid" : "The hotel has not set an amount yet" });
  const reference = "PS-" + crypto.randomBytes(8).toString("hex");
  const d = await ps("/transaction/initialize", { method: "POST", body: JSON.stringify({ email: b.guest_email, amount: due * 100, currency: "NGN", reference,
    callback_url: (process.env.SITE_URL || "") + "/?pay=1#/mine", metadata: { booking_ref: b.ref } }) });
  if (!d.status) { console.error("paystack init", d.message); return s.status(502).json({ error: "Could not start payment. Please try again." }); }
  await db.query("insert into payments(booking_id,reference,amount_ngn) values($1,$2,$3)", [b.id, reference, due]);
  s.json({ url: d.data.authorization_url });
}));
app.get("/api/payments/verify", need(), wrap(async (q, s) => {
  const ref = z.string().min(5).max(60).parse(q.query.reference);
  const { rows } = await db.query("select p.id from payments p join bookings b on b.id=p.booking_id where p.reference=$1 and b.user_id=$2", [ref, q.user.id]);
  if (!rows[0]) return s.status(404).json({ error: "Payment not found" });
  const p = await settle(ref); s.json({ status: p?.status });
}));
app.post("/api/paystack/webhook", wrap(async (q, s) => {
  const sig = Buffer.from(q.get("x-paystack-signature") || "", "utf8"), mac = Buffer.from(crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY || "x").update(q.raw || "").digest("hex"), "utf8");
  if (!process.env.PAYSTACK_SECRET_KEY || sig.length !== mac.length || !crypto.timingSafeEqual(sig, mac)) return s.sendStatus(401);
  if (q.body?.event === "charge.success" && q.body.data?.reference) await settle(q.body.data.reference);
  s.sendStatus(200);
}));
app.post("/api/staff/bookings/:id/quote", need(STAFF), wrap(async (q, s) => {
  const b = z.object({ amountNgn: z.number().int().min(0).max(100000000) }).parse(q.body);
  const { rows } = await db.query("update bookings set amount_ngn=$2 where id=$1 and status in ('confirmed','checked_in') returning id", [q.params.id, b.amountNgn]);
  rows[0] ? s.json({ ok: true }) : s.status(409).json({ error: "Confirm the booking first" });
}));
app.post("/api/staff/bookings/:id/cash", need(STAFF), wrap(async (q, s) => {
  const b = z.object({ amountNgn: z.number().int().min(1).max(100000000) }).parse(q.body);
  const { rows: [bk] } = await db.query("select * from bookings where id=$1", [q.params.id]);
  if (!bk) return s.status(404).json({ error: "Not found" });
  await db.query("insert into payments(booking_id,reference,amount_ngn,status,channel,paid_at) values($1,$2,$3,'success','cash',now())", [bk.id, "CASH-" + crypto.randomBytes(6).toString("hex"), b.amountNgn]);
  await db.query("update bookings set paid_ngn=paid_ngn+$2 where id=$1", [bk.id, b.amountNgn]); s.json({ ok: true });
}));

app.use(express.static("public"));
app.use((e, q, s, n) => {
  if (e instanceof ZodError) return s.status(400).json({ error: "Invalid input", details: e.issues.map(i => i.path.join(".") + ": " + i.message) });
  console.error(e); s.status(500).json({ error: "Server error" });
});

async function start() {
  await db.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const { ADMIN_EMAIL: e, ADMIN_PASSWORD: p } = process.env;
  if (e && p) {
    const has = await db.query("select 1 from users where role='admin' limit 1");
    if (!has.rowCount) await db.query("insert into users(email,password_hash,name,role) values(lower($1),$2,'Owner','admin')", [e, await bcrypt.hash(p, 12)]);
  }
  app.listen(3000, () => console.log("Boveeri API on :3000"));
}
start().catch(e => { console.error(e); process.exit(1); });
