
const cheerio=require('cheerio');
const { extractEmails, extractPhones, extractWhatsApp, extractSocial, extractCompanyName } = require('../lib/extractors');
class WebsiteCrawlAdapter{
  async enrich(html, url, campaign){
    const $=cheerio.load(html);
    const companyName=extractCompanyName($);
    const emails=extractEmails(html);
    const phones=extractPhones(html);
    const wa=extractWhatsApp(html);
    const social=extractSocial(html);
    return emails.length>0 ? emails.map(email=>({
      companyName, industry: campaign.industry, website:url, domain:new URL(url).hostname, email, phoneRaw:phones[0], whatsappDetected: wa.links.length>0||wa.numbers.length>0, whatsappUrl: wa.links[0], whatsappNormalized: wa.numbers[0], social
    })) : [{ companyName, industry: campaign.industry, website:url, domain:new URL(url).hostname, email:null, phoneRaw:phones[0], whatsappDetected: wa.links.length>0, whatsappUrl: wa.links[0], social }];
  }
}
module.exports=WebsiteCrawlAdapter;
