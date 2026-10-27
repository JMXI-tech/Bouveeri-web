import nodemailer from "nodemailer";
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ok=process.env.GMAIL_USER&&process.env.GMAIL_APP_PASSWORD;
const tx=ok&&nodemailer.createTransport({service:"gmail",auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD}});
export async function sendMail(to,subject,html){
  if(!tx){console.warn("Mail skipped (Gmail not configured):",subject);return}
  try{await tx.sendMail({from:`"Boveeri Pavilion & Suites" <${process.env.GMAIL_USER}>`,to,subject,html})}
  catch(e){console.error("Mail failed:",e.message)}
}
const what=b=>b.kind==="venue"?`${esc(b.venue_name||"Event space")} on ${esc(b.check_in)} (${esc(b.start_time||"")} to ${esc(b.end_time||"")})`
  :`${esc(b.category)}${b.room_number?" - Room "+esc(b.room_number):""}, ${esc(b.check_in)} to ${esc(b.check_out)}`;
const foot="<p>Boveeri Pavilion &amp; Suites, 7 Afaha Atai Road, Eket, Akwa Ibom. Phone +234 907 210 7699.</p>";
export const mails={
  received:b=>[`Booking request ${b.ref} received`,`<p>Hello ${esc(b.guest_name)},</p><p>We received your request: ${what(b)}.</p><p>Reference: <b>${esc(b.ref)}</b>. Our receptionist will confirm shortly. No payment is taken online.</p>${foot}`],
  confirmed:b=>[`Booking ${b.ref} confirmed`,`<p>Hello ${esc(b.guest_name)},</p><p>Your booking is confirmed: ${what(b)}.</p><p>Check-in is from 14:00; check-out by 12:00. The receptionist will hand over your keys on arrival.</p>${foot}`],
  declined:b=>[`Booking ${b.ref} could not be confirmed`,`<p>Hello ${esc(b.guest_name)},</p><p>Sorry, we could not confirm: ${what(b)}. Please call us or try other dates.</p>${foot}`],
  alert:b=>[`New booking request ${b.ref}`,`<p>${esc(b.guest_name)} (${esc(b.phone)}) requested ${what(b)} for ${esc(b.guests)} guest(s).</p>`]
};
mails.paid = b => [`Payment received for ${b.ref}`, `<p>Hello ${esc(b.guest_name)},</p><p>We received your payment of <b>NGN ${Number(b.paid_now).toLocaleString()}</b> for booking ${esc(b.ref)} (${what(b)}). Thank you!</p>${foot}`];
