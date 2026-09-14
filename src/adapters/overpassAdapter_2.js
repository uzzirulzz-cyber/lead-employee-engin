
const BaseAdapter=require('./base');
const axios=require('axios');
class OverpassAdapter extends BaseAdapter {
  constructor(){ super(); this.name='osm_overpass'; }
  async discoverWithTag({ industry, country, city, keywords, campaignId, tag }){
    const overpassUrl=process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter';
    const area = city || country || 'Pakistan';
    const safeTag = tag.includes('=') ? tag : `${tag}`;
    const q=`[out:json][timeout:60]; area["name"="${area}"]->.a; (nwr[${safeTag}](area.a);); out 500;`;
    try{
      const res=await axios.post(overpassUrl, q, { headers:{'Content-Type':'text/plain'}, timeout:25000 });
      const elements=res.data.elements||[];
      return elements.map(el=>{
        const website=el.tags?.website || el.tags?.['contact:website'] || null;
        const url=website || (el.tags?.name ? null : `https://www.openstreetmap.org/${el.type}/${el.id}`);
        if(!url) return null;
        return { url, source:this.name, query:`${industry||tag} in ${area}`, campaignId, meta:{ name: el.tags?.name, website, tags: el.tags } };
      }).filter(Boolean);
    }catch(e){ return []; }
  }
  async discoverAround({ lat, lon, radius, industry, campaignId }){
    const overpassUrl=process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter';
    const tagMap={ 'real estate':'shop=estate_agent', 'restaurant':'amenity=restaurant', 'default':'shop' };
    const tag=tagMap[(industry||'').toLowerCase()]||tagMap.default;
    const q=`[out:json][timeout:40]; (nwr[${tag}](around:${radius},${lat},${lon});); out 500;`;
    try{
      const res=await axios.post(overpassUrl, q, { headers:{'Content-Type':'text/plain'}, timeout:20000 });
      const elements=res.data.elements||[];
      return elements.map(el=>{
        const website=el.tags?.website || el.tags?.['contact:website'];
        if(!website) return null;
        return { url: website, source: this.name+'_around', query: `${industry} around ${lat},${lon}`, campaignId, meta:{ name: el.tags?.name } };
      }).filter(Boolean);
    }catch(e){ return []; }
  }
  async discover(query){ return this.discoverWithTag({ ...query, tag: 'shop' }); }
}
module.exports=OverpassAdapter;
