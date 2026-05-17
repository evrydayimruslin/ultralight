// Shared demo data for the marketplace + public tool + acquisition canvases.
// One source of truth so a tool's name/author/price stays consistent
// across surfaces — the same get_weather you see at #4 in Top 10 is the
// same one whose public page you'd open and the same one in the order book.

const MD_TOOLS = [
  { id:'gw', name:'get_weather',       tagline:'Hyper-local weather, anywhere.',           author:'@kepler',     authorAvatar:'#7c3aed',  category:'weather',     installs: 24803, likes: 2104, callPrice: 0.012, latencyP50: 142, growth7d: 0.18, sparkline: [11,13,16,12,17,21,28] },
  { id:'cc', name:'currency_convert',  tagline:'Live FX with 28 base currencies.',         author:'@anchor',     authorAvatar:'#0891b2',  category:'finance',     installs: 19402, likes: 1820, callPrice: 0.003, latencyP50:  84, growth7d: 0.06, sparkline: [14,15,16,15,17,18,19] },
  { id:'st', name:'stripe.subscribe',  tagline:'Charge & meter from any agent.',           author:'stripe',      authorAvatar:'#635bff',  category:'finance',     installs: 18204, likes: 3041, callPrice: 0.024, latencyP50: 220, growth7d: 0.31, sparkline: [10, 9,12,16,18,22,30] },
  { id:'sl', name:'slack.post',        tagline:'Post to a channel as your bot.',           author:'@hex',        authorAvatar:'#22c55e',  category:'productivity',installs: 16880, likes: 1402, callPrice: 0.001, latencyP50: 110, growth7d:-0.04, sparkline: [22,21,19,20,18,18,19] },
  { id:'pd', name:'pdf.parse',         tagline:'Layout-aware PDF text + tables.',          author:'@vellum',     authorAvatar:'#ea580c',  category:'docs',        installs: 15211, likes:  988, callPrice: 0.018, latencyP50: 480, growth7d: 0.12, sparkline: [12,13,14,15,16,17,19] },
  { id:'gh', name:'github.diff',       tagline:'Branch diff + review comments.',           author:'@octo',       authorAvatar:'#0a0a0a',  category:'developer',   installs: 14093, likes: 2200, callPrice: 0.005, latencyP50: 320, growth7d: 0.09, sparkline: [13,14,14,15,16,16,17] },
  { id:'mp', name:'maps.route',        tagline:'Driving + walking + transit ETAs.',        author:'@cartography',authorAvatar:'#10b981',  category:'maps',        installs: 12705, likes: 1180, callPrice: 0.008, latencyP50: 195, growth7d: 0.21, sparkline: [ 9,10,11,12,13,15,16] },
  { id:'tw', name:'tweet.draft',       tagline:'Voice-matched tweet generation.',          author:'@kepler',     authorAvatar:'#7c3aed',  category:'social',      installs: 11502, likes:  944, callPrice: 0.014, latencyP50: 410, growth7d: 0.42, sparkline: [ 6, 7, 9,11,14,18,22] },
  { id:'sb', name:'supabase.query',    tagline:'Type-safe queries for any project.',       author:'supabase',    authorAvatar:'#3ecf8e',  category:'developer',   installs: 10844, likes: 1620, callPrice: 0.002, latencyP50:  68, growth7d: 0.05, sparkline: [14,14,15,15,15,16,16] },
  { id:'cl', name:'calendar.book',     tagline:'Find slots, send invites, done.',          author:'@hex',        authorAvatar:'#22c55e',  category:'productivity',installs:  9612, likes:  802, callPrice: 0.006, latencyP50: 175, growth7d: 0.14, sparkline: [11,12,12,13,13,14,15] },
];

// Tools with active asks / bids.
const MD_LISTINGS = {
  gw: {
    askLight: 4200,                // owner-posted ask
    bids: [
      { id:'b1', bidder:'@arbiter',   bidderColor:'#ef4444', amount: 3800, placedHr: 2,  message:'Will keep author credit; offering revenue share for 6mo.' },
      { id:'b2', bidder:'@cumulus',   bidderColor:'#f59e0b', amount: 3650, placedHr: 6,  message:'Want to bundle with our travel suite.' },
      { id:'b3', bidder:'@you',       bidderColor:'#0a0a0a', amount: 3500, placedHr: 14, message:'Long-term operator.', isYou: true },
      { id:'b4', bidder:'@nimbus',    bidderColor:'#8b5cf6', amount: 3200, placedHr: 22, message:'Long-term operator.' },
      { id:'b5', bidder:'@stratus',   bidderColor:'#0ea5e9', amount: 2900, placedHr: 31, message:null },
    ],
    revenuePublic: false,
    monthlyRevenue: 297.6,         // ✦/mo
    callsPerWeek: 5800,
    recentAcquisitions: [
      { name:'currency_convert', sold: 12500, daysAgo: 18 },
      { name:'tweet.draft',      sold:  9200, daysAgo: 41 },
      { name:'pdf.parse',        sold: 18400, daysAgo: 73 },
    ],
  },
};

// Public revenue/visibility settings the owner can toggle.
// Used in the bid/ask owner-side artboard.
const MD_VISIBILITY_PRESETS = [
  { id:'public',     label:'Public',                   desc:'Anyone browsing the page can see revenue + call volume.' },
  { id:'bidders',    label:'Verified bidders',         desc:'Visible only after a bidder posts ✦1000+.' },
  { id:'shortlist',  label:'Hand-picked',              desc:'You manually unlock specific bidders.' },
  { id:'private',    label:'Private',                  desc:'No one but you sees the numbers. (Default.)' },
];

const MD_CATEGORIES = [
  { id:'weather',      label:'Weather',     count: 142, color:'#0ea5e9' },
  { id:'finance',      label:'Finance',     count: 318, color:'#10b981' },
  { id:'productivity', label:'Productivity',count: 521, color:'#22c55e' },
  { id:'docs',         label:'Docs',        count: 204, color:'#ea580c' },
  { id:'developer',    label:'Developer',   count: 1042,color:'#0a0a0a' },
  { id:'maps',         label:'Maps',        count:  68, color:'#14b8a6' },
  { id:'social',       label:'Social',      count: 287, color:'#ec4899' },
  { id:'data',         label:'Data',        count: 462, color:'#8b5cf6' },
];

const MD_NEW_THIS_WEEK = [
  { id:'n1', name:'whoop.sync',         author:'@whoop',     callPrice: 0.004, days: 1 },
  { id:'n2', name:'figma.export',       author:'@design',    callPrice: 0.011, days: 2 },
  { id:'n3', name:'arxiv.search',       author:'@research',  callPrice: 0.002, days: 3 },
  { id:'n4', name:'plaid.balance',      author:'plaid',      callPrice: 0.020, days: 4 },
  { id:'n5', name:'notion.write',       author:'@hex',       callPrice: 0.005, days: 5 },
  { id:'n6', name:'spotify.queue',      author:'@kepler',    callPrice: 0.003, days: 6 },
];

// Functions exposed by get_weather (for the public-tool function list).
const MD_FUNCTIONS = [
  { name:'forecast',     args:'{ city, days }',      pricePerCall: 0.012, p50ms: 142, desc:'5-day hyperlocal forecast.' },
  { name:'now',          args:'{ city }',            pricePerCall: 0.004, p50ms:  68, desc:'Current temp + conditions.' },
  { name:'historical',   args:'{ city, date }',      pricePerCall: 0.018, p50ms: 280, desc:'Lookup any past day.' },
  { name:'alerts',       args:'{ city }',            pricePerCall: 0.006, p50ms:  92, desc:'Active severe-weather alerts.' },
  { name:'radar.tile',   args:'{ z, x, y }',         pricePerCall: 0.001, p50ms:  44, desc:'Radar map tile (PNG).' },
];

const MD_CAPABILITIES = [
  { kind:'read',  what:'public weather data (NOAA, OpenWeather)' },
  { kind:'read',  what:'user-supplied city / coordinates' },
  { kind:'write', what:'no writes — read-only tool' },
  { kind:'net',   what:'outbound HTTPS to api.openweather.com' },
];

// Format helpers.
function fmtN(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
}
function fmtSpark(arr, w = 56, h = 16) {
  const max = Math.max(...arr), min = Math.min(...arr);
  const range = max - min || 1;
  const dx = w / (arr.length - 1);
  const pts = arr.map((v, i) => `${(i*dx).toFixed(1)},${(h - ((v-min)/range)*h).toFixed(1)}`).join(' ');
  return pts;
}

window.PUI_MarketData = {
  MD_TOOLS, MD_LISTINGS, MD_VISIBILITY_PRESETS, MD_CATEGORIES,
  MD_NEW_THIS_WEEK, MD_FUNCTIONS, MD_CAPABILITIES,
  fmtN, fmtSpark,
};
