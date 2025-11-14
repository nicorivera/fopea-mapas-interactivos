//  Configuración de colores/tamaños
const COLOR_YPF = "#0178D6";
const COLOR_ARG = "#9BBCDC";
const COLOR_EXT = "#F4785E";
const COLOR_UNKNOWN = "#CCCCCC";
const crono = document.getElementById('crono');
const cadena = document.getElementById('cadena');
const pozo = document.getElementById('pozoProf');
let isMob = window.innerWidth;

// Cambiar imagen para el elemento "graficos" según ancho de pantalla
  const cronoMob = 'cronoMob.svg';    // <- imagen Cronologia mobile
  const cronoDesk = 'crono.svg';  // <- imagen Cronologia desktop
  const cadenaMob = 'cadenavalorMob.svg';    // <- imagen Cadena mobile
  const cadenaDesk = 'cadenavalor.svg';  // <- imagen Cadena desktop
  const pozoMob = 'pozoMob.svg';    // <- imagen Pozo mobile
  const pozoDesk = 'pozo.svg';  // <- imagen Pozo desktop

  crono.src = isMob < 800 ? cronoMob : cronoDesk;
  cadena.src = isMob < 800 ? cadenaMob : cadenaDesk;
  pozo.src = isMob < 800 ? pozoMob : pozoDesk;

  // actualizar al redimensionar (debounce)
  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
  });

function colorFromType(tipo) {
  if (!tipo) return COLOR_UNKNOWN;
  tipo = tipo.toUpperCase();
  
  if (tipo.includes("YPF")) return COLOR_YPF;
  if (["TOTAL", "CHEVRON", "FLXS", "SHELL", "KILWER"].some(x => tipo.includes(x))) return COLOR_EXT;
  return COLOR_ARG;
}

// escala de radio para yacimientos (ya calculada en 'radio' por el python)
// para clusters, usaremos reglas del usuario:
function clusterSize(count) {
  if (count < 30) return 300;
  if (count < 500) return 500;
  if (count < 1300) return 700;
  if (count < 2300) return 950;
  return 1200;
}

L.TileLayer.Grayscale = L.TileLayer.extend({
	options: {
		quotaRed: 21,
		quotaGreen: 71,
		quotaBlue: 8,
		quotaDividerTune: 0,
		quotaDivider: function() {
			return this.quotaRed + this.quotaGreen + this.quotaBlue + this.quotaDividerTune;
		}
	},

	initialize: function (url, options) {
		options = options || {}
		options.crossOrigin = true;
		L.TileLayer.prototype.initialize.call(this, url, options);

		this.on('tileload', function(e) {
			this._makeGrayscale(e.tile);
		});
	},

	_createTile: function () {
		var tile = L.TileLayer.prototype._createTile.call(this);
		tile.crossOrigin = "Anonymous";
		return tile;
	},

	_makeGrayscale: function (img) {
		if (img.getAttribute('data-grayscaled'))
			return;

      img.crossOrigin = '';
		var canvas = document.createElement("canvas");
		canvas.width = img.width;
		canvas.height = img.height;
		var ctx = canvas.getContext("2d");
		ctx.drawImage(img, 0, 0);

		var imgd = ctx.getImageData(0, 0, canvas.width, canvas.height);
		var pix = imgd.data;
		for (var i = 0, n = pix.length; i < n; i += 4) {
      pix[i] = pix[i + 1] = pix[i + 2] = (this.options.quotaRed * pix[i] + this.options.quotaGreen * pix[i + 1] + this.options.quotaBlue * pix[i + 2]) / this.options.quotaDivider();
		}
		ctx.putImageData(imgd, 0, 0);
		img.setAttribute('data-grayscaled', true);
		img.src = canvas.toDataURL();
	}
});

L.tileLayer.grayscale = function (url, options) {
	return new L.TileLayer.Grayscale(url, options);
};

// Mapa base de INTITUTO GEOGRÁFICO NACIONAL
const map = L.map("map").setView([-38, -68.5], 8);
  L.tileLayer('https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/mapabase_gris@EPSG%3A3857@png/{z}/{x}/{-y}.png', {
    attribution: '<a href="http://leafletjs.com" title="A JS library for interactive maps">Leaflet</a> | <a href="http://www.ign.gob.ar/AreaServicios/Argenmap/IntroduccionV2" target="_blank">Instituto Geográfico Nacional</a> + <a href="http://www.osm.org/copyright" target="_blank">OpenStreetMap</a>',
    doubleClickZoom: false,
    minZoom: 6,
    maxZoom: 13,
    opacity: 0.5,
  }).addTo(map);
  // L.tileLayer.grayscale('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  //   attribution: 'Map data &copy; <a href="https://openstreetmap.org/">OpenStreetMap</a> contributors',
  //   maxZoom: 18, minZoom: 3
  // }).addTo(map);

// Capa area Vaca Muerta
fetch("cuenca_neuquina_area_from_zip.geojson")
  .then(r => r.json())
  .then(data => {
    const contornoLayer = L.geoJSON(data, {
      style: { weight:1, fillColor:"#B9A78A", color:"rgba(0,0,0,0.3)", fillOpacity:0.3 },
      interactive: false
    }).bindPopup("<b>Área hidrocarburífera<br>Vaca Muerta</b>");
    contornoLayer.addTo(map);
  });
// Previene el zoom inicial en el mapa al scrollear
map.scrollWheelZoom.disable();
window.activeShape = null;
window.activePozosLayers = [];
window.currentShownYacimiento = null;

// Capas y estructuras
// Vamos a crear tres MarkerClusterGroups (uno por tipo de empresa) para los pozos,
// y tres LayerGroups simples para los yacimientos.
const clusterYPF = L.markerClusterGroup({
  iconCreateFunction: clusterIconCreate,
  disableClusteringAtZoom: 5
});
const clusterARG = L.markerClusterGroup({
  iconCreateFunction: clusterIconCreate,
  disableClusteringAtZoom: 5
});
const clusterEXT = L.markerClusterGroup({
  iconCreateFunction: clusterIconCreate,
  disableClusteringAtZoom: 5
});

const yacYPF = L.layerGroup();
const yacARG = L.layerGroup();
const yacEXT = L.layerGroup();

// Grupos visibles por defecto
let showYPF = true, showARG = true, showEXT = true;

// Guardar GeoJSON completos en memoria
let allYacimientos = null;
let allPozos = null;

//  Función cluster iconCreate (color según mayoría en el cluster)
function clusterIconCreate(cluster) {
  const children = cluster.getAllChildMarkers();
  const count = cluster.getChildCount();
  
  let ypf = 0, arg = 0, ext = 0;
  children.forEach(m => {
    const tipo = (m.options.tipo_empresa || (m.feature && m.feature.properties.tipo_empresa) || "").toString().toUpperCase();
    if (tipo.includes("YPF")) ypf++;
    else if (["TOTAL", "CHEVRON", "FLXS", "SHELL", "KILWER"].some(x => t.includes(x))) ext++;
    else if (["VISTA","CAPEX","PLUSPETROL","PETROLERA","PAMPA","PETROARGENTINA","PETROQUIMICA","PATAGONIA","TECPETROL","OILSTONE ENERGIA"].some(x => t.includes(x))) arg++;
  });
  let color = COLOR_EXT;
  if (ypf >= arg && ypf >= ext) color = COLOR_YPF;
  else if (arg >= ypf && arg >= ext) color = COLOR_ARG;  
  
  const size = clusterSize(count);
  const html = `<div style="
      background:${color};
      opacity:0.95;
      color:white;
      border-radius:50%;
      width:${size}px;
      height:${size}px;
      display:flex;
      align-items:center;
      justify-content:center;
      font-weight:bold;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
    ">${count}</div>`;
  return L.divIcon({ html: html, className: 'cluster-icon', iconSize: [size, size]});
}

//  Cargar GeoJSONs
Promise.all([
  fetch('yacimientos_vm_EXTARGYPF.geojson').then(r => r.json()),
  fetch('pozos_vm_EXTARGYPF.geojson').then(r => r.json()),
  fetch('yacimientos_vm_shapes.geojson').then(r => r.json()),
]).then(([yacJson, pozJson, shapesJson]) => {
  allYacimientos = yacJson;
  allPozos = pozJson;
  allShapes = shapesJson;

  // Contadores de yacimientos por tipo 
  let countYPF = 0, countARG = 0, countEXT = 0;
  yacJson.features.forEach(f => {
    const tipo = (f.properties?.tipo_dominante || "").toUpperCase();
    if (tipo.includes("YPF")) countYPF++;
    else if (tipo.includes("ARG")) countARG++;
    else countEXT++;
  });

  //  Mostrar los conteos en los labels
  const chkYPF = document.getElementById('chkYPF');
  const chkARG = document.getElementById('chkARG');
  const chkEXT = document.getElementById('chkEXT');
  chkYPF.innerHTML= `YPF (${countYPF})`;
  chkARG.innerHTML= `OTRAS ARGENTINAS (${countARG})`;
  chkEXT.innerHTML= `EXTRANJERAS (${countEXT})`;

  /* === LÓGICA DE FILTROS EXCLUSIVOS === */
  function activarFiltro(tipo) {
    // quitar pozos visibles
    if (activePozosLayers.length > 0) {
      activePozosLayers.forEach(c => map.removeLayer(c));
      activePozosLayers = [];
    }
    // Eliminar el shape anterior si existe
    map.setView([-38, -68.5], 8);
    // reset botones
    document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('no'));

    // activar botón clickeado
    const btn = document.querySelector(`[data-tipo="${tipo}"]`);
    const btns = document.querySelectorAll('.btn.filtro-btn');
    if (btn) {btn.classList.add('active'); btn.style.backgroundColor = tipo === 'YPF' ? COLOR_YPF : tipo === 'ARG' ? COLOR_ARG : COLOR_EXT;}
    btns.forEach(b => {
      if (!b.classList.contains('active')) {b.style.backgroundColor = '#fff';}
    });

    // actualizar visibilidad de yacimientos según tipo elegido
    showYPF = (tipo === 'YPF');
    showARG = (tipo === 'ARG');
    showEXT = (tipo === 'EXT');
    updateYacimientosVisibility();

    // si hay un yacimiento abierto, actualizar sus pozos
    // if (currentShownYacimiento) showPozosForYacimiento(currentShownYacimiento, allPozos, allShapes);
    if (window.activeShape) {
      try { map.removeLayer(window.activeShape);} catch (e) {}
      window.activeShape = null;
    }
  }

  // manejar clicks en botones
  document.getElementById('chkYPF').addEventListener('click', () => activarFiltro('YPF'));
  document.getElementById('chkARG').addEventListener('click', () => activarFiltro('ARG'));
  document.getElementById('chkEXT').addEventListener('click', () => activarFiltro('EXT'));

  // botón de reset Ver todos los yacimientos
  document.getElementById('btnReset').addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.btn.filtro-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.btn.filtro-btn').forEach(b => b.classList.add('no'));
    let activePozos = document.querySelectorAll('.leaflet-interactive');
    activePozos.forEach(p => { 
      if (p.classList.contains('no')) {p.classList.remove('no');}
    });
    map.setView([-38, -68.5], 7);
    // Eliminar el shape anterior si existe
    if (window.activeShape) {
      try { map.removeLayer(window.activeShape);} catch (e) {}
      window.activeShape = null;
    }
    
    showYPF = true; showARG = true; showEXT = true;
    updateYacimientosVisibility();
    showAllYacimientos();
  });

  createYacimientosLayer(yacJson, allPozos, allShapes);
  preparePozosClusters(allPozos);
  updateYacimientosVisibility();
}).catch(err => {
  console.error("Error cargando GeoJSONs:", err);
});

// Saca la tapa del mapa para que se pueda hacer zoom
// const tapa = document.getElementById('tapa');
// function hideTapa(cli){
//   if(cli){
//     map.scrollWheelZoom.enable();
//   }
//   tapa.addEventListener('click', (e) =>{
//     map.scrollWheelZoom.enable();
//   })
// }

//  Crear yacimientos (vista inicial)
function createYacimientosLayer(yacJson, allPozos, allShapes) {
  // evitar duplicados por nombre
  const seen = new Set();
  
  yacJson.features.forEach(f => {
    const props = f.properties || {};
    const yacName = (props.yacimiento || props.yac || "").toString();
    if (!yacName) return;
    if (seen.has(yacName)) return;
    seen.add(yacName);

    const coords = f.geometry && f.geometry.coordinates;
    if (!coords) return;
    const lng = coords[0], lat = coords[1];
    const tipo = (props.tipo_dominante || "").toString();
    const color = props.color || colorFromType(tipo);
    const radio = props.radio ? Number(props.radio) : 40;
    // const radio = f.properties.num_pozos < 30 ? 10 :
    //               f.properties.num_pozos < 500 ? 20 :
    //               f.properties.num_pozos < 1300 ? 30 :
    //               f.properties.num_pozos < 2300 ? 40 : 50;
    
    // marker del yacimiento
    const circle = L.circleMarker([lat, lng], {
      radius: Math.max(2, radio/2), // ajustamos visualmente: radio en el geojson es grande
      fillColor: color,
      color: "#e5e5e5",
      strokeWidth: 0.2,
      weight: 0.8,
      fillOpacity: 0.7,
    });

    // popup con info resumen
    const popupHtml = `
      Yacimiento: <b>${yacName}</b><br>
      Empresa dominante: <b>${props.tipo_dominante || "N/D"}</b><br>
      <b>${props.num_pozos || "N/D"} pozos</b>
    `;
    circle.bindTooltip(`<b>Yacimiento ${yacName}</b><br><b style="color:${color}">${props.tipo_dominante || "N/D"}</b><br>${props.num_pozos} pozos`);
    
    circle.bindPopup(popupHtml);
    
    // Al click mostrar pozos y hacer zoom
    circle.on('click', (e) => {
      // Zoom hacia el punto (o hacia un pequeño bbox)
      // hideTapa('cli');
      map.setView([lat, lng], 11);      
      showPozosForYacimiento(yacName, allPozos, allShapes, circle);
    });
    
    // Agregar al grupo correspondiente según tipo dominante
    const tipo_up = (props.tipo_dominante || "").toString().toUpperCase();
    if (tipo_up.includes("YPF")) yacYPF.addLayer(circle);
    else if (tipo_up.includes("ARG")) yacARG.addLayer(circle);
    else yacEXT.addLayer(circle);
  });

  // Agregar todos los grupos al mapa (visibilidad controlada por filtros)
  yacEXT.addTo(map);
  yacARG.addTo(map);
  yacYPF.addTo(map);
}

//  Preparar pozos en clusters (en memoria)
function preparePozosClusters(pozJson) {
  // iterar features y crear markers dentro del cluster correspondiente
  pozJson.features.forEach(f => {
    const p = f.properties || {};    
    const coords = f.geometry && f.geometry.coordinates;
    if (!coords) return;
    const lng = coords[0], lat = coords[1];
    const tipo_empresa = (p.tipo_empresa || p.empresa || "").toString();
    const color = p.color || colorFromType(tipo_empresa);
    const pet = Number(p.prod_pet || 0);
    const gas = Number(p.prod_gas || 0);
    const totalProd = pet + gas;

    // Tamaño de pozo individual según producción (ajustar si se desea)
    const radius = Math.max(3, Math.log1p(totalProd) * 0.3);

    const marker = L.circleMarker([lat, lng], {
      radius: radius,
      fillColor: color,
      weight: 0.5,
      fillOpacity: 0.9,
      stroke: "#e5e5e5",
      strokeWidth: 0.2,
      tipo_empresa: tipo_empresa  // mantenerlo en options para clusterIconCreate
    });

    // Agregar feature para conteo en clusters
    marker.feature = f;
    marker.options.tipo_empresa = tipo_empresa;

    // Popup con detalle
    const pozoId = p.pozo || p.idpozo || "Sin ID";
    const pozoSigla = p.sigla || p.idpozo || "Sin ID";
    const popup = `
      <b>Pozo:</b> ${pozoSigla}<br>
      <b>Yacimiento:</b> ${p.areayacimiento || "N/D"}<br>
      <b>Empresa:</b> ${p.empresa || p.empresa_operadora || "N/D"}<br>
      <hr>
      <b>Producción 2025:</b><br>
      <b>Petróleo:</b> ${pet.toLocaleString()} m³<br>
      <b>Gas:</b> ${gas.toLocaleString()} m³
    `;
    marker.bindPopup(popup);

    // Elegir cluster según tipo
    const t = tipo_empresa.toUpperCase();    
    if (t.includes("YPF")) clusterYPF.addLayer(marker);
    else if (["TOTAL", "CHEVRON", "FLXS", "SHELL", "KILWER"].some(x => t.includes(x))) clusterEXT.addLayer(marker);
    else clusterARG.addLayer(marker);
  });
}

function showPozosForYacimiento(yacName, pozos, shapes, circulo) {
  let currentYac=null;

  // Quitar clase 'no' de todos los paths activos (circulos de yacimientos)
  let activePozos = document.querySelectorAll('.leaflet-interactive');
  activePozos.forEach(p => { 
    if (p.classList.contains('no')) {p.classList.remove('no');}
  });
  // Agregar clase 'no' al círculo del yacimiento seleccionado
  circulo?circulo._path.classList.add('no'):null;
  // Si ya hay pozos mostrados, removerlos del mapa antes de cargar nuevos
  if (activePozosLayers.length > 0) {
    activePozosLayers.forEach(c => {
      try { map.removeLayer(c); } catch (e) {}
    });
    activePozosLayers = [];
  }
  currentShownYacimiento = yacName;
  
  // Vaciar clusters actuales del mapa
  if (map.hasLayer(clusterEXT)) map.removeLayer(clusterEXT);
  if (map.hasLayer(clusterARG)) map.removeLayer(clusterARG);
  if (map.hasLayer(clusterYPF)) map.removeLayer(clusterYPF);

  // Crear clusters nuevos filtrando pozos por yacimiento
  const features = pozos.features.filter(f => {
    const p = f.properties || {};    
    return (p.areayacimiento || "").toString().toUpperCase() === yacName.toUpperCase();
  });  

  // Si no hay features, mostrar aviso y salir
  if (features.length === 0) {
    alert("No se encontraron pozos para ese yacimiento en los datos.");
    return;
  }

  // Crear clusters temporales vacíos
  const tmpEXT = L.markerClusterGroup({ iconCreateFunction: clusterIconCreate, disableClusteringAtZoom: 5 });
  const tmpARG = L.markerClusterGroup({ iconCreateFunction: clusterIconCreate, disableClusteringAtZoom: 5 });
  const tmpYPF = L.markerClusterGroup({ iconCreateFunction: clusterIconCreate, disableClusteringAtZoom: 5 });

  // Llenarlos con markers filtrados (miramos tipo_empresa)
  features.forEach(f => {   
    const p = f.properties || {};
    const coords = f.geometry && f.geometry.coordinates;
    if (!coords) return;
    const lng = coords[0], lat = coords[1];
    const tipo_empresa = (p.tipo_empresa || p.empresa || "").toString().toUpperCase();
    const color = p.color || colorFromType(tipo_empresa);
    const pet = Number(p.prod_pet || 0), gas = Number(p.prod_gas || 0);
    const radius = Math.max(3, Math.log1p(pet + gas) * 0.9);
    const pozoSigla = p.sigla || p.idpozo || "Sin ID";
    
    if(window.activeShape){ try{ map.removeLayer(window.activeShape);}catch(e){} window.activeShape=null; }

    // Marcador de pozo
    const marker = L.circleMarker([lat, lng], {
      radius: radius,
      fillColor: color,
      color: "#222",
      weight: 0.5,
      fillOpacity: 0.9,
      tipo_empresa: tipo_empresa
    });
    marker.feature = f;    

    // Popup con detalle
    const popup = `
      <b>Pozo:</b> ${pozoSigla}<br>
      <b>Yacimiento:</b> ${p.areayacimiento || "N/D"}<br>
      <b>Empresa:</b> ${p.empresa || p.empresa_operadora || "N/D"}<br>
      <hr>
      <b>Producción 2025:</b><br>
      <b>Petróleo:</b> ${pet.toLocaleString()} m³<br>
      <b>Gas:</b> ${gas.toLocaleString()} m³
    `;
    marker.bindPopup(popup);

    if (tipo_empresa.includes("YPF")) tmpYPF.addLayer(marker);
    else if (["TOTAL", "CHEVRON", "FLXS", "SHELL", "KILWER"].some(x => tipo_empresa.includes(x))) tmpEXT.addLayer(marker);
    else tmpARG.addLayer(marker);

    // Dibujar el shape del yacimiento seleccionado
    currentYac = p.areayacimiento || "";
    const sh = shapes.features.find(s => (s.properties.areayacimiento && s.properties.areayacimiento.toString()) == currentShownYacimiento);
    currentShownYacimiento = p.areayacimiento || "";

    if (sh) {
      window.activeShape = L.geoJSON(sh, { style: { color: color, weight: 1.5, dashArray: "3,3", fillOpacity: 0.3 }});
      window.activeShape.addTo(map);
      try { map.fitBounds(window.activeShape.getBounds().pad(0.12)); } catch (e) {}
    }
  });

  // Añadir clusters al mapa según filtros activos
  if (showEXT) { tmpEXT.addTo(map); activePozosLayers.push(tmpEXT); }
  if (showARG) { tmpARG.addTo(map); activePozosLayers.push(tmpARG); }
  if (showYPF) { tmpYPF.addTo(map); activePozosLayers.push(tmpYPF); }

  // ajustar vista al bounds de los markers si existen
  const groupAll = L.featureGroup();
  features.forEach(f => {
    const coords = f.geometry && f.geometry.coordinates;
    if (coords) groupAll.addLayer(L.marker([coords[1], coords[0]]));
  });
  if (groupAll.getLayers().length) {
    map.fitBounds(groupAll.getBounds().pad(0.3));
  }
}

//  Funciones de visibilidad: mostrar todos los yacimientos
function showAllYacimientos() {
    // Si ya hay pozos mostrados, removerlos del mapa antes de cargar nuevos
  if (activePozosLayers.length > 0) {
    activePozosLayers.forEach(c => {      
      try { map.removeLayer(c); } catch (e) {}
    });
    activePozosLayers = [];
  }
  // remover clusters temporales si existían
  if (window._tmpClusters && window._tmpClusters.length) {
    window._tmpClusters.forEach(c => { try { map.removeLayer(c); } catch(e){} });
    window._tmpClusters = [];
  }
  // quitar clusters permanentes si existían
  if (map.hasLayer(clusterEXT)) map.removeLayer(clusterEXT);
  if (map.hasLayer(clusterARG)) map.removeLayer(clusterARG);
  if (map.hasLayer(clusterYPF)) map.removeLayer(clusterYPF);

  // reanudar mostrar los yacimientos
  currentShownYacimiento = null;
  // opcional: ajustar bounds al conjunto de yacimientos visibles
  const boundsGroup = L.featureGroup();
  [yacYPF, yacARG, yacEXT].forEach(g => {
    g.eachLayer(l => boundsGroup.addLayer(l));
  });
  if (boundsGroup.getLayers().length) map.fitBounds(boundsGroup.getBounds().pad(0.3));
  
}

//  Manejo de filtros (checkboxes)
function updateYacimientosVisibility() {
  // limpiar todos    
  try { yacYPF.remove(); } catch(e){}
  try { yacARG.remove(); } catch(e){}
  try { yacEXT.remove(); } catch(e){}
  // añadir según flags 
  if (showEXT) yacEXT.addTo(map);
  if (showARG) yacARG.addTo(map);
  if (showYPF) yacYPF.addTo(map);
}

//  Controles filtros
const controlDiv = L.control({position: 'topright'});
controlDiv.onAdd = function () {
  const d = L.DomUtil.create('div','legend');
  d.innerHTML = `<div>
     <div id="filtros">
        <p style="font-weight:bold; margin:0px 6px;display:inline-block;">Filtro por empresa</p>
        <button id="chkYPF" class="btn filtro-btn" data-tipo="YPF">YPF</button>
        <button id="chkARG" class="btn filtro-btn" data-tipo="ARG">OTRAS ARGENTINAS</button>
        <button id="chkEXT" class="btn filtro-btn" data-tipo="EXT">EXTRANJERAS</button>
        <button id="btnReset" class="btn">Ver todos los yacimientos</button>
      </div>
    </div>`;
  return d;
};
//  Controles filtros mobile
const controlDivMob = L.control({position: 'topright'});
controlDivMob.onAdd = function () {
  const dMob = L.DomUtil.create('div','legend');
  dMob.innerHTML = `<div>
     <div id="filtrosMob">
        <p style="font-weight:bold; margin:0px 6px;display:block;">Filtro por empresa</p>
        <div class="bots"><button id="chkYPF" class="btn filtro-btn" data-tipo="YPF">YPF</button>
        <button id="chkARG" class="btn filtro-btn" data-tipo="ARG">OTRAS ARGENTINAS</button></div>
        <div class="bots"><button id="chkEXT" class="btn filtro-btn" data-tipo="EXT">EXTRANJERAS</button>
        <button id="btnReset" class="btn">Ver todos los yacimientos</button></div>
      </div>
    </div>`;
  return dMob;
};
isMob <= 800 ? controlDivMob.addTo(map) : controlDiv.addTo(map);
const actualizacion = L.control({position: 'bottomleft'});
actualizacion.onAdd = function () {
  const d = L.DomUtil.create('div','actualizacion');
  d.innerHTML = `<div>
     <p style="font-size:11px; margin:0px 6px;display:inline-block;">Datos actualizados al 21.10.2025</p>
    </div>`;
  return d;
};
// hideTapa();
actualizacion.addTo(map);