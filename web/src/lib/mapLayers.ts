import L from "leaflet";

// Fonds de carte partagés par toutes les cartes de l'app. Tous utilisables SANS clé
// d'API (rien à protéger côté client) : tile.openstreetmap.org bloquait nos requêtes
// et CARTO exige désormais une clé sur ses fonds gratuits.
// - IGN (Géoplateforme, data.geopf.fr) : service public, sans clé depuis 2024 —
//   le plus lisible en France (routes secondaires, lieux-dits), et l'orthophoto IGN
//   est plus nette que l'imagerie Esri sur le territoire.
// - OpenTopoMap : courbes de niveau, pour repérer le relief.
export function createBaseLayers(): Record<string, L.TileLayer> {
  const ign = (layer: string, format: "image/png" | "image/jpeg", style = "normal") =>
    `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${style}&TILEMATRIXSET=PM&FORMAT=${format}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
  const ignAttribution = '© <a href="https://www.ign.fr/">IGN</a> — Géoplateforme';

  return {
    "Vélo": L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
      maxZoom: 19,
      subdomains: "abc",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | © <a href="https://www.cyclosm.org">CyclOSM</a>',
    }),
    "Plan IGN": L.tileLayer(ign("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png"), { maxZoom: 19, attribution: ignAttribution }),
    "Photo IGN": L.tileLayer(ign("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg"), { maxZoom: 19, attribution: ignAttribution }),
    "Satellite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "© Esri — World Imagery",
    }),
    "Relief": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      subdomains: "abc",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }),
  };
}

const BASE_LAYER_KEY = "pbp.map.baseLayer";

// Le fond choisi est mémorisé (par navigateur) : quelqu'un qui préfère le Plan IGN
// ne veut pas le re-sélectionner à chaque carte ouverte.
export function addBaseLayers(map: L.Map, defaultName = "Vélo", overlays?: Record<string, L.Layer>): void {
  const layers = createBaseLayers();
  let initial = defaultName;
  try {
    const saved = localStorage.getItem(BASE_LAYER_KEY);
    if (saved && layers[saved]) initial = saved;
  } catch {
    // stockage indisponible (navigation privée...) : fond par défaut
  }
  layers[initial].addTo(map);
  L.control.layers(layers, overlays).addTo(map);
  map.on("baselayerchange", (e: L.LayersControlEvent) => {
    try {
      localStorage.setItem(BASE_LAYER_KEY, e.name);
    } catch {
      // idem
    }
  });
}
