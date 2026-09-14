
const crypto=require('crypto');
function canonicalDomain(url){
 if(!url) return '';
 try{
  const u = url.startsWith('http')? new URL(url): new URL('https://'+url);
  return u.hostname.replace(/^www\./,'').toLowerCase();
 }catch{ return url.toLowerCase().replace(/^www\./,'').trim(); }
}
function fingerprint({email, phone, domain, company}){
 const parts=[(email||'').toLowerCase().trim(), (phone||'').replace(/\D/g,''), canonicalDomain(domain||''), (company||'').toLowerCase().trim()].join('|');
 return crypto.createHash('sha256').update(parts).digest('hex');
}
module.exports={ canonicalDomain, fingerprint };
