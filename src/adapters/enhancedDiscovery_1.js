
const OverpassAdapter = require('./overpassAdapter');
const axios = require('axios');
const INDUSTRY_TAGS = {
  'real estate': ['shop=estate_agent', 'office=estate_agent', 'office=property_management'],
  'restaurant': ['amenity=restaurant', 'amenity=fast_food', 'amenity=food_court'],
  'hotel': ['tourism=hotel', 'tourism=guest_house', 'tourism=hostel'],
  'gym': ['leisure=fitness_centre', 'leisure=sports_centre'],
  'hospital': ['amenity=hospital', 'amenity=clinic'],
  'default': ['shop', 'office', 'amenity']
};
class EnhancedDiscovery {
  constructor(){ this.name='enhanced_orchestrator'; }
  async discover({ industry, country, city, keywords, campaignId }){
    const all = [];
    const overpass = new OverpassAdapter();
    const tags = INDUSTRY_TAGS[(industry||'').toLowerCase()] || INDUSTRY_TAGS.default;
    for(const tag of tags.slice(0,4)){
      const res = await overpass.discoverWithTag({ industry, country, city, keywords, campaignId, tag });
      all.push(...res);
      if(all.length >= 1500) break;
    }
    for(const kw of (keywords||[]).slice(0,3)){
      const res = await overpass.discoverWithTag({ industry: kw, country, city, keywords: [], campaignId, tag: 'shop' });
      all.push(...res);
    }
    if(city && country){
      try{
        const nom = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city+','+country)}&format=json&limit=1`, { headers:{'User-Agent':'LeadForge/2.0'}, timeout:10000 });
        if(nom.data[0]){
          const { lat, lon } = nom.data[0];
          const aroundResults = await overpass.discoverAround({ lat, lon, radius: 10000, industry, campaignId });
          all.push(...aroundResults);
        }
      }catch(e){}
    }
    const seen = new Set();
    const deduped = [];
    for(const item of all){ if(!seen.has(item.url)){ seen.add(item.url); deduped.push(item); } }
    return deduped.slice(0, 2000);
  }
}
module.exports = EnhancedDiscovery;
