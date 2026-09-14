
const EMAIL_RE=/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE=/(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,9}/g;
const WA_LINK_RE=/(https?:\/\/)?(wa\.me|api\.whatsapp\.com\/send)\/[^\s"'<]+/gi;
function extractEmails(html){
  const text=html.replace(/<[^>]+>/g,' ');
  const mails=[...text.matchAll(EMAIL_RE)].map(m=>m[0].toLowerCase());
  return [...new Set(mails)].filter(e=>!e.endsWith('.png')&&!e.includes('example.com')).slice(0,10);
}
function extractPhones(html){ return [...new Set([...html.matchAll(PHONE_RE)].map(m=>m[0]))].slice(0,10); }
function extractWhatsApp(html){
  const links=[...html.matchAll(WA_LINK_RE)].map(m=>m[0]);
  const nums=[...html.matchAll(/wa\.me\/([\d+]+)/gi)].map(m=>m[1]);
  return { links:[...new Set(links)], numbers:[...new Set(nums)] };
}
function extractSocial(html){
  const li=(html.match(/https?:\/\/(www\.)?linkedin\.com\/[^\s"'<]+/gi)||[])[0];
  const fb=(html.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"'<]+/gi)||[])[0];
  const ig=(html.match(/https?:\/\/(www\.)?instagram\.com\/[^\s"'<]+/gi)||[])[0];
  return { linkedin:li, facebook:fb, instagram:ig };
}
function extractCompanyName($){ return $('meta[property="og:site_name"]').attr('content') || $('title').text().split('|')[0].trim().slice(0,120) || null; }
function scoreLead(l){ let s=0; if(l.email) s+=25; if(l.emailStatus==='VALID') s+=20; if(l.website) s+=10; if(l.phoneRaw) s+=10; if(l.whatsappDetected) s+=15; if(l.companyName) s+=5; if(l.city) s+=5; if(l.industry) s+=5; return Math.min(100,s); }
module.exports={ extractEmails, extractPhones, extractWhatsApp, extractSocial, extractCompanyName, scoreLead };
