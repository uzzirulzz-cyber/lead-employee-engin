
const axios=require('axios');
const cheerio=require('cheerio');
const { extractEmails, extractPhones, extractWhatsApp, extractSocial, extractCompanyName } = require('../lib/extractors');
class Enricher {
  async findContactPages(baseUrl, html){
    const $=cheerio.load(html);
    const links=[];
    $('a').each((_,a)=>{
      const href=$(a).attr('href')||'';
      const text=$(a).text().toLowerCase();
      if(href.includes('contact') || text.includes('contact') || text.includes('get in touch') || href.includes('about')){
        try{ const full=new URL(href, baseUrl).toString(); if(full.includes(new URL(baseUrl).hostname)) links.push(full); }catch{}
      }
    });
    return [...new Set(links)].slice(0,3);
  }
  async enrichFromContactPages(baseUrl, baseHtml, campaign){
    let allEmails=[], allPhones=[], allWaLinks=[], allWaNums=[], social={}, company=null;
    try{
      const $=cheerio.load(baseHtml);
      company=extractCompanyName($);
      allEmails.push(...extractEmails(baseHtml));
      allPhones.push(...extractPhones(baseHtml));
      const wa=extractWhatsApp(baseHtml);
      allWaLinks.push(...wa.links); allWaNums.push(...wa.numbers);
      social={...extractSocial(baseHtml)};
      const contactPages=await this.findContactPages(baseUrl, baseHtml);
      for(const cp of contactPages){
        try{
          const res=await axios.get(cp, { headers:{'User-Agent':'LeadForgeBot/2.0'}, timeout:8000 });
          allEmails.push(...extractEmails(res.data));
          allPhones.push(...extractPhones(res.data));
          const wa2=extractWhatsApp(res.data);
          allWaLinks.push(...wa2.links); allWaNums.push(...wa2.numbers);
          const s=extractSocial(res.data); social={...social, ...s};
        }catch{}
      }
    }catch(e){}
    return { companyName: company, emails: [...new Set(allEmails)].slice(0,10), phones: [...new Set(allPhones)].slice(0,5), whatsapp: { links:[...new Set(allWaLinks)], numbers:[...new Set(allWaNums)] }, social };
  }
}
module.exports=Enricher;
