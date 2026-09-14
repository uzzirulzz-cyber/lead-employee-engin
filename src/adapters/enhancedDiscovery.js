
// Solid multi-source discovery orchestrator - FREE sources only
const OverpassAdapter = require('./overpassAdapter');
const axios = require('axios');

// Expanded industry mapping for solid lead generation
const INDUSTRY_TAGS = {
  'real estate': ['shop=estate_agent', 'office=estate_agent', 'office=property_management'],
  'restaurant': ['amenity=restaurant', 'amenity=fast_food', 'amenity=food_court'],
  'hotel': ['tourism=hotel', 'tourism=guest_house', 'tourism=hostel', 'tourism=motel'],
  'gym': ['leisure=fitness_centre', 'leisure=sports_centre', 'shop=sports'],
  'hospital': ['amenity=hospital', 'amenity=clinic', 'amenity=doctors'],
  'school': ['amenity=school', 'amenity=college', 'amenity=university'],
  'cafe': ['amenity=cafe', 'amenity=bar', 'amenity=pub'],
  'salon': ['shop=beauty', 'shop=hairdresser', 'shop=cosmetics'],
  'automotive': ['shop=car', 'shop=car_repair', 'amenity=fuel'],
  'construction': ['shop=doityourself', 'shop=hardware', 'craft=carpenter'],
  'default': ['shop', 'office', 'amenity', 'craft']
};

class EnhancedDiscovery {
  constructor(){ this.name='enhanced_orchestrator'; }

  async discover({ industry, country, city, keywords, campaignId }){
    const all = [];
    const overpass = new OverpassAdapter();
    
    // 1. Primary OSM discovery with expanded tags
    const tags = INDUSTRY_TAGS[(industry||'').toLowerCase()] || INDUSTRY_TAGS.default;
    for(const tag of tags.slice(0,4)){ // up to 4 tag variants for solid coverage
      const res = await overpass.discoverWithTag({ industry, country, city, keywords, campaignId, tag });
      all.push(...res);
      if(all.length >= 1500) break; // enough for 1000 valid after dedup
    }

    // 2. Keyword expansion discovery
    for(const kw of (keywords||[]).slice(0,3)){
      const res = await overpass.discoverWithTag({ industry: kw, country, city, keywords: [], campaignId, tag: 'shop' });
      all.push(...res);
    }

    // 3. City centroid + radius search via Nominatim (FREE) for broader coverage
    if(city && country){
      try{
        const nom = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city+','+country)}&format=json&limit=1`, { headers:{'User-Agent':'LeadForge/2.0'}, timeout:10000 });
        if(nom.data[0]){
          const { lat, lon } = nom.data[0];
          // Search around city center using overpass around query
          const aroundResults = await overpass.discoverAround({ lat, lon, radius: 10000, industry, campaignId });
          all.push(...aroundResults);
        }
      }catch(e){ console.log('Nominatim failed', e.message); }
    }

    // Deduplicate URLs
    const seen = new Set();
    const deduped = [];
    for(const item of all){
      if(!seen.has(item.url)){
        seen.add(item.url);
        deduped.push(item);
      }
    }
    console.log(`[enhanced] discovered ${deduped.length} unique sources`);
    return deduped.slice(0, 2000); // cap for performance but enough for 1000 valid
  }
}

module.exports = EnhancedDiscovery;
