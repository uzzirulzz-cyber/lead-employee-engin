
const nodemailer=require('nodemailer');
function getTransporter(){
  const host=process.env.SMTP_HOST||'smtp.gmail.com';
  const port=parseInt(process.env.SMTP_PORT||'587');
  const user=process.env.SMTP_USER; const pass=process.env.SMTP_PASS;
  if(!user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port===465, auth:{ user, pass } });
}
function renderTemplate(text, lead){
  if(!text) return '';
  return text.replace(/\{\{companyName\}\}/g, lead.companyName||'there').replace(/\{\{city\}\}/g, lead.city||'').replace(/\{\{country\}\}/g, lead.country||'').replace(/\{\{industry\}\}/g, lead.industry||'').replace(/\{\{website\}\}/g, lead.website||'').replace(/\{\{email\}\}/g, lead.email||'');
}
async function sendEmail({ to, subject, body, lead }){
  const transporter=getTransporter();
  if(!transporter) throw new Error('SMTP not configured. Set SMTP_USER and SMTP_PASS in .env');
  const html = renderTemplate(body, lead).replace(/\n/g,'<br>');
  const textSubject = renderTemplate(subject, lead);
  const info=await transporter.sendMail({ from: process.env.SMTP_FROM||process.env.SMTP_USER, to, subject: textSubject, html, text: renderTemplate(body, lead) });
  return info;
}
module.exports={ getTransporter, sendEmail, renderTemplate };
